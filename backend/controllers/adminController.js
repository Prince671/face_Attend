const User = require('../models/User');
const Notification = require('../models/Notification');
const Subject = require('../models/Subject');
const Lecture = require('../models/Lecture');
const Attendance = require('../models/Attendance');
const { enrollStudentInMatchingSubjects } = require('../utils/subjectEnrollment');
const { applyDepartmentScope, applyAcademicScope, assertDepartmentAccess, getAdminDepartment, getAdminSemesterScope, isSystemAdmin } = require('../utils/adminScope');
const { logAudit } = require('../utils/auditLogger');
const { schedulePendingDeletion } = require('../utils/pendingDeletion');

const KNOWN_DEPARTMENTS = ['Computer Science', 'Information Technology', 'Electronics', 'Mechanical', 'Civil', 'Chemical', 'Electrical'];

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

const getPendingStudents = async (req, res) => {
  try {
    const query = applyAcademicScope({ role: 'student', status: 'pending', pendingDeletion: { $ne: true } }, req.user);
    const students = await User.find(query)
      .select('-password -faceEncoding')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, students });
  } catch (err) {
    console.error('getPendingStudents error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getAllStudents = async (req, res) => {
  try {
    const { status, department, semester, search } = req.query;
    const query = { role: 'student', pendingDeletion: { $ne: true } };
    if (status) query.status = status;
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
      .populate('enrolledSubjects', 'name code')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, students, total: students.length });
  } catch (err) {
    console.error('getAllStudents error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getStudentById = async (req, res) => {
  try {
    const student = await User.findById(req.params.id)
      .select('-password -faceEncoding')
      .populate('enrolledSubjects', 'name code department semester');
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
    await Notification.create({
      recipient: student._id,
      type: 'account_restricted',
      title: 'Account Restricted',
      message: reason || 'Your account has been restricted.',
      priority: 'critical'
    });
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

const enrollStudentSubjects = async (req, res) => {
  try {
    const { subjectIds } = req.body;
    const existingStudent = await User.findById(req.params.id);
    if (!ensureStudentAccess(existingStudent, req, res)) return;
    if (Array.isArray(subjectIds) && subjectIds.length > 0) {
      const subjectQuery = applyAcademicScope({ _id: { $in: subjectIds }, isActive: true }, req.user);
      const allowedCount = await Subject.countDocuments(subjectQuery);
      if (allowedCount !== subjectIds.length) {
        return res.status(403).json({ success: false, message: 'Access denied: one or more subjects belong to another department' });
      }
    }
    const student = await User.findByIdAndUpdate(
      req.params.id,
      { enrolledSubjects: subjectIds },
      { new: true }
    ).populate('enrolledSubjects', 'name code').select('-password -faceEncoding');
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    await logAudit(req, {
      action: 'student.enrollments_updated',
      entityType: 'student',
      entityId: student._id,
      entityName: `${student.name} (${student.studentId})`,
      targetDepartment: student.department,
      details: { subjectIds }
    });
    res.json({ success: true, student });
  } catch (err) {
    console.error('enrollStudentSubjects error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getAnalytics = async (req, res) => {
  try {
    const studentScope = applyAcademicScope({ role: 'student', pendingDeletion: { $ne: true } }, req.user);
    const subjectScope = applyAcademicScope({ isActive: true, pendingDeletion: { $ne: true } }, req.user);
    const scopedSubjects = await Subject.find(subjectScope).select('_id');
    const scopedSubjectIds = scopedSubjects.map(subject => subject._id);
    const lectureScope = scopedSubjectIds.length ? { subject: { $in: scopedSubjectIds }, pendingDeletion: { $ne: true } } : { subject: { $in: [] } };
    const attendanceScope = scopedSubjectIds.length ? { subject: { $in: scopedSubjectIds } } : { subject: { $in: [] } };

    const totalStudents = await User.countDocuments({ ...studentScope, status: 'active' });
    const pendingStudents = await User.countDocuments({ ...studentScope, status: 'pending' });
    const totalSubjects = await Subject.countDocuments(subjectScope);
    const totalLectures = await Lecture.countDocuments(lectureScope);
    const completedLectures = await Lecture.countDocuments({ ...lectureScope, status: 'completed' });
    const totalAttendanceRecords = await Attendance.countDocuments({ ...attendanceScope, status: 'present' });

    const subjectAnalytics = await Attendance.aggregate([
      { $match: attendanceScope },
      {
        $lookup: {
          from: 'lectures', localField: 'lecture', foreignField: '_id', as: 'lectureData'
        }
      },
      { $unwind: '$lectureData' },
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
    ]);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentAttendance = await Attendance.aggregate([
      { $match: { ...attendanceScope, createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const topStudents = await Attendance.aggregate([
      { $match: { ...attendanceScope, status: 'present' } },
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
    ]);
    await logAudit(req, {
      action: 'analytics.viewed',
      entityType: 'analytics',
      entityName: 'Admin analytics',
      targetDepartment: getAdminDepartment(req.user) || 'All Departments',
    });

    res.json({
      success: true,
      analytics: {
        totalStudents, pendingStudents, totalSubjects, totalLectures,
        completedLectures, totalAttendanceRecords,
        subjectAnalytics, recentAttendance, topStudents
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

    const { department, semester, subjectId } = req.query;
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
        subjectIds.length ? Lecture.countDocuments({ subject: { $in: subjectIds }, pendingDeletion: { $ne: true } }) : 0,
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

    let semesters = [];
    let subjects = [];
    let selectedSubject = null;
    let lectures = [];

    if (department) {
      semesters = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(async (sem) => {
        const semSubjects = await Subject.find({ department, semester: sem, isActive: true, pendingDeletion: { $ne: true } }).select('_id');
        const semSubjectIds = semSubjects.map(subject => subject._id);
        const [students, pendingStudents, lectureCount, completedLectureCount, attendanceRecords] = await Promise.all([
          User.countDocuments({ role: 'student', pendingDeletion: { $ne: true }, department, semester: sem, status: 'active' }),
          User.countDocuments({ role: 'student', pendingDeletion: { $ne: true }, department, semester: sem, status: 'pending' }),
          semSubjectIds.length ? Lecture.countDocuments({ subject: { $in: semSubjectIds }, pendingDeletion: { $ne: true } }) : 0,
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
      }));
    }

    if (department && semester) {
      const semesterNumber = Number(semester);
      const subjectDocs = await Subject.find({ department, semester: semesterNumber, isActive: true, pendingDeletion: { $ne: true } })
        .sort({ name: 1 })
        .select('name code department semester credits description');

      subjects = await Promise.all(subjectDocs.map(async (subject) => {
        const [lectureCount, completedLectureCount, enrolledStudents, attendanceRecords] = await Promise.all([
          Lecture.countDocuments({ subject: subject._id, pendingDeletion: { $ne: true } }),
          Lecture.countDocuments({ subject: subject._id, pendingDeletion: { $ne: true }, status: 'completed' }),
          User.countDocuments({ role: 'student', pendingDeletion: { $ne: true }, status: 'active', enrolledSubjects: subject._id }),
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
      const subject = await Subject.findById(subjectId).select('name code department semester credits description isActive');
      if (!subject || !subject.isActive || subject.pendingDeletion) {
        return res.status(404).json({ success: false, message: 'Subject not found' });
      }
      if (department && subject.department !== department) {
        return res.status(403).json({ success: false, message: 'Subject does not belong to selected department' });
      }
      if (semester && Number(subject.semester) !== Number(semester)) {
        return res.status(403).json({ success: false, message: 'Subject does not belong to selected semester' });
      }

      selectedSubject = subject;
      const lectureDocs = await Lecture.find({ subject: subject._id, pendingDeletion: { $ne: true } })
        .populate('createdBy', 'name email')
        .sort({ date: 1, startTime: 1, createdAt: 1 });
      const enrolledStudentCount = await User.countDocuments({ role: 'student', pendingDeletion: { $ne: true }, status: 'active', enrolledSubjects: subject._id });

      lectures = await Promise.all(lectureDocs.map(async (lecture) => {
        const present = await Attendance.countDocuments({ lecture: lecture._id, status: 'present' });
        return {
          ...lecture.toObject(),
          enrolledStudents: enrolledStudentCount,
          attendanceStats: {
            present,
            absent: Math.max(enrolledStudentCount - present, 0),
            total: enrolledStudentCount,
            percentage: enrolledStudentCount ? ((present / enrolledStudentCount) * 100).toFixed(1) : '0.0'
          }
        };
      }));
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

module.exports = {
  getPendingStudents, getAllStudents, getStudentById, approveStudent, rejectStudent,
  activateStudent, deactivateStudent, restrictStudent, deleteStudent,
  enrollStudentSubjects, getAnalytics, getSuperOverview
};
