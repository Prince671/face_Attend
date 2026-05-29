const mongoose = require('mongoose');

const lmsPrivateCommentSchema = new mongoose.Schema({
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'LmsAssignment', required: true, index: true },
  submission: { type: mongoose.Schema.Types.ObjectId, ref: 'LmsSubmission', required: true, index: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorRole: { type: String, enum: ['student', 'teacher', 'admin'], required: true },
  message: { type: String, required: true, trim: true }
}, { timestamps: true });

lmsPrivateCommentSchema.index({ submission: 1, createdAt: 1 });

module.exports = mongoose.model('LmsPrivateComment', lmsPrivateCommentSchema);
