const mongoose = require('mongoose');

const holidaySchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  date: { type: Date, required: true, index: true },
  endDate: { type: Date },
  startTime: { type: String, default: '', trim: true },
  endTime: { type: String, default: '', trim: true },
  type: { type: String, enum: ['holiday', 'event', 'exam', 'other'], default: 'holiday' },
  course: { type: String, default: '', trim: true },
  department: { type: String, default: '', trim: true },
  branch: { type: String, default: '', trim: true },
  semester: { type: Number, min: 1, max: 8 },
  scopes: [{
    course: { type: String, default: '', trim: true },
    department: { type: String, default: '', trim: true },
    branch: { type: String, default: '', trim: true },
    semester: { type: Number, min: 1, max: 8 },
  }],
  appliesToAll: { type: Boolean, default: true },
  notes: { type: String, default: '', trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

holidaySchema.index({ date: 1, endDate: 1, department: 1, branch: 1, semester: 1 });
holidaySchema.index({ 'scopes.department': 1, 'scopes.branch': 1, 'scopes.semester': 1 });

module.exports = mongoose.model('Holiday', holidaySchema);
