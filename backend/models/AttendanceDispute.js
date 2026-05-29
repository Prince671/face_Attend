const mongoose = require('mongoose');

const attendanceDisputeSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  lecture: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture', required: true },
  reason: { type: String, required: true, trim: true, maxlength: 500 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolvedAt: { type: Date },
  resolutionNote: { type: String, trim: true, maxlength: 500 },
}, { timestamps: true });

attendanceDisputeSchema.index({ student: 1, lecture: 1 }, { unique: true });
attendanceDisputeSchema.index({ subject: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('AttendanceDispute', attendanceDisputeSchema);
