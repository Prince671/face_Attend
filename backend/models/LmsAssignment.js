const mongoose = require('mongoose');

const lmsAssignmentSchema = new mongoose.Schema({
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  dueDate: { type: Date },
  dueTime: { type: String, default: '' },
  maxMarks: { type: Number, default: 10, min: 0 },
  isUngraded: { type: Boolean, default: false },
  gradeCategory: { type: String, enum: ['homework', 'practical', 'project', 'internal', 'essay', 'other'], default: 'homework', index: true },
  submissionMode: { type: String, enum: ['offline', 'online'], default: 'offline', index: true },
  allowResubmission: { type: Boolean, default: false },
  acceptLateSubmissions: { type: Boolean, default: false },
  fileUrl: { type: String, default: '' },
  fileName: { type: String, default: '' },
  attachments: [{
    type: { type: String, enum: ['file', 'link', 'video', 'audio', 'image', 'document', 'note'], default: 'file' },
    title: { type: String, default: '', trim: true },
    url: { type: String, default: '', trim: true },
    fileName: { type: String, default: '', trim: true },
    fileSize: { type: Number, default: 0 },
    publicId: { type: String, default: '', trim: true },
    resourceType: { type: String, enum: ['image', 'video', 'raw'], default: 'raw' },
    visibility: { type: String, enum: ['view', 'download', 'student_copy'], default: 'view' }
  }],
  filePublicId: { type: String, default: '', trim: true },
  fileResourceType: { type: String, enum: ['image', 'video', 'raw'], default: 'raw' },
  tags: [{ type: String, trim: true }],
  topic: { type: String, default: '', trim: true, index: true },
  status: { type: String, enum: ['draft', 'scheduled', 'published', 'closed', 'returned'], default: 'draft', index: true },
  rubric: [{
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    levels: [{
      title: { type: String, required: true, trim: true },
      description: { type: String, default: '', trim: true },
      points: { type: Number, default: 0, min: 0 }
    }]
  }],
  rubricLocked: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isPublished: { type: Boolean, default: false, index: true },
  scheduledPublishAt: { type: Date },
  publishedAt: { type: Date },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reminderSentAt: { type: Date },
  submissionSummarySentAt: { type: Date }
}, { timestamps: true });

lmsAssignmentSchema.index({ subject: 1, dueDate: 1, createdAt: -1 });

module.exports = mongoose.model('LmsAssignment', lmsAssignmentSchema);
