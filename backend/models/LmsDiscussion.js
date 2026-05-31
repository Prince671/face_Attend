const mongoose = require('mongoose');

const lmsDiscussionSchema = new mongoose.Schema({
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  studentId: { type: String, trim: true, uppercase: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  message: { type: String, required: true, trim: true, maxlength: 2000 },
  status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
  lastReplyAt: { type: Date },
  lastReplyBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resolvedAt: { type: Date },
  resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

lmsDiscussionSchema.index({ subject: 1, status: 1, updatedAt: -1 });
lmsDiscussionSchema.index({ student: 1, subject: 1, createdAt: -1 });
lmsDiscussionSchema.index({ studentId: 1, subject: 1, createdAt: -1 });

module.exports = mongoose.model('LmsDiscussion', lmsDiscussionSchema);
