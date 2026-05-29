const Lecture = require('../models/Lecture');
const Subject = require('../models/Subject');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { closeExpiredAttendance, getAttendanceExpiry } = require('../utils/attendanceAutoClose');
const { assertDepartmentAccess, getAdminDepartment, getAdminSemesterScope, getTeacherSemesterScope, adminDepartmentRoom } = require('../utils/adminScope');
const { logAudit } = require('../utils/auditLogger');
const { schedulePendingDeletion } = require('../utils/pendingDeletion');
const { studentMatchesSubject } = require('../utils/subjectEnrollment');
const { isLectureBlockedByHoliday } = require('./holidayController');
const { canReceiveSubjectUpdates } = require('../utils/restrictionPolicy');

// Generate 6-digit OTP
const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();
const toBoolean = (value) => value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
const visibleLectureFilter = {
  source: { $ne: 'imported' },
  title: { $not: /^Imported Attendance/i }
};
const parseLocalDate = (value) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(value);
};

const dayRangeFor = (value) => {
  const date = value ? new Date(value) : new Date();
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const emitLectureChange = async (req, lecture, event = 'lecture_updated') => {
  const io = req.app.get('io');
  if (!io || !lecture) return;
  const subject = lecture.subject?._id ? lecture.subject : await Subject.findById(lecture.subject).select('name code department semester assignedTeachers');
  if (!subject) return;
  const payload = {
    lectureId: lecture._id,
    subjectId: subject._id,
    subjectName: subject.name,
    department: subject.department,
    semester: subject.semester,
    status: lecture.status,
    attendanceOpen: lecture.attendanceOpen
  };
  io.to('admin_room').emit(event, payload);
  io.to(adminDepartmentRoom(subject.department)).emit(event, payload);
  io.to('admin_room').emit('lectures_changed', payload);
  io.to(adminDepartmentRoom(subject.department)).emit('lectures_changed', payload);
  (subject.assignedTeachers || []).forEach(teacherId => {
    io.to(`user_${teacherId}`).emit(event, payload);
    io.to(`user_${teacherId}`).emit('lectures_changed', payload);
  });
};

const repairResumedSubjectLectures = async (subjectSelector = {}) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const activeSubjects = await Subject.find({
    ...subjectSelector,
    classesStopped: { $ne: true },
    syllabusCompleted: { $ne: true },
    isActive: true,
    pendingDeletion: { $ne: true }
  }).select('_id').lean();
  const activeSubjectIds = activeSubjects.map(subject => subject._id);
  if (!activeSubjectIds.length) return 0;
  const result = await Lecture.updateMany(
    {
      subject: { $in: activeSubjectIds },
      status: 'cancelled',
      cancelledByHoliday: { $exists: false },
      date: { $gte: today },
      pendingDeletion: { $ne: true }
    },
    { $set: { status: 'scheduled' }, $unset: { cancellationReason: '' } }
  );
  return result.modifiedCount || 0;
};

const getScopedSubjectIds = async (user, options = {}) => {
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
  const semester = options.allSemesters ? null : getAdminSemesterScope(user);
  if (semester) query.semester = semester;
  const subjects = await Subject.find(query).select('_id');
  return subjects.map(subject => subject._id);
};

const ensureLectureAccess = async (lecture, req, res) => {
  if (!lecture) {
    res.status(404).json({ success: false, message: 'Lecture not found' });
    return false;
  }
  if (lecture.pendingDeletion) {
    res.status(404).json({ success: false, message: 'Lecture is pending deletion' });
    return false;
  }
  const subject = lecture.subject?.department
    ? lecture.subject
    : await Subject.findById(lecture.subject).select('department semester assignedTeachers');
  if (req.user.role === 'teacher') {
    const assigned = (subject?.assignedTeachers || []).some(id => id.toString() === req.user._id.toString());
    if (!assigned) {
      res.status(403).json({ success: false, message: 'Access denied: lecture is not assigned to this teacher' });
      return false;
    }
    const teacherSemester = getTeacherSemesterScope(req.user);
    if (teacherSemester && Number(subject.semester) !== teacherSemester) {
      res.status(403).json({ success: false, message: 'Access denied: lecture belongs to another semester scope' });
      return false;
    }
    return true;
  }
  if (!assertDepartmentAccess(subject, req.user)) {
    res.status(403).json({ success: false, message: 'Access denied: lecture belongs to another department' });
    return false;
  }
  return true;
};

