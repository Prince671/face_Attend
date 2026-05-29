const Subject = require('../models/Subject');
const User    = require('../models/User');
const Lecture = require('../models/Lecture');
const Notification = require('../models/Notification');
const { syncSubjectEnrollment, enrollStudentInMatchingSubjects } = require('../utils/subjectEnrollment');
const { applyAcademicScope, assertDepartmentAccess, getAdminDepartment, getAdminSemesterScope, getTeacherSemesterScope, adminDepartmentRoom } = require('../utils/adminScope');
const { logAudit } = require('../utils/auditLogger');
const { schedulePendingDeletion } = require('../utils/pendingDeletion');
const { canReceiveSubjectUpdates, isProfileRestricted, isRestrictedForSubject } = require('../utils/restrictionPolicy');

const normalizeBranchValue = (value) => {
  const branch = String(value || '').trim();
  return /^(unassigned branch|general)$/i.test(branch) ? '' : branch;
};

const branchFilter = (value) => {
  if (value === undefined || value === null || value === '') return {};
  const branch = normalizeBranchValue(value);
  return branch ? { branch } : { $or: [{ branch: '' }, { branch: { $exists: false } }] };
};

const createSubject = async (req, res) => {
  try {
    const { name, code, department, semester, credits, description, branch } = req.body;
    const scopedDepartment = getAdminDepartment(req.user) || department;
    const scopedSemester = getAdminSemesterScope(req.user) || semester;
    if (!name || !code || !scopedDepartment || !scopedSemester) {
      return res.status(400).json({ success: false, message: 'name, code, department, semester are required' });
    }
    const existing = await Subject.findOne({ code: code.toUpperCase() });
    if (existing) return res.status(400).json({ success: false, message: 'Subject code already exists.' });

    const subject = await Subject.create({
      name, code: code.toUpperCase(), department: scopedDepartment,
      branch: normalizeBranchValue(branch),
      semester: parseInt(scopedSemester), credits: parseInt(credits) || 3,
      description, createdBy: req.user._id
    });

    const enrollment = await syncSubjectEnrollment(subject);
    await logAudit(req, {
      action: 'subject.created',
      entityType: 'subject',
      entityId: subject._id,
      entityName: `${subject.name} (${subject.code})`,
      targetDepartment: subject.department,
      details: { semester: subject.semester, credits: subject.credits }
    });
    res.status(201).json({ success: true, subject, enrollment });
  } catch (err) {
    console.error('createSubject error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getAllSubjects = async (req, res) => {
  try {
    const { department, semester, allSemesters, branch } = req.query;
    const adminDepartment = getAdminDepartment(req.user);
    const skipAdminSemester = allSemesters === 'true' || allSemesters === true;
    const query = adminDepartment
      ? { isActive: true, pendingDeletion: { $ne: true }, department: adminDepartment }
      : applyAcademicScope({ isActive: true, pendingDeletion: { $ne: true } }, req.user);
    if (adminDepartment && !skipAdminSemester) {
      const adminSemester = getAdminSemesterScope(req.user);
      if (adminSemester) query.semester = adminSemester;
    }
    if (req.user.role === 'student') {
      query.department = req.user.department;
      query.semester = Number(req.user.semester);
    } else if (req.user.role === 'teacher') {
      query.assignedTeachers = req.user._id;
      const teacherSemester = getTeacherSemesterScope(req.user);
      if (teacherSemester) query.semester = teacherSemester;
      else if (semester) query.semester = parseInt(semester);
      if (department) query.department = department;
    }
    if (req.user.role === 'admin' && !getAdminDepartment(req.user)) {
      if (department) query.department = department;
      if (semester) query.semester = parseInt(semester);
    }
    Object.assign(query, branchFilter(branch));
    const subjects = await Subject.find(query)
      .populate('createdBy', 'name')
      .populate('assignedTeachers', 'name email departments')
      .sort({ name: 1 });
    res.json({ success: true, subjects });
  } catch (err) {
    console.error('getAllSubjects error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getSubjectById = async (req, res) => {
  try {
    const subject = await Subject.findById(req.params.id).populate('createdBy', 'name');
    if (!subject || subject.pendingDeletion) return res.status(404).json({ success: false, message: 'Subject not found' });
    if (req.user.role === 'teacher' && !(subject.assignedTeachers || []).some(id => id.toString() === req.user._id.toString())) {
      return res.status(403).json({ success: false, message: 'Access denied: subject is not assigned to this teacher' });
    }
    if (!assertDepartmentAccess(subject, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied: subject belongs to another department' });
    }
    res.json({ success: true, subject });
  } catch (err) {
    console.error('getSubjectById error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const updateSubject = async (req, res) => {
  try {
    const update = { ...req.body };
    if (update.code) update.code = update.code.toUpperCase();
    if (update.semester) update.semester = parseInt(update.semester);
    if (update.credits) update.credits = parseInt(update.credits);
    if (update.branch !== undefined) update.branch = normalizeBranchValue(update.branch);
    if (update.classesStopped !== undefined) {
      update.classesStopped = update.classesStopped === true || update.classesStopped === 'true' || update.classesStopped === 'on' || update.classesStopped === 1 || update.classesStopped === '1';
      update.syllabusCompleted = update.classesStopped;
      update.classesStoppedAt = update.classesStopped ? new Date() : null;
      update.classesStoppedBy = update.classesStopped ? req.user._id : null;
      update.classesStoppedReason = update.classesStopped ? String(update.classesStoppedReason || 'Syllabus completed').trim() : '';
    }
    const existing = await Subject.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Subject not found' });
    if (!assertDepartmentAccess(existing, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied: subject belongs to another department' });
    }
    const scopedDepartment = getAdminDepartment(req.user);
    if (scopedDepartment) update.department = scopedDepartment;

    const subject = await Subject.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    let cancelledLectures = 0;
    let resumedLectures = 0;
    if (update.classesStopped === true) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const cancelResult = await Lecture.updateMany(
        {
          subject: subject._id,
          status: 'scheduled',
          date: { $gte: today },
          pendingDeletion: { $ne: true }
        },
        {
          $set: {
            status: 'cancelled',
            attendanceOpen: false,
            attendanceCode: '',
            codeExpiresAt: null
          }
        }
      );
      cancelledLectures = cancelResult.modifiedCount || 0;
    } else if (update.classesStopped === false) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const resumeResult = await Lecture.updateMany(
        {
          subject: subject._id,
          status: 'cancelled',
          date: { $gte: today },
          pendingDeletion: { $ne: true }
        },
        {
          $set: { status: 'scheduled' }
        }
      );
      resumedLectures = resumeResult.modifiedCount || 0;
    }

    const enrollment = await syncSubjectEnrollment(subject);
    if (update.classesStopped === true || update.classesStopped === false) {
      const assignedTeacherIds = (subject.assignedTeachers || []).filter(Boolean);
      const actionLabel = update.classesStopped ? 'stopped' : 'resumed';
      const type = update.classesStopped ? 'subject_classes_stopped' : 'subject_classes_resumed';
      const title = update.classesStopped ? 'Subject classes stopped' : 'Subject classes resumed';
      if (assignedTeacherIds.length) {
        const notifications = await Promise.all(assignedTeacherIds.map(teacherId => Notification.create({
          recipient: teacherId,
          type,
          title,
          message: `${req.user.name || 'Admin'} ${actionLabel} ${subject.name} (${subject.code}) for Semester ${subject.semester}.`,
          data: {
            subjectId: subject._id,
            subjectName: subject.name,
            subjectCode: subject.code,
            semester: subject.semester,
            department: subject.department,
            reason: subject.classesStoppedReason || '',
            changedBy: {
              id: req.user._id,
              name: req.user.name,
              email: req.user.email,
              role: req.user.department === 'Administration' || String(req.user.email || '').toLowerCase() === 'admin@school.edu' ? 'Super Admin' : 'Department Admin'
            }
          },
          priority: update.classesStopped ? 'high' : 'medium'
        })));
        const io = req.app.get('io');
        if (io) {
          notifications.forEach(notification => {
            io.to(`user_${notification.recipient}`).emit('notification_created', {
              notificationId: notification._id,
              type: notification.type,
              title: notification.title,
              message: notification.message
            });
          });
        }
      }
    }
    const io = req.app.get('io');
    if (io) {
      const payload = {
        subjectId: subject._id,
        department: subject.department,
        semester: subject.semester,
        classesStopped: subject.classesStopped,
        syllabusCompleted: subject.syllabusCompleted,
        cancelledLectures,
        resumedLectures
      };
      io.to('admin_room').emit('subject_updated', payload);
      io.to(adminDepartmentRoom(subject.department)).emit('subject_updated', payload);
      io.to('admin_room').emit('lectures_changed', payload);
      io.to(adminDepartmentRoom(subject.department)).emit('lectures_changed', payload);

      (subject.assignedTeachers || []).forEach(teacherId => {
        io.to(`user_${teacherId}`).emit('subject_updated', payload);
        io.to(`user_${teacherId}`).emit('lectures_changed', payload);
      });

      const enrolledStudents = await User.find({
        role: 'student',
        enrolledSubjects: subject._id,
        status: 'active',
        isRestricted: { $ne: true },
        pendingDeletion: { $ne: true }
      }).select('_id role status isRestricted subjectRestrictions').lean();
      enrolledStudents.filter(student => canReceiveSubjectUpdates(student, subject._id)).forEach(student => {
        io.to(`student_${student._id}`).emit('subject_updated', payload);
        io.to(`student_${student._id}`).emit('lectures_changed', payload);
      });
    }
    await logAudit(req, {
      action: update.classesStopped === true ? 'subject.classes_stopped' : update.classesStopped === false ? 'subject.classes_resumed' : 'subject.updated',
      entityType: 'subject',
      entityId: subject._id,
      entityName: `${subject.name} (${subject.code})`,
      targetDepartment: subject.department,
      details: { ...update, cancelledLectures, resumedLectures }
    });
    res.json({ success: true, subject, enrollment });
  } catch (err) {
    console.error('updateSubject error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const deleteSubject = async (req, res) => {
  try {
    const existing = await Subject.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Subject not found' });
    if (!assertDepartmentAccess(existing, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied: subject belongs to another department' });
    }
    if (existing.pendingDeletion) {
      return res.status(400).json({ success: false, message: 'Subject deletion is already pending.' });
    }
    const deletion = await schedulePendingDeletion({
      resourceType: 'subject',
      resourceId: existing._id,
      resourceName: `${existing.name} (${existing.code})`,
      targetDepartment: existing.department,
      requestedBy: req.user._id
    });
    const subject = await Subject.findByIdAndUpdate(req.params.id, {
      isActive: false,
      pendingDeletion: true,
      deletionScheduledAt: new Date(),
      deletionExpiresAt: deletion.expiresAt
    }, { new: true });

    const enrollment = await syncSubjectEnrollment(subject);
    await logAudit(req, {
      action: 'subject.delete_scheduled',
      entityType: 'subject',
      entityId: subject._id,
      entityName: `${subject.name} (${subject.code})`,
      targetDepartment: subject.department,
      details: { undoExpiresAt: deletion.expiresAt }
    });
    res.json({
      success: true,
      message: 'Subject delete scheduled. You can undo this for 10 minutes.',
      enrollment,
      deletionId: deletion._id,
      undoExpiresAt: deletion.expiresAt
    });
  } catch (err) {
    console.error('deleteSubject error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getStudentSubjects = async (req, res) => {
  try {
    const currentStudent = await User.findById(req.user._id).select('role department branch semester status isRestricted subjectRestrictions');
    if (!currentStudent) return res.status(404).json({ success: false, message: 'Student not found' });
    if (isProfileRestricted(currentStudent)) return res.json({ success: true, subjects: [] });
    await enrollStudentInMatchingSubjects(currentStudent);
    const match = {
      isActive: true,
      department: currentStudent.department,
      semester: Number(currentStudent.semester)
    };
    if (/computer|cse|cs/i.test(String(currentStudent.department || ''))) {
      const branch = currentStudent.branch || 'Computer Science';
      if (branch === 'Computer Science') {
        match.$or = [{ branch: 'Computer Science' }, { branch: '' }, { branch: { $exists: false } }];
      } else {
        match.branch = branch;
      }
    }

    const student = await User.findById(req.user._id).populate({
      path: 'enrolledSubjects',
      match,
      select: 'name code department branch semester credits description'
    });
    const subjects = (student.enrolledSubjects || []).filter(subject => !isRestrictedForSubject(currentStudent, subject._id));
    res.json({ success: true, subjects });
  } catch (err) {
    console.error('getStudentSubjects error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = { createSubject, getAllSubjects, getSubjectById, updateSubject, deleteSubject, getStudentSubjects };
