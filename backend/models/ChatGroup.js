const mongoose = require('mongoose');

const chatGroupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, trim: true, maxlength: 240 },
  avatarUrl: { type: String, default: '' },
  avatarPublicId: { type: String, default: '' },
  avatarResourceType: { type: String, enum: ['image', 'video', 'raw'], default: 'image' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  department: { type: String, required: true, index: true },
  branch: { type: String, default: '', trim: true },
  semester: { type: Number, required: true, index: true },
  chatMode: { type: String, enum: ['everyone', 'admins_only'], default: 'everyone' },
  inviteCode: { type: String, default: '', index: true },
  inviteEnabled: { type: Boolean, default: true },
  inviteExpiresAt: { type: Date },
  inviteMaxUses: { type: Number, default: 0, min: 0 },
  inviteUses: { type: Number, default: 0, min: 0 },
  inviteRequireApproval: { type: Boolean, default: false },
  autoDeleteAfterHours: { type: Number, default: 0, min: 0 },
  showSystemMessages: { type: Boolean, default: true },
  permissions: {
    editInfo: { type: String, enum: ['admins', 'members'], default: 'admins' },
    sendMessages: { type: String, enum: ['admins', 'members'], default: 'members' },
    addMembers: { type: String, enum: ['admins', 'members'], default: 'admins' },
    pinMessages: { type: String, enum: ['admins', 'members'], default: 'admins' },
  },
  pinnedMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage' },
  lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage' },
  lastMessageAt: { type: Date },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date },
}, { timestamps: true });

chatGroupSchema.index({ department: 1, branch: 1, semester: 1, isDeleted: 1, updatedAt: -1 });
chatGroupSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model('ChatGroup', chatGroupSchema);
