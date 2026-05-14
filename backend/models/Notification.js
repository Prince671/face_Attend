const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  recipientRole: { type: String, enum: ['admin', 'student', 'all'] },
  type: {
    type: String,
    enum: [
      'registration_request',
      'account_approved',
      'account_rejected',
      'account_deactivated',
      'account_restricted',
      'unwanted_student_detected',
      'attendance_opened',
      'attendance_marked',
      'attendance_closed',
      'lecture_created',
      'general'
    ]
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipientRole: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipientRole: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ deletedFor: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
