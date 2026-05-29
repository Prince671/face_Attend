const mongoose = require('mongoose');

const lmsMaterialFolderSchema = new mongoose.Schema({
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
  name: { type: String, required: true, trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  order: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

lmsMaterialFolderSchema.index({ subject: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('LmsMaterialFolder', lmsMaterialFolderSchema);
