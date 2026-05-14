const Attendance = require('../models/Attendance');
const Lecture = require('../models/Lecture');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Notification = require('../models/Notification');
const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { closeExpiredAttendance } = require('../utils/attendanceAutoClose');
const { uploadImage, downloadImage, isRemoteImage } = require('../utils/cloudinary');
const { SYSTEM_ADMIN_DEPARTMENT, adminDepartmentRoom, assertDepartmentAccess, getAdminDepartment, getAdminSemesterScope } = require('../utils/adminScope');
const { logAudit } = require('../utils/auditLogger');

const attendanceFailure = (res, message, extra = {}) => {
  return res.json({ success: false, message, ...extra });
};

const formatDate = (date) => date ? new Date(date).toLocaleDateString('en-IN') : '-';
const formatDateTime = (date) => date ? new Date(date).toLocaleString('en-IN') : '-';
const cleanFilePart = (value) => String(value || 'attendance').replace(/[^a-z0-9_-]+/gi, '_');

const sendWorkbook = (res, workbook, filename) => {
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
};

const addSheet = (workbook, rows, name, cols = []) => {
  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Message: 'No records found' }]);
  if (cols.length) sheet['!cols'] = cols.map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
};

const resolveProfileImagePath = async (student) => {
  const profileCandidate = isRemoteImage(student.profileImage)
    ? student.profileImage
    : student.profileImage
      ? path.join(__dirname, '..', student.profileImage.replace(/^\/+/, ''))
      : null;

  const candidates = [
    student.faceImagePath,
    profileCandidate
  ].filter(Boolean);

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
      student.faceImagePath = student.faceImagePath || student.profileImage || candidate;
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
    : await Subject.findById(lecture.subject).select('department');
  return ensureSubjectAccess(subject, req, res);
};

