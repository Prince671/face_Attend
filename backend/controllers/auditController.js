const AuditLog = require('../models/AuditLog');
const { applyDepartmentScope } = require('../utils/adminScope');

const getAuditLogs = async (req, res) => {
  try {
    const { action, entityType, actor, dateFrom, dateTo, limit = 100 } = req.query;
    const query = applyDepartmentScope({}, req.user, 'targetDepartment');

    if (action) query.action = action;
    if (entityType) query.entityType = entityType;
    if (actor) query.actor = actor;
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
