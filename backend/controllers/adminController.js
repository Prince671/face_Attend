const User = require('../models/User');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Notification = require('../models/Notification');
const Subject = require('../models/Subject');
const Lecture = require('../models/Lecture');
const Attendance = require('../models/Attendance');
const AcademicStructure = require('../models/AcademicStructure');
const AttendanceCriteria = require('../models/AttendanceCriteria');
const { enrollStudentInMatchingSubjects, studentMatchForSubject, studentMatchesSubject } = require('../utils/subjectEnrollment');
const { applyDepartmentScope, applyAcademicScope, assertDepartmentAccess, getAdminDepartment, getAdminSemesterScope, getTeacherSemesterScope, isSystemAdmin, adminDepartmentRoom } = require('../utils/adminScope');
const { logAudit } = require('../utils/auditLogger');
const { schedulePendingDeletion } = require('../utils/pendingDeletion');
const { loadWorkbook, rowToValues } = require('../utils/excelWorkbook');
const { canReceiveSubjectUpdates } = require('../utils/restrictionPolicy');
const { studentCodeOf } = require('../utils/studentIdentity');
const { criteriaFilter, getAttendanceCriteria } = require('../utils/attendanceCriteria');

const KNOWN_DEPARTMENTS = ['Computer Science', 'Information Technology', 'Electronics', 'Mechanical', 'Civil', 'Chemical', 'Electrical'];
const COURSE_OPTIONS = ['B. Tech', 'Diploma', 'BBA', 'MBA'];
const emitAdminChange = (req, event, payload = {}, department = null) => {
  const io = req.app.get('io');
  if (!io) return;
  io.to('admin_room').emit(event, payload);
  if (department) io.to(adminDepartmentRoom(department)).emit(event, payload);
};
const visibleDashboardLectureFilter = {
  source: { $ne: 'imported' },
  title: { $not: /^Imported Attendance/i }
};
const normalizeAnalyticsBranch = (value) => {
  const branch = String(value || '').trim();
  return /^(unassigned branch|general)$/i.test(branch) ? '' : branch;
};

const applyAnalyticsBranchFilter = (query, value) => {
  if (value === undefined || value === null || value === '') return query;
  const branch = normalizeAnalyticsBranch(value);
  if (!branch) {
    query.$or = [{ branch: '' }, { branch: { $exists: false } }];
    return query;
  }
  query.branch = branch;
  return query;
};

const parseDateOnlyAsLocalDay = (value) => {
  if (!value) return new Date();
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  return new Date(raw);
};

const toLocalDateValue = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const DEFAULT_ACADEMIC_STRUCTURE = [
  {
    course: 'B. Tech',
    branches: [
      { name: 'Computer Science', department: 'Computer Science', subjectBranch: 'Computer Science', semesters: [1, 2, 3, 4, 5, 6, 7, 8] },
      { name: 'Mechanical Engineering', department: 'Mechanical', subjectBranch: '', semesters: [1, 2, 3, 4, 5, 6, 7, 8] },
      { name: 'Electrical Engineering', department: 'Electrical', subjectBranch: '', semesters: [1, 2, 3, 4, 5, 6, 7, 8] },
      { name: 'AI/ML Engineering', department: 'Computer Science', subjectBranch: 'AI/ML Engineering', semesters: [1, 2, 3, 4, 5, 6, 7, 8] }
    ]
  },
  {
    course: 'Diploma',
    branches: [
      { name: 'Computer Science', department: 'Computer Science', subjectBranch: 'Diploma CS', semesters: [1, 2, 3, 4, 5, 6] },
      { name: 'Mechanical Engineering', department: 'Mechanical', subjectBranch: 'Diploma Mechanical', semesters: [1, 2, 3, 4, 5, 6] },
      { name: 'Electrical Engineering', department: 'Electrical', subjectBranch: 'Diploma Electrical', semesters: [1, 2, 3, 4, 5, 6] }
    ]
  },
  { course: 'BBA', branches: [{ name: 'BBA', department: 'BBA', subjectBranch: '', semesters: [1, 2, 3, 4, 5, 6] }] },
  { course: 'MBA', branches: [{ name: 'MBA', department: 'MBA', subjectBranch: '', semesters: [1, 2, 3, 4] }] }
];

const seedAcademicStructure = async () => {
  const count = await AcademicStructure.countDocuments();
  if (count) return;
  await AcademicStructure.insertMany(DEFAULT_ACADEMIC_STRUCTURE.map(item => ({ ...item, isActive: true })));
};

const inferCourse = (item = {}) => {
  const explicit = String(item.course || '').trim();
  if (explicit) return explicit;
  const branch = String(item.branch || '').trim();
  const department = String(item.department || '').trim();
  if (/^Diploma CS$/i.test(branch)) return 'Diploma';
  if (/^BBA$/i.test(department)) return 'BBA';
  if (/^MBA$/i.test(department)) return 'MBA';
  return 'B. Tech';
};

const inferAcademicBranch = (item = {}) => {
  const branch = String(item.branch || '').trim();
  const department = String(item.department || '').trim();
  if (/^Diploma CS$/i.test(branch)) return 'Computer Science';
  if (branch && !/^general|unassigned branch$/i.test(branch)) return branch;
  if (/computer|cse|cs/i.test(department)) return 'Computer Science';
  if (/mechanical/i.test(department)) return 'Mechanical Engineering';
  if (/electrical/i.test(department)) return 'Electrical Engineering';
  if (/^BBA$|^MBA$/i.test(department)) return department;
  return department || 'General';
};

const courseBranchMatch = ({ course, branch }) => (item) => {
  if (course && inferCourse(item) !== course) return false;
  if (branch && inferAcademicBranch(item) !== branch) return false;
  return true;
};

const normalizeDepartments = (value, fallbackDepartment) => {
  const values = Array.isArray(value)
    ? value
    : String(value || fallbackDepartment || '').split(/[|;,]/);
  const departments = values.map(item => String(item || '').trim()).filter(Boolean);
  return [...new Set(departments)];
};

const parseTeacherCsv = (filePath) => {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(header => header.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(col => col.trim());
    const row = {};
    headers.forEach((header, index) => { row[header] = cols[index] || ''; });
    return {
      name: row.name || row.teacher || row['teacher name'],
      email: row.email || row.gmail || row['gmail id'],
      phone: row.phone || row.mobile,
      departments: row.departments || row.department
    };
  }).filter(row => row.name && row.email);
};

const normalizeImportHeader = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

const importRowValue = (row, aliases = []) => {
  for (const alias of aliases) {
    const key = normalizeImportHeader(alias);
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== '') return row[key];
  }
  return '';
};

const parseSpreadsheetRows = async (filePath, ext) => {
  const { worksheets } = await loadWorkbook(filePath, ext);
  const parsedRows = [];
  const nameHeaders = new Set(['name', 'studentname', 'nameofstudent', 'fullname']);
  const idHeaders = new Set(['studentid', 'student', 'rollno', 'rollnumber', 'roll', 'enrollmentno', 'enrollmentnumber', 'enrollment', 'id']);

  worksheets.forEach((worksheet) => {
    const rawRows = [];
    worksheet.eachRow({ includeEmpty: false }, row => rawRows.push(rowToValues(row)));
    if (rawRows.length < 2) return;

    let headerIndex = 0;
    let bestScore = 0;
    rawRows.slice(0, 30).forEach((values, index) => {
      const normalized = values.map(normalizeImportHeader);
      const hasName = normalized.some(header => nameHeaders.has(header));
      const hasStudentId = normalized.some(header => idHeaders.has(header));
      const hasEmail = normalized.some(header => ['email', 'gmail', 'gmailid'].includes(header));
      const hasSemester = normalized.some(header => ['semester', 'sem', 'semesterno'].includes(header));
      const score = (hasName ? 10 : 0) + (hasStudentId ? 10 : 0) + (hasEmail ? 3 : 0) + (hasSemester ? 2 : 0);
      if (score > bestScore) {
        bestScore = score;
        headerIndex = index;
      }
    });

    const headers = rawRows[headerIndex].map(normalizeImportHeader);
    rawRows.slice(headerIndex + 1).forEach((values, index) => {
      const row = {
        __rowNumber: headerIndex + index + 2,
        __sheetName: worksheet.name
      };
      headers.forEach((header, colIndex) => {
        if (header) row[header] = values[colIndex];
      });
      if (Object.keys(row).some(key => !key.startsWith('__') && String(row[key] || '').trim())) {
        parsedRows.push(row);
      }
    });
  });

  return parsedRows;
};

const normalizeImportStatus = (value) => {
  const status = String(value || 'active').trim().toLowerCase();
  if (['pending', 'active', 'inactive', 'restricted'].includes(status)) return status;
  return 'active';
};

const safeTrim = (value) => String(value || '').trim();

const teacherSafeFields = 'name email role department departments status profileImage adminSemesterScope createdAt updatedAt';
const publicTeacherFields = 'name email profileImage';

const normalizeBranchValue = (value) => {
  const branch = String(value || '').trim();
  return /^(unassigned branch|general)$/i.test(branch) ? '' : branch;
};

const resolveImportBranch = ({ course, department, branch }) => {
  const explicit = normalizeBranchValue(branch);
  if (explicit) return explicit;
  if (/computer|cse|cs/i.test(String(department || ''))) {
    if (/diploma/i.test(String(course || ''))) return 'Diploma CS';
    return 'Computer Science';
  }
  return normalizeBranchValue(inferAcademicBranch({ course, department }));
};

const branchFilter = (value) => {
  const branch = normalizeBranchValue(value);
  return branch ? { branch } : { $or: [{ branch: '' }, { branch: { $exists: false } }] };
};

const ensureStudentAccess = (student, req, res) => {
  if (!student || student.role !== 'student') {
    res.status(404).json({ success: false, message: 'Student not found' });
    return false;
  }
  if (!assertDepartmentAccess(student, req.user)) {
    res.status(403).json({ success: false, message: 'Access denied: student belongs to another department' });
    return false;
  }
  const semester = getAdminSemesterScope(req.user);
  if (semester && Number(student.semester) !== semester) {
    res.status(403).json({ success: false, message: 'Access denied: student belongs to another semester scope' });
    return false;
  }
  return true;
};

const emitStudentProfileChange = (req, student, action) => {
  const io = req.app.get('io');
  if (!io || !student?._id) return;
  const payload = {
    action,
    studentId: student._id,
    studentMongoId: student._id,
    studentCode: student.studentId,
    name: student.name,
    department: student.department,
    branch: student.branch,
    semester: student.semester,
    status: student.status,
    isRestricted: Boolean(student.isRestricted),
    restrictionReason: student.restrictionReason || ''
  };
  io.to('admin_room').emit('student_profile_changed', payload);
  if (student.department) io.to(adminDepartmentRoom(student.department)).emit('student_profile_changed', payload);
  io.to(`student_${student._id}`).emit('account_status_changed', {
    status: student.status,
    isRestricted: Boolean(student.isRestricted),
    restrictionReason: student.restrictionReason || ''
  });
};

const activeSubjectRestriction = (student, subjectId) => (
  (student?.subjectRestrictions || []).find(item => (
    item?.active !== false &&
    String(item.subject?._id || item.subject) === String(subjectId)
  ))
);

const notifyUsers = async (req, notifications = []) => {
  const studentRecipientIds = notifications
    .filter(item => item?.recipientRole === 'student' && item.recipient && !item.recipientStudentId)
    .map(item => item.recipient);
  const students = studentRecipientIds.length
    ? await User.find({ _id: { $in: studentRecipientIds } }).select('_id studentId').lean()
    : [];
  const studentsById = new Map(students.map(student => [String(student._id), student]));
  const created = await Promise.all(notifications.map(item => Notification.create({
    ...item,
    recipientStudentId: item.recipientStudentId || (item.recipientRole === 'student' ? studentCodeOf(studentsById.get(String(item.recipient))) : undefined)
  })));
  const io = req.app.get('io');
  if (io) {
    created.forEach(notification => {
      if (notification.recipient) {
        io.to(`user_${notification.recipient}`).emit('notification_created', notification);
        io.to(`student_${notification.recipient}`).emit('notification_created', notification);
      }
    });
  }
  return created;
};

const safeImportSideEffect = async (label, task) => {
  try {
    return await task();
  } catch (error) {
    console.warn(`${label} failed after import save:`, error.message);
    return null;
  }
};

const mapWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