const ensureStudentSubjectAccess = async (subjectId, req, res) => {
  const student = await User.findById(req.user._id).select('department semester enrolledSubjects role');
  const subject = await Subject.findById(subjectId).select('department semester isActive');
  if (!student || student.role !== 'student') {
    res.status(403).json({ success: false, message: 'Student access required' });
    return false;
  }
  if (!subject || !subject.isActive) {
    res.status(404).json({ success: false, message: 'Subject not found' });
    return false;
  }
  const allowed = subject.department === student.department &&
    Number(subject.semester) === Number(student.semester) &&
    student.enrolledSubjects.some(id => id.toString() === subjectId);
  if (!allowed) {
    res.status(403).json({ success: false, message: 'Access denied: subject is not assigned to your semester' });
    return false;
  }
  return true;
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

    const lecture = await Lecture.findById(lectureId).populate('subject', 'name code department semester pendingDeletion');
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

    const existing = await Attendance.findOne({ lecture: lectureId, student: studentId });
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
    if (verificationResult.is_restricted || student.isRestricted) {
      const io = req.app.get('io');
      const admins = await User.find({
        role: 'admin',
        status: 'active',
        department: { $in: [SYSTEM_ADMIN_DEPARTMENT, lecture.subject.department] }
      });

      const notifPromises = admins.map(admin =>
        Notification.create({
          recipient: admin._id,
          recipientRole: 'admin',
          type: 'unwanted_student_detected',
          title: '🚨 Restricted Student Detected!',
          message: `Restricted student ${student.name} (${student.studentId}) attempted attendance in ${lecture.subject.name} - ${lecture.title}`,
          data: { studentId: student._id, studentName: student.name, lectureId },
          priority: 'critical'
        })
      );
      await Promise.all(notifPromises);

      if (io) {
        io.to('admin_room').emit('restricted_student_detected', {
          studentName: student.name,
          studentId: student.studentId,
          lectureName: lecture.title,
          subjectName: lecture.subject.name,
          timestamp: new Date()
        });
        io.to(adminDepartmentRoom(lecture.subject.department)).emit('restricted_student_detected', {
          studentName: student.name,
          studentId: student.studentId,
          lectureName: lecture.title,
          subjectName: lecture.subject.name,
          timestamp: new Date()
        });
      }

      cleanupFiles(uploadedPaths);
      return res.status(403).json({
        success: false,
        message: 'Access denied. Your account is restricted.',
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

    let captureUpload;
    try {
      captureUpload = await uploadImage(filePath, {
        folder: `${process.env.CLOUDINARY_FOLDER || 'faceattend'}/captures`,
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
      .populate('subject', 'name code semester')
      .sort({ date: 1, startTime: 1, createdAt: 1 });
    const lectureIds = lectures.map(lec => lec._id);

    const attendanceRecords = await Attendance.find({
      student: studentId,
      subject: subjectId,
      lecture: { $in: lectureIds },
      status: 'present'
    }).populate('lecture', 'title date startTime endTime');

    const attendanceMap = {};
    attendanceRecords.forEach(a => {
      if (a.lecture?._id) attendanceMap[a.lecture._id.toString()] = a;
    });

    const result = lectures.map(lec => ({
      lecture: lec,
      attendance: attendanceMap[lec._id.toString()] || null,
      status: attendanceMap[lec._id.toString()] ? 'present' : 'absent'
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

// @desc  Download attendance as Excel
const downloadAttendanceExcel = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const student = await User.findById(req.user._id).select('name studentId department semester');
    const subject = await Subject.findById(subjectId);

    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found' });
    if (subject.department !== student.department || Number(subject.semester) !== Number(student.semester)) {
      return res.status(403).json({ success: false, message: 'Access denied: subject is not assigned to your semester' });
    }

    const lectures = await Lecture.find({ subject: subjectId, status: 'completed' }).sort({ date: 1, startTime: 1, createdAt: 1 });
    const lectureIds = lectures.map(lec => lec._id);
    const attendanceRecords = await Attendance.find({
      student: req.user._id,
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
      ['FaceAttend - Student Attendance Report'],
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

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(workbookRows);
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];
    ws['!cols'] = [
      { wch: 8 }, { wch: 14 }, { wch: 30 }, { wch: 12 },
      { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 16 }, { wch: 16 }
    ];
    ws['!autofilter'] = { ref: `A17:I${Math.max(17 + rows.length, 18)}` };
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');

    const filename = `Attendance_${cleanFilePart(student.studentId)}_${cleanFilePart(subject.code)}.xlsx`;
    sendWorkbook(res, wb, filename);
  } catch (err) {
    console.error('downloadAttendanceExcel error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getAdminAttendanceByLecture = async (req, res) => {
  try {
    const { lectureId } = req.params;
    const lecture = await Lecture.findById(lectureId).populate('subject', 'name code department');
    if (!(await ensureLectureAccess(lecture, req, res))) return;
    await logAudit(req, {
      action: 'attendance.viewed',
      entityType: 'lecture',
      entityId: lecture._id,
      entityName: lecture.title,
      targetDepartment: lecture.subject.department,
    });
    const attendance = await Attendance.find({ lecture: lectureId })
      .populate('student', 'name studentId profileImage department semester')
      .sort({ markedAt: -1 });
    res.json({ success: true, attendance });
  } catch (err) {
    console.error('getAdminAttendanceByLecture error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const downloadLectureAttendanceExcel = async (req, res) => {
  try {
    const { lectureId } = req.params;
    const lecture = await Lecture.findById(lectureId).populate('subject', 'name code department semester');
    if (!lecture) return res.status(404).json({ success: false, message: 'Lecture not found' });
    if (!lecture.subject) return res.status(404).json({ success: false, message: 'Lecture subject not found' });
    if (!(await ensureLectureAccess(lecture, req, res))) return;

    const enrolledStudents = await User.find({
      enrolledSubjects: lecture.subject._id,
      role: 'student',
      status: { $in: ['active', 'restricted', 'inactive'] }
    }).select('name studentId department semester');

    const attendance = await Attendance.find({ lecture: lectureId })
      .populate('student', 'name studentId department semester')
      .sort({ markedAt: 1 });

    const attendanceMap = {};
    attendance.forEach(record => {
      if (record.student?._id) attendanceMap[record.student._id.toString()] = record;
    });

    const rows = enrolledStudents.map((student, index) => {
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

    const present = attendance.filter(record => record.student).length;
    const total = enrolledStudents.length;
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

    const workbook = XLSX.utils.book_new();
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
    sendWorkbook(res, workbook, filename);
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
      .populate('subject', 'name code department semester')
      .sort({ date: 1, startTime: 1 });

    const studentQuery = {
      role: 'student',
      status: { $in: ['active', 'restricted', 'inactive'] }
    };
    if (subjectId) studentQuery.enrolledSubjects = subjectId;
    const adminDepartment = getAdminDepartment(req.user);
    if (adminDepartment) studentQuery.department = adminDepartment;
    const adminSemester = getAdminSemesterScope(req.user);
    if (adminSemester) studentQuery.semester = adminSemester;

    const students = await User.find(studentQuery).populate('enrolledSubjects', 'name code department semester')
      .select('name studentId department semester enrolledSubjects');

    const attendanceFindQuery = scopedSubjectIds && !subjectId
      ? { subject: { $in: scopedSubjectIds } }
      : subjectId
        ? { subject: subjectId }
        : {};

    const attendanceRecords = await Attendance.find(attendanceFindQuery)
      .populate('lecture', 'title date startTime endTime subject')
      .populate('subject', 'name code')
      .populate('student', 'name studentId')
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
      const studentLectures = lectures.filter(lecture => lecture.subject?._id && enrolledIds.has(lecture.subject._id.toString()));
      let presentCount = 0;

      studentLectures.forEach((lecture) => {
        const record = attendanceMap[`${student._id}_${lecture._id}`];
        if (record) presentCount += 1;
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
          'Status': record ? 'Present' : 'Absent',
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

    const workbook = XLSX.utils.book_new();
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
    sendWorkbook(res, workbook, filename);
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

module.exports = {
  detectGuideFace,
  markAttendance,
  getStudentSubjectAttendance,
  downloadAttendanceExcel,
  getAdminAttendanceByLecture,
  downloadLectureAttendanceExcel,
  downloadSessionAttendanceExcel,
  getSubjectAttendanceAnalytics
};
