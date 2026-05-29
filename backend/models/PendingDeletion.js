const mongoose = require('mongoose');

const pendingDeletionSchema = new mongoose.Schema({
  resourceType: {
    type: String,
    enum: ['student', 'lecture', 'subject', 'teacher'],
    required: true,
    index: true
  },
  resourceId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  resourceName: { type: String, required: true },
  targetDepartment: { type: String },
  batchId: { type: String, index: true },
  batchName: { type: String },
  batchCount: { type: Number },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: {
    type: String,
    enum: ['pending', 'undone', 'completed'],
    default: 'pending',
    index: true
  },
  expiresAt: { type: Date, required: true, index: true },
  completedAt: { type: Date },
  undoneAt: { type: Date },
}, { timestamps: true });

pendingDeletionSchema.index({ resourceType: 1, resourceId: 1, status: 1 });
pendingDeletionSchema.index({ batchId: 1, status: 1, expiresAt: 1 });

module.exports = mongoose.model('PendingDeletion', pendingDeletionSchema);
