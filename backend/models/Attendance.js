const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  lecture: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture', required: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentId: { type: String, trim: true, uppercase: true, index: true },
  status: { type: String, enum: ['present', 'absent', 'late', 'excused'], default: 'present' },
  markedAt: { type: Date, default: Date.now },
  faceVerified: { type: Boolean, default: false },
  faceConfidence: { type: Number },          // 0-100
  capturedImagePath: { type: String },
  capturedImagePublicId: { type: String },
  verificationDetails: {
    faceMatch: { type: Boolean },
    confidence: { type: Number },
    livenessScore: { type: Number },
    activeLivenessScore: { type: Number },
    bodyLanguageScore: { type: Number },
    eyeOpenScore: { type: Number },
    qualityScore: { type: Number },
  },
  codeUsed: { type: String },
  ipAddress: { type: String },
  deviceInfo: { type: String },
  isAutomatic: { type: Boolean, default: false },
  markedBy: { type: String, enum: ['student', 'admin'], default: 'student' },
}, { timestamps: true });

// Unique: one attendance per student per lecture
attendanceSchema.index({ lecture: 1, student: 1 }, { unique: true });
attendanceSchema.index({ lecture: 1, studentId: 1 }, { unique: true, sparse: true });
attendanceSchema.index({ subject: 1, student: 1, markedAt: -1 });
attendanceSchema.index({ subject: 1, studentId: 1, markedAt: -1 });
attendanceSchema.index({ lecture: 1, status: 1 });
attendanceSchema.index({ student: 1, markedAt: -1 });
attendanceSchema.index({ subject: 1, status: 1 });
attendanceSchema.index({ subject: 1, status: 1, createdAt: 1 });
attendanceSchema.index({ subject: 1, status: 1, lecture: 1, student: 1 });
attendanceSchema.index({ student: 1, subject: 1, status: 1 });
attendanceSchema.index({ capturedImagePublicId: 1, markedAt: 1 });

module.exports = mongoose.model('Attendance', attendanceSchema);
