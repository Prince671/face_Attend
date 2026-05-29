const mongoose = require('mongoose');

const chatReportSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
  message: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', index: true },
  reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reason: { type: String, trim: true, maxlength: 500 },
  status: { type: String, enum: ['open', 'reviewed', 'dismissed'], default: 'open', index: true },
}, { timestamps: true });

chatReportSchema.index({ group: 1, createdAt: -1 });
chatReportSchema.index({ message: 1, reporter: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('ChatReport', chatReportSchema);
