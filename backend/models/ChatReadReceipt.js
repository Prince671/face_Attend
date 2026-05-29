const mongoose = require('mongoose');

const chatReadReceiptSchema = new mongoose.Schema({
  message: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', required: true, index: true },
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  readAt: { type: Date, default: Date.now },
}, { timestamps: true });

chatReadReceiptSchema.index({ message: 1, user: 1 }, { unique: true });
chatReadReceiptSchema.index({ group: 1, user: 1, readAt: -1 });

module.exports = mongoose.model('ChatReadReceipt', chatReadReceiptSchema);
