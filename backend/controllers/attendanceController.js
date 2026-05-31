const Attendance = require('../models/Attendance');
const Lecture = require('../models/Lecture');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Notification = require('../models/Notification');
const AttendanceDispute = require('../models/AttendanceDispute');
const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ExcelJS, addArraySheet, addJsonSheet, loadWorkbook, rowToValues } = require('../utils/excelWorkbook');
const { closeExpiredAttendance } = require('../utils/attendanceAutoClose');
const { uploadImage, downloadImage, isRemoteImage, deleteImage } = require('../utils/cloudinary');
const { SYSTEM_ADMIN_DEPARTMENT, adminDepartmentRoom, assertDepartmentAccess, getAdminDepartment, getAdminSemesterScope, getTeacherSemesterScope } = require('../utils/adminScope');
const { logAudit } = require('../utils/auditLogger');
const { studentMatchesSubject } = require('../utils/subjectEnrollment');
const { schedulePendingDeletion } = require('../utils/pendingDeletion');
const { studentCodeOf, studentIdentityFilter } = require('../utils/studentIdentity');

const attendanceFailure = (res, message, extra = {}) => {
  return res.json({ success: false, message, ...extra });
};

const subjectRestrictionFor = (student, subjectId) => (
  (student?.subjectRestrictions || []).find(item => (
    item?.active !== false &&
    String(item.subject?._id || item.subject) === String(subjectId)
  ))
);

const isRestrictedForSubject = (student, subjectId) => Boolean(
  student?.isRestricted ||
  student?.status === 'restricted' ||
  subjectRestrictionFor(student, subjectId)
);

const formatDate = (date) => date ? new Date(date).toLocaleDateString('en-IN') : '-';
const formatDateTime = (date) => date ? new Date(date).toLocaleString('en-IN') : '-';
const cleanFilePart = (value) => String(value || 'attendance').replace(/[^a-z0-9_-]+/gi, '_');
const studentIdSortValue = (value) => {
  const id = String(value || '').toUpperCase();
  const dMatch = id.match(/D(\d+)$/);
  if (dMatch) return 100000 + Number(dMatch[1]);
  const numberMatch = id.match(/(\d{1,4})$/);
  return numberMatch ? Number(numberMatch[1]) : Number.MAX_SAFE_INTEGER;
};
const parseDateBoundary = (value, endOfDay = false) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return date;
};

const sendWorkbook = async (res, workbook, filename) => {
  const buffer = await workbook.xlsx.writeBuffer();
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
};

const addSheet = (workbook, rows, name, cols = []) => {
  addJsonSheet(workbook, rows, name, cols);
};

const normalizeHeader = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

const getRowValue = (row, aliases = []) => {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
  }
  return '';
};

const parseSpreadsheetRows = async (filePath, ext) => {
  const { worksheets } = await loadWorkbook(filePath, ext);
  const worksheet = worksheets[0];
  if (!worksheet) return [];
  const rawRows = [];
  worksheet.eachRow({ includeEmpty: false }, row => rawRows.push(rowToValues(row)));
  if (rawRows.length < 2) return [];
  const headers = rawRows[0].map(normalizeHeader);
  return rawRows.slice(1)
    .map((values, index) => {
      const row = { __rowNumber: index + 2 };
      headers.forEach((header, colIndex) => {
        if (header) row[header] = values[colIndex];
      });
      return row;
    })
    .filter(row => Object.keys(row).some(key => key !== '__rowNumber' && String(row[key] || '').trim()));
};

const isDateHeader = (value) => {
  const date = parseImportDate(value);
  if (!date) return false;
  const year = date.getFullYear();
  return year >= 2000 && year <= 2100;
};

const stringifyCell = (value) => {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (value.result != null) return stringifyCell(value.result);
    if (value.text != null) return stringifyCell(value.text);
    if (value.richText) return value.richText.map(part => part.text || '').join('');
    if (value.formula || value.sharedFormula) return '';
  }
  return String(value).trim();
};

const rowHasContent = (values = []) => values.some(value => stringifyCell(value) !== '');

const looksLikeStudentIdHeader = (value) => {
  const header = normalizeHeader(value);
  return ['studentid', 'student', 'enrollmentno', 'enrollmentnumber', 'enrollment', 'rollno', 'rollnumber', 'roll', 'id'].includes(header);
};

const looksLikeNameHeader = (value) => {
  const header = normalizeHeader(value);
  return ['nameofstudent', 'studentname', 'name', 'fullname'].includes(header);
};

const looksLikeStatusHeader = (value) => {
  const header = normalizeHeader(value);
  return ['status', 'attendance', 'mark', 'presentabsent', 'present', 'attendancevalue'].includes(header);
};

const buildRowsFromHeader = (rawRows, headerIndex) => {
  const headers = rawRows[headerIndex].map(normalizeHeader);
  return rawRows.slice(headerIndex + 1)
    .map((values, index) => {
      const row = { __rowNumber: headerIndex + index + 2 };
      headers.forEach((header, colIndex) => {
        if (header) row[header] = values[colIndex];
      });
      return row;
    })
    .filter(row => Object.keys(row).some(key => key !== '__rowNumber' && stringifyCell(row[key]) !== ''));
};

const parseWideAttendanceRows = (rawRows, headerIndex, sheetName) => {
  const header = rawRows[headerIndex];
  const studentIdIndex = header.findIndex(looksLikeStudentIdHeader);
  const nameIndex = header.findIndex(looksLikeNameHeader);
  const dateColumns = header
    .map((value, index) => ({ value, index, date: parseImportDate(value) }))
    .filter(item => item.date && isDateHeader(item.value));

  if (studentIdIndex < 0 || dateColumns.length === 0) return [];

  const rows = [];
  rawRows.slice(headerIndex + 1).forEach((values, offset) => {
    const rowNumber = headerIndex + offset + 2;
    const studentId = stringifyCell(values[studentIdIndex]);
    const studentName = nameIndex >= 0 ? stringifyCell(values[nameIndex]) : '';
    if (!studentId || /^total|attendance|remark$/i.test(studentId)) return;

    dateColumns.forEach(({ index, date }) => {
      const rawStatus = values[index];
      const statusText = stringifyCell(rawStatus);
      if (statusText === '') return;
      rows.push({
        __rowNumber: rowNumber,
        __sheetName: sheetName,
        date,
        studentId,
        studentName,
        status: rawStatus
      });
    });
  });

  return rows;
};

const parseAttendanceImportRows = async (filePath, ext) => {
  const { worksheets } = await loadWorkbook(filePath, ext);
  const parsedRows = [];

  worksheets.forEach((worksheet) => {
    const rawRows = [];
    worksheet.eachRow({ includeEmpty: false }, row => rawRows.push(rowToValues(row)));
    if (rawRows.length < 2) return;

    let bestWide = { index: -1, score: 0 };
    let bestLong = { index: -1, score: 0 };
    rawRows.slice(0, 30).forEach((values, index) => {
      const hasStudentId = values.some(looksLikeStudentIdHeader);
      const dateCount = values.filter(isDateHeader).length;
      const hasDateHeader = values.some(value => normalizeHeader(value) === 'date' || normalizeHeader(value) === 'attendancedate' || normalizeHeader(value) === 'lecturedate' || normalizeHeader(value) === 'classdate');
      const hasStatusHeader = values.some(looksLikeStatusHeader);
      const wideScore = (hasStudentId ? 10 : 0) + dateCount;
      const longScore = (hasStudentId ? 10 : 0) + (hasDateHeader ? 5 : 0) + (hasStatusHeader ? 5 : 0);
      if (wideScore > bestWide.score) bestWide = { index, score: wideScore };
      if (longScore > bestLong.score) bestLong = { index, score: longScore };
    });

    if (bestWide.index >= 0 && bestWide.score >= 12) {
      parsedRows.push(...parseWideAttendanceRows(rawRows, bestWide.index, worksheet.name));
      return;
    }

    if (bestLong.index >= 0 && bestLong.score >= 15) {
      parsedRows.push(...buildRowsFromHeader(rawRows, bestLong.index));
      return;
    }

    parsedRows.push(...buildRowsFromHeader(rawRows, 0));
  });

  return parsedRows;
};

const normalizeAttendanceStatus = (value) => {
  const status = String(value || 'present').trim().toLowerCase();
  if (['present', 'p', '1', 'yes', 'y', 'true'].includes(status)) return 'present';
  if (['absent', 'a', '0', 'no', 'n', 'false'].includes(status)) return 'absent';
  return null;
};

const parseImportDate = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = String(value || '').trim();
  if (!raw) return null;
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const [, dd, mm, yyyy] = dmy;
    const year = yyyy.length === 2 ? Number(`20${yyyy}`) : Number(yyyy);
    const date = new Date(year, Number(mm) - 1, Number(dd));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
};

const importDateKey = (value) => {
  const date = parseDateBoundary(value, false);
  return date ? date.toISOString().slice(0, 10) : '';
};

const findOrCreateImportedLecture = async ({ subject, dayStart, req }) => {
  const dayEnd = parseDateBoundary(dayStart, true);
  let lecture = await Lecture.findOne({
    subject: subject._id,
    date: { $gte: dayStart, $lte: dayEnd },
    pendingDeletion: { $ne: true }
  }).sort({ startTime: 1 });

  if (!lecture) {
    return Lecture.create({
      subject: subject._id,
      title: `Imported Attendance - ${formatDate(dayStart)}`,
      description: 'Attendance imported from CSV/Excel sheet',
      date: dayStart,
      startTime: '00:00',
      endTime: '00:01',
      duration: 1,
      createdBy: req.user._id,
      status: 'completed',
      attendanceOpen: false,
      attendanceClosedAt: new Date(),
      source: 'imported'
    });
  }

  lecture.status = 'completed';
  lecture.attendanceOpen = false;
  lecture.attendanceClosedAt = lecture.attendanceClosedAt || new Date();
  lecture.source = 'imported';
  return lecture.save();
};

