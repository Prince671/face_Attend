const mongoose = require('mongoose');

const chatActivitySchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true, trim: true, maxlength: 80 },
  label: { type: String, required: true, trim: true, maxlength: 240 },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

chatActivitySchema.index({ group: 1, createdAt: -1 });

module.exports = mongoose.model('ChatActivity', chatActivitySchema);
