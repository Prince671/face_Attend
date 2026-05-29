const mongoose = require('mongoose');

const lmsMaterialViewSchema = new mongoose.Schema({
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'LmsMaterial', required: true, index: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  viewedAt: { type: Date, default: Date.now }
}, { timestamps: true });

lmsMaterialViewSchema.index({ material: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('LmsMaterialView', lmsMaterialViewSchema);
