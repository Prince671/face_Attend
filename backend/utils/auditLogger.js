const AuditLog = require('../models/AuditLog');

const logAudit = async (req, entry = {}) => {
  try {
    if (!req?.user?._id) return null;

    return await AuditLog.create({
      actor: req.user._id,
      actorName: req.user.name || 'Unknown Admin',
      actorEmail: req.user.email || 'unknown',
      actorDepartment: req.user.department,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityName: entry.entityName,
      targetDepartment: entry.targetDepartment || req.user.department,
      details: entry.details || {},
      ipAddress: req.ip,
      userAgent: req.get?.('user-agent'),
    });
  } catch (err) {
    console.error('audit log error:', err.message);
    return null;
  }
};

module.exports = { logAudit };
