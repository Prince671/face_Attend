const mongoose = require('mongoose');

const lmsAnnouncementSchema = new mongoose.Schema({
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', index: true },
  department: { type: String, default: '', index: true },
  branch: { type: String, default: '', trim: true },
  semester: { type: Number, min: 1, max: 8 },
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

lmsAnnouncementSchema.index({ subject: 1, createdAt: -1 });
lmsAnnouncementSchema.index({ department: 1, branch: 1, semester: 1, createdAt: -1 });

module.exports = mongoose.model('LmsAnnouncement', lmsAnnouncementSchema);
