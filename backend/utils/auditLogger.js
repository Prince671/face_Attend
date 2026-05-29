const AuditLog = require('../models/AuditLog');
const { adminDepartmentRoom } = require('./adminScope');

const READ_ONLY_ACTIONS = new Set([
  'analytics.viewed',
  'attendance.viewed',
  'attendance.copied_viewed',
  'page.opened',
  'page.viewed',
  'record.viewed',
  'records.listed'
]);

const shouldStoreAudit = (action) => {
  if (!action || READ_ONLY_ACTIONS.has(action)) return false;
  return true;
};

const logAudit = async (req, entry = {}) => {
  try {
    if (!req?.user?._id) return null;
    if (!shouldStoreAudit(entry.action)) return null;

    const log = await AuditLog.create({
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
    const io = req.app?.get?.('io');
    if (io) {
      const payload = { action: log.action, entityType: log.entityType, targetDepartment: log.targetDepartment, logId: log._id };
      io.to('admin_room').emit('audit_logs_changed', payload);
      if (log.targetDepartment) io.to(adminDepartmentRoom(log.targetDepartment)).emit('audit_logs_changed', payload);
    }
    return log;
  } catch (err) {
    console.error('audit log error:', err.message);
    return null;
  }
};

module.exports = { logAudit, shouldStoreAudit };
