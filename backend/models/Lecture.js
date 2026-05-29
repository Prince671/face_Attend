const mongoose = require('mongoose');

const lectureSchema = new mongoose.Schema({
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  title: { type: String, required: true },
  description: { type: String },
  date: { type: Date, required: true },
  startTime: { type: String, required: true }, // "HH:MM"
  endTime: { type: String, required: true },
  duration: { type: Number, required: true }, // minutes
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  attendanceCode: { type: String, length: 6 },       // 6-digit OTP
  attendanceOpen: { type: Boolean, default: false },
  attendanceOpenedAt: { type: Date },
  attendanceClosedAt: { type: Date },
  codeExpiresAt: { type: Date },
  status: { type: String, enum: ['scheduled', 'ongoing', 'completed', 'cancelled'], default: 'scheduled' },
  reminderSentAt: { type: Date },
  copiedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture' },  // for copy feature
  source: { type: String, enum: ['manual', 'timetable', 'imported'], default: 'manual', index: true },
  timetable: { type: mongoose.Schema.Types.ObjectId, ref: 'Timetable' },
  timetableSlot: { type: mongoose.Schema.Types.ObjectId },
  isLab: { type: Boolean, default: false, index: true },
  labNumber: { type: String, enum: ['', 'LAB1', 'LAB2', 'LAB3'], default: '' },
  cancelledByHoliday: { type: mongoose.Schema.Types.ObjectId, ref: 'Holiday' },
  cancellationReason: { type: String, trim: true, default: '' },
  pendingDeletion: { type: Boolean, default: false, index: true },
  deletionScheduledAt: { type: Date },
  deletionExpiresAt: { type: Date },
}, { timestamps: true });

lectureSchema.index({ subject: 1, pendingDeletion: 1, date: 1, startTime: 1 });
lectureSchema.index({ subject: 1, status: 1, pendingDeletion: 1 });
lectureSchema.index({ attendanceOpen: 1, codeExpiresAt: 1 });
lectureSchema.index({ timetable: 1, timetableSlot: 1 });
lectureSchema.index({ createdBy: 1, createdAt: -1 });
lectureSchema.index({ status: 1, pendingDeletion: 1, date: 1 });
lectureSchema.index({ subject: 1, status: 1, source: 1, pendingDeletion: 1, date: -1, startTime: -1 });
lectureSchema.index({ source: 1, pendingDeletion: 1, status: 1 });
lectureSchema.index({ cancelledByHoliday: 1, status: 1 });

module.exports = mongoose.model('Lecture', lectureSchema);
