const PendingDeletion = require('../models/PendingDeletion');
const { undoPendingDeletion } = require('../utils/pendingDeletion');
const { logAudit } = require('../utils/auditLogger');

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

module.exports = { getPendingDeletions, undoDeletion };
