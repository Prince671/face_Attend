const Lecture = require('../models/Lecture');
const Subject = require('../models/Subject');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { closeExpiredAttendance, getAttendanceExpiry } = require('../utils/attendanceAutoClose');
const { assertDepartmentAccess, getAdminDepartment, getAdminSemesterScope } = require('../utils/adminScope');
const { logAudit } = require('../utils/auditLogger');
const { schedulePendingDeletion } = require('../utils/pendingDeletion');

// Generate 6-digit OTP
const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();
const toBoolean = (value) => value === true || value === 'true' || value === 'on' || value === 1 || value === '1';

const getScopedSubjectIds = async (user) => {
  const department = getAdminDepartment(user);
  if (!department) return null;
  const query = { department, isActive: true };
  const semester = getAdminSemesterScope(user);
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
    : await Subject.findById(lecture.subject).select('department');
  if (!assertDepartmentAccess(subject, req.user)) {
    res.status(403).json({ success: false, message: 'Access denied: lecture belongs to another department' });
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
    if (!assertDepartmentAccess(subject, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied: subject belongs to another department' });
    }
    const adminSemester = getAdminSemesterScope(req.user);
    if (adminSemester && Number(subject.semester) !== adminSemester) {
      return res.status(403).json({ success: false, message: 'Access denied: subject belongs to another semester scope' });
    }

    const lecture = await Lecture.create({
      subject: subjectId,
      title,
      description,
      date: new Date(date),
      startTime,
      endTime,
      duration: parseInt(duration),
      createdBy: req.user._id,
      status: 'scheduled',
      isLab: toBoolean(isLab),
      labNumber: toBoolean(isLab) ? (labNumber || 'LAB1') : ''
    });

    await lecture.populate('subject', 'name code');

    // Notify enrolled students
    const enrolledStudents = await User.find({
      enrolledSubjects: subjectId,
      status: 'active',
      role: 'student'
    });

    if (enrolledStudents.length > 0) {
      const notifPromises = enrolledStudents.map(s =>
        Notification.create({
          recipient: s._id,
          type: 'lecture_created',
          title: `New Lecture: ${subject.name}`,
          message: `A new lecture "${title}" has been scheduled for ${new Date(date).toDateString()} at ${startTime}.`,
          data: { lectureId: lecture._id }
        })
      );
      await Promise.all(notifPromises);

      // FIX: Emit socket event to each enrolled student's room
      const io = req.app.get('io');
      if (io) {
        enrolledStudents.forEach(s => {
          io.to(`student_${s._id}`).emit('new_lecture', { lecture });
        });
      }
    }
    await logAudit(req, {
      action: 'lecture.created',
      entityType: 'lecture',
      entityId: lecture._id,
      entityName: lecture.title,
      targetDepartment: subject.department,
      details: { subjectId, subjectCode: subject.code, date, startTime, endTime, duration }
    });

    res.status(201).json({ success: true, lecture });
  } catch (err) {
    console.error('createLecture error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// @desc    Get all lectures (admin)
const getAllLectures = async (req, res) => {
  try {
    await closeExpiredAttendance(req.app.get('io'));
    const { subjectId, status, date, limit } = req.query;
    const query = { pendingDeletion: { $ne: true } };
    if (subjectId) query.subject = subjectId;
    if (status) query.status = status;
    if (date) {
      const d = new Date(date);
      query.date = { $gte: new Date(d.setHours(0, 0, 0, 0)), $lte: new Date(d.setHours(23, 59, 59, 999)) };
    }
    const scopedSubjectIds = await getScopedSubjectIds(req.user);
    if (scopedSubjectIds) {
      if (subjectId && !scopedSubjectIds.some(id => id.toString() === subjectId)) {
        return res.json({ success: true, lectures: [] });
      }
      query.subject = subjectId || { $in: scopedSubjectIds };
    }

    let lectureQuery = Lecture.find(query)
      .populate('subject', 'name code department')
      .populate('createdBy', 'name')
      .sort({ date: 1, startTime: 1, createdAt: 1 });

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
      .populate('subject', 'name code department semester')
      .populate('createdBy', 'name email');
    if (!lecture) return res.status(404).json({ success: false, message: 'Lecture not found' });
    if (!(await ensureLectureAccess(lecture, req, res))) return;
    res.json({ success: true, lecture });
  } catch (err) {
    console.error('getLectureById error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// @desc    Start attendance for a lecture (generates 6-digit code)
const startAttendance = async (req, res) => {
  try {
    await closeExpiredAttendance(req.app.get('io'));
    const { durationMinutes } = req.body || {};
    const lecture = await Lecture.findById(req.params.id).populate('subject', 'name code department');
    if (!(await ensureLectureAccess(lecture, req, res))) return;
    if (lecture.attendanceOpen) {
      return res.status(400).json({ success: false, message: 'Attendance is already open for this lecture.' });
    }

    if (lecture.status === 'completed' && (!durationMinutes || Number(durationMinutes) < 1)) {
      return res.status(400).json({ success: false, message: 'Set a restart duration in minutes to reopen attendance.' });
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
      role: 'student'
    });

    if (enrolledStudents.length > 0) {
      const notifPromises = enrolledStudents.map(s =>
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
        enrolledStudents.forEach(s => {
          io.to(`student_${s._id}`).emit('attendance_opened', {
            lectureId: lecture._id,
            subjectName: lecture.subject.name,
            expiresAt
          });
        });
      }
    }
    await logAudit(req, {
      action: 'attendance.opened',
      entityType: 'lecture',
      entityId: lecture._id,
      entityName: lecture.title,
      targetDepartment: lecture.subject.department,
      details: { subjectId: lecture.subject._id, codeExpiresAt: expiresAt, durationMinutes: durationMinutes || null }
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
    const lecture = await Lecture.findById(req.params.id).populate('subject', 'name department');
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
    await logAudit(req, {
      action: 'attendance.closed',
      entityType: 'lecture',
      entityId: lecture._id,
      entityName: lecture.title,
      targetDepartment: lecture.subject.department,
    });

    res.json({ success: true, message: 'Attendance closed for this lecture.' });
  } catch (err) {
    console.error('stopAttendance error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// @desc    Copy attendance from one lecture to another (view only)
const copyLectureAttendance = async (req, res) => {
  try {
    const { sourceLectureId } = req.body;
    const targetLecture = await Lecture.findById(req.params.id).populate('subject', 'name code department');
    const sourceLecture = await Lecture.findById(sourceLectureId).populate('subject', 'name code department');

    if (!(await ensureLectureAccess(targetLecture, req, res))) return;
    if (!(await ensureLectureAccess(sourceLecture, req, res))) return;

    const sourceAttendance = await Attendance.find({ lecture: sourceLectureId })
      .populate('student', 'name studentId');

    await logAudit(req, {
      action: 'attendance.copied_viewed',
      entityType: 'lecture',
      entityId: targetLecture._id,
      entityName: targetLecture.title,
      targetDepartment: targetLecture.subject.department,
      details: { sourceLectureId }
    });

    res.json({
      success: true,
      message: 'Attendance copied (view only - cannot edit)',
      sourceAttendance,
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
    const lecture = await Lecture.findById(req.params.id).populate('subject', 'name code');
    if (!(await ensureLectureAccess(lecture, req, res))) return;

    const attendance = await Attendance.find({ lecture: req.params.id })
      .populate('student', 'name studentId profileImage department semester')
      .sort({ markedAt: -1 });

    const enrolledStudents = await User.find({
      enrolledSubjects: lecture.subject._id,
      status: 'active',
      role: 'student'
    }).select('name studentId profileImage');

    const presentIds = attendance.map(a => a.student._id.toString());
    const absentStudents = enrolledStudents.filter(s => !presentIds.includes(s._id.toString()));

    res.json({
      success: true,
      lecture,
      attendance,
      absentStudents,
      stats: {
        total: enrolledStudents.length,
        present: attendance.length,
        absent: absentStudents.length,
        percentage: enrolledStudents.length ? ((attendance.length / enrolledStudents.length) * 100).toFixed(1) : 0
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
    const lecture = await Lecture.findById(req.params.id).populate('subject', 'department');
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
  stopAttendance, copyLectureAttendance, getLectureAttendance, deleteLecture
};
