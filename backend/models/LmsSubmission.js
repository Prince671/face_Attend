const mongoose = require('mongoose');

const lmsSubmissionSchema = new mongoose.Schema({
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'LmsAssignment', required: true, index: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  studentId: { type: String, trim: true, uppercase: true, index: true },
  text: { type: String, default: '', trim: true },
  fileUrl: { type: String, default: '' },
  fileName: { type: String, default: '' },
  attachments: [{
    url: { type: String, default: '' },
    type: { type: String, default: 'file' },
    title: { type: String, default: '', trim: true },
    fileName: { type: String, default: '', trim: true },
    fileSize: { type: Number, default: 0 },
    publicId: { type: String, default: '', trim: true },
    resourceType: { type: String, enum: ['image', 'video', 'raw'], default: 'raw' },
    visibility: { type: String, enum: ['view', 'download', 'student_copy'], default: 'download' }
  }],
  filePublicId: { type: String, default: '', trim: true },
  fileResourceType: { type: String, enum: ['image', 'video', 'raw'], default: 'raw' },
  status: { type: String, enum: ['submitted', 'graded', 'returned', 'missing', 'late'], default: 'submitted', index: true },
  isLate: { type: Boolean, default: false, index: true },
  isLocked: { type: Boolean, default: true },
  marks: { type: Number, default: null },
  feedback: { type: String, default: '', trim: true },
  rubricScores: [{
    criterionTitle: { type: String, default: '', trim: true },
    levelTitle: { type: String, default: '', trim: true },
    points: { type: Number, default: 0 }
  }],
  gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  gradedAt: { type: Date },
  returnedAt: { type: Date },
  returnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

lmsSubmissionSchema.index({ assignment: 1, student: 1 }, { unique: true });
lmsSubmissionSchema.index({ assignment: 1, studentId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('LmsSubmission', lmsSubmissionSchema);
