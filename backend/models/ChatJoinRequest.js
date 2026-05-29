const mongoose = require('mongoose');

const chatJoinRequestSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  requestedByInviteCode: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },
}, { timestamps: true });

chatJoinRequestSchema.index({ group: 1, user: 1, status: 1 });
chatJoinRequestSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('ChatJoinRequest', chatJoinRequestSchema);