const getPendingStudents = async (req, res) => {
  try {
    const query = applyAcademicScope({
      role: 'student',
      pendingDeletion: { $ne: true },
      $or: [
        { status: 'pending' },
        { 'pendingProfileUpdate.status': 'pending' }
      ]
    }, req.user);
    const students = await User.find(query)
      .select('-password -faceEncoding')
      .sort({ 'pendingProfileUpdate.requestedAt': -1, createdAt: -1 })
      .lean();
    res.json({ success: true, students, total: students.length });
  } catch (err) {
    console.error('getPendingStudents error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getAllStudents = async (req, res) => {
  try {
    const { status, course, branch, department, semester, search } = req.query;
    const query = { role: 'student', pendingDeletion: { $ne: true } };
    if (status) query.status = status;
    if (course) query.course = course;
    if (branch !== undefined && branch !== '') Object.assign(query, branchFilter(branch));
    const adminDepartment = getAdminDepartment(req.user);
    const adminSemester = getAdminSemesterScope(req.user);
    if (adminDepartment) query.department = adminDepartment;
    else if (department) query.department = department;
    if (adminSemester) query.semester = adminSemester;
    else if (semester) query.semester = parseInt(semester);
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { studentId: { $regex: search, $options: 'i' } }
    ];
    const students = await User.find(query)
      .select('-password -faceEncoding')
      .populate('enrolledSubjects', 'name code branch semester')
      .sort({ createdAt: -1 })
      .lean();
    const filteredStudents = isSystemAdmin(req.user) && (course || branch)
      ? students.filter(courseBranchMatch({ course, branch }))
      : students;
    res.json({ success: true, students: filteredStudents, total: filteredStudents.length });
  } catch (err) {
    console.error('getAllStudents error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getStudentById = async (req, res) => {
  try {
    const student = await User.findById(req.params.id)
      .select('-password -faceEncoding')
      .populate('enrolledSubjects', 'name code department branch semester');
    if (!ensureStudentAccess(student, req, res)) return;
    res.json({ success: true, student });
  } catch (err) {
    console.error('getStudentById error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const approveStudent = async (req, res) => {
  try {
    const student = await User.findById(req.params.id);
    if (!ensureStudentAccess(student, req, res)) return;
    student.status = 'active';
    student.approvedAt = new Date();
    student.approvedBy = req.user._id;
    await student.save();
    await enrollStudentInMatchingSubjects(student);

    await Notification.create({
      recipient: student._id,
      type: 'account_approved',
      title: 'Account Approved!',
      message: 'Your registration has been approved. You can now log in.',
      priority: 'high'
    });

    const io = req.app.get('io');
    if (io) io.to(`student_${student._id}`).emit('account_status_changed', { status: 'active' });
    emitStudentProfileChange(req, student, 'approved');
    await logAudit(req, {
      action: 'student.approved',
      entityType: 'student',
      entityId: student._id,
      entityName: `${student.name} (${student.studentId})`,
      targetDepartment: student.department,
    });

    res.json({ success: true, message: `${student.name}'s account approved.` });
  } catch (err) {
    console.error('approveStudent error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const rejectStudent = async (req, res) => {
  try {
    const { reason } = req.body;
    const student = await User.findById(req.params.id);
    if (!ensureStudentAccess(student, req, res)) return;
    await Notification.create({
      recipient: student._id,
      type: 'account_rejected',
      title: 'Registration Rejected',
      message: reason || 'Your registration was rejected by admin.',
      priority: 'high'
    });
    await User.findByIdAndDelete(req.params.id);
    await logAudit(req, {
      action: 'student.rejected',
      entityType: 'student',
      entityId: student._id,
      entityName: `${student.name} (${student.studentId})`,
      targetDepartment: student.department,
      details: { reason: reason || null }
    });
    res.json({ success: true, message: 'Student registration rejected.' });
  } catch (err) {
    console.error('rejectStudent error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const activateStudent = async (req, res) => {
  try {
    const existing = await User.findById(req.params.id);
    if (!ensureStudentAccess(existing, req, res)) return;
    const student = await User.findByIdAndUpdate(
      req.params.id, { status: 'active' }, { new: true }
    ).select('-password -faceEncoding');
    await enrollStudentInMatchingSubjects(student);

    await Notification.create({
      recipient: student._id,
      type: 'account_approved',
      title: 'Account Activated',
      message: 'Your account has been activated.',
      priority: 'high'
    });

    const io = req.app.get('io');
    if (io) io.to(`student_${student._id}`).emit('account_status_changed', { status: 'active' });
    emitStudentProfileChange(req, student, 'activated');
    await logAudit(req, {
      action: 'student.activated',
      entityType: 'student',
      entityId: student._id,
      entityName: `${student.name} (${student.studentId})`,
      targetDepartment: student.department,
    });
    res.json({ success: true, message: 'Student activated', student });
  } catch (err) {
    console.error('activateStudent error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const deactivateStudent = async (req, res) => {
  try {
    const { reason } = req.body;
    const existing = await User.findById(req.params.id);
    if (!ensureStudentAccess(existing, req, res)) return;
    const student = await User.findByIdAndUpdate(
      req.params.id, { status: 'inactive' }, { new: true }
    ).select('-password -faceEncoding');

    await Notification.create({
      recipient: student._id,
      type: 'account_deactivated',
      title: 'Account Deactivated',
      message: reason || 'Your account has been deactivated by admin.',
      priority: 'high'
    });

    const io = req.app.get('io');
    if (io) io.to(`student_${student._id}`).emit('account_status_changed', { status: 'inactive' });
    emitStudentProfileChange(req, student, 'deactivated');
    await logAudit(req, {
      action: 'student.deactivated',
      entityType: 'student',
      entityId: student._id,
      entityName: `${student.name} (${student.studentId})`,
      targetDepartment: student.department,
      details: { reason: reason || null }
    });
    res.json({ success: true, message: 'Student deactivated' });
  } catch (err) {
    console.error('deactivateStudent error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const restrictStudent = async (req, res) => {
  try {
    const { reason } = req.body;
    const existing = await User.findById(req.params.id);
    if (!ensureStudentAccess(existing, req, res)) return;
    const student = await User.findByIdAndUpdate(
      req.params.id,
      { isRestricted: true, restrictionReason: reason, status: 'restricted' },
      { new: true }
    ).select('-password -faceEncoding');
    const notification = await Notification.create({
      recipient: student._id,
      type: 'account_restricted',
      title: 'Account Restricted',
      message: reason || 'Your account has been restricted.',
      priority: 'critical'
    });
    const io = req.app.get('io');
    if (io) {
      io.to(`student_${student._id}`).emit('notification_created', notification);
      io.to(`user_${student._id}`).emit('notification_created', notification);
    }
    emitStudentProfileChange(req, student, 'restricted');
    await logAudit(req, {
      action: 'student.restricted',
      entityType: 'student',
      entityId: student._id,
      entityName: `${student.name} (${student.studentId})`,
      targetDepartment: student.department,
      details: { reason: reason || null }
    });
    res.json({ success: true, message: 'Student restricted', student });
  } catch (err) {
    console.error('restrictStudent error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const unrestrictStudent = async (req, res) => {
  try {
    const existing = await User.findById(req.params.id);
    if (!ensureStudentAccess(existing, req, res)) return;
    const student = await User.findByIdAndUpdate(
      req.params.id,
      { isRestricted: false, restrictionReason: undefined, status: 'active' },
      { new: true }
    ).select('-password -faceEncoding');

    const notification = await Notification.create({
      recipient: student._id,
      type: 'general',
      title: 'Account Unrestricted',
      message: 'Your account restriction has been removed. You can mark attendance again.',
      priority: 'high'
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`student_${student._id}`).emit('account_status_changed', { status: 'active', isRestricted: false });
      io.to(`student_${student._id}`).emit('notification_created', notification);
      io.to(`user_${student._id}`).emit('notification_created', notification);
    }
    emitStudentProfileChange(req, student, 'unrestricted');

    await logAudit(req, {
      action: 'student.unrestricted',
      entityType: 'student',
      entityId: student._id,
      entityName: `${student.name} (${student.studentId})`,
      targetDepartment: student.department
    });

    res.json({ success: true, message: 'Student unrestricted', student });
  } catch (err) {
    console.error('unrestrictStudent error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const deleteStudent = async (req, res) => {
  try {
    const student = await User.findById(req.params.id);
    if (!ensureStudentAccess(student, req, res)) return;
    if (student.pendingDeletion) {
      return res.status(400).json({ success: false, message: 'Student deletion is already pending.' });
    }
    const deletion = await schedulePendingDeletion({
      resourceType: 'student',
      resourceId: student._id,
      resourceName: `${student.name} (${student.studentId})`,
      targetDepartment: student.department,
      requestedBy: req.user._id
    });
    student.pendingDeletion = true;
    student.deletionScheduledAt = new Date();
    student.deletionExpiresAt = deletion.expiresAt;
    await student.save({ validateBeforeSave: false });
    await logAudit(req, {
      action: 'student.delete_scheduled',
      entityType: 'student',
      entityId: student._id,
      entityName: `${student.name} (${student.studentId})`,
      targetDepartment: student.department,
      details: { undoExpiresAt: deletion.expiresAt }
    });
    res.json({
      success: true,
      message: 'Student delete scheduled. You can undo this for 10 minutes.',
      deletionId: deletion._id,
      undoExpiresAt: deletion.expiresAt
    });
  } catch (err) {
    console.error('deleteStudent error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const bulkDeleteStudents = async (req, res) => {
  try {
    const { course, branch, semester, status = 'active' } = req.body || {};
    const adminDepartment = getAdminDepartment(req.user);
    if (!adminDepartment) {
      return res.status(403).json({ success: false, message: 'Department admin scope is required for bulk delete.' });
    }

    const query = {
      role: 'student',
      pendingDeletion: { $ne: true },
      department: adminDepartment
    };
    if (status === 'registered') query.status = { $ne: 'pending' };
    else if (status && status !== 'all') query.status = status;
    if (course) query.course = course;
    if (semester) query.semester = Number(semester);
    if (branch !== undefined && branch !== '') Object.assign(query, branchFilter(branch));

    const students = await User.find(query).select('name studentId department course branch semester status');
    if (!students.length) {
      return res.status(404).json({ success: false, message: 'No matching students found to delete.' });
    }

    const deletions = [];
    const batchId = crypto.randomUUID();
    const batchName = `${students.length} ${course || ''} ${branch || adminDepartment} Semester ${semester || ''} students`.replace(/\s+/g, ' ').trim();
    for (const student of students) {
      const deletion = await schedulePendingDeletion({
        resourceType: 'student',
        resourceId: student._id,
        resourceName: `${student.name} (${student.studentId})`,
        targetDepartment: student.department,
        requestedBy: req.user._id,
        batchId,
        batchName,
        batchCount: students.length
      });
      student.pendingDeletion = true;
      student.deletionScheduledAt = new Date();
      student.deletionExpiresAt = deletion.expiresAt;
      await student.save({ validateBeforeSave: false });
      deletions.push(deletion);
    }

    await logAudit(req, {
      action: 'students.bulk_delete_scheduled',
      entityType: 'student',
      entityName: 'Bulk student delete',
      targetDepartment: adminDepartment,
      details: {
        count: students.length,
        course,
        branch,
        semester,
        status,
        undoExpiresAt: deletions[0]?.expiresAt
      }
    });

    const io = req.app.get('io');
    if (io) {
      const payload = { count: students.length, course, branch, semester, timestamp: new Date() };
      io.to('admin_room').emit('student_profile_changed', payload);
      io.to(adminDepartmentRoom(adminDepartment)).emit('student_profile_changed', payload);
    }

    res.json({
      success: true,
      message: `${students.length} students scheduled for deletion. Undo is available for 15 minutes.`,
      count: students.length,
      batchId,
      batchName,
      deletions,
      undoExpiresAt: deletions[0]?.expiresAt
    });
  } catch (err) {
    console.error('bulkDeleteStudents error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const enrollStudentSubjects = async (req, res) => {
  try {
    const { subjectIds } = req.body;
    const existingStudent = await User.findById(req.params.id);
    if (!ensureStudentAccess(existingStudent, req, res)) return;
    if (Array.isArray(subjectIds) && subjectIds.length > 0) {
      const subjectQuery = applyAcademicScope({ _id: { $in: subjectIds }, isActive: true }, req.user);
      const allowedSubjects = await Subject.find(subjectQuery).select('department branch semester');
      if (allowedSubjects.length !== subjectIds.length) {
        return res.status(403).json({ success: false, message: 'Access denied: one or more subjects belong to another department' });
      }
      const invalidSubject = allowedSubjects.find(subject => !studentMatchesSubject(existingStudent, subject));
      if (invalidSubject) {
        return res.status(400).json({ success: false, message: 'Subject does not match the student branch and semester' });
      }
    }
    const student = await User.findByIdAndUpdate(
      req.params.id,
      { enrolledSubjects: subjectIds },
      { new: true }
    ).populate('enrolledSubjects', 'name code branch semester').select('-password -faceEncoding');
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    await logAudit(req, {
      action: 'student.enrollments_updated',
      entityType: 'student',
      entityId: student._id,
      entityName: `${student.name} (${student.studentId})`,
      targetDepartment: student.department,
      details: { subjectIds }
    });
    emitStudentProfileChange(req, student, 'enrollments_updated');
    res.json({ success: true, student });
  } catch (err) {
    console.error('enrollStudentSubjects error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getAnalytics = async (req, res) => {
  try {
    const isTeacher = req.user.role === 'teacher';
    const subjectScope = isTeacher
      ? { assignedTeachers: req.user._id, isActive: true, pendingDeletion: { $ne: true } }
      : applyAcademicScope({ isActive: true, pendingDeletion: { $ne: true } }, req.user);
    const teacherSemester = isTeacher ? getTeacherSemesterScope(req.user) : null;
    if (teacherSemester) subjectScope.semester = teacherSemester;
    applyAnalyticsBranchFilter(subjectScope, req.query.branch);
    if (req.query.semester) subjectScope.semester = Number(req.query.semester);
    if (req.query.subjectId) subjectScope._id = req.query.subjectId;
    const scopedSubjects = await Subject.find(subjectScope)
      .select('_id name code department branch semester')
      .sort({ semester: 1, code: 1, name: 1 })
      .lean();
    const scopedSubjectIds = scopedSubjects.map(subject => subject._id);
    const lectureScope = scopedSubjectIds.length
      ? { subject: { $in: scopedSubjectIds }, pendingDeletion: { $ne: true } }
      : { subject: { $in: [] } };
    const attendanceScope = scopedSubjectIds.length ? { subject: { $in: scopedSubjectIds } } : { subject: { $in: [] } };
    const studentScope = isTeacher
      ? {
        role: 'student',
        pendingDeletion: { $ne: true },
        ...(scopedSubjectIds.length ? { enrolledSubjects: { $in: scopedSubjectIds } } : { _id: { $in: [] } })
      }
      : applyAcademicScope({ role: 'student', pendingDeletion: { $ne: true } }, req.user);
    if (!isTeacher) {
      applyAnalyticsBranchFilter(studentScope, req.query.branch);
      if (req.query.semester) studentScope.semester = Number(req.query.semester);
      if (req.query.subjectId) studentScope.enrolledSubjects = scopedSubjectIds[0] || req.query.subjectId;
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const analyticsDate = parseDateOnlyAsLocalDay(req.query.date);
    if (Number.isNaN(analyticsDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid analytics date' });
    }
    const dayStart = new Date(analyticsDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(analyticsDate);
    dayEnd.setHours(23, 59, 59, 999);
    const [
      totalStudents,
      pendingStudents,
      totalSubjects,
      totalLectures,
      completedLectures,
      totalAttendanceRecords,
      subjectAnalytics,
      recentAttendance,
      topStudents,
      subjectTopStudents,
      recentLectures,
      dailyLectureAnalytics,
      dailySubjectCounts,
      studentStatusSummary
    ] = await Promise.all([
      User.countDocuments({ ...studentScope, status: 'active' }),
      isTeacher ? Promise.resolve(0) : User.countDocuments({ ...studentScope, status: 'pending' }),
      Subject.countDocuments(subjectScope),
      Lecture.countDocuments({ ...lectureScope, status: 'completed' }),
      Lecture.countDocuments({ ...lectureScope, status: 'completed' }),
      Attendance.countDocuments(attendanceScope),
      Attendance.aggregate([
      { $match: attendanceScope },
      {
        $lookup: {
          from: 'lectures', localField: 'lecture', foreignField: '_id', as: 'lectureData'
        }
      },
      { $unwind: '$lectureData' },
      {
        $match: {
          'lectureData.status': 'completed',
          'lectureData.pendingDeletion': { $ne: true }
        }
      },
      {
        $group: {
          _id: '$subject',
          presentCount: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
          totalCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'subjects', localField: '_id', foreignField: '_id', as: 'subjectInfo'
        }
      },
      { $unwind: '$subjectInfo' },
      {
        $project: {
          subjectName: '$subjectInfo.name',
          subjectCode: '$subjectInfo.code',
          presentCount: 1,
          totalCount: 1,
          percentage: {
            $multiply: [{ $divide: ['$presentCount', { $add: ['$totalCount', 0.0001] }] }, 100]
          }
        }
      }
      ]),
      Attendance.aggregate([
      { $match: attendanceScope },
      { $lookup: { from: 'lectures', localField: 'lecture', foreignField: '_id', as: 'lectureData' } },
      { $unwind: '$lectureData' },
      {
        $match: {
          'lectureData.status': 'completed',
          'lectureData.pendingDeletion': { $ne: true },
          'lectureData.date': { $gte: sevenDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$lectureData.date' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
      ]),
      Attendance.aggregate([
      { $match: { ...attendanceScope, status: 'present' } },
      { $lookup: { from: 'lectures', localField: 'lecture', foreignField: '_id', as: 'lectureData' } },
      { $unwind: '$lectureData' },
      {
        $match: {
          'lectureData.status': 'completed',
          'lectureData.pendingDeletion': { $ne: true }
        }
      },
      { $group: { _id: '$student', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'studentInfo' }
      },
      { $unwind: '$studentInfo' },
      {
        $project: {
          name: '$studentInfo.name',
          studentId: '$studentInfo.studentId',
          profileImage: '$studentInfo.profileImage',
          count: 1
        }
      }
      ]),
      Attendance.aggregate([
      { $match: { ...attendanceScope, status: 'present' } },
      { $lookup: { from: 'lectures', localField: 'lecture', foreignField: '_id', as: 'lectureData' } },
      { $unwind: '$lectureData' },
      {
        $match: {
          'lectureData.status': 'completed',
          'lectureData.pendingDeletion': { $ne: true }
        }
      },
      { $group: { _id: { subject: '$subject', student: '$student' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      {
        $lookup: { from: 'users', localField: '_id.student', foreignField: '_id', as: 'studentInfo' }
      },
      { $unwind: '$studentInfo' },
      {
        $lookup: { from: 'subjects', localField: '_id.subject', foreignField: '_id', as: 'subjectInfo' }
      },
      { $unwind: '$subjectInfo' },
      {
        $group: {
          _id: '$_id.subject',
          subject: {
            $first: {
              _id: '$subjectInfo._id',
              name: '$subjectInfo.name',
              code: '$subjectInfo.code',
              semester: '$subjectInfo.semester',
              branch: '$subjectInfo.branch'
            }
          },
          students: {
            $push: {
              _id: '$studentInfo._id',
              name: '$studentInfo.name',
              studentId: '$studentInfo.studentId',
              profileImage: '$studentInfo.profileImage',
              count: '$count'
            }
          }
        }
      },
      { $project: { subject: 1, students: { $slice: ['$students', 5] } } },
      { $sort: { 'subject.code': 1, 'subject.name': 1 } }
      ]),
      Lecture.find({ ...lectureScope, status: 'completed', ...visibleDashboardLectureFilter })
        .populate('subject', 'name code department branch semester')
        .sort({ date: -1, startTime: -1, createdAt: -1 })
        .limit(5)
        .lean(),
      Lecture.find({
        ...lectureScope,
        status: 'completed',
        date: { $gte: dayStart, $lte: dayEnd }
      })
        .populate('subject', 'name code department branch semester')
        .sort({ startTime: 1, createdAt: 1 })
        .lean()
        .then(async (lectures) => {
          if (!lectures.length) return [];
          const counts = await Attendance.aggregate([
            { $match: { lecture: { $in: lectures.map(lecture => lecture._id) }, status: { $in: ['present', 'absent'] } } },
            {
              $group: {
                _id: '$lecture',
                present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
                absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
                total: { $sum: 1 }
              }
            }
          ]);
          const countMap = new Map(counts.map(item => [item._id.toString(), item]));
          return lectures.map(lecture => ({
            _id: lecture._id,
            title: lecture.title,
            date: lecture.date,
            startTime: lecture.startTime,
            subject: lecture.subject,
            present: countMap.get(lecture._id.toString())?.present || 0,
            absent: countMap.get(lecture._id.toString())?.absent || 0,
            total: countMap.get(lecture._id.toString())?.total || 0,
            percentage: countMap.get(lecture._id.toString())?.total
              ? (((countMap.get(lecture._id.toString())?.present || 0) / countMap.get(lecture._id.toString()).total) * 100).toFixed(1)
              : '0.0'
          }));
        }),
      Attendance.aggregate([
        { $match: { subject: { $in: scopedSubjectIds }, status: { $in: ['present', 'absent'] } } },
        { $lookup: { from: 'lectures', localField: 'lecture', foreignField: '_id', as: 'lectureData' } },
        { $unwind: '$lectureData' },
        {
          $match: {
            'lectureData.status': 'completed',
            'lectureData.pendingDeletion': { $ne: true },
            'lectureData.date': { $gte: dayStart, $lte: dayEnd }
          }
        },
        {
          $group: {
            _id: '$subject',
            present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
            absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
            total: { $sum: 1 },
            lectures: { $addToSet: '$lecture' }
          }
        },
        {
          $project: {
            present: 1,
            absent: 1,
            total: 1,
            lectureCount: { $size: '$lectures' }
          }
        }
      ])
      ,
      User.aggregate([
        { $match: studentScope },
        {
          $group: {
            _id: {
              $cond: [{ $eq: ['$status', 'active'] }, 'active', 'inactive']
            },
            count: { $sum: 1 }
          }
        }
      ])
    ]);
    const statusMap = new Map(studentStatusSummary.map(item => [item._id, item.count]));
    const studentStatusCounts = {
      active: statusMap.get('active') || 0,
      inactive: statusMap.get('inactive') || 0
    };
    const dailySubjectCountMap = new Map(dailySubjectCounts.map(item => [item._id.toString(), item]));
    const dailySubjectAttendance = scopedSubjects.map(subject => {
      const counts = dailySubjectCountMap.get(subject._id.toString()) || {};
      const total = counts.total || 0;
      const present = counts.present || 0;
      return {
        subjectId: subject._id,
        subjectName: subject.name,
        subjectCode: subject.code,
        department: subject.department,
        branch: subject.branch || '',
        semester: subject.semester,
        present,
        absent: counts.absent || 0,
        total,
        lectureCount: counts.lectureCount || 0,
        percentage: total ? Number(((present / total) * 100).toFixed(1)) : 0
      };
    });
    await logAudit(req, {
      action: 'analytics.viewed',
      entityType: 'analytics',
      entityName: 'Admin analytics',
      targetDepartment: getAdminDepartment(req.user) || (isTeacher ? 'Teacher Assigned Subjects' : 'All Departments'),
    });

    res.json({
      success: true,
      analytics: {
        totalStudents, pendingStudents, totalSubjects, totalLectures,
        completedLectures,
        totalAttendanceRecords,
        subjectAnalytics,
        recentAttendance,
        topStudents,
        subjectTopStudents,
        recentLectures,
        dailyLectureAnalytics,
        dailySubjectAttendance,
        studentStatusCounts,
        analyticsDate: toLocalDateValue(dayStart)
      }
    });
  } catch (err) {
    console.error('getAnalytics error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getSuperOverview = async (req, res) => {
  try {
    if (!isSystemAdmin(req.user)) {
      return res.status(403).json({ success: false, message: 'Super admin access required' });
    }

    const { course, branch, department, semester, subjectId } = req.query;
    const matchesSelectedCourseBranch = courseBranchMatch({ course, branch });
    const [studentDepartments, subjectDepartments] = await Promise.all([
      User.distinct('department', { role: 'student', pendingDeletion: { $ne: true }, department: { $nin: [null, '', 'Administration'] } }),
      Subject.distinct('department', { isActive: true, pendingDeletion: { $ne: true }, department: { $nin: [null, '', 'Administration'] } })
    ]);
    const departmentNames = Array.from(new Set([...KNOWN_DEPARTMENTS, ...studentDepartments, ...subjectDepartments]))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));

    const departments = await Promise.all(departmentNames.map(async (name) => {
      const subjects = await Subject.find({ department: name, isActive: true, pendingDeletion: { $ne: true } }).select('_id');
      const subjectIds = subjects.map(subject => subject._id);
      const [students, pendingStudents, lectures, completedLectures, attendanceRecords] = await Promise.all([
        User.countDocuments({ role: 'student', pendingDeletion: { $ne: true }, department: name, status: 'active' }),
        User.countDocuments({ role: 'student', pendingDeletion: { $ne: true }, department: name, status: 'pending' }),
        subjectIds.length ? Lecture.countDocuments({ subject: { $in: subjectIds }, pendingDeletion: { $ne: true }, status: 'completed' }) : 0,
        subjectIds.length ? Lecture.countDocuments({ subject: { $in: subjectIds }, pendingDeletion: { $ne: true }, status: 'completed' }) : 0,
        subjectIds.length ? Attendance.countDocuments({ subject: { $in: subjectIds }, status: 'present' }) : 0
      ]);
      return {
        name,
        students,
        pendingStudents,
        subjects: subjectIds.length,
        lectures,
        completedLectures,
        attendanceRecords
      };
    }));

    const [studentCourseRows, subjectCourseRows] = await Promise.all([
      User.find({ role: 'student', pendingDeletion: { $ne: true } }).select('course department branch status').lean(),
      Subject.find({ isActive: true, pendingDeletion: { $ne: true } }).select('course department branch').lean()
    ]);
    const courseNames = Array.from(new Set([...COURSE_OPTIONS, ...studentCourseRows.map(inferCourse), ...subjectCourseRows.map(inferCourse)]))
      .filter(Boolean)
      .sort((a, b) => COURSE_OPTIONS.indexOf(a) - COURSE_OPTIONS.indexOf(b));
    const courses = courseNames.map(name => {
      const courseStudents = studentCourseRows.filter(row => inferCourse(row) === name);
      const courseSubjects = subjectCourseRows.filter(row => inferCourse(row) === name);
      return {
        name,
        students: courseStudents.filter(row => row.status === 'active').length,
        pendingStudents: courseStudents.filter(row => row.status === 'pending').length,
        subjects: courseSubjects.length,
        branches: new Set([...courseStudents, ...courseSubjects].map(inferAcademicBranch).filter(Boolean)).size
      };
    });

    let branches = [];
    if (course) {
      const selectedCourseItems = [...studentCourseRows, ...subjectCourseRows].filter(row => inferCourse(row) === course);
      const branchNames = Array.from(new Set(selectedCourseItems.map(inferAcademicBranch).filter(Boolean))).sort((a, b) => a.localeCompare(b));
      branches = branchNames.map(name => {
        const branchStudents = studentCourseRows.filter(row => inferCourse(row) === course && inferAcademicBranch(row) === name);
        const branchSubjects = subjectCourseRows.filter(row => inferCourse(row) === course && inferAcademicBranch(row) === name);
        return {
          name,
          students: branchStudents.filter(row => row.status === 'active').length,
          pendingStudents: branchStudents.filter(row => row.status === 'pending').length,
          subjects: branchSubjects.length
        };
      });
    }

    let semesters = [];
    let subjects = [];
    let selectedSubject = null;
    let lectures = [];

    if (course && branch) {
      semesters = (await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(async (sem) => {
        const allSemSubjects = await Subject.find({ semester: sem, isActive: true, pendingDeletion: { $ne: true } }).select('_id course department branch').lean();
        const semSubjects = allSemSubjects.filter(matchesSelectedCourseBranch);
        const semSubjectIds = semSubjects.map(subject => subject._id);
        const studentRows = await User.find({ role: 'student', pendingDeletion: { $ne: true }, semester: sem }).select('course department branch status').lean();
        const matchingStudents = studentRows.filter(matchesSelectedCourseBranch);
        const [students, pendingStudents, lectureCount, completedLectureCount, attendanceRecords] = await Promise.all([
          Promise.resolve(matchingStudents.filter(student => student.status === 'active').length),
          Promise.resolve(matchingStudents.filter(student => student.status === 'pending').length),
          semSubjectIds.length ? Lecture.countDocuments({ subject: { $in: semSubjectIds }, pendingDeletion: { $ne: true }, status: 'completed' }) : 0,
          semSubjectIds.length ? Lecture.countDocuments({ subject: { $in: semSubjectIds }, pendingDeletion: { $ne: true }, status: 'completed' }) : 0,
          semSubjectIds.length ? Attendance.countDocuments({ subject: { $in: semSubjectIds }, status: 'present' }) : 0
        ]);
        return {
          semester: sem,
          students,
          pendingStudents,
          subjects: semSubjectIds.length,
          lectures: lectureCount,
          completedLectures: completedLectureCount,
          attendanceRecords
        };
      }))).filter(item => item.subjects > 0);
    } else if (department) {
      semesters = (await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(async (sem) => {
        const semSubjects = await Subject.find({ department, semester: sem, isActive: true, pendingDeletion: { $ne: true } }).select('_id');
        const semSubjectIds = semSubjects.map(subject => subject._id);
        const [students, pendingStudents, lectureCount, completedLectureCount, attendanceRecords] = await Promise.all([
          User.countDocuments({ role: 'student', pendingDeletion: { $ne: true }, department, semester: sem, status: 'active' }),
          User.countDocuments({ role: 'student', pendingDeletion: { $ne: true }, department, semester: sem, status: 'pending' }),
          semSubjectIds.length ? Lecture.countDocuments({ subject: { $in: semSubjectIds }, pendingDeletion: { $ne: true }, status: 'completed' }) : 0,
          semSubjectIds.length ? Lecture.countDocuments({ subject: { $in: semSubjectIds }, pendingDeletion: { $ne: true }, status: 'completed' }) : 0,
          semSubjectIds.length ? Attendance.countDocuments({ subject: { $in: semSubjectIds }, status: 'present' }) : 0
        ]);
        return { semester: sem, students, pendingStudents, subjects: semSubjectIds.length, lectures: lectureCount, completedLectures: completedLectureCount, attendanceRecords };
      }))).filter(item => item.subjects > 0);
    }

    if (course && branch && semester) {
      const semesterNumber = Number(semester);
      const allSubjectDocs = await Subject.find({ semester: semesterNumber, isActive: true, pendingDeletion: { $ne: true } })
        .sort({ name: 1 })
        .select('name code department branch semester credits description');
      const subjectDocs = allSubjectDocs.filter(matchesSelectedCourseBranch);

      subjects = await Promise.all(subjectDocs.map(async (subject) => {
        const [lectureCount, completedLectureCount, enrolledStudents, attendanceRecords] = await Promise.all([
          Lecture.countDocuments({ subject: subject._id, pendingDeletion: { $ne: true }, status: 'completed' }),
          Lecture.countDocuments({ subject: subject._id, pendingDeletion: { $ne: true }, status: 'completed' }),
          User.countDocuments({ ...studentMatchForSubject(subject), pendingDeletion: { $ne: true }, status: 'active', enrolledSubjects: subject._id }),
          Attendance.countDocuments({ subject: subject._id, status: 'present' })
        ]);
        return { ...subject.toObject(), course: inferCourse(subject), academicBranch: inferAcademicBranch(subject), lectureCount, completedLectureCount, enrolledStudents, attendanceRecords };
      }));
    } else if (department && semester) {
      const semesterNumber = Number(semester);
      const subjectDocs = await Subject.find({ department, semester: semesterNumber, isActive: true, pendingDeletion: { $ne: true } })
        .sort({ name: 1 })
        .select('name code department branch semester credits description');

      subjects = await Promise.all(subjectDocs.map(async (subject) => {
        const [lectureCount, completedLectureCount, enrolledStudents, attendanceRecords] = await Promise.all([
          Lecture.countDocuments({ subject: subject._id, pendingDeletion: { $ne: true }, status: 'completed' }),
          Lecture.countDocuments({ subject: subject._id, pendingDeletion: { $ne: true }, status: 'completed' }),
          User.countDocuments({ ...studentMatchForSubject(subject), pendingDeletion: { $ne: true }, status: 'active', enrolledSubjects: subject._id }),
          Attendance.countDocuments({ subject: subject._id, status: 'present' })
        ]);
        return {
          ...subject.toObject(),
          lectureCount,
          completedLectureCount,
          enrolledStudents,
          attendanceRecords
        };
      }));
    }

    if (subjectId) {
      const subject = await Subject.findById(subjectId).select('name code department branch semester credits description isActive pendingDeletion');
      if (!subject || !subject.isActive || subject.pendingDeletion) {
        return res.status(404).json({ success: false, message: 'Subject not found' });
      }
      if (course && inferCourse(subject) !== course) {
        return res.status(403).json({ success: false, message: 'Subject does not belong to selected course' });
      }
      if (branch && inferAcademicBranch(subject) !== branch) {
        return res.status(403).json({ success: false, message: 'Subject does not belong to selected branch' });
      }
      if (department && subject.department !== department) {
        return res.status(403).json({ success: false, message: 'Subject does not belong to selected department' });
      }
      if (semester && Number(subject.semester) !== Number(semester)) {
        return res.status(403).json({ success: false, message: 'Subject does not belong to selected semester' });
      }

      selectedSubject = subject;
      const [lectureDocs, enrolledStudentCount] = await Promise.all([
        Lecture.find({ subject: subject._id, pendingDeletion: { $ne: true }, status: 'completed' })
          .populate('createdBy', 'name email')
          .sort({ date: 1, startTime: 1, createdAt: 1 })
          .lean(),
        User.countDocuments({ ...studentMatchForSubject(subject), pendingDeletion: { $ne: true }, status: 'active', enrolledSubjects: subject._id })
      ]);
      const presentCounts = lectureDocs.length
        ? await Attendance.aggregate([
          { $match: { lecture: { $in: lectureDocs.map(lecture => lecture._id) }, status: 'present' } },
          { $group: { _id: '$lecture', present: { $sum: 1 } } }
        ])
        : [];
      const presentMap = new Map(presentCounts.map(item => [item._id.toString(), item.present]));

      lectures = lectureDocs.map((lecture) => {
        const present = presentMap.get(lecture._id.toString()) || 0;
        return {
          ...lecture,
          enrolledStudents: enrolledStudentCount,
          attendanceStats: {
            present,
            absent: Math.max(enrolledStudentCount - present, 0),
            total: enrolledStudentCount,
            percentage: enrolledStudentCount ? ((present / enrolledStudentCount) * 100).toFixed(1) : '0.0'
          }
        };
      });
    }

    await logAudit(req, {
      action: 'analytics.viewed',
      entityType: 'analytics',
      entityName: 'Super admin department explorer',
      targetDepartment: department || 'All Departments',
      details: { department: department || null, semester: semester || null, subjectId: subjectId || null }
    });

    res.json({
      success: true,
      departments,
      courses,
      branches,
      semesters,
      subjects,
      selectedSubject,
      lectures
    });
  } catch (err) {
    console.error('getSuperOverview error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getAcademicStructure = async (req, res) => {
  try {
    await seedAcademicStructure();
    const structures = await AcademicStructure.find({ isActive: true }).sort({ course: 1 }).lean();
    res.json({ success: true, structures });
  } catch (err) {
    console.error('getAcademicStructure error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getAttendanceCriteriaSettings = async (req, res) => {
  try {
    const scopedDepartment = getAdminDepartment(req.user);
    const department = scopedDepartment || String(req.query.department || '').trim();
    const branch = normalizeBranchValue(req.query.branch);
    const semester = Number(req.query.semester || getAdminSemesterScope(req.user) || 0);
    if (!department || !semester) {
      return res.status(400).json({ success: false, message: 'Department and semester are required' });
    }
    if (scopedDepartment && department !== scopedDepartment) {
      return res.status(403).json({ success: false, message: `Department admin can update only ${scopedDepartment}.` });
    }
    const criteria = await getAttendanceCriteria({
      course: req.query.course,
      department,
      branch,
      semester,
    });
    res.json({
      success: true,
      criteria,
    });
  } catch (err) {
    console.error('getAttendanceCriteriaSettings error:', err);
    res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Server error' });
  }
};

const updateAttendanceCriteriaSettings = async (req, res) => {
  try {
    const scopedDepartment = getAdminDepartment(req.user);
    const department = scopedDepartment || String(req.body.department || '').trim();
    const branch = normalizeBranchValue(req.body.branch);
    const semester = Number(req.body.semester || getAdminSemesterScope(req.user) || 0);
    const course = String(req.body.course || '').trim();
    const minimumPercentage = Number(req.body.minimumPercentage);
    if (!department || !semester) {
      return res.status(400).json({ success: false, message: 'Department and semester are required' });
    }
    if (scopedDepartment && department !== scopedDepartment) {
      return res.status(403).json({ success: false, message: `Department admin can update only ${scopedDepartment}.` });
    }
    if (!Number.isFinite(minimumPercentage) || minimumPercentage < 1 || minimumPercentage > 100) {
      return res.status(400).json({ success: false, message: 'Minimum percentage must be between 1 and 100' });
    }

    const criteria = await AttendanceCriteria.findOneAndUpdate(
      criteriaFilter({ department, branch, semester }),
      {
        course,
        department,
        branch,
        semester,
        minimumPercentage,
        updatedBy: req.user._id,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    const recipientQuery = {
      pendingDeletion: { $ne: true },
      status: 'active',
      $or: [
        { role: 'student', department, semester },
        { role: 'teacher', departments: department },
        { role: 'teacher', department },
      ],
    };
    const recipients = await User.find(recipientQuery).select('_id role').lean();
    const message = `The minimum % criteria is updated by the Department Admin to ${minimumPercentage}%.`;
    const notifications = await Notification.insertMany(recipients.map(recipient => ({
      recipient: recipient._id,
      recipientRole: recipient.role,
      type: 'general',
      title: 'Attendance criteria updated',
      message,
      data: { department, branch, semester, course, minimumPercentage },
      priority: 'high',
    })), { ordered: false });

    const payload = { action: 'attendance_criteria_updated', criteria };
    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('attendance_criteria_updated', payload);
      io.to(adminDepartmentRoom(department)).emit('attendance_criteria_updated', payload);
      recipients.forEach((recipient, index) => {
        io.to(`user_${recipient._id}`).emit('attendance_criteria_updated', payload);
        if (notifications[index]) io.to(`user_${recipient._id}`).emit('notification_created', notifications[index]);
      });
    }

    await logAudit(req, {
      action: 'attendance.criteria_updated',
      entityType: 'attendance_criteria',
      entityId: criteria._id,
      entityName: `${department} Semester ${semester}`,
      targetDepartment: department,
      details: { course, branch, semester, minimumPercentage },
    });
    res.json({ success: true, criteria, message: 'Attendance criteria updated' });
  } catch (err) {
    console.error('updateAttendanceCriteriaSettings error:', err);
    res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Server error' });
  }
};

const addAcademicCourse = async (req, res) => {
  try {
    const course = String(req.body.course || '').trim();
    if (!course) return res.status(400).json({ success: false, message: 'Course name is required' });
    await seedAcademicStructure();
    const existing = await AcademicStructure.findOne({ course });
    if (existing) return res.status(400).json({ success: false, message: 'Course already exists' });
    const structure = await AcademicStructure.create({ course, branches: [], isActive: true });
    await logAudit(req, {
      action: 'academic.course_created',
      entityType: 'academic_structure',
      entityId: structure._id,
      entityName: course,
      targetDepartment: 'Administration'
    });
    emitAdminChange(req, 'academic_structure_changed', { action: 'course_created', course, structureId: structure._id });
    res.status(201).json({ success: true, structure });
  } catch (err) {
    console.error('addAcademicCourse error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const addAcademicBranch = async (req, res) => {
  try {
    const { course, name, department, subjectBranch, semesters } = req.body;
    const courseName = String(course || '').trim();
    const branchName = String(name || '').trim();
    const branchDepartment = String(department || '').trim();
    if (!courseName || !branchName || !branchDepartment) {
      return res.status(400).json({ success: false, message: 'Course, branch name, and department are required' });
    }
    await seedAcademicStructure();
    const structure = await AcademicStructure.findOne({ course: courseName, isActive: true });
    if (!structure) return res.status(404).json({ success: false, message: 'Course not found' });
    if ((structure.branches || []).some(branch => branch.name.toLowerCase() === branchName.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'Branch already exists in this course' });
    }
    const semesterValues = Array.isArray(semesters)
      ? semesters
      : String(semesters || '').split(',');
    const normalizedSemesters = [...new Set(semesterValues.map(value => Number(value)).filter(value => value >= 1 && value <= 12))];
    structure.branches.push({
      name: branchName,
      department: branchDepartment,
      subjectBranch: String(subjectBranch || '').trim(),
      semesters: normalizedSemesters.length ? normalizedSemesters : [1, 2, 3, 4, 5, 6, 7, 8],
      isActive: true
    });
    await structure.save();
    await logAudit(req, {
      action: 'academic.branch_created',
      entityType: 'academic_structure',
      entityId: structure._id,
      entityName: `${courseName} - ${branchName}`,
      targetDepartment: branchDepartment,
      details: { subjectBranch, semesters: normalizedSemesters }
    });
    emitAdminChange(req, 'academic_structure_changed', { action: 'branch_created', course: courseName, branch: branchName, department: branchDepartment, structureId: structure._id }, branchDepartment);
    res.status(201).json({ success: true, structure });
  } catch (err) {
    console.error('addAcademicBranch error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const deleteAcademicCourse = async (req, res) => {
  try {
    const courseName = decodeURIComponent(String(req.params.course || '')).trim();
    if (!courseName) return res.status(400).json({ success: false, message: 'Course is required' });
    const structure = await AcademicStructure.findOne({ course: courseName, isActive: true });
    if (!structure) return res.status(404).json({ success: false, message: 'Course not found' });

    const subjectBranches = (structure.branches || []).map(branch => ({
      department: branch.department,
      subjectBranch: normalizeBranchValue(branch.subjectBranch)
    }));
    const subjectConflict = subjectBranches.length
      ? await Subject.findOne({
        isActive: true,
        pendingDeletion: { $ne: true },
        $or: subjectBranches.map(branch => ({
          department: branch.department,
          ...branchFilter(branch.subjectBranch)
        }))
      }).select('_id')
      : null;
    const studentConflict = await User.findOne({ role: 'student', course: courseName, pendingDeletion: { $ne: true } }).select('_id');
    if (subjectConflict || studentConflict) {
      return res.status(400).json({ success: false, message: 'Move or delete related students/subjects before deleting this course.' });
    }

    structure.isActive = false;
    await structure.save();
    await logAudit(req, {
      action: 'academic.course_deleted',
      entityType: 'academic_structure',
      entityId: structure._id,
      entityName: courseName,
      targetDepartment: 'Administration'
    });
    emitAdminChange(req, 'academic_structure_changed', { action: 'course_deleted', course: courseName, structureId: structure._id });
    res.json({ success: true, message: 'Course deleted' });
  } catch (err) {
    console.error('deleteAcademicCourse error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const deleteAcademicBranch = async (req, res) => {
  try {
    const courseName = decodeURIComponent(String(req.params.course || '')).trim();
    const branchName = decodeURIComponent(String(req.params.branch || '')).trim();
    if (!courseName || !branchName) return res.status(400).json({ success: false, message: 'Course and branch are required' });
    const structure = await AcademicStructure.findOne({ course: courseName, isActive: true });
    if (!structure) return res.status(404).json({ success: false, message: 'Course not found' });
    const branch = (structure.branches || []).find(item => item.name === branchName && item.isActive !== false);
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

    const subjectConflict = await Subject.findOne({
      department: branch.department,
      ...branchFilter(branch.subjectBranch),
      isActive: true,
      pendingDeletion: { $ne: true }
    }).select('_id');
    const studentConflict = await User.findOne({
      role: 'student',
      course: courseName,
      pendingDeletion: { $ne: true },
      $or: [{ branch: branchName }, { branch: branch.subjectBranch }]
    }).select('_id');
    if (subjectConflict || studentConflict) {
      return res.status(400).json({ success: false, message: 'Move or delete related students/subjects before deleting this branch.' });
    }

    branch.isActive = false;
    await structure.save();
    await logAudit(req, {
      action: 'academic.branch_deleted',
      entityType: 'academic_structure',
      entityId: structure._id,
      entityName: `${courseName} - ${branchName}`,
      targetDepartment: branch.department
    });
    emitAdminChange(req, 'academic_structure_changed', { action: 'branch_deleted', course: courseName, branch: branchName, department: branch.department, structureId: structure._id }, branch.department);
    res.json({ success: true, message: 'Branch deleted' });
  } catch (err) {
    console.error('deleteAcademicBranch error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const upsertTeacher = async ({ payload, req, fallbackDepartment, defaultPassword }) => {
  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const departments = normalizeDepartments(payload.departments || payload.department, fallbackDepartment);
  if (!name || !email) throw new Error('Teacher name and email are required');
  if (!departments.length) throw new Error('At least one department is required');

  const existing = await User.findOne({ email });
  if (existing && existing.role !== 'teacher') {
    throw new Error(`${email} already belongs to a ${existing.role} account`);
  }

  if (existing) {
    const nextDepartments = [...new Set([...(existing.departments || []), ...departments])];
    existing.name = name || existing.name;
    existing.phone = payload.phone || existing.phone;
    existing.department = existing.department || nextDepartments[0];
    existing.departments = nextDepartments;
    existing.status = existing.status === 'pending' ? 'active' : existing.status;
    existing.pendingDeletion = false;
    await existing.save({ validateBeforeSave: false });
    return existing;
  }

  return User.create({
    name,
    email,
    password: defaultPassword,
    role: 'teacher',
    status: 'active',
    department: departments[0],
    departments,
    phone: payload.phone || '',
    approvedAt: new Date(),
    approvedBy: req.user._id
  });
};

const getTeachers = async (req, res) => {
  try {
    const adminDepartment = getAdminDepartment(req.user);
    const { department, search } = req.query;
    const targetDepartment = adminDepartment || department;
    const query = { role: 'teacher', pendingDeletion: { $ne: true } };
    if (targetDepartment) query.departments = targetDepartment;
    if (search) query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];

    const teachers = await User.find(query)
      .select(teacherSafeFields)
      .sort({ name: 1 })
      .lean();

    res.json({ success: true, teachers });
  } catch (err) {
    console.error('getTeachers error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const deleteTeacher = async (req, res) => {
  try {
    const teacher = await User.findOne({ _id: req.params.id, role: 'teacher' });
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });
    const adminDepartment = getAdminDepartment(req.user);
    if (adminDepartment && !(teacher.departments || []).includes(adminDepartment)) {
      return res.status(403).json({ success: false, message: 'Access denied: teacher belongs to another department' });
    }
    if (teacher.pendingDeletion) {
      return res.status(400).json({ success: false, message: 'Teacher deletion is already pending.' });
    }

    const deletion = await schedulePendingDeletion({
      resourceType: 'teacher',
      resourceId: teacher._id,
      resourceName: teacher.name,
      targetDepartment: (teacher.departments || []).join(', '),
      requestedBy: req.user._id
    });
    teacher.pendingDeletion = true;
    teacher.deletionScheduledAt = new Date();
    teacher.deletionExpiresAt = deletion.expiresAt;
    await teacher.save();

    await logAudit(req, {
      action: 'teacher.delete_scheduled',
      entityType: 'teacher',
      entityId: teacher._id,
      entityName: teacher.name,
      targetDepartment: (teacher.departments || []).join(', '),
      details: { undoExpiresAt: deletion.expiresAt }
    });
    (teacher.departments || [adminDepartment]).filter(Boolean).forEach(department => {
      emitAdminChange(req, 'teacher_changed', { action: 'delete_scheduled', teacherId: teacher._id, department }, department);
    });
    emitAdminChange(req, 'pending_deletions_changed', { resourceType: 'teacher', resourceId: teacher._id, action: 'scheduled' }, adminDepartment);

    res.json({
      success: true,
      message: 'Teacher delete scheduled. You can undo this for 10 minutes.',
      deletionId: deletion._id,
      undoExpiresAt: deletion.expiresAt
    });
  } catch (err) {
    console.error('deleteTeacher error:', err);
    res.status(500).json({ success: false, message: err.message || 'Could not delete teacher' });
  }
};

const getTeacherDashboard = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teacher access required' });
    }

    const semester = getTeacherSemesterScope(req.user);
    const subjectQuery = { assignedTeachers: req.user._id, isActive: true, pendingDeletion: { $ne: true } };
    if (semester) subjectQuery.semester = semester;
    const subjects = await Subject.find(subjectQuery).select('_id name code department branch semester assignedTeachers').lean();
    const subjectIds = subjects.map(subject => subject._id);
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now);
    todayEnd.setHours(23, 59, 59, 999);

    let [completedLectures, todayLectures, todayPresent, todayPresentStudents, recentLectures] = await Promise.all([
      subjectIds.length ? Lecture.countDocuments({ subject: { $in: subjectIds }, status: 'completed', pendingDeletion: { $ne: true } }) : 0,
      subjectIds.length ? Lecture.find({
        subject: { $in: subjectIds },
        date: { $gte: todayStart, $lte: todayEnd },
        pendingDeletion: { $ne: true },
        ...visibleDashboardLectureFilter
      }).populate('subject', 'name code department branch semester').sort({ startTime: 1 }).lean() : [],
      subjectIds.length ? Attendance.countDocuments({
        subject: { $in: subjectIds },
        status: 'present',
        markedAt: { $gte: todayStart, $lte: todayEnd }
      }) : 0,
      subjectIds.length ? Attendance.distinct('student', {
        subject: { $in: subjectIds },
        status: 'present',
        markedAt: { $gte: todayStart, $lte: todayEnd }
      }) : [],
      subjectIds.length ? Lecture.find({ subject: { $in: subjectIds }, pendingDeletion: { $ne: true }, status: 'completed', ...visibleDashboardLectureFilter })
        .populate('subject', 'name code department branch semester')
        .sort({ date: -1, startTime: -1 })
        .limit(6)
        .lean() : []
    ]);

    const todayLectureIds = todayLectures.map(lecture => lecture._id);
    if (todayLectureIds.length) {
      [todayPresent, todayPresentStudents] = await Promise.all([
        Attendance.countDocuments({
          lecture: { $in: todayLectureIds },
          status: 'present'
        }),
        Attendance.distinct('student', {
          lecture: { $in: todayLectureIds },
          status: 'present'
        })
      ]);
    } else {
      todayPresent = 0;
      todayPresentStudents = [];
    }

    const openToday = todayLectures.filter(lecture => lecture.attendanceOpen).length;
    const completedToday = todayLectures.filter(lecture => lecture.status === 'completed').length;
    const lowAttendance = [];
    const [allCompletedLectureDocs, allAssignedStudents] = await Promise.all([
      subjectIds.length ? Lecture.find({ subject: { $in: subjectIds }, status: 'completed', pendingDeletion: { $ne: true } }).select('_id subject').lean() : [],
      subjectIds.length ? User.find({
        role: 'student',
        status: 'active',
        enrolledSubjects: { $in: subjectIds },
        pendingDeletion: { $ne: true }
      }).select('name email studentId profileImage department branch semester enrolledSubjects').lean() : []
    ]);
    const lectureCountMap = new Map();
    allCompletedLectureDocs.forEach((lecture) => {
      const key = lecture.subject.toString();
      lectureCountMap.set(key, (lectureCountMap.get(key) || 0) + 1);
    });
    const presentCounts = allCompletedLectureDocs.length
      ? await Attendance.aggregate([
        {
          $match: {
            subject: { $in: subjectIds },
            lecture: { $in: allCompletedLectureDocs.map(lecture => lecture._id) },
            status: 'present',
            student: { $in: allAssignedStudents.map(student => student._id) }
          }
        },
        { $group: { _id: { subject: '$subject', student: '$student' }, present: { $sum: 1 } } }
      ])
      : [];
    const countMap = new Map(presentCounts.map(item => [`${item._id.subject}-${item._id.student}`, item.present]));
    for (const subject of subjects) {
      const lectureCount = lectureCountMap.get(subject._id.toString()) || 0;
      const matchingStudents = allAssignedStudents.filter(student => (
        (student.enrolledSubjects || []).some(id => id.toString() === subject._id.toString()) &&
        studentMatchesSubject(student, subject)
      ));
      if (!lectureCount || !matchingStudents.length) continue;
      matchingStudents.forEach(student => {
        const present = countMap.get(`${subject._id}-${student._id}`) || 0;
        const percentage = (present / lectureCount) * 100;
        if (percentage < 60) {
          lowAttendance.push({
            student: {
              _id: student._id,
              name: student.name,
              email: student.email,
              studentId: student.studentId,
              profileImage: student.profileImage
            },
            subject: {
              _id: subject._id,
              name: subject.name,
              code: subject.code,
              semester: subject.semester,
              branch: subject.branch,
              department: subject.department
            },
            present,
            total: lectureCount,
            percentage: percentage.toFixed(1)
          });
        }
      });
    }
    const teacherDepartments = normalizeDepartments(req.user.departments, req.user.department);
    const peerSubjectQuery = {
      isActive: true,
      pendingDeletion: { $ne: true },
      assignedTeachers: { $exists: true, $ne: [] }
    };
    if (semester) peerSubjectQuery.semester = semester;
    if (teacherDepartments.length) peerSubjectQuery.department = { $in: teacherDepartments };
    const peerSubjects = await Subject.find(peerSubjectQuery).select('assignedTeachers').lean();
    const teacherIds = new Set();
    peerSubjects.forEach(subject => (subject.assignedTeachers || []).forEach(id => {
      if (id?.toString() !== req.user._id.toString()) teacherIds.add(id.toString());
    }));
    const peerTeachers = teacherIds.size
      ? await User.find({ _id: { $in: [...teacherIds] }, role: 'teacher', pendingDeletion: { $ne: true } })
        .select(publicTeacherFields)
        .lean()
      : [];

    res.json({
      success: true,
      dashboard: {
        assignedSubjects: subjects.length,
        completedLectures,
        todayLectures: todayLectures.length,
        todayPresent,
        todayPresentStudents: todayPresentStudents.length,
        openToday,
        completedToday,
        recentLectures,
        peerTeachers,
        lowAttendance,
        todayWindow: { start: todayStart, end: todayEnd }
      }
    });
  } catch (err) {
    console.error('getTeacherDashboard error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getTeacherStudents = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teacher access required' });
    }
    const { search, status } = req.query;
    const semester = getTeacherSemesterScope(req.user);
    const subjectQuery = { assignedTeachers: req.user._id, isActive: true, pendingDeletion: { $ne: true } };
    if (semester) subjectQuery.semester = semester;
    const subjects = await Subject.find(subjectQuery).select('_id name code department branch semester assignedTeachers').lean();
    const subjectIds = subjects.map(subject => subject._id);
    if (!subjectIds.length) {
      return res.json({ success: true, students: [], subjects: [] });
    }

    const query = {
      role: 'student',
      enrolledSubjects: { $in: subjectIds },
      pendingDeletion: { $ne: true },
      status: status && status !== 'all' ? status : { $in: ['active', 'restricted', 'inactive'] }
    };
    if (semester) query.semester = semester;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { studentId: { $regex: search, $options: 'i' } }
      ];
    }

    const students = await User.find(query)
      .select('name email studentId profileImage department branch semester status isRestricted restrictionReason subjectRestrictions enrolledSubjects createdAt')
      .sort({ name: 1 })
      .lean();

    const visibleStudents = students
      .filter(student => subjects.some(subject => studentMatchesSubject(student, subject)))
      .map(student => ({
        ...student,
        subjectRestrictions: (student.subjectRestrictions || []).filter(item => (
          item?.active !== false && subjectIds.some(subjectId => String(subjectId) === String(item.subject?._id || item.subject))
        )),
        teacherSubjects: subjects.filter(subject => (
          (student.enrolledSubjects || []).some(id => String(id) === String(subject._id)) &&
          studentMatchesSubject(student, subject)
        )).map(subject => ({
          _id: subject._id,
          name: subject.name,
          code: subject.code,
          department: subject.department,
          branch: subject.branch,
          semester: subject.semester,
          restricted: Boolean(activeSubjectRestriction(student, subject._id))
        }))
      }));

    res.json({ success: true, students: visibleStudents, subjects });
  } catch (err) {
    console.error('getTeacherStudents error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const restrictStudentForSubject = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teacher access required' });
    }
    const { subjectId, reason } = req.body || {};
    if (!subjectId) return res.status(400).json({ success: false, message: 'subjectId is required' });

    const semester = getTeacherSemesterScope(req.user);
    const subjectQuery = {
      _id: subjectId,
      assignedTeachers: req.user._id,
      isActive: true,
      pendingDeletion: { $ne: true }
    };
    if (semester) subjectQuery.semester = semester;
    const subject = await Subject.findOne(subjectQuery).select('_id name code department branch semester assignedTeachers').lean();
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found in your teacher workspace.' });

    const student = await User.findOne({
      _id: req.params.id,
      role: 'student',
      enrolledSubjects: subject._id,
      pendingDeletion: { $ne: true }
    }).select('name email studentId department branch semester status isRestricted subjectRestrictions enrolledSubjects');
    if (!student || !studentMatchesSubject(student, subject)) {
      return res.status(404).json({ success: false, message: 'Student is not enrolled in this assigned subject.' });
    }

    const alreadyRestricted = activeSubjectRestriction(student, subject._id);
    if (alreadyRestricted) {
      return res.json({ success: true, message: 'Student is already restricted for this subject.', student });
    }

    student.subjectRestrictions.push({
      subject: subject._id,
      restrictedBy: req.user._id,
      reason: String(reason || '').trim() || `Restricted by ${req.user.name}`,
      restrictedAt: new Date(),
      active: true
    });
    await student.save({ validateBeforeSave: false });

    const teacherRecipients = (subject.assignedTeachers || []).map(id => String(id));
    const adminRecipients = await User.find({
      role: 'admin',
      status: 'active',
      department: subject.department,
      pendingDeletion: { $ne: true }
    }).select('_id').lean();
    const recipientIds = [...new Set([
      student._id.toString(),
      ...teacherRecipients,
      ...adminRecipients.map(admin => admin._id.toString())
    ])];
    await notifyUsers(req, recipientIds.map(recipientId => ({
      recipient: recipientId,
      type: 'account_restricted',
      title: recipientId === student._id.toString() ? 'Subject Attendance Restricted' : 'Student Restricted For Subject',
      message: recipientId === student._id.toString()
        ? `Your profile is restricted by ${req.user.name} for ${subject.name}.`
        : `${student.name} (${student.studentId}) was restricted by ${req.user.name} for ${subject.name}.`,
      data: {
        studentId: student._id,
        studentName: student.name,
        subjectId: subject._id,
        subjectName: subject.name,
        restrictedBy: req.user._id,
        restrictedByName: req.user.name
      },
      priority: recipientId === student._id.toString() ? 'critical' : 'high'
    })));

    emitStudentProfileChange(req, student, 'subject_restricted');
    await logAudit(req, {
      action: 'student.subject_restricted',
      entityType: 'student',
      entityId: student._id,
      entityName: `${student.name} (${student.studentId})`,
      targetDepartment: subject.department,
      details: { subjectId: subject._id, subjectName: subject.name, reason: reason || null }
    });

    res.json({ success: true, message: `Student restricted for ${subject.name}.`, student });
  } catch (err) {
    console.error('restrictStudentForSubject error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const unrestrictStudentForSubject = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teacher access required' });
    }
    const { subjectId } = req.body || {};
    if (!subjectId) return res.status(400).json({ success: false, message: 'subjectId is required' });
    const subject = await Subject.findOne({
      _id: subjectId,
      assignedTeachers: req.user._id,
      isActive: true,
      pendingDeletion: { $ne: true }
    }).select('_id name department').lean();
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found in your teacher workspace.' });

    const student = await User.findOneAndUpdate(
      {
        _id: req.params.id,
        role: 'student',
        'subjectRestrictions.subject': subject._id,
        pendingDeletion: { $ne: true }
      },
      { $set: { 'subjectRestrictions.$[item].active': false } },
      { new: true, arrayFilters: [{ 'item.subject': subject._id, 'item.active': { $ne: false } }] }
    ).select('name studentId department branch semester status isRestricted subjectRestrictions');
    if (!student) return res.status(404).json({ success: false, message: 'Active subject restriction not found.' });

    await notifyUsers(req, [{
      recipient: student._id,
      type: 'general',
      title: 'Subject Attendance Unrestricted',
      message: `Your restriction for ${subject.name} has been removed by ${req.user.name}.`,
      data: { subjectId: subject._id, subjectName: subject.name, unrestrictedBy: req.user._id },
      priority: 'high'
    }]);
    emitStudentProfileChange(req, student, 'subject_unrestricted');
    await logAudit(req, {
      action: 'student.subject_unrestricted',
      entityType: 'student',
      entityId: student._id,
      entityName: `${student.name} (${student.studentId})`,
      targetDepartment: subject.department,
      details: { subjectId: subject._id, subjectName: subject.name }
    });

    res.json({ success: true, message: `Student unrestricted for ${subject.name}.`, student });
  } catch (err) {
    console.error('unrestrictStudentForSubject error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const notifyLowAttendanceStudents = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teacher access required' });
    }
    const { subjectId } = req.body || {};
    const semester = getTeacherSemesterScope(req.user);
    const subjectQuery = {
      _id: subjectId,
      assignedTeachers: req.user._id,
      isActive: true,
      pendingDeletion: { $ne: true }
    };
    if (semester) subjectQuery.semester = semester;
    const subject = await Subject.findOne(subjectQuery).select('_id name code department branch semester assignedTeachers').lean();
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found in your teacher workspace.' });

    const [lectures, students] = await Promise.all([
      Lecture.find({ subject: subject._id, status: 'completed', pendingDeletion: { $ne: true } }).select('_id').lean(),
      User.find({
        role: 'student',
        status: 'active',
        isRestricted: { $ne: true },
        enrolledSubjects: subject._id,
        pendingDeletion: { $ne: true }
      }).select('name studentId department branch semester enrolledSubjects status isRestricted subjectRestrictions').lean()
    ]);
    const matchingStudents = students.filter(student => (
      studentMatchesSubject(student, subject) &&
      canReceiveSubjectUpdates(student, subject._id)
    ));
    if (!lectures.length || !matchingStudents.length) {
      return res.json({ success: true, message: 'No completed attendance data available yet.', notified: 0 });
    }
    const lectureIds = lectures.map(lecture => lecture._id);
    const presentCounts = await Attendance.aggregate([
      { $match: { subject: subject._id, lecture: { $in: lectureIds }, status: 'present', student: { $in: matchingStudents.map(student => student._id) } } },
      { $group: { _id: '$student', present: { $sum: 1 } } }
    ]);
    const countMap = new Map(presentCounts.map(item => [item._id.toString(), item.present]));
    const lowStudents = matchingStudents.map(student => {
      const present = countMap.get(student._id.toString()) || 0;
      const percentage = (present / lectures.length) * 100;
      return { student, present, percentage };
    }).filter(item => item.percentage < 60);

    const recentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const notifications = [];
    for (const { student, present, percentage } of lowStudents) {
      const alreadySent = await Notification.findOne({
        recipient: student._id,
        type: 'low_attendance_alert',
        'data.subjectId': subject._id,
        'data.notifiedBy': req.user._id,
        createdAt: { $gte: recentCutoff }
      }).select('_id').lean();
      if (alreadySent) continue;
      notifications.push(await Notification.create({
        recipient: student._id,
        recipientRole: 'student',
        type: 'low_attendance_alert',
        title: `Low attendance in ${subject.name}`,
        message: `${req.user.name} notified you that your attendance in ${subject.name} is ${percentage.toFixed(1)}% (${present}/${lectures.length}). Please attend upcoming lectures.`,
        data: { subjectId: subject._id, subjectName: subject.name, present, total: lectures.length, percentage: percentage.toFixed(1), notifiedBy: req.user._id },
        priority: 'high'
      }));
    }
    const io = req.app.get('io');
    if (io) {
      notifications.forEach(notification => {
        io.to(`student_${notification.recipient}`).emit('notification_created', notification);
        io.to(`user_${notification.recipient}`).emit('notification_created', notification);
      });
    }
    res.json({
      success: true,
      message: notifications.length
        ? 'Low attendance reminder sent once for this subject.'
        : 'Reminder was already sent recently for this subject.',
      notified: notifications.length ? 1 : 0,
      studentNotifications: notifications.length
    });
  } catch (err) {
    console.error('notifyLowAttendanceStudents error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getTeacherPeers = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teacher access required' });
    }
    const semester = getTeacherSemesterScope(req.user);
    const teacherDepartments = normalizeDepartments(req.user.departments, req.user.department);
    const subjectQuery = {
      isActive: true,
      pendingDeletion: { $ne: true },
      assignedTeachers: { $exists: true, $ne: [] }
    };
    if (semester) subjectQuery.semester = semester;
    if (teacherDepartments.length) subjectQuery.department = { $in: teacherDepartments };
    const subjects = await Subject.find(subjectQuery)
      .populate('assignedTeachers', publicTeacherFields)
      .select('name code department branch semester assignedTeachers')
      .lean();
    const peers = new Map();
    subjects.forEach(subject => {
      (subject.assignedTeachers || []).forEach(teacher => {
        if (!teacher?._id || teacher._id.toString() === req.user._id.toString()) return;
        const id = teacher._id.toString();
        const existing = peers.get(id) || { ...teacher, sharedSubjects: [] };
        existing.sharedSubjects.push({ _id: subject._id, name: subject.name, code: subject.code, semester: subject.semester, branch: subject.branch });
        peers.set(id, existing);
      });
    });
    res.json({ success: true, teachers: [...peers.values()] });
  } catch (err) {
    console.error('getTeacherPeers error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getTeacherPeerProfile = async (req, res) => {
  try {
    if (req.user.role !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Teacher access required' });
    }

    const semester = getTeacherSemesterScope(req.user);
    const teacherDepartments = normalizeDepartments(req.user.departments, req.user.department);
    const subjectQuery = {
      isActive: true,
      pendingDeletion: { $ne: true },
      assignedTeachers: { $exists: true, $ne: [] }
    };
    if (semester) subjectQuery.semester = semester;
    if (teacherDepartments.length) subjectQuery.department = { $in: teacherDepartments };

    const subjects = await Subject.find(subjectQuery)
      .populate('assignedTeachers', publicTeacherFields)
      .select('name code department branch semester assignedTeachers')
      .lean();
    const peerTeacherIds = new Set();
    const peerSubjects = [];
    const ownSubjects = [];
    subjects.forEach(subject => {
      const assignedIds = (subject.assignedTeachers || []).map(teacher => teacher?._id?.toString()).filter(Boolean);
      if (assignedIds.includes(req.user._id.toString())) ownSubjects.push(subject);
      if (assignedIds.includes(String(req.params.id))) peerSubjects.push(subject);
      assignedIds.forEach(id => {
        if (id !== req.user._id.toString()) peerTeacherIds.add(id);
      });
    });

    if (!peerTeacherIds.has(String(req.params.id))) {
      return res.status(404).json({ success: false, message: 'Teacher profile not found in your current semester workspace' });
    }

    const teacher = await User.findOne({
      _id: req.params.id,
      role: 'teacher',
      pendingDeletion: { $ne: true }
    }).select(publicTeacherFields).lean();
    if (!teacher) return res.status(404).json({ success: false, message: 'Teacher not found' });

    const selectedDate = parseDateOnlyAsLocalDay(req.query.date);
    const todayStart = new Date(selectedDate);
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(selectedDate);
    todayEnd.setHours(23, 59, 59, 999);
    const peerSubjectIds = peerSubjects.map(subject => subject._id);
    const ownSubjectIds = ownSubjects.map(subject => subject._id);

    const [peerLectures, myLectures] = await Promise.all([
      peerSubjectIds.length ? Lecture.find({
        subject: { $in: peerSubjectIds },
        date: { $gte: todayStart, $lte: todayEnd },
        pendingDeletion: { $ne: true }
      })
        .populate('subject', 'name code department branch semester')
        .populate('createdBy', publicTeacherFields)
        .sort({ startTime: 1 })
        .lean() : [],
      ownSubjectIds.length ? Lecture.find({
        subject: { $in: ownSubjectIds },
        date: { $gte: todayStart, $lte: todayEnd },
        pendingDeletion: { $ne: true }
      })
        .populate('subject', 'name code department branch semester')
        .sort({ startTime: 1 })
        .lean() : []
    ]);

    const lectures = await Promise.all(peerLectures.map(async (lecture) => {
      const attendance = await Attendance.find({ lecture: lecture._id, status: 'present' })
        .populate('student', 'name studentId profileImage department branch semester')
        .sort({ markedAt: -1 })
        .lean();
      const matchingAttendance = attendance.filter(record => record.student && studentMatchesSubject(record.student, lecture.subject));
      return {
        ...lecture,
        attendance: matchingAttendance,
        attendanceStats: {
          present: matchingAttendance.length
        }
      };
    }));

    res.json({
      success: true,
      teacher,
      subjects: peerSubjects.map(subject => ({
        _id: subject._id,
        name: subject.name,
        code: subject.code,
        department: subject.department,
        branch: subject.branch,
        semester: subject.semester
      })),
      lectures,
      myTodayLectures: myLectures.map(lecture => ({
        _id: lecture._id,
        title: lecture.title,
        date: lecture.date,
        startTime: lecture.startTime,
        endTime: lecture.endTime,
        subject: lecture.subject
      })),
      selectedDate: todayStart,
      dayWindow: { start: todayStart, end: todayEnd }
    });
  } catch (err) {
    console.error('getTeacherPeerProfile error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const createTeacher = async (req, res) => {
  try {
    const adminDepartment = getAdminDepartment(req.user);
    const defaultPassword = String(req.body.defaultPassword || process.env.DEFAULT_TEACHER_PASSWORD || 'Teacher@123');
    if (defaultPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Default password must be at least 8 characters' });
    }

    const teacher = await upsertTeacher({
      payload: req.body,
      req,
      fallbackDepartment: adminDepartment,
      defaultPassword
    });

    await logAudit(req, {
      action: 'teacher.created',
      entityType: 'teacher',
      entityId: teacher._id,
      entityName: teacher.name,
      targetDepartment: adminDepartment || (teacher.departments || []).join(', '),
      details: { email: teacher.email, departments: teacher.departments }
    });
    (teacher.departments || [adminDepartment]).filter(Boolean).forEach(department => {
      emitAdminChange(req, 'teacher_changed', { action: 'created', teacherId: teacher._id, department }, department);
    });

    res.status(201).json({ success: true, teacher: teacher.toSafeObject ? teacher.toSafeObject() : teacher });
  } catch (err) {
    console.error('createTeacher error:', err);
    res.status(400).json({ success: false, message: err.message || 'Could not add teacher' });
  }
};

const importStudents = async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!filePath) {
      return res.status(400).json({ success: false, message: 'CSV or Excel file is required' });
    }

    const rows = await parseSpreadsheetRows(filePath, path.extname(req.file.originalname));
    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'No student rows found in the file' });
    }

    const adminDepartment = getAdminDepartment(req.user);
    const adminSemester = getAdminSemesterScope(req.user);
    const defaultCourse = safeTrim(req.body.course);
    const defaultDepartment = adminDepartment || safeTrim(req.body.department);
    const defaultBranch = safeTrim(req.body.branch);
    const defaultSemester = Number(req.body.semester || adminSemester || 0) || undefined;
    const defaultPassword = safeTrim(req.body.defaultPassword) || process.env.DEFAULT_STUDENT_PASSWORD || 'Student@123';
    const summary = { processed: rows.length, created: 0, updated: 0, skipped: 0, errors: [] };
    const candidates = [];
    const seenStudentIds = new Set();
    const seenEmails = new Set();

    for (const row of rows) {
      const rowNumber = row.__rowNumber;
      const name = safeTrim(importRowValue(row, ['name', 'student name', 'full name']));
      let email = safeTrim(importRowValue(row, ['email', 'gmail', 'gmail id'])).toLowerCase();
      const studentId = safeTrim(importRowValue(row, ['studentId', 'student id', 'roll no', 'roll', 'enrollment no', 'enrollment', 'id']));
      if (!email && studentId) email = `${studentId.toLowerCase()}@students.local`;
      const rowDepartment = safeTrim(importRowValue(row, ['department', 'dept']));
      const department = defaultDepartment || rowDepartment;
      const semester = Number(importRowValue(row, ['semester', 'sem', 'semester no']) || defaultSemester);
      const rowCourse = safeTrim(importRowValue(row, ['course', 'program']));
      const rowBranch = importRowValue(row, ['branch', 'academic branch', 'subject branch']);
      const course = rowCourse || defaultCourse || 'B. Tech';
      const branch = resolveImportBranch({
        course,
        department,
        branch: rowBranch || (rowCourse ? '' : defaultBranch)
      });
      const status = normalizeImportStatus(importRowValue(row, ['status', 'account status']));

      const skip = (message) => {
        summary.skipped += 1;
        summary.errors.push({ row: rowNumber, message });
      };

      if (!name || !studentId || !department || !semester) {
        skip('name, studentId, department, and semester are required');
        continue;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        skip('Invalid email address');
        continue;
      }
      if (adminDepartment && department !== adminDepartment) {
        skip(`Department admin can import only ${adminDepartment} students`);
        continue;
      }
      if (adminSemester && Number(semester) !== Number(adminSemester)) {
        skip(`Admin can import only semester ${adminSemester} students`);
        continue;
      }
      const normalizedStudentId = studentId.toUpperCase();
      if (seenStudentIds.has(normalizedStudentId)) {
        skip(`Duplicate Student ID ${studentId} inside this sheet`);
        continue;
      }
      if (seenEmails.has(email)) {
        skip(`Duplicate email ${email} inside this sheet`);
        continue;
      }
      seenStudentIds.add(normalizedStudentId);
      seenEmails.add(email);

      const password = safeTrim(importRowValue(row, ['password', 'default password']));
      const payload = {
        name,
        email,
        studentId,
        course,
        department,
        branch,
        semester,
        fatherName: safeTrim(importRowValue(row, ['father name', 'fatherName', 'guardian name'])),
        phone: safeTrim(importRowValue(row, ['phone', 'mobile', 'contact'])),
        address: safeTrim(importRowValue(row, ['address'])),
        status,
        isRestricted: status === 'restricted',
        approvedAt: status === 'active' || status === 'restricted' ? new Date() : undefined,
        approvedBy: status === 'active' || status === 'restricted' ? req.user._id : undefined
      };
      const dateOfBirth = importRowValue(row, ['date of birth', 'dob']);
      if (dateOfBirth) {
        const parsedDob = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
        if (!Number.isNaN(parsedDob.getTime())) payload.dateOfBirth = parsedDob;
      }

      candidates.push({ rowNumber, payload, password: password || defaultPassword });
    }

    const existing = candidates.length
      ? await User.find({
        role: 'student',
        pendingDeletion: { $ne: true },
        $or: [
          { studentId: { $in: candidates.map(item => item.payload.studentId) } },
          { email: { $in: candidates.map(item => item.payload.email) } }
        ]
      }).select('email studentId').lean()
      : [];
    const existingStudentIds = new Map(existing.map(student => [String(student.studentId || '').trim().toUpperCase(), student]));
    const existingEmails = new Map(existing.map(student => [String(student.email || '').trim().toLowerCase(), student]));
    const createItems = [];

    candidates.forEach((item) => {
      const byStudentId = existingStudentIds.get(String(item.payload.studentId || '').trim().toUpperCase());
      const byEmail = existingEmails.get(String(item.payload.email || '').trim().toLowerCase());
      if (byStudentId && byEmail && String(byStudentId._id) !== String(byEmail._id)) {
        summary.skipped += 1;
        summary.errors.push({ row: item.rowNumber, message: 'Email and studentId belong to different students' });
        return;
      }
      const duplicate = byStudentId || byEmail;
      if (duplicate) {
        summary.skipped += 1;
        summary.errors.push({
          row: item.rowNumber,
          message: String(duplicate.studentId || '').trim().toUpperCase() === String(item.payload.studentId || '').trim().toUpperCase()
            ? `Student ID ${item.payload.studentId} is already registered`
            : `Email ${item.payload.email} is already registered`
        });
        return;
      }
      createItems.push(item);
    });

    const hashedPasswords = await Promise.all(createItems.map(item => bcrypt.hash(item.password, 12)));
    const docsToInsert = createItems.map((item, index) => ({
      ...item.payload,
      role: 'student',
      password: hashedPasswords[index]
    }));
    let touchedStudents = [];
    if (docsToInsert.length) {
      try {
        touchedStudents = await User.insertMany(docsToInsert, { ordered: false });
      } catch (error) {
        touchedStudents = error.insertedDocs || error.result?.insertedDocs || [];
        const writeErrors = error.writeErrors || error.result?.result?.writeErrors || [];
        writeErrors.slice(0, 20).forEach(item => {
          summary.skipped += 1;
          summary.errors.push({
            row: createItems[item.index]?.rowNumber || null,
            message: item.errmsg || item.message || 'Row could not be imported'
          });
        });
        if (!touchedStudents.length) throw error;
      }
    }
    summary.created = touchedStudents.length;

    const subjects = touchedStudents.length
      ? await Subject.find({
        isActive: true,
        pendingDeletion: { $ne: true },
        department: { $in: [...new Set(touchedStudents.map(student => student.department).filter(Boolean))] },
        semester: { $in: [...new Set(touchedStudents.map(student => Number(student.semester)).filter(Boolean))] }
      }).select('_id department branch semester').lean()
      : [];
    const enrollmentOps = touchedStudents.map((student) => {
      const subjectIds = subjects
        .filter(subject => studentMatchesSubject(student, subject))
        .map(subject => subject._id);
      if (!subjectIds.length) return null;
      return {
        updateOne: {
          filter: { _id: student._id },
          update: { $addToSet: { enrolledSubjects: { $each: subjectIds } } }
        }
      };
    }).filter(Boolean);
    if (enrollmentOps.length) {
      await safeImportSideEffect('Student enrollment sync', () => User.bulkWrite(enrollmentOps, { ordered: false }));
    }

    const notifications = touchedStudents.map(student => ({
      recipient: student._id,
      type: student.status === 'pending' ? 'registration_request' : 'account_approved',
      title: student.status === 'pending' ? 'Registration Imported' : 'Student Account Ready',
      message: student.status === 'pending'
        ? 'Your student profile was imported and is pending approval.'
        : 'Your student profile was imported by department admin.',
      priority: 'medium'
    }));
    if (notifications.length) {
      await safeImportSideEffect('Student import notifications', () => Notification.insertMany(notifications, { ordered: false }));
    }

    await safeImportSideEffect('Student import audit log', () => logAudit(req, {
      action: 'students.imported',
      entityType: 'student',
      entityName: 'Bulk student import',
      targetDepartment: adminDepartment || 'Multiple',
      details: summary
    }));

    const io = req.app.get('io');
    await safeImportSideEffect('Student import socket emit', async () => {
      if (!io) return;
      const payload = { action: 'bulk_imported', summary, timestamp: new Date() };
      io.to('admin_room').emit('student_profile_changed', payload);
      if (adminDepartment) io.to(adminDepartmentRoom(adminDepartment)).emit('student_profile_changed', payload);
    });

    res.json({
      success: true,
      message: `Imported ${summary.created + summary.updated} students`,
      summary
    });
  } catch (err) {
    console.error('importStudents error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  } finally {
    if (filePath) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
  }
};

const importTeachers = async (req, res) => {
  const filePath = req.file?.path;
  try {
    if (!filePath) return res.status(400).json({ success: false, message: 'CSV file is required' });
    const adminDepartment = getAdminDepartment(req.user);
    const defaultPassword = String(req.body.defaultPassword || process.env.DEFAULT_TEACHER_PASSWORD || 'Teacher@123');
    if (defaultPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'Default password must be at least 8 characters' });
    }

    const rows = parseTeacherCsv(filePath);
    const results = [];
    const errors = [];
    const seenEmails = new Set();
    const importRows = rows.filter((row) => {
      const email = String(row.email || '').trim().toLowerCase();
      if (!email) return true;
      if (seenEmails.has(email)) {
        errors.push({ email, message: 'Duplicate teacher email inside this file' });
        return false;
      }
      seenEmails.add(email);
      return true;
    });

    const outcomes = await mapWithConcurrency(importRows, 6, async (row) => {
      try {
        const teacher = await upsertTeacher({
          payload: row,
          req,
          fallbackDepartment: adminDepartment,
          defaultPassword
        });
        return { ok: true, teacher: { email: teacher.email, name: teacher.name } };
      } catch (err) {
        return { ok: false, error: { email: row.email, message: err.message } };
      }
    });
    outcomes.forEach((outcome) => {
      if (outcome?.ok) results.push(outcome.teacher);
      else if (outcome?.error) errors.push(outcome.error);
    });

    await safeImportSideEffect('Teacher import audit log', () => logAudit(req, {
      action: 'teacher.imported',
      entityType: 'teacher',
      entityName: 'Teacher CSV import',
      targetDepartment: adminDepartment || 'Multiple Departments',
      details: { imported: results.length, failed: errors.length }
    }));
    await safeImportSideEffect('Teacher import socket emit', async () => {
      emitAdminChange(req, 'teacher_changed', { action: 'imported', imported: results.length, failed: errors.length }, adminDepartment);
    });

    res.json({ success: true, imported: results.length, failed: errors.length, teachers: results, errors });
  } catch (err) {
    console.error('importTeachers error:', err);
    res.status(500).json({ success: false, message: err.message || 'Could not import teachers' });
  } finally {
    if (filePath) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
  }
};

const getTeacherAllocation = async (req, res) => {
  try {
    const adminDepartment = getAdminDepartment(req.user);
    const { branch } = req.query;
    const department = adminDepartment || req.query.department;
    const semester = Number(req.query.semester || getAdminSemesterScope(req.user));
    if (!department || !semester) {
      return res.status(400).json({ success: false, message: 'Department and semester are required' });
    }

    const [teachers, subjects] = await Promise.all([
      User.find({ role: 'teacher', departments: department, pendingDeletion: { $ne: true } })
        .select(teacherSafeFields)
        .sort({ name: 1 })
        .lean(),
      Subject.find({ department, semester, ...branchFilter(branch), isActive: true, pendingDeletion: { $ne: true } })
        .populate('assignedTeachers', 'name email departments')
        .sort({ name: 1 })
        .lean()
    ]);

    res.json({ success: true, department, semester, branch: normalizeBranchValue(branch), teachers, subjects });
  } catch (err) {
    console.error('getTeacherAllocation error:', err);
    res.status(500).json({ success: false, message: err.message || 'Could not load teacher allocation' });
  }
};

const saveTeacherAllocation = async (req, res) => {
  try {
    const adminDepartment = getAdminDepartment(req.user);
    const { teacherId, subjectIds = [], department, branch, semester, allocations } = req.body;
    const scopedDepartment = adminDepartment || department;
    const scopedSemester = Number(semester || getAdminSemesterScope(req.user));
    if (!scopedDepartment || !scopedSemester) {
      return res.status(400).json({ success: false, message: 'Department and semester are required' });
    }

    const [teachers, allowedSubjects] = await Promise.all([
      User.find({
        role: 'teacher',
        departments: scopedDepartment,
        pendingDeletion: { $ne: true }
      }).select('_id name'),
      Subject.find({
        department: scopedDepartment,
        ...branchFilter(branch),
        semester: scopedSemester,
        isActive: true,
        pendingDeletion: { $ne: true }
      }).select('_id')
    ]);

    const teacherMap = new Map(teachers.map(teacher => [teacher._id.toString(), teacher]));
    const allowedIds = new Set(allowedSubjects.map(subject => subject._id.toString()));
    const allocationList = Array.isArray(allocations) && allocations.length
      ? allocations
      : [{ teacherId, subjectIds }];

    const normalized = allocationList
      .map(item => ({
        teacherId: String(item.teacherId || ''),
        subjectIds: [...new Set((item.subjectIds || []).map(String))].filter(id => allowedIds.has(id))
      }))
      .filter(item => item.teacherId && teacherMap.has(item.teacherId));

    if (!normalized.length) {
      return res.status(400).json({ success: false, message: 'Select at least one valid teacher allocation' });
    }

    await Subject.updateMany(
      { _id: { $in: [...allowedIds] } },
      { $pull: { assignedTeachers: { $in: normalized.map(item => item.teacherId) } } }
    );

    await Promise.all(normalized.flatMap(item => (
      item.subjectIds.length
        ? [Subject.updateMany({ _id: { $in: item.subjectIds } }, { $addToSet: { assignedTeachers: item.teacherId } })]
        : []
    )));

    const assignedSubjectDocs = await Subject.find({
      _id: { $in: normalized.flatMap(item => item.subjectIds) }
    }).select('name code semester department branch').lean();
    const subjectById = new Map(assignedSubjectDocs.map(subject => [subject._id.toString(), subject]));

    const assignmentNotifications = await Promise.all(normalized
      .filter(item => item.subjectIds.length)
      .map(async (item) => {
        const teacher = teacherMap.get(item.teacherId);
        const subjectsForTeacher = item.subjectIds
          .map(id => subjectById.get(id))
          .filter(Boolean);
        if (!teacher || subjectsForTeacher.length === 0) return null;

        const subjectList = subjectsForTeacher
          .map(subject => `${subject.name}${subject.code ? ` (${subject.code})` : ''}`)
          .join(', ');

        return Notification.create({
          recipient: teacher._id,
          type: 'teacher_assignment',
          title: `Semester ${scopedSemester} subject assignment`,
          message: `${req.user.name || 'Admin'} assigned you ${subjectList} for Semester ${scopedSemester}.`,
          data: {
            semester: scopedSemester,
            department: scopedDepartment,
            assignedBy: {
              id: req.user._id,
              name: req.user.name,
              email: req.user.email,
              role: req.user.department === 'Administration' || String(req.user.email || '').toLowerCase() === 'admin@school.edu' ? 'Super Admin' : 'Department Admin'
            },
            subjects: subjectsForTeacher.map(subject => ({
              id: subject._id,
              name: subject.name,
              code: subject.code,
              branch: subject.branch
            }))
          },
          priority: 'medium'
        });
      }));
    const io = req.app.get('io');
    if (io) {
      assignmentNotifications.filter(Boolean).forEach(notification => {
        io.to(`user_${notification.recipient}`).emit('notification_created', {
          notificationId: notification._id,
          type: notification.type,
          title: notification.title,
          message: notification.message
        });
      });
    }

    await logAudit(req, {
      action: 'teacher.subjects_assigned',
      entityType: 'teacher_allocation',
      entityName: 'Teacher subject allocation',
      targetDepartment: scopedDepartment,
      details: {
        semester: scopedSemester,
        teacherCount: normalized.length,
        subjectAssignments: normalized.reduce((sum, item) => sum + item.subjectIds.length, 0)
      }
    });
    emitAdminChange(req, 'teacher_changed', { action: 'subjects_assigned', department: scopedDepartment, semester: scopedSemester, teacherIds: normalized.map(item => item.teacherId) }, scopedDepartment);
    emitAdminChange(req, 'subject_updated', { action: 'teacher_allocation_changed', department: scopedDepartment, semester: scopedSemester }, scopedDepartment);

    res.json({
      success: true,
      allocations: normalized,
      assignedSubjectIds: normalized.find(item => item.teacherId === String(teacherId))?.subjectIds || []
    });
  } catch (err) {
    console.error('saveTeacherAllocation error:', err);
    res.status(500).json({ success: false, message: err.message || 'Could not save teacher allocation' });
  }
};

const resolveStudentProfileUpdate = async (req, res, status) => {
  try {
    const student = await User.findById(req.params.id);
    if (!ensureStudentAccess(student, req, res)) return;
    if (student.pendingProfileUpdate?.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'No pending profile update request found.' });
    }

    const requestedFields = student.pendingProfileUpdate.requestedFields || {};
    if (status === 'approved') {
      if (requestedFields.email) {
        const existingEmail = await User.findOne({
          _id: { $ne: student._id },
          email: requestedFields.email,
          pendingDeletion: { $ne: true }
        }).select('_id');
        if (existingEmail) {
          return res.status(409).json({ success: false, message: 'Requested email is already used by another account.' });
        }
      }
      ['name', 'email', 'phone', 'fatherName'].forEach(field => {
        if (requestedFields[field] !== undefined) student[field] = requestedFields[field];
      });
    }

    student.pendingProfileUpdate.status = status;
    student.pendingProfileUpdate.reviewedAt = new Date();
    student.pendingProfileUpdate.reviewedBy = req.user._id;
    student.pendingProfileUpdate.reviewNote = req.body.note || '';
    await student.save({ validateBeforeSave: false });

    await Notification.create({
      recipient: student._id,
      recipientRole: 'student',
      type: 'student_profile_update_resolved',
      title: status === 'approved' ? 'Profile Update Approved' : 'Profile Update Rejected',
      message: status === 'approved'
        ? 'Your requested profile changes have been approved and applied.'
        : `Your requested profile changes were rejected${req.body.note ? `: ${req.body.note}` : '.'}`,
      data: {
        status,
        reviewedBy: req.user._id,
        fields: Object.keys(requestedFields)
      },
      priority: status === 'approved' ? 'medium' : 'high'
    });

    const io = req.app.get('io');
    if (io) {
      io.to(`student_${student._id}`).emit('profile_update_resolved', {
        status,
        user: student.toSafeObject()
      });
      io.to(`user_${student._id}`).emit('notification_created', {
        type: 'student_profile_update_resolved',
        title: status === 'approved' ? 'Profile Update Approved' : 'Profile Update Rejected'
      });
    }

    await logAudit(req, {
      action: `student.profile_update_${status}`,
      entityType: 'student',
      entityId: student._id,
      entityName: `${student.name} (${student.studentId})`,
      targetDepartment: student.department,
      details: {
        fields: Object.keys(requestedFields),
        note: req.body.note || ''
      }
    });

    res.json({
      success: true,
      message: `Student profile update ${status}.`,
      student: student.toSafeObject()
    });
  } catch (err) {
    console.error('resolveStudentProfileUpdate error:', err);
    res.status(500).json({ success: false, message: err.message || 'Could not resolve profile update' });
  }
};

const approveStudentProfileUpdate = (req, res) => resolveStudentProfileUpdate(req, res, 'approved');
const rejectStudentProfileUpdate = (req, res) => resolveStudentProfileUpdate(req, res, 'rejected');

module.exports = {
  getPendingStudents, getAllStudents, getStudentById, approveStudent, rejectStudent,
  activateStudent, deactivateStudent, restrictStudent, unrestrictStudent, deleteStudent, bulkDeleteStudents,
  enrollStudentSubjects, getAnalytics, getSuperOverview,
  getAcademicStructure, getAttendanceCriteriaSettings, updateAttendanceCriteriaSettings, addAcademicCourse, addAcademicBranch, deleteAcademicCourse, deleteAcademicBranch,
  getTeachers, createTeacher, importTeachers, importStudents, deleteTeacher, getTeacherDashboard, getTeacherStudents,
  restrictStudentForSubject, unrestrictStudentForSubject, notifyLowAttendanceStudents,
  getTeacherPeers, getTeacherPeerProfile, getTeacherAllocation, saveTeacherAllocation,
  approveStudentProfileUpdate, rejectStudentProfileUpdate
};
