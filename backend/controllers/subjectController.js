const Subject = require('../models/Subject');
const User    = require('../models/User');
const { syncSubjectEnrollment, enrollStudentInMatchingSubjects } = require('../utils/subjectEnrollment');
const { applyDepartmentScope, applyAcademicScope, assertDepartmentAccess, getAdminDepartment, getAdminSemesterScope } = require('../utils/adminScope');
const { logAudit } = require('../utils/auditLogger');
const { schedulePendingDeletion } = require('../utils/pendingDeletion');

const createSubject = async (req, res) => {
  try {
    const { name, code, department, semester, credits, description } = req.body;
    const scopedDepartment = getAdminDepartment(req.user) || department;
    const scopedSemester = getAdminSemesterScope(req.user) || semester;
    if (!name || !code || !scopedDepartment || !scopedSemester) {
      return res.status(400).json({ success: false, message: 'name, code, department, semester are required' });
    }
    const existing = await Subject.findOne({ code: code.toUpperCase() });
    if (existing) return res.status(400).json({ success: false, message: 'Subject code already exists.' });

    const subject = await Subject.create({
      name, code: code.toUpperCase(), department: scopedDepartment,
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
    const { department, semester } = req.query;
    const query = applyAcademicScope({ isActive: true, pendingDeletion: { $ne: true } }, req.user);
    if (req.user.role === 'student') {
      query.department = req.user.department;
      query.semester = Number(req.user.semester);
    }
    if (req.user.role !== 'student' && !getAdminDepartment(req.user) && department) query.department = department;
    if (req.user.role !== 'student' && semester) query.semester = parseInt(semester);
    const subjects = await Subject.find(query).populate('createdBy', 'name').sort({ name: 1 });
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
    const existing = await Subject.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Subject not found' });
    if (!assertDepartmentAccess(existing, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied: subject belongs to another department' });
    }
    const scopedDepartment = getAdminDepartment(req.user);
    if (scopedDepartment) update.department = scopedDepartment;

    const subject = await Subject.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });

    const enrollment = await syncSubjectEnrollment(subject);
    await logAudit(req, {
      action: 'subject.updated',
      entityType: 'subject',
      entityId: subject._id,
      entityName: `${subject.name} (${subject.code})`,
      targetDepartment: subject.department,
      details: update
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
    const currentStudent = await User.findById(req.user._id).select('role department semester');
    if (!currentStudent) return res.status(404).json({ success: false, message: 'Student not found' });
    await enrollStudentInMatchingSubjects(currentStudent);

    const student = await User.findById(req.user._id).populate({
      path: 'enrolledSubjects',
      match: {
        isActive: true,
        department: currentStudent.department,
        semester: Number(currentStudent.semester)
      },
      select: 'name code department semester credits description'
    });
    res.json({ success: true, subjects: student.enrolledSubjects });
  } catch (err) {
    console.error('getStudentSubjects error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = { createSubject, getAllSubjects, getSubjectById, updateSubject, deleteSubject, getStudentSubjects };
