const AuditLog = require('../models/AuditLog');
const { applyDepartmentScope } = require('../utils/adminScope');

const READ_ONLY_ACTIONS = [
  'analytics.viewed',
  'attendance.viewed',
  'attendance.copied_viewed',
  'page.opened',
  'page.viewed',
  'record.viewed',
  'records.listed'
];

const getAuditLogs = async (req, res) => {
  try {
    const { action, entityType, actor, dateFrom, dateTo, limit = 100 } = req.query;
    const query = applyDepartmentScope({}, req.user, 'targetDepartment');
    const currentActorId = req.user?._id?.toString();

    if (action) {
      if (READ_ONLY_ACTIONS.includes(action)) {
        return res.json({ success: true, logs: [] });
      }
      query.action = action;
    } else {
      query.action = { $nin: READ_ONLY_ACTIONS };
    }
    if (entityType) query.entityType = entityType;
    if (actor) {
      if (currentActorId && actor === currentActorId) {
        return res.json({ success: true, logs: [] });
      }
      query.actor = actor;
    } else if (currentActorId) {
      query.actor = { $ne: req.user._id };
    }
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    const logs = await AuditLog.find(query)
      .populate('actor', 'name email department')
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10) || 100, 300));

    res.json({ success: true, logs });
  } catch (err) {
    console.error('getAuditLogs error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = { getAuditLogs };
