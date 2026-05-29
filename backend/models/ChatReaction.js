const mongoose = require('mongoose');

const chatReactionSchema = new mongoose.Schema({
  message: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', required: true, index: true },
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatGroup', required: true, index: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  emoji: { type: String, required: true, trim: true, maxlength: 16 },
}, { timestamps: true });

chatReactionSchema.index({ message: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('ChatReaction', chatReactionSchema);
