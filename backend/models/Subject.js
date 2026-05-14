const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, unique: true, uppercase: true },
  department: { type: String, required: true },
  semester: { type: Number, required: true, min: 1, max: 8 },
  credits: { type: Number, default: 3 },
  description: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isActive: { type: Boolean, default: true },
  pendingDeletion: { type: Boolean, default: false, index: true },
  deletionScheduledAt: { type: Date },
  deletionExpiresAt: { type: Date },
}, { timestamps: true });

subjectSchema.index({ department: 1, semester: 1, isActive: 1, pendingDeletion: 1 });
subjectSchema.index({ department: 1, isActive: 1, pendingDeletion: 1 });
subjectSchema.index({ createdBy: 1, createdAt: -1 });
subjectSchema.index({ name: 1, department: 1, semester: 1 });

module.exports = mongoose.model('Subject', subjectSchema);
