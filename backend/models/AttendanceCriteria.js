const mongoose = require('mongoose');

const attendanceCriteriaSchema = new mongoose.Schema({
  course: { type: String, default: '', trim: true },
  department: { type: String, required: true, trim: true, index: true },
  branch: { type: String, default: '', trim: true, index: true },
  semester: { type: Number, required: true, min: 1, max: 12, index: true },
  minimumPercentage: { type: Number, required: true, min: 1, max: 100, default: 75 },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

attendanceCriteriaSchema.index({ department: 1, branch: 1, semester: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceCriteria', attendanceCriteriaSchema);