const ensureTeacherPeerSourceAccess = async (sourceLecture, targetLecture, req, res) => {
  if (req.user.role !== 'teacher') return ensureLectureAccess(sourceLecture, req, res);
  if (!sourceLecture) {
    res.status(404).json({ success: false, message: 'Source lecture not found' });
    return false;
  }
  if (sourceLecture.pendingDeletion) {
    res.status(404).json({ success: false, message: 'Source lecture is pending deletion' });
    return false;
  }
  const sourceSubject = sourceLecture.subject?.department
    ? sourceLecture.subject
    : await Subject.findById(sourceLecture.subject).select('department branch semester assignedTeachers');
  const targetSubject = targetLecture.subject?.department
    ? targetLecture.subject
    : await Subject.findById(targetLecture.subject).select('department branch semester assignedTeachers');
  const teacherSemester = getTeacherSemesterScope(req.user);
  const teacherDepartments = Array.isArray(req.user.departments) && req.user.departments.length
    ? req.user.departments
    : [req.user.department].filter(Boolean);
  const sameSemester = Number(sourceSubject?.semester) === Number(targetSubject?.semester);
  const sameDepartment = sourceSubject?.department === targetSubject?.department;
  const teacherDepartmentAllowed = !teacherDepartments.length || teacherDepartments.includes(sourceSubject?.department);
  const scopedSemesterOk = !teacherSemester || Number(sourceSubject?.semester) === Number(teacherSemester);
  if (!sameSemester || !sameDepartment || !teacherDepartmentAllowed || !scopedSemesterOk) {
    res.status(403).json({ success: false, message: 'Source lecture must be from the same department and semester.' });
    return false;
  }
  return true;
};

