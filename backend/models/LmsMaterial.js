const mongoose = require('mongoose');

const lmsMaterialSchema = new mongoose.Schema({
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  resourceType: { type: String, enum: ['file', 'link', 'note'], default: 'note' },
  fileUrl: { type: String, default: '' },
  fileName: { type: String, default: '' },
  fileSize: { type: Number, default: 0 },
  attachments: [{
    type: { type: String, enum: ['file', 'link', 'video', 'audio', 'image', 'document', 'note'], default: 'file' },
    title: { type: String, default: '', trim: true },
    url: { type: String, default: '', trim: true },
    fileName: { type: String, default: '', trim: true },
    fileSize: { type: Number, default: 0 },
    publicId: { type: String, default: '', trim: true },
    resourceType: { type: String, enum: ['image', 'video', 'raw'], default: 'raw' },
    visibility: { type: String, enum: ['view', 'download'], default: 'view' }
  }],
  filePublicId: { type: String, default: '', trim: true },
  fileResourceType: { type: String, enum: ['image', 'video', 'raw'], default: 'raw' },
  linkUrl: { type: String, default: '', trim: true },
  tags: [{ type: String, trim: true }],
  folder: { type: String, default: '', trim: true, index: true },
  topic: { type: String, default: '', trim: true, index: true },
  category: { type: String, enum: ['notes', 'slides', 'reading', 'reference', 'lab', 'video', 'other'], default: 'notes', index: true },
  isPinned: { type: Boolean, default: false, index: true },
  order: { type: Number, default: 0 },
  archivedAt: { type: Date },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isActive: { type: Boolean, default: true, index: true },
  isPublished: { type: Boolean, default: false, index: true },
  status: { type: String, enum: ['draft', 'scheduled', 'published', 'archived'], default: 'draft', index: true },
  scheduledPublishAt: { type: Date },
  publishedAt: { type: Date },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

lmsMaterialSchema.index({ subject: 1, isPinned: -1, order: 1, createdAt: -1 });

module.exports = mongoose.model('LmsMaterial', lmsMaterialSchema);