const rowStudentName = (row) => String(getRowValue(row, [
  'studentName', 'student name', 'name', 'full name', 'name of student'
]) || '').trim();

const rowStudentEmail = (row) => String(getRowValue(row, [
  'email', 'gmail', 'gmail id', 'email address'
]) || '').trim().toLowerCase();

const rowStudentIdentifier = (row) => String(getRowValue(row, [
  'studentId', 'student id', 'roll no', 'roll', 'enrollment no', 'enrollment', 'email', 'gmail'
]) || '').trim();

const syntheticImportEmail = async (studentId, subject) => {
  const base = String(studentId || crypto.randomUUID())
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '') || crypto.randomUUID();
  let candidate = `${base}@students.local`;
  let suffix = 1;
  while (await User.exists({ email: candidate })) {
    candidate = `${base}.${suffix}@students.local`;
    suffix += 1;
  }
  return candidate;
};

const findOrCreateImportStudent = async ({ row, subject, req, warnings, cache }) => {
  const rawIdentifier = rowStudentIdentifier(row);
  const email = rowStudentEmail(row);
  const studentId = email && rawIdentifier.toLowerCase() === email ? '' : rawIdentifier;
  const cacheKey = String(studentId || email || rawIdentifier).trim().toLowerCase();
  const cachedStudent = cacheKey && cache?.has(cacheKey) ? cache.get(cacheKey) : null;
  if (cachedStudent && !cachedStudent.__prefetchedForImport) return cachedStudent;
  const query = {
    role: 'student',
    pendingDeletion: { $ne: true },
    $or: []
  };
  if (studentId) query.$or.push({ studentId: new RegExp(`^${studentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
  if (email) query.$or.push({ email });

  let student = cachedStudent || (query.$or.length ? await User.findOne(query).select('name email studentId department branch semester enrolledSubjects status isRestricted restrictionReason subjectRestrictions') : null);
  if (student) {
    delete student.__prefetchedForImport;
    const warningParts = [];
    if (!studentMatchesSubject(student, subject)) warningParts.push('student academic details do not match this subject');
    if (!(student.enrolledSubjects || []).some(id => String(id) === String(subject._id))) warningParts.push('student was not enrolled in this subject');
    if (isRestrictedForSubject(student, subject._id)) warningParts.push('student is restricted');
    if (warningParts.length && warnings.length < 50) {
      warnings.push({ row: row.__rowNumber, message: `${student.studentId || student.email}: ${warningParts.join(', ')}. Attendance imported anyway.` });
    }
    await User.updateOne({ _id: student._id }, { $addToSet: { enrolledSubjects: subject._id } });
    student.enrolledSubjects = [...(student.enrolledSubjects || []), subject._id];
    if (cacheKey && cache) cache.set(cacheKey, student);
    return student;
  }

  if (!studentId && !email) return null;
  const placeholderId = studentId || `IMPORT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  student = await User.create({
    name: rowStudentName(row) || placeholderId,
    email: email || await syntheticImportEmail(placeholderId, subject),
    password: `Import@${crypto.randomUUID().slice(0, 12)}`,
    role: 'student',
    studentId: placeholderId,
    course: 'B. Tech',
    department: subject.department,
    branch: subject.branch || subject.department,
    semester: subject.semester,
    status: 'inactive',
    enrolledSubjects: [subject._id]
  });
  if (warnings.length < 50) {
    warnings.push({ row: row.__rowNumber, message: `${placeholderId}: student was not registered, so a placeholder inactive student was created and attendance was imported.` });
  }
  if (cacheKey && cache) cache.set(cacheKey, student);
  return student;
};

const resolveProfileImagePath = async (student) => {
  const candidates = [
    student.faceImagePath,
    student.profileImage
  ].filter(isRemoteImage);

  for (const candidate of candidates) {
    try {
      if (isRemoteImage(candidate)) {
        const filePath = await downloadImage(candidate, `profile_${student._id}`);
        return { filePath, tempFile: filePath };
      }
      if (fs.existsSync(candidate)) return { filePath: candidate, tempFile: null };
    } catch (err) {
      console.error('Cloud profile image fetch error:', err.message);
    }
  }

  return null;
};

const validateImageForEncoding = async (imagePath, timeout = 120000) => {
  const form = new FormData();
  form.append('image', fs.createReadStream(imagePath), path.basename(imagePath));

  const mlRes = await fetch(`${process.env.ML_SERVICE_URL || 'http://localhost:8000'}/validate-face`, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
    timeout
  });
  return mlRes.json();
};

const detectGuideFace = async (req, res) => {
  const file = req.file;
  try {
    if (!file) {
      return res.status(400).json({
        success: false,
        faceDetected: false,
        message: 'Camera frame is required.'
      });
    }

    const validation = await validateImageForEncoding(file.path, 30000);
    cleanupFiles([file.path]);

    return res.json({
      success: true,
      faceDetected: Boolean(validation.valid),
      ready: Boolean(validation.valid),
      message: validation.valid
        ? 'Face is inside the guide'
        : (validation.message || 'Move your face into the oval'),
      qualityScore: validation.quality_score,
      faceLocation: validation.face_location
    });
  } catch (err) {
    console.error('detectGuideFace error:', err.message);
    cleanupFiles([file?.path]);
    return res.status(503).json({
      success: false,
      faceDetected: false,
      ready: false,
      message: 'Face detection service is unavailable. Please try again.',
      ...(process.env.NODE_ENV === 'development' && {
        error: err.code || err.message
      })
    });
  }
};

const ensureStudentFaceEncoding = async (student, fallbackImagePath = null) => {
  if (student.faceEncoding && student.faceEncoding.length > 0) return { ok: true };

  const resolvedProfile = await resolveProfileImagePath(student);
  const tempDownloads = [resolvedProfile?.tempFile].filter(Boolean);
  const candidates = [resolvedProfile?.filePath, fallbackImagePath].filter(Boolean);

  if (candidates.length === 0) {
    cleanupFiles(tempDownloads);
    return { ok: false, message: 'No registered profile photo found. Please contact admin.' };
  }

  let lastMessage = 'Could not rebuild face data. Please retry with a clear face image.';

  for (const candidate of candidates) {
    try {
      const validation = await validateImageForEncoding(candidate);
      if (!validation.valid || !validation.encoding?.length) {
        lastMessage = validation.message || lastMessage;
        continue;
      }

      student.faceEncoding = validation.encoding;
      if (!student.faceImagePath && isRemoteImage(student.profileImage)) {
        student.faceImagePath = student.profileImage;
      }
      await student.save({ validateBeforeSave: false });
      cleanupFiles(tempDownloads);
      return { ok: true };
    } catch (err) {
      console.error('Face encoding rebuild error:', err.message);
      lastMessage = err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT'
        ? 'Face recognition service is not running. Start the ML service and try again.'
        : 'Face recognition service unavailable while rebuilding face data.';
    }
  }

  cleanupFiles(tempDownloads);
  return { ok: false, message: lastMessage };
};

const cleanupFiles = (paths = []) => {
  paths.filter(Boolean).forEach(file => {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (_) {}
  });
};

const getScopedSubjectIds = async (user) => {
  if (user?.role === 'teacher') {
    const query = { assignedTeachers: user._id, isActive: true, pendingDeletion: { $ne: true } };
    const semester = getTeacherSemesterScope(user);
    if (semester) query.semester = semester;
    const subjects = await Subject.find(query).select('_id');
    return subjects.map(subject => subject._id);
  }
  const department = getAdminDepartment(user);
  if (!department) return null;
  const query = { department, isActive: true };
  const semester = getAdminSemesterScope(user);
  if (semester) query.semester = semester;
  const subjects = await Subject.find(query).select('_id');
  return subjects.map(subject => subject._id);
};

const ensureSubjectAccess = (subject, req, res) => {
  if (!subject) {
    res.status(404).json({ success: false, message: 'Subject not found' });
    return false;
  }
  if (req.user.role === 'teacher') {
    const assigned = (subject.assignedTeachers || []).some(id => id.toString() === req.user._id.toString());
    if (!assigned) {
      res.status(403).json({ success: false, message: 'Access denied: subject is not assigned to this teacher' });
      return false;
    }
    const semester = getTeacherSemesterScope(req.user);
    if (semester && Number(subject.semester) !== semester) {
      res.status(403).json({ success: false, message: 'Access denied: subject belongs to another semester scope' });
      return false;
    }
    return true;
  }
  if (!assertDepartmentAccess(subject, req.user)) {
    res.status(403).json({ success: false, message: 'Access denied: subject belongs to another department' });
    return false;
  }
  const semester = getAdminSemesterScope(req.user);
  if (semester && Number(subject.semester) !== semester) {
    res.status(403).json({ success: false, message: 'Access denied: subject belongs to another semester scope' });
    return false;
  }
  return true;
};

const ensureLectureAccess = async (lecture, req, res) => {
  if (!lecture) {
    res.status(404).json({ success: false, message: 'Lecture not found' });
    return false;
  }
  const subject = lecture.subject?.department
    ? lecture.subject
    : await Subject.findById(lecture.subject).select('department semester assignedTeachers');
  return ensureSubjectAccess(subject, req, res);
};

const ensureStudentSubjectAccess = async (subjectId, req, res) => {
  const student = await User.findById(req.user._id).select('department branch semester enrolledSubjects role status isRestricted restrictionReason subjectRestrictions');
  const subject = await Subject.findById(subjectId).select('department branch semester isActive');
  if (!student || student.role !== 'student') {
    res.status(403).json({ success: false, message: 'Student access required' });
    return false;
  }
  if (!subject || !subject.isActive) {
    res.status(404).json({ success: false, message: 'Subject not found' });
    return false;
  }
  const allowed = studentMatchesSubject(student, subject) &&
    student.enrolledSubjects.some(id => id.toString() === subjectId);
  if (!allowed) {
    res.status(403).json({ success: false, message: 'Access denied: subject is not assigned to your semester' });
    return false;
  }
  if (isRestrictedForSubject(student, subjectId)) {
    res.status(403).json({
      success: false,
      message: student.isRestricted || student.status === 'restricted'
        ? 'Your profile is restricted. Attendance access is disabled.'
        : 'Your profile is restricted for this subject. Attendance access is disabled for this subject.'
    });
    return false;
  }
  return true;
};

const buildLectureAttendancePayload = async (lecture) => {
  const [attendanceRecords, enrolledStudents] = await Promise.all([
    Attendance.find({ lecture: lecture._id })
      .populate('student', 'name studentId profileImage department branch semester status isRestricted restrictionReason subjectRestrictions')
      .sort({ markedAt: -1 }),
    User.find({
      enrolledSubjects: lecture.subject._id,
      status: { $in: ['active', 'restricted'] },
      role: 'student',
      pendingDeletion: { $ne: true }
    }).select('name studentId profileImage department branch semester status isRestricted restrictionReason subjectRestrictions')
  ]);

  const matchingStudents = enrolledStudents.filter(student => studentMatchesSubject(student, lecture.subject));
  const matchingStudentIds = new Set(matchingStudents.map(student => student._id.toString()));
  const attendance = attendanceRecords.filter(record => (
    record.student && matchingStudentIds.has(record.student._id.toString())
    && record.status === 'present'
  ));
  const presentIds = new Set(attendance.map(record => record.student._id.toString()));
  const absentStudents = matchingStudents.filter(student => !presentIds.has(student._id.toString()));

  return {
    success: true,
    lecture,
    attendance,
    absentStudents,
    stats: {
      total: matchingStudents.length,
      present: attendance.length,
      absent: absentStudents.length,
      percentage: matchingStudents.length ? ((attendance.length / matchingStudents.length) * 100).toFixed(1) : 0
    }
  };
};

const emitDirectNotification = (req, userId, notification) => {
  const io = req.app.get('io');
  if (!io || !userId || !notification) return;
  io.to(`user_${userId}`).emit('notification_created', {
    _id: notification._id,
    title: notification.title,
    message: notification.message,
    type: notification.type,
    createdAt: notification.createdAt
  });
  io.to(`student_${userId}`).emit('notification_created', {
    _id: notification._id,
    title: notification.title,
    message: notification.message,
    type: notification.type,
    createdAt: notification.createdAt
  });
};

const safeImportSideEffect = async (label, task) => {
  try {
    return await task();
  } catch (error) {
    console.warn(`${label} failed after import save:`, error.message);
    return null;
  }
};

// @desc  Mark attendance via face recognition + OTP
const markAttendance = async (req, res) => {
  const faceFile = req.file || req.files?.faceCapture?.[0] || null;
  const livenessFiles = req.files?.livenessFrames || [];
  let filePath = faceFile?.path || null;
  let uploadedPaths = [filePath, ...livenessFiles.map(file => file.path)];
  try {
    await closeExpiredAttendance(req.app.get('io'));
    const { lectureId, attendanceCode } = req.body;
    const studentId = req.user._id;
    const studentRecordFilter = studentIdentityFilter(req.user);

    if (!faceFile) {
      return attendanceFailure(res, 'Face capture image is required.');
    }
    if (livenessFiles.length < 3) {
      cleanupFiles(uploadedPaths);
      return attendanceFailure(res, 'Live camera verification is required. Please use the camera, not an uploaded or displayed photo.');
    }
    if (!lectureId || !attendanceCode) {
      cleanupFiles(uploadedPaths);
      return attendanceFailure(res, 'lectureId and attendanceCode are required.');
    }

    const lecture = await Lecture.findById(lectureId).populate('subject', 'name code department branch semester pendingDeletion assignedTeachers');
    if (!lecture || lecture.pendingDeletion || lecture.subject?.pendingDeletion) {
      cleanupFiles(uploadedPaths);
      return attendanceFailure(res, 'Lecture not found.');
    }
    if (!lecture.attendanceOpen) {
      cleanupFiles(uploadedPaths);
      return attendanceFailure(res, 'Attendance is not open for this lecture.');
    }
    if (!(await ensureStudentSubjectAccess(lecture.subject._id.toString(), req, res))) {
      cleanupFiles(uploadedPaths);
      return;
    }
    if (lecture.attendanceCode !== attendanceCode) {
      cleanupFiles(uploadedPaths);
      return attendanceFailure(res, 'Invalid attendance code.');
    }
    if (new Date() > lecture.codeExpiresAt) {
      cleanupFiles(uploadedPaths);
      return attendanceFailure(res, 'Attendance code has expired.');
    }

    const existing = await Attendance.findOne({ lecture: lectureId, ...studentRecordFilter });
    if (existing) {
      cleanupFiles(uploadedPaths);
      return attendanceFailure(res, 'Attendance already marked for this lecture.');
    }

    const student = await User.findById(studentId);
    const faceData = await ensureStudentFaceEncoding(student, filePath);
    if (!faceData.ok) {
      cleanupFiles(uploadedPaths);
      return attendanceFailure(res, faceData.message);
    }

    // Call ML service
    let verificationResult;
    try {
      const form = new FormData();
      form.append('image', fs.createReadStream(filePath), faceFile.originalname);
      livenessFiles.forEach((liveFile, index) => {
        form.append('liveness_images', fs.createReadStream(liveFile.path), liveFile.originalname || `live_frame_${index}.jpg`);
      });
      form.append('student_id', student._id.toString());
      form.append('face_encoding', JSON.stringify(student.faceEncoding));
      form.append('profile_image_path', student.faceImagePath || '');

      const mlRes = await fetch(`${process.env.ML_SERVICE_URL || 'http://localhost:8000'}/verify-face`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
        timeout: 60000
      });
      verificationResult = await mlRes.json();
    } catch (err) {
      console.error('ML service error:', err.message);
      cleanupFiles(uploadedPaths);
      return res.status(503).json({ success: false, message: 'Face recognition service unavailable. Try again.' });
    }

    // Restricted student alert
    const subjectRestriction = subjectRestrictionFor(student, lecture.subject._id);
    if (verificationResult.is_restricted || isRestrictedForSubject(student, lecture.subject._id)) {
      const io = req.app.get('io');
      const recipients = await User.find({
        role: { $in: ['admin', 'teacher'] },
        status: 'active',
        department: lecture.subject.department
      });

      const notifPromises = recipients.map(recipient =>
        Notification.create({
          recipient: recipient._id,
          recipientRole: recipient.role,
          type: 'unwanted_student_detected',
          title: 'Restricted Student Detected',
          message: `Restricted student ${student.name} (${student.studentId}) attempted attendance in ${lecture.subject.name} - ${lecture.title}`,
          data: { studentId: student._id, studentName: student.name, lectureId, subjectId: lecture.subject._id, subjectRestriction: Boolean(subjectRestriction) },
          priority: 'critical'
        })
      );
      await Promise.all(notifPromises);

      if (io) {
        io.to(adminDepartmentRoom(lecture.subject.department)).emit('restricted_student_detected', {
          studentName: student.name,
          studentId: student.studentId,
          studentMongoId: student._id,
          lectureName: lecture.title,
          subjectName: lecture.subject.name,
          department: lecture.subject.department,
          timestamp: new Date()
        });
      }

      cleanupFiles(uploadedPaths);
      return res.status(403).json({
        success: false,
        message: subjectRestriction
          ? `Access denied. Your profile is restricted for ${lecture.subject.name}.`
          : 'Access denied. Your account is restricted.',
        restricted: true
      });
    }

    if (!verificationResult.match) {
      cleanupFiles(uploadedPaths);
      return attendanceFailure(res,
        verificationResult.message ||
        `Face verification failed. Confidence: ${verificationResult.confidence?.toFixed(1) || 0}%. Ensure proper lighting and face visibility.`,
        {
          confidence: verificationResult.confidence,
          threshold: verificationResult.threshold,
          distance: verificationResult.distance,
          livenessScore: verificationResult.liveness_score,
          activeLivenessScore: verificationResult.active_liveness_score,
          details: verificationResult.details
        }
      );
    }

    const minActiveLiveness = Number(process.env.MIN_ACTIVE_LIVENESS_SCORE || 0.35);
    const minQualityScore = Number(process.env.MIN_FACE_QUALITY_SCORE || 0.25);
    const activeLivenessScore = Number(verificationResult.active_liveness_score ?? verificationResult.liveness_score ?? 1);
    const qualityScore = Number(verificationResult.quality_score ?? 1);
    if (activeLivenessScore < minActiveLiveness || qualityScore < minQualityScore) {
      cleanupFiles(uploadedPaths);
      return attendanceFailure(res, 'Liveness verification failed. Please use the live camera with clear lighting and natural face movement.', {
        livenessScore: verificationResult.liveness_score,
        activeLivenessScore: verificationResult.active_liveness_score,
        qualityScore: verificationResult.quality_score,
        requiredLivenessScore: minActiveLiveness,
        requiredQualityScore: minQualityScore
      });
    }

    let captureUpload;
    try {
      captureUpload = await uploadImage(filePath, {
        folder: `${process.env.CLOUDINARY_FOLDER || 'studysphere'}/captures`,
        publicId: `attendance_${student.studentId || student._id}_${lectureId}_${Date.now()}`
      });
    } catch (err) {
      console.error('Cloudinary upload error during attendance:', err.message);
      cleanupFiles(uploadedPaths);
      return res.status(503).json({
        success: false,
        message: 'Cloud image storage is unavailable. Attendance was not saved. Please try again.',
        ...(process.env.NODE_ENV === 'development' && {
          error: err.code || err.message
        })
      });
    }

    const attendance = await Attendance.create({
      lecture: lectureId,
      subject: lecture.subject._id,
      student: studentId,
      studentId: studentCodeOf(student),
      status: 'present',
      faceVerified: true,
      faceConfidence: verificationResult.confidence,
      capturedImagePath: captureUpload.url,
      capturedImagePublicId: captureUpload.publicId,
      verificationDetails: {
        faceMatch: verificationResult.match,
        confidence: verificationResult.confidence,
        livenessScore: verificationResult.liveness_score,
        activeLivenessScore: verificationResult.active_liveness_score,
        bodyLanguageScore: verificationResult.body_language_score,
        eyeOpenScore: verificationResult.eye_open_score,
        qualityScore: verificationResult.quality_score
      },
      codeUsed: attendanceCode,
      ipAddress: req.ip,
      markedBy: 'student'
    });
    cleanupFiles(uploadedPaths);
    uploadedPaths = [];

    await attendance.populate('lecture subject');

    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('attendance_marked', {
        studentName: student.name,
        studentId: student.studentId,
        lectureName: lecture.title,
        subjectName: lecture.subject.name,
        confidence: verificationResult.confidence,
        timestamp: new Date()
      });
      io.to(adminDepartmentRoom(lecture.subject.department)).emit('attendance_marked', {
        studentName: student.name,
        studentId: student.studentId,
        lectureName: lecture.title,
        subjectName: lecture.subject.name,
        confidence: verificationResult.confidence,
        timestamp: new Date()
      });
    }

    res.json({
      success: true,
      message: 'Attendance marked successfully!',
      attendance: {
        _id: attendance._id,
        status: 'present',
        markedAt: attendance.markedAt || attendance.createdAt,
        faceConfidence: verificationResult.confidence,
        subject: lecture.subject.name,
        lecture: lecture.title
      }
    });
  } catch (err) {
    console.error('markAttendance error:', err);
    cleanupFiles(uploadedPaths);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// @desc  Get student's attendance for a subject
const getStudentSubjectAttendance = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const studentId = req.user._id;
    if (!(await ensureStudentSubjectAccess(subjectId, req, res))) return;

    const lectures = await Lecture.find({ subject: subjectId, status: 'completed' })
      .populate('subject', 'name code branch semester department assignedTeachers')
      .sort({ date: 1, startTime: 1, createdAt: 1 });
    const lectureIds = lectures.map(lec => lec._id);

    const attendanceRecords = await Attendance.find({
      ...studentIdentityFilter(req.user),
      subject: subjectId,
      lecture: { $in: lectureIds },
      status: 'present'
    }).populate('lecture', 'title date startTime endTime');

    const attendanceMap = {};
    attendanceRecords.forEach(a => {
      if (a.lecture?._id) attendanceMap[a.lecture._id.toString()] = a;
    });

    const disputes = await AttendanceDispute.find({
      ...studentIdentityFilter(req.user),
      subject: subjectId,
      lecture: { $in: lectureIds }
    }).lean();
    const disputeMap = {};
    disputes.forEach(dispute => { disputeMap[dispute.lecture.toString()] = dispute; });

    const result = lectures.map(lec => ({
      lecture: lec,
      attendance: attendanceMap[lec._id.toString()] || null,
      status: attendanceMap[lec._id.toString()] ? 'present' : 'absent',
      dispute: disputeMap[lec._id.toString()] || null
    }));

    const presentCount = Object.keys(attendanceMap).length;
    const totalCount = lectures.length;
    const percentage = totalCount > 0 ? ((presentCount / totalCount) * 100).toFixed(2) : '0.00';

    res.json({
      success: true,
      records: result,
      stats: { present: presentCount, total: totalCount, percentage }
    });
  } catch (err) {
    console.error('getStudentSubjectAttendance error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const createAttendanceDispute = async (req, res) => {
  try {
    const { lectureId, lectureIds, reason } = req.body || {};
    const ids = [...new Set((Array.isArray(lectureIds) ? lectureIds : [lectureId]).filter(Boolean).map(String))];
    if (!ids.length || !String(reason || '').trim()) {
      return res.status(400).json({ success: false, message: 'Lecture and reason are required.' });
    }

    const lectures = await Lecture.find({ _id: { $in: ids } }).populate('subject', 'name code department branch semester assignedTeachers');
    if (lectures.length !== ids.length || lectures.some(lecture => lecture.status !== 'completed')) {
      return res.status(400).json({ success: false, message: 'Disputes can be raised only for completed lectures.' });
    }
    const subjectIds = [...new Set(lectures.map(lecture => lecture.subject._id.toString()))];
    if (subjectIds.length !== 1) {
      return res.status(400).json({ success: false, message: 'Combined disputes must be for one subject only.' });
    }
    if (!(await ensureStudentSubjectAccess(subjectIds[0], req, res))) return;

    const presentLectureIds = await Attendance.distinct('lecture', {
      lecture: { $in: lectures.map(lecture => lecture._id) },
      ...studentIdentityFilter(req.user),
      status: 'present'
    });
    const presentSet = new Set(presentLectureIds.map(String));
    const disputedLectures = lectures.filter(lecture => !presentSet.has(String(lecture._id)));
    if (!disputedLectures.length) {
      return res.status(400).json({ success: false, message: 'Selected attendance records are already marked present.' });
    }

    const disputes = [];
    for (const lecture of disputedLectures) {
      const dispute = await AttendanceDispute.findOneAndUpdate(
        { lecture: lecture._id, ...studentIdentityFilter(req.user) },
        {
          $setOnInsert: {
            lecture: lecture._id,
            subject: lecture.subject._id,
            student: req.user._id,
            studentId: studentCodeOf(req.user),
          },
          $set: {
            reason: String(reason).trim(),
            status: 'pending',
            resolutionNote: ''
          },
          $unset: {
            resolvedBy: '',
            resolvedAt: ''
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      disputes.push(dispute);
    }

    const lecture = disputedLectures[0];
    const recipients = (lecture.subject.assignedTeachers || []).map(id => id.toString());
    const admins = await User.find({
      role: 'admin',
      status: 'active',
      department: { $in: [SYSTEM_ADMIN_DEPARTMENT, lecture.subject.department] }
    }).select('_id').lean();
    admins.forEach(admin => recipients.push(admin._id.toString()));
    const uniqueRecipients = [...new Set(recipients)];
    await Promise.all(uniqueRecipients.map(recipient => Notification.create({
      recipient,
      recipientRole: 'admin',
      type: 'attendance_dispute_created',
      title: 'Attendance correction requested',
      message: `${req.user.name} requested correction for ${lecture.subject.name}${disputes.length > 1 ? ` across ${disputes.length} dates` : ` - ${lecture.title}`}.`,
      data: { disputeId: disputes[0]._id, disputeIds: disputes.map(item => item._id), lectureId: lecture._id, subjectId: lecture.subject._id, studentId: req.user._id },
      priority: 'high'
    }).then(notification => emitDirectNotification(req, recipient, notification))));

    res.status(201).json({ success: true, dispute: disputes[0], disputes, count: disputes.length });
  } catch (err) {
    console.error('createAttendanceDispute error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getAttendanceDisputes = async (req, res) => {
  try {
    const scopedSubjectIds = await getScopedSubjectIds(req.user);
    const query = {};
    if (scopedSubjectIds) query.subject = { $in: scopedSubjectIds };
    if (req.query.subjectId) {
      if (scopedSubjectIds && !scopedSubjectIds.some(id => id.toString() === String(req.query.subjectId))) {
        return res.status(403).json({ success: false, message: 'Access denied for this subject.' });
      }
      query.subject = req.query.subjectId;
    }
    if (req.query.status) query.status = req.query.status;
    if (req.query.startDate || req.query.endDate) {
      const start = parseDateBoundary(req.query.startDate || new Date(0));
      const end = parseDateBoundary(req.query.endDate || new Date(), true);
      const lectureQuery = { date: { $gte: start, $lte: end } };
      if (query.subject) lectureQuery.subject = query.subject;
      const lectureIds = await Lecture.distinct('_id', lectureQuery);
      query.lecture = { $in: lectureIds };
    }
    const disputes = await AttendanceDispute.find(query)
      .populate('student', 'name studentId email profileImage department branch semester')
      .populate('subject', 'name code department branch semester assignedTeachers')
      .populate('lecture', 'title date startTime endTime')
      .populate('resolvedBy', 'name email role')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ success: true, disputes });
  } catch (err) {
    console.error('getAttendanceDisputes error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const resolveAttendanceDispute = async (req, res) => {
  try {
    const { status, note = '', attendanceStatus } = req.body || {};
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Resolution status must be approved or rejected.' });
    }
    if (attendanceStatus && !['present', 'absent'].includes(attendanceStatus)) {
      return res.status(400).json({ success: false, message: 'Attendance status must be present or absent.' });
    }
    const dispute = await AttendanceDispute.findById(req.params.id)
      .populate('subject', 'name code department branch semester assignedTeachers')
      .populate('lecture', 'title date startTime endTime')
      .populate('student', 'name studentId');
    if (!dispute) return res.status(404).json({ success: false, message: 'Dispute not found.' });
    if (!ensureSubjectAccess(dispute.subject, req, res)) return;

    dispute.status = status;
    dispute.resolvedBy = req.user._id;
    dispute.resolvedAt = new Date();
    dispute.resolutionNote = String(note || '').trim();
    await dispute.save();

    const nextAttendanceStatus = attendanceStatus || (status === 'approved' ? 'present' : null);
    if (nextAttendanceStatus) {
      await Attendance.findOneAndUpdate(
        { lecture: dispute.lecture._id, ...studentIdentityFilter(dispute.student) },
        {
          $set: {
            lecture: dispute.lecture._id,
            subject: dispute.subject._id,
            student: dispute.student._id,
            studentId: studentCodeOf(dispute.student),
            status: nextAttendanceStatus,
            markedAt: new Date(),
            faceVerified: false,
            markedBy: 'admin',
            verificationDetails: { disputeResolved: true, disputeStatus: status }
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    const noteText = dispute.resolutionNote ? ` Note: ${dispute.resolutionNote}` : '';
    const attendanceText = nextAttendanceStatus ? ` Attendance is marked ${nextAttendanceStatus}.` : '';
    const notification = await Notification.create({
      recipient: dispute.student._id,
      recipientStudentId: studentCodeOf(dispute.student),
      recipientRole: 'student',
      type: 'attendance_dispute_resolved',
      title: `Attendance request ${status}`,
      message: `Your correction request for ${dispute.subject.name} - ${dispute.lecture.title} was ${status}.${attendanceText}${noteText}`,
      data: {
        disputeId: dispute._id,
        lectureId: dispute.lecture._id,
        subjectId: dispute.subject._id,
        status,
        attendanceStatus: nextAttendanceStatus || undefined,
        note: dispute.resolutionNote || undefined
      },
      priority: status === 'approved' ? 'medium' : 'high'
    });
    emitDirectNotification(req, dispute.student._id, notification);

    res.json({ success: true, dispute });
  } catch (err) {
    console.error('resolveAttendanceDispute error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const deleteAttendanceDispute = async (req, res) => {
  try {
    const dispute = await AttendanceDispute.findById(req.params.id)
      .populate('subject', 'name code department branch semester assignedTeachers');
    if (!dispute) return res.status(404).json({ success: false, message: 'Dispute not found.' });
    if (!ensureSubjectAccess(dispute.subject, req, res)) return;

    await AttendanceDispute.deleteOne({ _id: dispute._id });
    res.json({ success: true, message: 'Dispute deleted.' });
  } catch (err) {
    console.error('deleteAttendanceDispute error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const deleteAttendanceDisputes = async (req, res) => {
  try {
    const scopedSubjectIds = await getScopedSubjectIds(req.user);
    const query = {};
    if (scopedSubjectIds) query.subject = { $in: scopedSubjectIds };
    if (req.query.subjectId) {
      if (scopedSubjectIds && !scopedSubjectIds.some(id => id.toString() === String(req.query.subjectId))) {
        return res.status(403).json({ success: false, message: 'Access denied for this subject.' });
      }
      const subject = await Subject.findById(req.query.subjectId).select('name code department branch semester assignedTeachers');
      if (!subject) return res.status(404).json({ success: false, message: 'Subject not found.' });
      if (!ensureSubjectAccess(subject, req, res)) return;
      query.subject = req.query.subjectId;
    }
    if (req.query.status) query.status = req.query.status;

    const result = await AttendanceDispute.deleteMany(query);
    res.json({ success: true, deletedCount: result.deletedCount || 0, message: `${result.deletedCount || 0} dispute${result.deletedCount === 1 ? '' : 's'} deleted.` });
  } catch (err) {
    console.error('deleteAttendanceDisputes error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// @desc  Download attendance as Excel
const downloadAttendanceExcel = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const student = await User.findById(req.user._id).select('name studentId department branch semester');
    const subject = await Subject.findById(subjectId);

    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found' });
    if (!studentMatchesSubject(student, subject)) {
      return res.status(403).json({ success: false, message: 'Access denied: subject is not assigned to your semester' });
    }

    const lectures = await Lecture.find({ subject: subjectId, status: 'completed' }).sort({ date: 1, startTime: 1, createdAt: 1 });
    const lectureIds = lectures.map(lec => lec._id);
    const attendanceRecords = await Attendance.find({
      ...studentIdentityFilter(student),
      subject: subjectId,
      lecture: { $in: lectureIds },
      status: 'present'
    });

    const attendanceMap = {};
    attendanceRecords.forEach(a => { attendanceMap[a.lecture.toString()] = a; });

    const presentCount = Object.keys(attendanceMap).length;
    const totalCount = lectures.length;
    const absentCount = Math.max(totalCount - presentCount, 0);
    const percentage = totalCount > 0 ? ((presentCount / totalCount) * 100).toFixed(2) : '0.00';

    const rows = lectures.map((lec, index) => {
      const att = attendanceMap[lec._id.toString()];
      return {
        'Sr. No.': index + 1,
        'Date': formatDate(lec.date),
        'Lecture Title': lec.title,
        'Start Time': lec.startTime,
        'End Time': lec.endTime,
        'Status': att ? 'Present' : 'Absent',
        'Marked At': att ? formatDateTime(att.markedAt || att.createdAt) : '-',
        'Face Confidence': att ? `${att.faceConfidence?.toFixed(1) || 0}%` : '-',
        'Verification': att ? (att.faceVerified ? 'Face Verified' : 'Manual') : '-'
      };
    });

    const workbookRows = [
      ['StudySphere - Student Attendance Report'],
      [],
      ['Student Name', student.name || '-'],
      ['Student ID', student.studentId || '-'],
      ['Department', student.department || subject.department || '-'],
      ['Semester', student.semester || subject.semester || '-'],
      ['Subject', subject.name],
      ['Subject Code', subject.code],
      ['Generated On', formatDateTime(new Date())],
      [],
      ['Summary'],
      ['Total Lectures', totalCount],
      ['Present', presentCount],
      ['Absent', absentCount],
      ['Attendance %', `${percentage}%`],
      [],
      ['Sr. No.', 'Date', 'Lecture Title', 'Start Time', 'End Time', 'Status', 'Marked At', 'Face Confidence', 'Verification'],
      ...rows.map(row => [
        row['Sr. No.'],
        row.Date,
        row['Lecture Title'],
        row['Start Time'],
        row['End Time'],
        row.Status,
        row['Marked At'],
        row['Face Confidence'],
        row.Verification
      ])
    ];

    if (rows.length === 0) {
      workbookRows.push(['-', '-', 'No lectures found for this subject', '-', '-', '-', '-', '-', '-']);
    }

    const wb = new ExcelJS.Workbook();
    addArraySheet(wb, workbookRows, 'Attendance', [8, 14, 30, 12, 12, 10, 22, 16, 16]);
    const ws = wb.getWorksheet('Attendance');
    ws.mergeCells('A1:I1');
    ws.autoFilter = `A17:I${Math.max(17 + rows.length, 18)}`;

    const filename = `Attendance_${cleanFilePart(student.studentId)}_${cleanFilePart(subject.code)}.xlsx`;
    await sendWorkbook(res, wb, filename);
  } catch (err) {
    console.error('downloadAttendanceExcel error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getAdminAttendanceByLecture = async (req, res) => {
  try {
    const { lectureId } = req.params;
    const lecture = await Lecture.findById(lectureId).populate('subject', 'name code department branch semester assignedTeachers');
    if (!(await ensureLectureAccess(lecture, req, res))) return;
    await logAudit(req, {
      action: 'attendance.viewed',
      entityType: 'lecture',
      entityId: lecture._id,
      entityName: lecture.title,
      targetDepartment: lecture.subject.department,
    });
    res.json(await buildLectureAttendancePayload(lecture));
  } catch (err) {
    console.error('getAdminAttendanceByLecture error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const updateLectureAttendanceStatus = async (req, res) => {
  try {
    const { lectureId } = req.params;
    const { studentId, studentIds, status } = req.body || {};
    const targetStudentIds = Array.isArray(studentIds) && studentIds.length ? studentIds : (studentId ? [studentId] : []);
    const uniqueStudentIds = [...new Set(targetStudentIds.map(id => String(id)).filter(Boolean))];
    if (!uniqueStudentIds.length || !['present', 'absent'].includes(status)) {
      return res.status(400).json({ success: false, message: 'studentId/studentIds and status (present/absent) are required' });
    }

    const lecture = await Lecture.findById(lectureId).populate('subject', 'name code department branch semester assignedTeachers');
    if (!(await ensureLectureAccess(lecture, req, res))) return;

    const students = await User.find({
      _id: { $in: uniqueStudentIds },
      role: 'student',
      enrolledSubjects: lecture.subject._id,
      pendingDeletion: { $ne: true }
    }).select('name studentId department branch semester enrolledSubjects status isRestricted restrictionReason subjectRestrictions');
    const invalidStudent = students.find(student => !studentMatchesSubject(student, lecture.subject));
    if (students.length !== uniqueStudentIds.length || invalidStudent) {
      return res.status(404).json({ success: false, message: 'One or more selected students are not enrolled in this subject branch/semester' });
    }
    if (students.some(student => isRestrictedForSubject(student, lecture.subject._id))) {
      return res.status(403).json({ success: false, message: 'One or more selected profiles are restricted. Attendance cannot be marked for restricted profiles.' });
    }

    if (status === 'present') {
      await Promise.all(students.map(student => (
        Attendance.findOneAndUpdate(
          { lecture: lecture._id, ...studentIdentityFilter(student) },
          {
            $set: {
              lecture: lecture._id,
              subject: lecture.subject._id,
              student: student._id,
              studentId: studentCodeOf(student),
              status: 'present',
              markedAt: new Date(),
              faceVerified: false,
              markedBy: 'admin',
              faceConfidence: null,
              verificationDetails: {}
            },
            $unset: {
              capturedImagePath: '',
              capturedImagePublicId: '',
              codeUsed: ''
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        )
      )));
    } else {
      const existingRecords = await Attendance.find({
        lecture: lecture._id,
        $or: [
          { student: { $in: students.map(student => student._id) } },
          { studentId: { $in: students.map(student => studentCodeOf(student)).filter(Boolean) } }
        ]
      }).select('capturedImagePublicId');
      await Promise.all(existingRecords
        .filter(record => record.capturedImagePublicId)
        .map(async record => {
          try { await deleteImage(record.capturedImagePublicId); } catch (err) { console.error('Manual attendance image cleanup error:', err.message); }
        }));
      await Promise.all(students.map(student => (
        Attendance.findOneAndUpdate(
          { lecture: lecture._id, ...studentIdentityFilter(student) },
          {
            $set: {
              lecture: lecture._id,
              subject: lecture.subject._id,
              student: student._id,
              studentId: studentCodeOf(student),
              status: 'absent',
              markedAt: new Date(),
              faceVerified: false,
              markedBy: 'admin',
              faceConfidence: null,
              verificationDetails: {}
            },
            $unset: {
              capturedImagePath: '',
              capturedImagePublicId: '',
              codeUsed: ''
            }
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        )
      )));
    }

    await Promise.all(students.map(student => logAudit(req, {
      action: 'attendance.edited',
      entityType: 'lecture',
      entityId: lecture._id,
      entityName: lecture.title,
      targetDepartment: lecture.subject.department,
      details: {
        studentId: student._id,
        studentName: student.name,
        status,
        bulkCount: students.length
      }
    })));

    const payload = await buildLectureAttendancePayload(lecture);
    const io = req.app.get('io');
    if (io) {
      const updatePayload = {
        lectureId: lecture._id,
        subjectId: lecture.subject._id,
        studentIds: students.map(student => student._id),
        status,
        updatedBy: req.user._id,
        stats: payload.stats,
        timestamp: new Date()
      };
      io.to('admin_room').emit('attendance_updated', updatePayload);
      io.to(adminDepartmentRoom(lecture.subject.department)).emit('attendance_updated', updatePayload);
      io.to('admin_room').emit('lectures_changed', updatePayload);
      io.to(adminDepartmentRoom(lecture.subject.department)).emit('lectures_changed', updatePayload);
    }

    res.json(payload);
  } catch (err) {
    console.error('updateLectureAttendanceStatus error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const importSubjectAttendance = async (req, res) => {
  const filePath = req.file?.path;
  try {
    const { subjectId } = req.params;
    const subject = await Subject.findById(subjectId).select('name code department branch semester assignedTeachers');
    if (!ensureSubjectAccess(subject, req, res)) return;
    if (!filePath) {
      return res.status(400).json({ success: false, message: 'CSV or Excel file is required' });
    }

    const rows = await parseAttendanceImportRows(filePath, path.extname(req.file.originalname));
    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'No attendance rows found in the file' });
    }

    const todayEnd = parseDateBoundary(new Date(), true);
    const dateAliases = ['date', 'attendance date', 'lecture date', 'class date'];
    const fallbackImportDate = rows
      .map(row => parseImportDate(getRowValue(row, dateAliases)))
      .find(Boolean);
    if (!fallbackImportDate) {
      return res.status(400).json({
        success: false,
        message: 'The sheet must include a Date, Attendance Date, or Lecture Date column.'
      });
    }

    const results = { imported: 0, present: 0, absent: 0, skipped: 0, lectures: 0, dates: [], errors: [], warnings: [] };
    const addImportError = (row, message) => {
      if (results.errors.length < 50) results.errors.push({ row, message });
    };
    const addImportWarning = (row, message) => {
      if (results.warnings.length < 50) results.warnings.push({ row, message });
    };
    const rowsByDate = new Map();
    const importStudentCache = new Map();
    const candidateStudentIds = new Set();
    const candidateEmails = new Set();

    rows.forEach((row) => {
      const identifier = rowStudentIdentifier(row);
      const email = rowStudentEmail(row);
      if (identifier && identifier.toLowerCase() !== email) {
        candidateStudentIds.add(identifier);
        candidateStudentIds.add(identifier.toUpperCase());
      }
      if (email) candidateEmails.add(email);
    });

    if (candidateStudentIds.size || candidateEmails.size) {
      const studentQuery = {
        role: 'student',
        pendingDeletion: { $ne: true },
        $or: []
      };
      if (candidateStudentIds.size) studentQuery.$or.push({ studentId: { $in: [...candidateStudentIds] } });
      if (candidateEmails.size) studentQuery.$or.push({ email: { $in: [...candidateEmails] } });
      const knownStudents = await User.find(studentQuery)
        .select('name email studentId department branch semester enrolledSubjects status isRestricted restrictionReason subjectRestrictions')
        .lean();
      knownStudents.forEach((student) => {
        student.__prefetchedForImport = true;
        if (student.studentId) importStudentCache.set(String(student.studentId).trim().toLowerCase(), student);
        if (student.email) importStudentCache.set(String(student.email).trim().toLowerCase(), student);
      });
    }

    for (const row of rows) {
      const importDate = parseImportDate(getRowValue(row, dateAliases)) || fallbackImportDate;
      const dayStart = parseDateBoundary(importDate, false);
      const dateKey = importDateKey(dayStart);
      if (!dayStart || dayStart > todayEnd) {
        results.skipped += 1;
        addImportError(row.__rowNumber, 'Invalid or future attendance date');
        continue;
      }
      if (!rowsByDate.has(dateKey)) rowsByDate.set(dateKey, { dayStart, rows: [] });
      rowsByDate.get(dateKey).rows.push(row);
    }

    const touchedLectures = [];
    const touchedStudentIds = new Set();

    for (const [, group] of rowsByDate) {
      const { dayStart, rows: dateRows } = group;
      const seenStudents = new Set();
      const validMarks = [];

      for (const row of dateRows) {
        const key = rowStudentIdentifier(row);
        const status = normalizeAttendanceStatus(getRowValue(row, ['status', 'attendance', 'mark', 'present/absent']));
        if (!key) {
          results.skipped += 1;
          addImportWarning(row.__rowNumber, 'Missing studentId/email. Row ignored.');
          continue;
        }
        if (!status) {
          results.skipped += 1;
          addImportWarning(row.__rowNumber, 'Status must be present or absent. Row ignored.');
          continue;
        }

        const student = await findOrCreateImportStudent({ row, subject, req, warnings: results.warnings, cache: importStudentCache });
        if (!student) {
          results.skipped += 1;
          addImportWarning(row.__rowNumber, 'Student could not be resolved. Row ignored.');
          continue;
        }
        if (seenStudents.has(String(student._id))) {
          results.skipped += 1;
          addImportWarning(row.__rowNumber, 'Duplicate student row ignored for this date.');
          continue;
        }

        seenStudents.add(String(student._id));
        touchedStudentIds.add(String(student._id));
        validMarks.push({ student, status });
      }

      if (!validMarks.length) continue;

      const lecture = await findOrCreateImportedLecture({ subject, dayStart, req });
      touchedLectures.push(lecture);
      results.lectures += 1;
      results.dates.push(dayStart.toISOString().slice(0, 10));

      const operations = validMarks.map(({ student, status }) => ({
        updateOne: {
          filter: { lecture: lecture._id, ...studentIdentityFilter(student) },
          update: {
            $set: {
              lecture: lecture._id,
              subject: subject._id,
              student: student._id,
              studentId: studentCodeOf(student),
              status,
              markedAt: dayStart,
              faceVerified: false,
              markedBy: 'admin',
              faceConfidence: null,
              verificationDetails: {
                faceMatch: false,
                confidence: 0
              },
              isAutomatic: false
            },
            $unset: {
              capturedImagePath: '',
              capturedImagePublicId: '',
              codeUsed: ''
            }
          },
          upsert: true,
          setDefaultsOnInsert: true
        }
      }));

      if (operations.length) {
        await Attendance.bulkWrite(operations, { ordered: false });
      }

      for (const { status } of validMarks) {
        results.imported += 1;
        results[status] += 1;
      }
    }

    await safeImportSideEffect('Attendance import audit log', () => logAudit(req, {
      action: 'attendance.imported',
      entityType: 'subject',
      entityId: subject._id,
      entityName: subject.name,
      targetDepartment: subject.department,
      details: {
        lectureIds: touchedLectures.map(item => item._id),
        dates: results.dates,
        imported: results.imported,
        skipped: results.skipped
      }
    }));

    const latestLecture = touchedLectures[touchedLectures.length - 1];
    const payload = latestLecture
      ? (await safeImportSideEffect('Attendance import payload build', async () => (
          buildLectureAttendancePayload(await latestLecture.populate('subject', 'name code department branch semester assignedTeachers'))
        ))) || { stats: null, lecture: null }
      : { stats: null, lecture: null };
    const io = req.app.get('io');
    await safeImportSideEffect('Attendance import socket emit', async () => {
      if (!io) return;
      const updatePayload = {
        lectureId: latestLecture?._id,
        lectureIds: touchedLectures.map(item => item._id),
        subjectId: subject._id,
        imported: results.imported,
        updatedBy: req.user._id,
        stats: payload.stats,
        timestamp: new Date()
      };
      io.to('admin_room').emit('attendance_updated', updatePayload);
      io.to(adminDepartmentRoom(subject.department)).emit('attendance_updated', updatePayload);
      io.to('admin_room').emit('lectures_changed', updatePayload);
      io.to(adminDepartmentRoom(subject.department)).emit('lectures_changed', updatePayload);
      touchedStudentIds.forEach(studentId => {
        io.to(`student_${studentId}`).emit('attendance_updated', updatePayload);
        io.to(`user_${studentId}`).emit('attendance_updated', updatePayload);
        io.to(`student_${studentId}`).emit('lectures_changed', updatePayload);
        io.to(`user_${studentId}`).emit('lectures_changed', updatePayload);
      });
    });

    res.json({
      success: true,
      message: `Imported ${results.imported} attendance records`,
      lecture: payload.lecture,
      stats: payload.stats,
      importSummary: results
    });
  } catch (err) {
    console.error('importSubjectAttendance error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  } finally {
    cleanupFiles([filePath]);
  }
};

const scheduleImportedAttendanceDeletion = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { startDate, endDate } = req.body || {};
    const subject = await Subject.findById(subjectId).select('name code department branch semester assignedTeachers');
    if (!ensureSubjectAccess(subject, req, res)) return;
    const start = parseDateBoundary(startDate, false);
    const end = parseDateBoundary(endDate || startDate, true);
    if (!start || !end || start > end) {
      return res.status(400).json({ success: false, message: 'Select a valid date range.' });
    }

    const lectures = await Lecture.find({
      subject: subject._id,
      source: 'imported',
      pendingDeletion: { $ne: true },
      date: { $gte: start, $lte: end }
    }).select('_id title date subject');

    if (!lectures.length) {
      return res.status(404).json({ success: false, message: 'No imported attendance found in this date range.' });
    }

    const batchId = crypto.randomUUID();
    const batchName = `${subject.code || subject.name} imported attendance ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`;
    const now = new Date();
    const deletions = [];
    for (const lecture of lectures) {
      const deletion = await schedulePendingDeletion({
        resourceType: 'lecture',
        resourceId: lecture._id,
        resourceName: lecture.title,
        targetDepartment: subject.department,
        requestedBy: req.user._id,
        batchId,
        batchName,
        batchCount: lectures.length
      });
      lecture.pendingDeletion = true;
      lecture.deletionScheduledAt = now;
      lecture.deletionExpiresAt = deletion.expiresAt;
      await lecture.save();
      deletions.push(deletion);
    }

    await logAudit(req, {
      action: 'attendance.bulk_delete_scheduled',
      entityType: 'subject',
      entityId: subject._id,
      entityName: subject.name,
      targetDepartment: subject.department,
      details: {
        batchId,
        count: lectures.length,
        startDate: start,
        endDate: end,
        undoExpiresAt: deletions[0]?.expiresAt
      }
    });

    const io = req.app.get('io');
    if (io) {
      const payload = { subjectId: subject._id, batchId, count: lectures.length, timestamp: new Date() };
      io.to('admin_room').emit('lectures_changed', payload);
      io.to(adminDepartmentRoom(subject.department)).emit('lectures_changed', payload);
      io.to('admin_room').emit('pending_deletions_changed', payload);
      io.to(adminDepartmentRoom(subject.department)).emit('pending_deletions_changed', payload);
    }

    res.json({
      success: true,
      message: `${lectures.length} imported attendance date${lectures.length === 1 ? '' : 's'} scheduled for deletion. Use Undo All to recover the full process.`,
      batchId,
      count: lectures.length,
      undoExpiresAt: deletions[0]?.expiresAt
    });
  } catch (err) {
    console.error('scheduleImportedAttendanceDeletion error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const downloadLectureAttendanceExcel = async (req, res) => {
  try {
    const { lectureId } = req.params;
    const lecture = await Lecture.findById(lectureId).populate('subject', 'name code department branch semester assignedTeachers');
    if (!lecture) return res.status(404).json({ success: false, message: 'Lecture not found' });
    if (!lecture.subject) return res.status(404).json({ success: false, message: 'Lecture subject not found' });
    if (!(await ensureLectureAccess(lecture, req, res))) return;

    const enrolledStudents = await User.find({
      enrolledSubjects: lecture.subject._id,
      role: 'student',
      status: { $in: ['active', 'restricted', 'inactive'] }
    }).select('name studentId department branch semester');
    const matchingStudents = enrolledStudents.filter(student => studentMatchesSubject(student, lecture.subject));

    const attendance = await Attendance.find({ lecture: lectureId })
      .populate('student', 'name studentId department branch semester')
      .sort({ markedAt: 1 });

    const attendanceMap = {};
    attendance.forEach(record => {
      if (record.student?._id && studentMatchesSubject(record.student, lecture.subject) && record.status === 'present') {
        attendanceMap[record.student._id.toString()] = record;
      }
    });

    const rows = matchingStudents.map((student, index) => {
      const record = attendanceMap[student._id.toString()];
      return {
        'Sr. No.': index + 1,
        'Student ID': student.studentId || '-',
        'Student Name': student.name,
        'Department': student.department || lecture.subject.department || '-',
        'Semester': student.semester || lecture.subject.semester || '-',
        'Date': formatDate(lecture.date),
        'Subject Code': lecture.subject.code,
        'Subject': lecture.subject.name,
        'Lecture': lecture.title,
        'Start Time': lecture.startTime,
        'End Time': lecture.endTime,
        'Status': record ? 'Present' : 'Absent',
        'Marked At': record ? formatDateTime(record.markedAt || record.createdAt) : '-',
        'Face Confidence': record?.faceConfidence ? `${record.faceConfidence.toFixed(1)}%` : '-',
        'Verification': record ? (record.faceVerified ? 'Face Verified' : 'Manual') : '-'
      };
    });

    const present = Object.keys(attendanceMap).length;
    const total = matchingStudents.length;
    const summaryRows = [
      { Field: 'Subject', Value: `${lecture.subject.name} (${lecture.subject.code})` },
      { Field: 'Lecture', Value: lecture.title },
      { Field: 'Date', Value: formatDate(lecture.date) },
      { Field: 'Time', Value: `${lecture.startTime} - ${lecture.endTime}` },
      { Field: 'Total Students', Value: total },
      { Field: 'Present', Value: present },
      { Field: 'Absent', Value: total - present },
      { Field: 'Attendance %', Value: total ? `${((present / total) * 100).toFixed(2)}%` : '0.00%' }
    ];

    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, summaryRows, 'Lecture Summary', [22, 35]);
    addSheet(workbook, rows, 'Attendance', [8, 15, 26, 20, 10, 14, 14, 28, 30, 12, 12, 12, 22, 16, 16]);

    const filename = `Lecture_Attendance_${cleanFilePart(lecture.subject.code)}_${cleanFilePart(lecture.title)}.xlsx`;
    await logAudit(req, {
      action: 'report.exported',
      entityType: 'lecture',
      entityId: lecture._id,
      entityName: lecture.title,
      targetDepartment: lecture.subject.department,
      details: { reportType: 'lecture_attendance', filename }
    });
    await sendWorkbook(res, workbook, filename);
  } catch (err) {
    console.error('downloadLectureAttendanceExcel error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const downloadSessionAttendanceExcel = async (req, res) => {
  try {
    const { subjectId } = req.query;
    const lectureQuery = { status: { $in: ['ongoing', 'completed'] } };
    const scopedSubjectIds = await getScopedSubjectIds(req.user);
    if (subjectId) {
      const subject = await Subject.findById(subjectId);
      if (!ensureSubjectAccess(subject, req, res)) return;
      lectureQuery.subject = subjectId;
    } else if (scopedSubjectIds) {
      lectureQuery.subject = { $in: scopedSubjectIds };
    }

    const lectures = await Lecture.find(lectureQuery)
      .populate('subject', 'name code department branch semester assignedTeachers')
      .sort({ date: 1, startTime: 1 });

    const studentQuery = {
      role: 'student',
      status: { $in: ['active', 'restricted', 'inactive'] }
    };
    if (subjectId) studentQuery.enrolledSubjects = subjectId;
    else if (scopedSubjectIds?.length) studentQuery.enrolledSubjects = { $in: scopedSubjectIds };
    const adminDepartment = getAdminDepartment(req.user);
    if (adminDepartment) studentQuery.department = adminDepartment;
    const adminSemester = getAdminSemesterScope(req.user);
    if (adminSemester) studentQuery.semester = adminSemester;

    const students = await User.find(studentQuery).populate('enrolledSubjects', 'name code department branch semester')
      .select('name studentId department branch semester enrolledSubjects');

    const attendanceFindQuery = scopedSubjectIds && !subjectId
      ? { subject: { $in: scopedSubjectIds } }
      : subjectId
        ? { subject: subjectId }
        : {};

    const attendanceRecords = await Attendance.find(attendanceFindQuery)
      .populate('lecture', 'title date startTime endTime subject')
      .populate('subject', 'name code department branch semester assignedTeachers')
      .populate('student', 'name studentId department branch semester')
      .sort({ markedAt: 1 });

    const attendanceMap = {};
    attendanceRecords.forEach(record => {
      if (record.lecture && record.student) {
        attendanceMap[`${record.student._id}_${record.lecture._id}`] = record;
      }
    });

    const summaryRows = [];
    const detailRows = [];

    students.forEach((student, studentIndex) => {
      const enrolledIds = new Set((student.enrolledSubjects || []).map(subject => subject._id.toString()));
      const studentLectures = lectures.filter(lecture => (
        lecture.subject?._id &&
        enrolledIds.has(lecture.subject._id.toString()) &&
        studentMatchesSubject(student, lecture.subject)
      ));
      let presentCount = 0;

      studentLectures.forEach((lecture) => {
        const record = attendanceMap[`${student._id}_${lecture._id}`];
        const isPresent = record?.status === 'present';
        if (isPresent) presentCount += 1;
        detailRows.push({
          'Student ID': student.studentId || '-',
          'Student Name': student.name,
          'Department': student.department || lecture.subject?.department || '-',
          'Semester': student.semester || lecture.subject?.semester || '-',
          'Date': formatDate(lecture.date),
          'Subject Code': lecture.subject?.code || '-',
          'Subject': lecture.subject?.name || '-',
          'Lecture': lecture.title,
          'Start Time': lecture.startTime,
          'End Time': lecture.endTime,
          'Status': isPresent ? 'Present' : 'Absent',
          'Marked At': record ? formatDateTime(record.markedAt || record.createdAt) : '-',
          'Face Confidence': record?.faceConfidence ? `${record.faceConfidence.toFixed(1)}%` : '-'
        });
      });

      const totalLectures = studentLectures.length;
      summaryRows.push({
        'Sr. No.': studentIndex + 1,
        'Student ID': student.studentId || '-',
        'Student Name': student.name,
        'Department': student.department || '-',
        'Semester': student.semester || '-',
        'Total Lectures': totalLectures,
        'Present': presentCount,
        'Absent': totalLectures - presentCount,
        'Attendance %': totalLectures ? `${((presentCount / totalLectures) * 100).toFixed(2)}%` : '0.00%'
      });
    });

    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, summaryRows, 'Student Summary', [8, 15, 26, 20, 10, 15, 10, 10, 14]);
    addSheet(workbook, detailRows, 'Detailed Attendance', [15, 26, 20, 10, 14, 14, 28, 30, 12, 12, 12, 22, 16]);

    const subjectCode = lectures[0]?.subject?.code;
    const filename = subjectId && subjectCode
      ? `Subject_Attendance_${cleanFilePart(subjectCode)}_${Date.now()}.xlsx`
      : `Session_Attendance_${Date.now()}.xlsx`;

    await logAudit(req, {
      action: 'report.exported',
      entityType: subjectId ? 'subject' : 'session',
      entityId: subjectId || undefined,
      entityName: subjectId ? subjectCode || 'Subject attendance' : 'Session attendance',
      targetDepartment: getAdminDepartment(req.user) || 'All Departments',
      details: { reportType: subjectId ? 'subject_session_attendance' : 'session_attendance', filename }
    });
    await sendWorkbook(res, workbook, filename);
  } catch (err) {
    console.error('downloadSessionAttendanceExcel error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getSubjectAttendanceAnalytics = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const subject = await Subject.findById(subjectId);
    if (!ensureSubjectAccess(subject, req, res)) return;
    const lectures = await Lecture.find({ subject: subjectId, status: 'completed' }).sort({ date: 1, startTime: 1, createdAt: 1 });
    const analytics = await Promise.all(
      lectures.map(async (lec) => {
        const att = await Attendance.find({ lecture: lec._id });
        return {
          lecture: lec,
          attendanceCount: att.length,
          presentStudents: att.filter(a => a.status === 'present').length
        };
      })
    );
    await logAudit(req, {
      action: 'analytics.viewed',
      entityType: 'subject',
      entityId: subject._id,
      entityName: `${subject.name} (${subject.code})`,
      targetDepartment: subject.department,
      details: { reportType: 'subject_attendance_analytics' }
    });
    res.json({ success: true, analytics });
  } catch (err) {
    console.error('getSubjectAttendanceAnalytics error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getSubjectAttendanceHistory = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const { startDate, endDate, search } = req.query;
    const subject = await Subject.findById(subjectId);
    if (!ensureSubjectAccess(subject, req, res)) return;

    const start = parseDateBoundary(startDate || new Date(new Date().setDate(new Date().getDate() - 30)));
    const end = parseDateBoundary(endDate || new Date(), true);
    if (!start || !end || start > end) {
      return res.status(400).json({ success: false, message: 'Enter a valid date range.' });
    }

    const studentQuery = {
      role: 'student',
      status: { $in: ['active', 'restricted'] },
      enrolledSubjects: subjectId
    };
    if (search) {
      const regex = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      studentQuery.$or = [{ name: regex }, { studentId: regex }, { email: regex }];
    }

    const [lectures, students] = await Promise.all([
      Lecture.find({
        subject: subjectId,
        status: 'completed',
        date: { $gte: start, $lte: end },
        pendingDeletion: { $ne: true }
      }).sort({ date: 1, startTime: 1, createdAt: 1 }),
      User.find(studentQuery).select('name studentId email profileImage department semester status isRestricted restrictionReason subjectRestrictions').lean()
    ]);
    students.sort((a, b) => {
      const series = studentIdSortValue(a.studentId) - studentIdSortValue(b.studentId);
      if (series !== 0) return series;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });

    const lectureIds = lectures.map(lecture => lecture._id);
    const studentIds = students.map(student => student._id);
    const studentCodes = students.map(student => studentCodeOf(student)).filter(Boolean);
    const records = lectureIds.length && students.length
      ? await Attendance.find({
        subject: subjectId,
        lecture: { $in: lectureIds },
        $or: [
          { student: { $in: studentIds } },
          { studentId: { $in: studentCodes } }
        ],
        status: 'present'
      }).select('student studentId lecture markedAt faceConfidence status')
      : [];

    const recordMap = new Map();
    records.forEach(record => {
      recordMap.set(`${record.student}:${record.lecture}`, record);
      if (record.studentId) recordMap.set(`${String(record.studentId).toUpperCase()}:${record.lecture}`, record);
    });
    const studentRows = students.map(student => {
      const lectureRecords = lectures.map(lecture => {
        const record = recordMap.get(`${student._id}:${lecture._id}`) || recordMap.get(`${studentCodeOf(student)}:${lecture._id}`);
        return {
          lectureId: lecture._id,
          title: lecture.title,
          date: lecture.date,
          startTime: lecture.startTime,
          status: record?.status === 'present' ? 'present' : 'absent',
          markedAt: record?.markedAt || null,
          faceConfidence: record?.faceConfidence || null
        };
      });
      const present = lectureRecords.filter(item => item.status === 'present').length;
      const total = lectureRecords.length;
      return {
        student,
        present,
        absent: Math.max(total - present, 0),
        total,
        percentage: total ? ((present / total) * 100).toFixed(1) : '0.0',
        lectures: lectureRecords
      };
    });

    const lectureSummaries = lectures.map(lecture => {
      const present = students.filter(student => recordMap.has(`${student._id}:${lecture._id}`) || recordMap.has(`${studentCodeOf(student)}:${lecture._id}`)).length;
      const total = students.length;
      return {
        lecture,
        present,
        absent: Math.max(total - present, 0),
        total,
        percentage: total ? ((present / total) * 100).toFixed(1) : '0.0'
      };
    });

    res.json({
      success: true,
      subject,
      range: { startDate: start, endDate: end },
      students: studentRows,
      lectures: lectureSummaries,
      summary: {
        totalLectures: lectures.length,
        totalStudents: students.length,
        totalPresent: records.length,
        totalPossible: lectures.length * students.length,
        percentage: lectures.length && students.length
          ? ((records.length / (lectures.length * students.length)) * 100).toFixed(1)
          : '0.0'
      }
    });
  } catch (err) {
    console.error('getSubjectAttendanceHistory error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = {
  detectGuideFace,
  markAttendance,
  getStudentSubjectAttendance,
  downloadAttendanceExcel,
  getAdminAttendanceByLecture,
  updateLectureAttendanceStatus,
  importSubjectAttendance,
  scheduleImportedAttendanceDeletion,
  downloadLectureAttendanceExcel,
  downloadSessionAttendanceExcel,
  getSubjectAttendanceAnalytics,
  getSubjectAttendanceHistory,
  createAttendanceDispute,
  getAttendanceDisputes,
  resolveAttendanceDispute,
  deleteAttendanceDispute,
  deleteAttendanceDisputes
};
