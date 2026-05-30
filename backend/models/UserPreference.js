const mongoose = require('mongoose');

const userPreferenceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  key: { type: String, required: true, trim: true, maxlength: 80 },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: true });

userPreferenceSchema.index({ user: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('UserPreference', userPreferenceSchema);
