const PendingDeletion = require('../models/PendingDeletion');
const { undoPendingDeletion, undoPendingDeletionBatch } = require('../utils/pendingDeletion');
const { logAudit } = require('../utils/auditLogger');
const { adminDepartmentRoom } = require('../utils/adminScope');

const emitDeletionChanged = (req, payload = {}) => {
  const io = req.app.get('io');
  if (!io) return;
  io.to('admin_room').emit('pending_deletions_changed', payload);
  if (payload.targetDepartment) io.to(adminDepartmentRoom(payload.targetDepartment)).emit('pending_deletions_changed', payload);
  if (payload.resourceType === 'teacher') io.to('admin_room').emit('teacher_changed', payload);
  if (payload.resourceType === 'student') io.to('admin_room').emit('student_profile_changed', { studentId: payload.resourceId, action: payload.action });
  if (payload.resourceType === 'subject') io.to('admin_room').emit('subject_updated', payload);
  if (payload.resourceType === 'lecture') io.to('admin_room').emit('lectures_changed', payload);
};

const getPendingDeletions = async (req, res) => {
  try {
    const query = { status: 'pending', expiresAt: { $gt: new Date() } };
    if (req.user.department && req.user.department !== 'Administration' && req.user.email !== 'admin@school.edu') {
      query.targetDepartment = req.user.department;
    }
    const deletions = await PendingDeletion.find(query)
      .populate('requestedBy', 'name email')
      .sort({ expiresAt: 1 });
    res.json({ success: true, deletions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Could not load pending deletions.' });
  }
};

const undoDeletion = async (req, res) => {
  try {
    const deletion = await undoPendingDeletion(req.params.id, req.user);
    await logAudit(req, {
      action: `${deletion.resourceType}.delete_undone`,
      entityType: deletion.resourceType,
      entityId: deletion.resourceId,
      entityName: deletion.resourceName,
      targetDepartment: deletion.targetDepartment,
      details: { deletionId: deletion._id }
    });
    emitDeletionChanged(req, { action: 'undone', resourceType: deletion.resourceType, resourceId: deletion.resourceId, targetDepartment: deletion.targetDepartment });
    res.json({
      success: true,
      message: `${deletion.resourceName} restored successfully.`,
      deletion
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Could not undo delete.'
    });
  }
};

const undoDeletionBatch = async (req, res) => {
  try {
    const deletions = await undoPendingDeletionBatch(req.params.batchId, req.user);
    const first = deletions[0];
    await logAudit(req, {
      action: `${first.resourceType}.bulk_delete_undone`,
      entityType: first.resourceType,
      entityName: first.batchName || 'Bulk delete',
      targetDepartment: first.targetDepartment,
      details: { batchId: req.params.batchId, count: deletions.length }
    });
    emitDeletionChanged(req, { action: 'batch_undone', resourceType: first.resourceType, targetDepartment: first.targetDepartment, batchId: req.params.batchId, count: deletions.length });
    res.json({
      success: true,
      message: `${deletions.length} delete requests restored successfully.`,
      count: deletions.length,
      batchId: req.params.batchId
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Could not undo delete-all request.'
    });
  }
};

module.exports = { getPendingDeletions, undoDeletion, undoDeletionBatch };
