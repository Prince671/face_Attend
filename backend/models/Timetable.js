const mongoose = require('mongoose');

const slotSchema = new mongoose.Schema({
  day: { type: String, required: true },
  semester: { type: Number, required: true, min: 1, max: 8 },
  branch: { type: String, default: '', trim: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
  title: { type: String },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  room: { type: String },
  faculty: { type: String },
  isLab: { type: Boolean, default: false },
  labNumber: { type: String, enum: ['', 'LAB1', 'LAB2', 'LAB3'], default: '' },
}, { _id: true });

const timetableSchema = new mongoose.Schema({
  department: { type: String, required: true, unique: true, index: true },
  title: { type: String, default: 'Department Timetable' },
  imageUrl: { type: String },
  imagePublicId: { type: String },
  uploadType: { type: String, enum: ['image', 'spreadsheet'], default: 'image' },
  originalFileName: { type: String },
  slots: [slotSchema],
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  analyzedAt: { type: Date },
  generatedFrom: { type: Date },
  generatedThrough: { type: Date },
}, { timestamps: true });

timetableSchema.index({ department: 1, updatedAt: -1 });
timetableSchema.index({ 'slots.semester': 1, department: 1 });

module.exports = mongoose.model('Timetable', timetableSchema);