// @desc    Create lecture
const createLecture = async (req, res) => {
  try {
    const { subjectId, title, description, date, startTime, endTime, duration, isLab, labNumber } = req.body;

    if (!subjectId || !title || !date || !startTime || !endTime || !duration) {
      return res.status(400).json({ success: false, message: 'Missing required fields: subjectId, title, date, startTime, endTime, duration' });
    }

    const subject = await Subject.findById(subjectId);
    if (!subject) return res.status(404).json({ success: false, message: 'Subject not found' });
    if (subject.classesStopped) {
      return res.status(400).json({ success: false, message: 'Classes are stopped for this subject because the syllabus is completed.' });
    }
    if (req.user.role === 'teacher') {
      const assigned = (subject.assignedTeachers || []).some(id => id.toString() === req.user._id.toString());
      if (!assigned) {
        return res.status(403).json({ success: false, message: 'Access denied: subject is not assigned to this teacher' });
      }
      const teacherSemester = getTeacherSemesterScope(req.user);
      if (teacherSemester && Number(subject.semester) !== teacherSemester) {
        return res.status(403).json({ success: false, message: 'Access denied: subject belongs to another semester scope' });
      }
    }
    if (!assertDepartmentAccess(subject, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied: subject belongs to another department' });
    }
    const adminSemester = getAdminSemesterScope(req.user);
    if (adminSemester && Number(subject.semester) !== adminSemester) {
      return res.status(403).json({ success: false, message: 'Access denied: subject belongs to another semester scope' });
    }
    const lectureDate = parseLocalDate(date);
    if (lectureDate.getDay() === 0) {
      return res.status(400).json({ success: false, message: 'Lectures can be scheduled from Monday to Saturday only.' });
    }

    const blockingHoliday = await isLectureBlockedByHoliday({
      subject,
      date: lectureDate,
      startTime,
      endTime
    });

    const lecturePayload = {
      subject: subjectId,
      title,
      description,
      date: lectureDate,
      startTime,
      endTime,
      duration: parseInt(duration),
      createdBy: req.user._id,
      status: blockingHoliday ? 'cancelled' : 'scheduled',
      isLab: toBoolean(isLab),
      labNumber: toBoolean(isLab) ? (labNumber || 'LAB1') : ''
    };
    if (blockingHoliday) {
      lecturePayload.cancelledByHoliday = blockingHoliday._id;
      lecturePayload.cancellationReason = `${blockingHoliday.type}: ${blockingHoliday.title}`;
    }
    const lecture = await Lecture.create(lecturePayload);

    await lecture.populate('subject', 'name code department branch semester');

    // Notify enrolled students
    const enrolledStudents = await User.find({
      enrolledSubjects: subjectId,
      status: 'active',
      isRestricted: { $ne: true },
      role: 'student'
    }).select('_id role status isRestricted subjectRestrictions');
    const eligibleStudents = enrolledStudents.filter(student => canReceiveSubjectUpdates(student, subjectId));

    if (eligibleStudents.length > 0) {
      const notifPromises = eligibleStudents.map(s =>
        Notification.create({
          recipient: s._id,
          type: 'lecture_created',
          title: `New Lecture: ${subject.name}`,
          message: blockingHoliday
            ? `The lecture "${title}" on ${new Date(date).toDateString()} is cancelled because of ${blockingHoliday.title}.`
            : `A new lecture "${title}" has been scheduled for ${new Date(date).toDateString()} at ${startTime}.`,
          data: { lectureId: lecture._id }
        })
      );
      await Promise.all(notifPromises);

      // FIX: Emit socket event to each enrolled student's room
      const io = req.app.get('io');
      if (io) {
        eligibleStudents.forEach(s => {
          io.to(`student_${s._id}`).emit('new_lecture', { lecture });
        });
      }
    }
    await emitLectureChange(req, lecture, 'new_lecture');
    await logAudit(req, {
      action: 'lecture.created',
      entityType: 'lecture',
      entityId: lecture._id,
      entityName: lecture.title,
      targetDepartment: subject.department,
      details: { subjectId, subjectCode: subject.code, date, startTime, endTime, duration }
    });

    res.status(201).json({
      success: true,
      lecture,
      holiday: blockingHoliday ? { _id: blockingHoliday._id, title: blockingHoliday.title, type: blockingHoliday.type } : null,
      message: blockingHoliday ? `Lecture created as cancelled because ${blockingHoliday.title} is configured for this time.` : undefined
    });
  } catch (err) {
    console.error('createLecture error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// @desc    Get all lectures (admin)
const getAllLectures = async (req, res) => {
  try {
    await closeExpiredAttendance(req.app.get('io'));
    const { subjectId, status, date, limit, allSemesters, excludeImported, sort } = req.query;
    const query = { pendingDeletion: { $ne: true } };
    if (subjectId) query.subject = subjectId;
    if (status) query.status = status;
    if (date) {
      const d = new Date(date);
      query.date = { $gte: new Date(d.setHours(0, 0, 0, 0)), $lte: new Date(d.setHours(23, 59, 59, 999)) };
    }
    if (excludeImported === 'true' || excludeImported === true) {
      Object.assign(query, visibleLectureFilter);
    }
    const scopedSubjectIds = await getScopedSubjectIds(req.user, { allSemesters: allSemesters === 'true' || allSemesters === true });
    if (scopedSubjectIds) {
      if (subjectId && !scopedSubjectIds.some(id => id.toString() === subjectId)) {
        return res.json({ success: true, lectures: [] });
      }
      query.subject = subjectId || { $in: scopedSubjectIds };
    }
    await repairResumedSubjectLectures(query.subject ? { _id: query.subject } : {});

    let lectureQuery = Lecture.find(query)
      .populate('subject', 'name code department branch semester assignedTeachers')
      .populate('createdBy', 'name')
      .sort(sort === 'recent' ? { date: -1, startTime: -1, createdAt: -1 } : { date: 1, startTime: 1, createdAt: 1 });

    if (limit) lectureQuery = lectureQuery.limit(parseInt(limit));

    const lectures = await lectureQuery;

    res.json({ success: true, lectures });
  } catch (err) {
    console.error('getAllLectures error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// @desc    Get lecture by ID
const getLectureById = async (req, res) => {
  try {
    await closeExpiredAttendance(req.app.get('io'));
    const lecture = await Lecture.findById(req.params.id)
      .populate('subject', 'name code department branch semester assignedTeachers')
      .populate('createdBy', 'name email');
    if (!lecture) return res.status(404).json({ success: false, message: 'Lecture not found' });
    if (!(await ensureLectureAccess(lecture, req, res))) return;
    res.json({ success: true, lecture });
  } catch (err) {
    console.error('getLectureById error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getCopyAttendanceSources = async (req, res) => {
  try {
    const targetLecture = await Lecture.findById(req.params.id).populate('subject', 'name code department branch semester assignedTeachers');
    if (!(await ensureLectureAccess(targetLecture, req, res))) return;
    const { start, end } = dayRangeFor(req.query.date || targetLecture.date);
    const subjectQuery = {
      department: targetLecture.subject.department,
      semester: targetLecture.subject.semester,
      isActive: true,
      pendingDeletion: { $ne: true }
    };
    if (req.user.role === 'teacher') {
      const teacherSemester = getTeacherSemesterScope(req.user);
      if (teacherSemester && Number(targetLecture.subject.semester) !== Number(teacherSemester)) {
        return res.status(403).json({ success: false, message: 'Target lecture belongs to another semester scope' });
      }
    } else if (!assertDepartmentAccess(targetLecture.subject, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const sourceSubjects = await Subject.find(subjectQuery).select('_id name code branch semester assignedTeachers').lean();
    const sourceSubjectIds = sourceSubjects.map(subject => subject._id);
    const lectures = sourceSubjectIds.length
      ? await Lecture.find({
        _id: { $ne: targetLecture._id },
        subject: { $in: sourceSubjectIds },
        date: { $gte: start, $lte: end },
        pendingDeletion: { $ne: true }
      })
        .populate('subject', 'name code department branch semester assignedTeachers')
        .populate('createdBy', 'name email profileImage')
        .sort({ startTime: 1, title: 1 })
        .lean()
      : [];

    const sources = await Promise.all(lectures.map(async (lecture) => {
      const records = await Attendance.find({ lecture: lecture._id, status: 'present' })
        .populate('student', 'name studentId profileImage department branch semester')
        .lean();
      const matchingRecords = records.filter(record => record.student && studentMatchesSubject(record.student, targetLecture.subject));
      return {
        ...lecture,
        canCopyCount: matchingRecords.length,
        attendancePreview: matchingRecords.slice(0, 8)
      };
    }));

    res.json({ success: true, targetLecture, sources, selectedDate: start, dayWindow: { start, end } });
  } catch (err) {
    console.error('getCopyAttendanceSources error:', err);
    res.status(500).json({ success: false, message: err.message || 'Could not load copy sources' });
  }
};

// @desc    Start attendance for a lecture (generates 6-digit code)
const startAttendance = async (req, res) => {
  try {
    await closeExpiredAttendance(req.app.get('io'));
    const { durationMinutes } = req.body || {};
    const lecture = await Lecture.findById(req.params.id).populate('subject', 'name code department branch semester assignedTeachers');
    if (!(await ensureLectureAccess(lecture, req, res))) return;
    if (lecture.attendanceOpen) {
      return res.status(400).json({ success: false, message: 'Attendance is already open for this lecture.' });
    }

    if (lecture.status === 'completed' && (!durationMinutes || Number(durationMinutes) < 1)) {
      return res.status(400).json({ success: false, message: 'Set a restart duration in minutes to reopen attendance.' });
    }

    const holiday = await isLectureBlockedByHoliday(lecture);
    if (holiday) {
      return res.status(400).json({
        success: false,
        message: `Attendance cannot be started on ${holiday.type}: ${holiday.title}.`
      });
    }

    const code = generateCode();
    const expiresAt = getAttendanceExpiry(lecture, durationMinutes);

    lecture.attendanceCode = code;
    lecture.attendanceOpen = true;
    lecture.attendanceOpenedAt = new Date();
    lecture.attendanceClosedAt = undefined;
    lecture.codeExpiresAt = expiresAt;
    lecture.status = 'ongoing';
    await lecture.save();

    const enrolledStudents = await User.find({
      enrolledSubjects: lecture.subject._id,
      status: 'active',
      isRestricted: { $ne: true },
      role: 'student'
    }).select('_id role status isRestricted subjectRestrictions');
    const eligibleStudents = enrolledStudents.filter(student => canReceiveSubjectUpdates(student, lecture.subject._id));

    if (eligibleStudents.length > 0) {
      const notifPromises = eligibleStudents.map(s =>
        Notification.create({
          recipient: s._id,
          type: 'attendance_opened',
          title: `Attendance Open: ${lecture.subject.name}`,
          message: `Attendance is now open for "${lecture.title}". Ask your admin for the attendance code in class.`,
          data: { lectureId: lecture._id },
          priority: 'high'
        })
      );
      await Promise.all(notifPromises);

      const io = req.app.get('io');
      if (io) {
        eligibleStudents.forEach(s => {
          io.to(`student_${s._id}`).emit('attendance_opened', {
            lectureId: lecture._id,
            subjectName: lecture.subject.name,
            expiresAt
          });
        });
      }
    }
    await emitLectureChange(req, lecture, 'attendance_opened');
    await logAudit(req, {
      action: 'attendance.opened',
      entityType: 'lecture',
      entityId: lecture._id,
      entityName: lecture.title,
      targetDepartment: lecture.subject.department,
      details: {
        subjectId: lecture.subject._id,
        subjectName: lecture.subject.name,
        lectureDate: lecture.date,
        lectureStartTime: lecture.startTime,
        lectureEndTime: lecture.endTime,
        attendanceStartedAt: lecture.attendanceOpenedAt,
        attendanceCodeExpiresAt: expiresAt,
        durationMinutes: durationMinutes || null
      }
    });

    res.json({ success: true, code, expiresAt, lectureId: lecture._id });
  } catch (err) {
    console.error('startAttendance error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// @desc    Stop attendance
const stopAttendance = async (req, res) => {
  try {
    const lecture = await Lecture.findById(req.params.id).populate('subject', 'name department branch semester assignedTeachers');
    if (!(await ensureLectureAccess(lecture, req, res))) return;
    if (!lecture.attendanceOpen) {
      return res.status(400).json({ success: false, message: 'Attendance is already closed.' });
    }

    lecture.attendanceOpen = false;
    lecture.attendanceClosedAt = new Date();
    lecture.status = 'completed';
    await lecture.save();

    const io = req.app.get('io');
    if (io) {
      io.emit('attendance_closed', { lectureId: lecture._id });
    }
    await emitLectureChange(req, lecture, 'attendance_closed');
    await logAudit(req, {
      action: 'attendance.closed',
      entityType: 'lecture',
      entityId: lecture._id,
      entityName: lecture.title,
      targetDepartment: lecture.subject.department,
      details: {
        subjectId: lecture.subject._id,
        subjectName: lecture.subject.name,
        lectureDate: lecture.date,
        lectureStartTime: lecture.startTime,
        lectureEndTime: lecture.endTime,
        attendanceClosedAt: lecture.attendanceClosedAt
      }
    });

    res.json({ success: true, message: 'Attendance closed for this lecture.' });
  } catch (err) {
    console.error('stopAttendance error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// @desc    Copy present attendance from one accessible lecture to another
const copyLectureAttendance = async (req, res) => {
  try {
    const { sourceLectureId } = req.body;
    if (!sourceLectureId || sourceLectureId === req.params.id) {
      return res.status(400).json({ success: false, message: 'Choose a different source lecture.' });
    }
    const targetLecture = await Lecture.findById(req.params.id).populate('subject', 'name code department branch semester assignedTeachers');
    const sourceLecture = await Lecture.findById(sourceLectureId).populate('subject', 'name code department branch semester assignedTeachers');

    if (!(await ensureLectureAccess(targetLecture, req, res))) return;
    if (!(await ensureTeacherPeerSourceAccess(sourceLecture, targetLecture, req, res))) return;

    const sourceAttendance = await Attendance.find({ lecture: sourceLectureId, status: 'present' })
      .populate('student', 'name studentId department branch semester');
    const matchingSourceAttendance = sourceAttendance.filter(record => (
      record.student && studentMatchesSubject(record.student, targetLecture.subject)
    ));

    if (!matchingSourceAttendance.length) {
      return res.status(400).json({ success: false, message: 'No present attendance records found in the source lecture.' });
    }

    const operations = matchingSourceAttendance.map(record => ({
      updateOne: {
        filter: { lecture: targetLecture._id, student: record.student._id },
        update: {
          $set: {
            lecture: targetLecture._id,
            subject: targetLecture.subject._id,
            student: record.student._id,
            status: 'present',
            markedAt: new Date(),
            faceVerified: false,
            faceConfidence: record.faceConfidence || null,
            markedBy: 'admin',
            verificationDetails: {
              copiedFromLecture: sourceLecture._id,
              copiedFromSubject: sourceLecture.subject?._id,
              copiedBy: req.user._id
            }
          },
          $unset: {
            capturedImagePath: '',
            capturedImagePublicId: '',
            codeUsed: ''
          }
        },
        upsert: true
      }
    }));

    await Attendance.bulkWrite(operations);
    targetLecture.copiedFrom = sourceLecture._id;
    await targetLecture.save();
    await emitLectureChange(req, targetLecture, 'lecture_updated');

    await logAudit(req, {
      action: 'attendance.copied',
      entityType: 'lecture',
      entityId: targetLecture._id,
      entityName: targetLecture.title,
      targetDepartment: targetLecture.subject.department,
      details: { sourceLectureId, copiedRecords: operations.length, sameSubject: targetLecture.subject._id.toString() === sourceLecture.subject?._id?.toString() }
    });

    res.json({
      success: true,
      message: `Copied ${operations.length} attendance record${operations.length === 1 ? '' : 's'}.`,
      copied: operations.length,
      sourceAttendance: matchingSourceAttendance,
      sourceLecture: { title: sourceLecture.title, date: sourceLecture.date },
      targetLecture: { title: targetLecture.title, date: targetLecture.date }
    });
  } catch (err) {
    console.error('copyLectureAttendance error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// @desc    Get lecture attendance list
const getLectureAttendance = async (req, res) => {
  try {
    await closeExpiredAttendance(req.app.get('io'));
    const lecture = await Lecture.findById(req.params.id).populate('subject', 'name code department branch semester assignedTeachers');
    if (!(await ensureLectureAccess(lecture, req, res))) return;

    const attendanceRecords = await Attendance.find({ lecture: req.params.id })
      .populate('student', 'name studentId profileImage department branch semester status isRestricted restrictionReason subjectRestrictions')
      .sort({ markedAt: -1 });

    const enrolledStudents = await User.find({
      enrolledSubjects: lecture.subject._id,
      status: { $in: ['active', 'restricted'] },
      role: 'student',
      pendingDeletion: { $ne: true }
    }).select('name studentId profileImage department branch semester status isRestricted restrictionReason subjectRestrictions');

    const matchingStudents = enrolledStudents.filter(student => studentMatchesSubject(student, lecture.subject));
    const matchingStudentIds = new Set(matchingStudents.map(student => student._id.toString()));
    const attendance = attendanceRecords.filter(record => (
      record.student && matchingStudentIds.has(record.student._id.toString())
      && record.status === 'present'
    ));

    const presentIds = attendance.map(a => a.student._id.toString());
    const absentStudents = matchingStudents.filter(s => !presentIds.includes(s._id.toString()));

    res.json({
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
    });
  } catch (err) {
    console.error('getLectureAttendance error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// @desc    Delete lecture
const deleteLecture = async (req, res) => {
  try {
    const lecture = await Lecture.findById(req.params.id).populate('subject', 'department branch semester assignedTeachers');
    if (!(await ensureLectureAccess(lecture, req, res))) return;

    if (lecture.pendingDeletion) {
      return res.status(400).json({ success: false, message: 'Lecture deletion is already pending.' });
    }
    const deletion = await schedulePendingDeletion({
      resourceType: 'lecture',
      resourceId: lecture._id,
      resourceName: lecture.title,
      targetDepartment: lecture.subject?.department,
      requestedBy: req.user._id
    });
    lecture.pendingDeletion = true;
    lecture.deletionScheduledAt = new Date();
    lecture.deletionExpiresAt = deletion.expiresAt;
    await lecture.save();
    await logAudit(req, {
      action: 'lecture.delete_scheduled',
      entityType: 'lecture',
      entityId: lecture._id,
      entityName: lecture.title,
      targetDepartment: lecture.subject?.department,
      details: { undoExpiresAt: deletion.expiresAt }
    });
    await emitLectureChange(req, lecture, 'lecture_updated');
    res.json({
      success: true,
      message: 'Lecture delete scheduled. You can undo this for 10 minutes.',
      deletionId: deletion._id,
      undoExpiresAt: deletion.expiresAt
    });
  } catch (err) {
    console.error('deleteLecture error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = {
  createLecture, getAllLectures, getLectureById, startAttendance,
  stopAttendance, copyLectureAttendance, getCopyAttendanceSources, getLectureAttendance, deleteLecture
};
