const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorName: { type: String, required: true },
  actorEmail: { type: String, required: true },
  actorDepartment: { type: String },
  action: { type: String, required: true, index: true },
  entityType: { type: String, required: true, index: true },
  entityId: { type: mongoose.Schema.Types.ObjectId },
  entityName: { type: String },
  targetDepartment: { type: String, index: true },
  details: { type: mongoose.Schema.Types.Mixed },
  ipAddress: { type: String },
  userAgent: { type: String },
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ targetDepartment: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
