const mongoose = require('mongoose');

const lmsQuizAttemptSchema = new mongoose.Schema({
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: 'LmsQuiz', required: true, index: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  answers: [{
    question: { type: mongoose.Schema.Types.ObjectId },
    selectedIndex: { type: Number, default: -1 },
    selectedIndexes: [{ type: Number }],
    textAnswer: { type: String, default: '', trim: true },
    awardedMarks: { type: Number, default: 0 },
    feedback: { type: String, default: '', trim: true },
    reviewStatus: { type: String, enum: ['auto_graded', 'needs_review', 'reviewed'], default: 'auto_graded' }
  }],
  score: { type: Number, default: 0 },
  totalMarks: { type: Number, default: 0 },
  status: { type: String, enum: ['submitted', 'auto_submitted', 'needs_review', 'reviewed'], default: 'submitted', index: true },
  gradingSource: { type: String, enum: ['auto', 'manual', 'mixed'], default: 'auto' },
  startedAt: { type: Date },
  timeSpentSeconds: { type: Number, default: 0, min: 0 },
  tabSwitchCount: { type: Number, default: 0, min: 0 },
  tabSwitches: [{
    occurredAt: { type: Date, default: Date.now },
    reason: { type: String, default: 'visibility_hidden', trim: true }
  }],
  antiCheatFlags: [{ type: String, trim: true }],
  submittedAt: { type: Date, default: Date.now }
}, { timestamps: true });

lmsQuizAttemptSchema.index({ quiz: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('LmsQuizAttempt', lmsQuizAttemptSchema);
