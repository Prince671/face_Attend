const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  recipientRole: { type: String, enum: ['admin', 'student', 'teacher', 'all'] },
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
      'lecture_reminder',
      'teacher_assignment',
      'subject_classes_stopped',
      'subject_classes_resumed',
      'low_attendance_alert',
      'attendance_dispute_created',
      'attendance_dispute_resolved',
      'student_profile_update_request',
      'student_profile_update_resolved',
      'lms_material_added',
      'lms_assignment_created',
      'lms_assignment_due',
      'lms_assignment_submitted',
      'lms_assignment_deadline_summary',
      'lms_assignment_graded',
      'lms_quiz_created',
      'lms_quiz_due',
      'lms_quiz_submitted',
      'lms_quiz_deadline_summary',
      'lms_quiz_released',
      'lms_announcement',
      'lms_discussion_created',
      'lms_discussion_replied',
      'chat_mention',
      'chat_report',
      'academic_calendar',
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
  autoDeleteProtectedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipientRole: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipientRole: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ deletedFor: 1 });
notificationSchema.index({ createdAt: 1, autoDeleteProtectedBy: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
