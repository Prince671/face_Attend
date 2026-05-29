const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  url: { type: String, required: true },
  name: { type: String, default: '' },
  mimeType: { type: String, default: '' },
  size: { type: Number, default: 0 },
  kind: { type: String, enum: ['image', 'gif', 'video', 'audio', 'voice', 'document', 'file'], default: 'file' },
  duration: { type: Number },
  publicId: { type: String, default: '' },
  resourceType: { type: String, enum: ['image', 'video', 'raw'], default: 'raw' },
}, { _id: false });

const pollOptionSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true, maxlength: 160 },
  votes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { _id: true });

const chatMessageSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: { type: String, enum: ['text', 'media', 'system', 'poll'], default: 'text' },
  text: { type: String, default: '', maxlength: 5000 },
  attachments: [attachmentSchema],
  poll: {
    question: { type: String, trim: true, maxlength: 500 },
    options: [pollOptionSchema],
    allowMultiple: { type: Boolean, default: false },
    anonymous: { type: Boolean, default: false },
    showVoters: { type: Boolean, default: true },
    closesAt: { type: Date },
  },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage' },
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  editHistory: [{
    text: { type: String, default: '' },
    editedAt: { type: Date, default: Date.now },
  }],
  editedAt: { type: Date },
  deletedAt: { type: Date },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reportedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  starredBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isDeleted: { type: Boolean, default: false, index: true },
  isForwarded: { type: Boolean, default: false },
  isImportant: { type: Boolean, default: false },
  importantBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isPinned: { type: Boolean, default: false },
  pinnedUntil: { type: Date },
  scheduledFor: { type: Date },
  deliveredAt: { type: Date },
  expiresAt: { type: Date },
  systemEvent: { type: String, enum: ['member_left', 'member_added', 'group_created', 'group_updated', 'member_promoted', 'member_removed', 'message'], default: 'message' },
}, { timestamps: true });

chatMessageSchema.index({ group: 1, createdAt: -1 });
chatMessageSchema.index({ sender: 1, createdAt: -1 });
chatMessageSchema.index({ group: 1, scheduledFor: 1, deliveredAt: 1 });
chatMessageSchema.index({ group: 1, expiresAt: 1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
