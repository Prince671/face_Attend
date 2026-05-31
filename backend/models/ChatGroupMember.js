const mongoose = require('mongoose');

const chatGroupMemberSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userStudentId: { type: String, trim: true, uppercase: true, index: true },
  role: { type: String, enum: ['admin', 'member'], default: 'member' },
  joinedAt: { type: Date, default: Date.now },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  leftAt: { type: Date },
  isActive: { type: Boolean, default: true, index: true },
  lastReadMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage' },
  lastReadAt: { type: Date },
  clearedAt: { type: Date },
  isPinned: { type: Boolean, default: false },
  isArchived: { type: Boolean, default: false },
  isHidden: { type: Boolean, default: false },
  lockCode: { type: String, default: '' },
  draftText: { type: String, default: '', maxlength: 5000 },
  hidePresence: { type: Boolean, default: false },
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

chatGroupMemberSchema.index({ group: 1, user: 1 }, { unique: true });
chatGroupMemberSchema.index({ group: 1, userStudentId: 1 }, { unique: true, sparse: true });
chatGroupMemberSchema.index({ user: 1, isActive: 1, updatedAt: -1 });
chatGroupMemberSchema.index({ userStudentId: 1, isActive: 1, updatedAt: -1 });

module.exports = mongoose.model('ChatGroupMember', chatGroupMemberSchema);
