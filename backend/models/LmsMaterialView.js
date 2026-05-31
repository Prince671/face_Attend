const mongoose = require('mongoose');

const lmsMaterialViewSchema = new mongoose.Schema({
  material: { type: mongoose.Schema.Types.ObjectId, ref: 'LmsMaterial', required: true, index: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  studentId: { type: String, trim: true, uppercase: true, index: true },
  viewedAt: { type: Date, default: Date.now }
}, { timestamps: true });

lmsMaterialViewSchema.index({ material: 1, student: 1 }, { unique: true });
lmsMaterialViewSchema.index({ material: 1, studentId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('LmsMaterialView', lmsMaterialViewSchema);
