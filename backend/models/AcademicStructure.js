const mongoose = require('mongoose');

const branchSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  department: { type: String, required: true, trim: true },
  subjectBranch: { type: String, default: '', trim: true },
  semesters: [{ type: Number, min: 1, max: 12 }],
  isActive: { type: Boolean, default: true }
});

const academicStructureSchema = new mongoose.Schema({
  course: { type: String, required: true, trim: true, unique: true },
  branches: [branchSchema],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

academicStructureSchema.index({ course: 1, isActive: 1 });

module.exports = mongoose.model('AcademicStructure', academicStructureSchema);
