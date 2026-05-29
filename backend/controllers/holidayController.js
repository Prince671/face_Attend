const Holiday = require('../models/Holiday');
const Lecture = require('../models/Lecture');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Subject = require('../models/Subject');
const { assertDepartmentAccess, getAdminDepartment, adminDepartmentRoom } = require('../utils/adminScope');

const dayRange = (value) => {
  const start = new Date(value);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const emitHolidayChanged = (req, holiday, action) => {
  const io = req.app.get('io');
  if (!io || !holiday) return;
  const scopes = getHolidayScopes(holiday);
  const departments = new Set(scopes.map(scope => scope.department).filter(Boolean));
  if (holiday.department) departments.add(holiday.department);
  const payload = { holidayId: holiday._id, action, departments: [...departments], type: holiday.type };
  io.to('admin_room').emit('holiday_changed', payload);
  departments.forEach(department => io.to(adminDepartmentRoom(department)).emit('holiday_changed', payload));
  io.emit('lectures_changed', payload);
};

const buildScopeQuery = (user, body = {}) => {
  const adminDepartment = getAdminDepartment(user);
  const query = {};
  if (adminDepartment) query.department = adminDepartment;
  if (body.course) query.course = String(body.course).trim();
  if (body.branch) query.branch = String(body.branch).trim();
  if (body.semester) query.semester = Number(body.semester);
  return query;
};

const normalizeBranch = (value) => String(value || '').trim();
const isComputerScienceDepartment = (department) => /computer|cse|cs/i.test(String(department || ''));

const COURSE_DEPARTMENT = {
  'B. Tech:Computer Science': 'Computer Science',
  'B. Tech:AI/ML Engineering': 'Computer Science',
  'B. Tech:Mechanical Engineering': 'Mechanical',
  'B. Tech:Electrical Engineering': 'Electrical',
  'Diploma:Computer Science': 'Computer Science',
  'Diploma:Mechanical Engineering': 'Mechanical',
  'Diploma:Electrical Engineering': 'Electrical',
  'BBA:BBA': 'BBA',
  'MBA:MBA': 'MBA',
};

const inferCourse = (subject = {}) => {
  const branch = normalizeBranch(subject.branch);
  const department = normalizeBranch(subject.department);
  if (/^Diploma CS$/i.test(branch) || /^Diploma/i.test(branch)) return 'Diploma';
  if (/^BBA$/i.test(department)) return 'BBA';
  if (/^MBA$/i.test(department)) return 'MBA';
  return 'B. Tech';
};

const inferAcademicBranch = (subject = {}) => {
  const branch = normalizeBranch(subject.branch);
  const department = normalizeBranch(subject.department);
  if (/^Diploma CS$/i.test(branch)) return 'Computer Science';
  if (branch && !/^(general|unassigned branch)$/i.test(branch)) return branch;
  if (isComputerScienceDepartment(department)) return 'Computer Science';
  if (/mechanical/i.test(department)) return 'Mechanical Engineering';
  if (/electrical/i.test(department)) return 'Electrical Engineering';
  return department || '';
};

const getDateRange = (startValue, endValue = null) => {
  const start = dayRange(startValue).start;
  const end = endValue ? dayRange(endValue).end : dayRange(startValue).end;
  return { start, end };
};

const rangesOverlap = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd;

const timeOverlaps = (holiday, lecture) => {
  if (!holiday.startTime || !holiday.endTime) return true;
  const lectureStart = String(lecture.startTime || '');
  const lectureEnd = String(lecture.endTime || '');
  if (!lectureStart || !lectureEnd) return true;
  return lectureStart < holiday.endTime && holiday.startTime < lectureEnd;
};

const normalizeScope = (user, rawScope = {}) => {
  const course = String(rawScope.course || '').trim();
  const branch = String(rawScope.branch || '').trim();
  const semester = Number(rawScope.semester);
  const requestedDepartment = String(rawScope.department || '').trim();
  const department = requestedDepartment || COURSE_DEPARTMENT[`${course}:${branch}`] || '';
  const adminDepartment = getAdminDepartment(user);
  if (!course || !branch || !semester) {
    throw new Error('Every audience must include course, branch, and semester.');
  }
  if (adminDepartment && department !== adminDepartment) {
    throw new Error('One or more selected audiences are outside your department access.');
  }
  return { course, branch, semester, department: adminDepartment || department };
};

const normalizeScopes = (user, body = {}) => {
  const sourceScopes = Array.isArray(body.scopes) && body.scopes.length
    ? body.scopes
    : [body];
  const unique = new Map();
  sourceScopes.forEach(scope => {
    const normalized = normalizeScope(user, scope);
    unique.set(`${normalized.course}:${normalized.department}:${normalized.branch}:${normalized.semester}`, normalized);
  });
  return [...unique.values()];
};

const subjectBranchForScope = (scope) => {
  if (scope.course === 'Diploma' && scope.branch === 'Computer Science') return 'Diploma CS';
  if (scope.course === 'Diploma' && scope.branch === 'Mechanical Engineering') return 'Diploma Mechanical';
  if (scope.course === 'Diploma' && scope.branch === 'Electrical Engineering') return 'Diploma Electrical';
  if (scope.course === 'B. Tech' && scope.branch === 'Computer Science') return 'Computer Science';
  if (scope.course === 'B. Tech' && scope.branch === 'AI/ML Engineering') return 'AI/ML Engineering';
  if (scope.course === 'BBA') return '';
  if (scope.course === 'MBA') return '';
  return scope.branch;
};

const studentBranchAliasesForScope = (scope) => {
  if (scope.course !== 'Diploma') return [scope.branch];
  if (scope.branch === 'Computer Science') return ['Computer Science', 'Diploma CS'];
  if (scope.branch === 'Mechanical Engineering') return ['Mechanical Engineering', 'Diploma Mechanical'];
  if (scope.branch === 'Electrical Engineering') return ['Electrical Engineering', 'Diploma Electrical'];
  return [scope.branch];
};

const scopeMatchesSubject = (scope, subject) => {
  if (scope.department && subject.department !== scope.department) return false;
  if (scope.semester && Number(scope.semester) !== Number(subject.semester)) return false;
  if (scope.course && scope.course !== inferCourse(subject)) return false;
  if (scope.branch && scope.branch !== inferAcademicBranch(subject)) return false;
  return true;
};

const getHolidayScopes = (holiday) => {
  if (Array.isArray(holiday.scopes) && holiday.scopes.length) return holiday.scopes;
  return [{
    course: holiday.course || '',
    department: holiday.department || '',
    branch: holiday.branch || '',
    semester: holiday.semester || null
  }];
};

const buildStudentNotificationQuery = (scope) => {
  const query = {
    role: 'student',
    status: 'active',
    pendingDeletion: { $ne: true }
  };
  if (scope.course) query.course = scope.course;
  if (scope.department) query.department = scope.department;
  if (scope.branch) query.branch = { $in: studentBranchAliasesForScope(scope) };
  if (scope.semester) query.semester = Number(scope.semester);
  return query;
};

const buildTeacherNotificationQuery = async (scope) => {
  const subjectQuery = {
    department: scope.department,
    semester: Number(scope.semester),
    isActive: true,
    pendingDeletion: { $ne: true },
    assignedTeachers: { $exists: true, $ne: [] }
  };
  const branch = subjectBranchForScope(scope);
  if (branch) subjectQuery.branch = branch;
  const subjects = await Subject.find(subjectQuery).select('assignedTeachers course department branch semester').lean();
  const teacherIds = new Set();
  subjects
    .filter(subject => scopeMatchesSubject(scope, subject))
    .forEach(subject => (subject.assignedTeachers || []).forEach(id => teacherIds.add(id.toString())));
  return {
    _id: { $in: [...teacherIds] },
    role: 'teacher',
    pendingDeletion: { $ne: true }
  };
};

const emitNotification = (io, recipientRole, notification) => {
  if (!io) return;
  io.to(`${recipientRole}_${notification.recipient}`).emit('notification_created', notification);
  io.to(`user_${notification.recipient}`).emit('notification_created', notification);
};

const notifyScopedUsers = async (req, holiday) => {
  const scopes = getHolidayScopes(holiday);
  const studentIds = new Set();
  const teacherIds = new Set();
  for (const scope of scopes) {
    const [students, teacherQuery] = await Promise.all([
      User.find(buildStudentNotificationQuery(scope)).select('_id').lean(),
      buildTeacherNotificationQuery(scope)
    ]);
    students.forEach(student => studentIds.add(student._id.toString()));
    const teachers = teacherQuery._id.$in.length
      ? await User.find(teacherQuery).select('_id').lean()
      : [];
    teachers.forEach(teacher => teacherIds.add(teacher._id.toString()));
  }
  if (!studentIds.size && !teacherIds.size) return { students: 0, teachers: 0, total: 0 };
  const dateText = holiday.endDate && new Date(holiday.endDate).toDateString() !== new Date(holiday.date).toDateString()
    ? `${new Date(holiday.date).toLocaleDateString('en-IN')} to ${new Date(holiday.endDate).toLocaleDateString('en-IN')}`
    : new Date(holiday.date).toLocaleDateString('en-IN');
  const timeText = holiday.startTime && holiday.endTime ? ` (${holiday.startTime} - ${holiday.endTime})` : '';
  const scopeText = scopes
    .map(scope => `${scope.course} / ${scope.branch} / Sem ${scope.semester}`)
    .join(', ');
  const basePayload = {
    type: 'academic_calendar',
    title: `${holiday.type === 'exam' ? 'Exam' : holiday.type === 'event' ? 'Event' : 'Holiday'}: ${holiday.title}`,
    message: `${holiday.title} is scheduled for ${dateText}${timeText} for ${scopeText}. Attendance sessions for affected lectures will be blocked automatically.`,
    data: {
      holidayId: holiday._id,
      type: holiday.type,
      course: holiday.course,
      branch: holiday.branch,
      semester: holiday.semester,
      scopes,
      date: holiday.date,
      endDate: holiday.endDate,
      startTime: holiday.startTime,
      endTime: holiday.endTime
    },
    priority: holiday.type === 'exam' ? 'high' : 'medium'
  };
  const notifications = await Promise.all([
    ...[...studentIds].map(id => Notification.create({ ...basePayload, recipient: id, recipientRole: 'student' })),
    ...[...teacherIds].map(id => Notification.create({ ...basePayload, recipient: id, recipientRole: 'teacher' }))
  ]);
  const io = req.app.get('io');
  notifications.forEach(notification => emitNotification(io, notification.recipientRole, notification));
  return { students: studentIds.size, teachers: teacherIds.size, total: notifications.length };
};

const getHolidays = async (req, res) => {
  try {
    const query = {};
    const adminDepartment = getAdminDepartment(req.user);
    if (adminDepartment) {
      query.$or = [
        { appliesToAll: true },
        { department: adminDepartment },
        { 'scopes.department': adminDepartment },
        { department: '' }
      ];
    }
    const holidays = await Holiday.find(query).sort({ date: 1, createdAt: -1 }).lean();
    res.json({ success: true, holidays });
  } catch (err) {
    console.error('getHolidays error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const createHoliday = async (req, res) => {
  try {
    const { title, date, endDate, type = 'holiday', notes = '', appliesToAll = true, startTime = '', endTime = '' } = req.body || {};
    if (!title || !date) {
      return res.status(400).json({ success: false, message: 'Title and date are required.' });
    }
    const scopes = normalizeScopes(req.user, req.body);
    if (['event', 'exam'].includes(type) && !endDate) {
      return res.status(400).json({ success: false, message: 'End date is required for events and exams.' });
    }
    if (type === 'event' && (!startTime || !endTime)) {
      return res.status(400).json({ success: false, message: 'Start and end time are required for events.' });
    }
    if (type === 'event' && startTime >= endTime) {
      return res.status(400).json({ success: false, message: 'Event end time must be after start time.' });
    }
    const { start, end } = getDateRange(date, ['event', 'exam'].includes(type) ? endDate : null);
    const primaryScope = scopes[0] || {};
    const holiday = await Holiday.create({
      title,
      date: start,
      endDate: end,
      startTime: ['event', 'other'].includes(type) ? startTime : '',
      endTime: ['event', 'other'].includes(type) ? endTime : '',
      type,
      notes,
      appliesToAll: getAdminDepartment(req.user) ? false : Boolean(appliesToAll),
      ...primaryScope,
      scopes,
      createdBy: req.user._id
    });
    const cancellation = await cancelLecturesForHoliday(req, holiday);
    const notified = await notifyScopedUsers(req, holiday);
    emitHolidayChanged(req, holiday, 'created');
    res.status(201).json({ success: true, holiday, notified, cancellation });
  } catch (err) {
    console.error('createHoliday error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const deleteHoliday = async (req, res) => {
  try {
    const holiday = await Holiday.findById(req.params.id);
    if (!holiday) return res.status(404).json({ success: false, message: 'Holiday not found.' });
    const scopes = getHolidayScopes(holiday);
    const hasAllowedScope = scopes.some(scope => assertDepartmentAccess({ department: scope.department || holiday.department }, req.user));
    if (holiday.department && !assertDepartmentAccess({ department: holiday.department }, req.user) && !hasAllowedScope) {
      return res.status(403).json({ success: false, message: 'Access denied for this holiday.' });
    }
    await Lecture.updateMany(
      { cancelledByHoliday: holiday._id, status: 'cancelled', pendingDeletion: { $ne: true } },
      { $set: { status: 'scheduled' }, $unset: { cancelledByHoliday: '', cancellationReason: '', attendanceClosedAt: '' } }
    );
    await holiday.deleteOne();
    emitHolidayChanged(req, holiday, 'deleted');
    res.json({ success: true, message: 'Holiday removed.' });
  } catch (err) {
    console.error('deleteHoliday error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const isLectureBlockedByHoliday = async (lecture) => {
  const subject = lecture.subject;
  if (!subject?.department) return null;
  const { start, end } = dayRange(lecture.date);
  const candidates = await Holiday.find({
    date: { $lte: end },
    $and: [{
      $or: [
        { endDate: { $gte: start } },
        { endDate: { $exists: false } },
        { endDate: null }
      ]
    }],
    $or: [
      { appliesToAll: true },
      {
        department: subject.department,
        semester: { $in: [null, subject.semester] }
      },
      {
        'scopes.department': subject.department,
        'scopes.semester': subject.semester
      }
    ]
  }).lean();
  return candidates.find(holiday => {
    const scopes = getHolidayScopes(holiday);
    if (!holiday.appliesToAll && !scopes.some(scope => scopeMatchesSubject(scope, subject))) return false;
    if (!rangesOverlap(start, end, new Date(holiday.date), new Date(holiday.endDate || holiday.date))) return false;
    return timeOverlaps(holiday, lecture);
  }) || null;
};

const lectureMatchesHoliday = (holiday, lecture) => {
  const subject = lecture.subject;
  if (!subject?.department) return false;
  const { start, end } = dayRange(lecture.date);
  const scopes = getHolidayScopes(holiday);
  if (!holiday.appliesToAll && !scopes.some(scope => scopeMatchesSubject(scope, subject))) return false;
  if (!rangesOverlap(start, end, new Date(holiday.date), new Date(holiday.endDate || holiday.date))) return false;
  return timeOverlaps(holiday, lecture);
};

const cancelLecturesForHoliday = async (req, holiday) => {
  if (!holiday?._id) return { cancelled: 0 };
  const { start, end } = getDateRange(holiday.date, holiday.endDate || holiday.date);
  const lectures = await Lecture.find({
    date: { $gte: start, $lte: end },
    status: { $in: ['scheduled', 'ongoing'] },
    pendingDeletion: { $ne: true }
  }).populate('subject', 'name code department branch semester assignedTeachers course').lean();
  const affectedIds = lectures
    .filter(lecture => lectureMatchesHoliday(holiday, lecture))
    .map(lecture => lecture._id);
  if (!affectedIds.length) return { cancelled: 0 };

  const result = await Lecture.updateMany(
    { _id: { $in: affectedIds } },
    {
      $set: {
        status: 'cancelled',
        attendanceOpen: false,
        attendanceClosedAt: new Date(),
        cancelledByHoliday: holiday._id,
        cancellationReason: `${holiday.type}: ${holiday.title}`
      },
      $unset: {
        attendanceCode: '',
        attendanceOpenedAt: '',
        codeExpiresAt: ''
      }
    }
  );

  const io = req.app.get('io');
  if (io) {
    const payload = {
      holidayId: holiday._id,
      title: holiday.title,
      type: holiday.type,
      lectureIds: affectedIds,
      cancelled: result.modifiedCount || 0
    };
    io.to('admin_room').emit('lectures_changed', payload);
    getHolidayScopes(holiday)
      .map(scope => scope.department)
      .filter(Boolean)
      .forEach(department => io.to(adminDepartmentRoom(department)).emit('lectures_changed', payload));
  }

  return { cancelled: result.modifiedCount || 0, lectureIds: affectedIds };
};

module.exports = { getHolidays, createHoliday, deleteHoliday, isLectureBlockedByHoliday, cancelLecturesForHoliday };
