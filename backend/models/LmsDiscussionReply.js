const mongoose = require('mongoose');

const lmsDiscussionReplySchema = new mongoose.Schema({
  discussion: { type: mongoose.Schema.Types.ObjectId, ref: 'LmsDiscussion', required: true, index: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  authorRole: { type: String, enum: ['admin', 'teacher', 'student'], required: true },
  message: { type: String, required: true, trim: true, maxlength: 2000 },
}, { timestamps: true });

lmsDiscussionReplySchema.index({ discussion: 1, createdAt: 1 });

module.exports = mongoose.model('LmsDiscussionReply', lmsDiscussionReplySchema);
