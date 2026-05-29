const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true },
  isCorrect: { type: Boolean, default: false }
}, { _id: false });

const questionSchema = new mongoose.Schema({
  type: { type: String, enum: ['multiple_choice', 'checkbox', 'dropdown', 'short_answer', 'paragraph'], default: 'multiple_choice' },
  text: { type: String, required: true, trim: true },
  required: { type: Boolean, default: true },
  marks: { type: Number, default: 1, min: 0 },
  explanation: { type: String, default: '', trim: true },
  correctFeedback: { type: String, default: '', trim: true },
  wrongFeedback: { type: String, default: '', trim: true },
  answerKey: [{ type: String, trim: true }],
  shuffleOptions: { type: Boolean, default: false },
  options: [optionSchema]
}, { _id: true });

const lmsQuizSchema = new mongoose.Schema({
  subject: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  startAt: { type: Date },
  endAt: { type: Date },
  durationMinutes: { type: Number, default: 15, min: 1 },
  questions: [questionSchema],
  totalMarks: { type: Number, default: 0 },
  tags: [{ type: String, trim: true }],
  topic: { type: String, default: '', trim: true, index: true },
  releaseMode: { type: String, enum: ['manual', 'immediate'], default: 'manual' },
  showCorrectAnswers: { type: Boolean, default: true },
  showPointValues: { type: Boolean, default: true },
  showMissedQuestions: { type: Boolean, default: true },
  shuffleQuestions: { type: Boolean, default: false },
  oneQuestionAtATime: { type: Boolean, default: false },
  tabSwitchWarning: { type: Boolean, default: true },
  maxTabSwitchWarnings: { type: Number, default: 3, min: 0 },
  allowLateAttempt: { type: Boolean, default: false },
  attemptLimit: { type: Number, default: 1, min: 1 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  isPublished: { type: Boolean, default: false, index: true },
  status: { type: String, enum: ['draft', 'scheduled', 'published', 'closed', 'released'], default: 'draft', index: true },
  scheduledPublishAt: { type: Date },
  publishedAt: { type: Date },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resultsReleased: { type: Boolean, default: false, index: true },
  resultsReleasedAt: { type: Date },
  resultsReleasedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reminderSentAt: { type: Date },
  attemptSummarySentAt: { type: Date }
}, { timestamps: true });

lmsQuizSchema.pre('save', function(next) {
  this.totalMarks = (this.questions || []).reduce((sum, question) => sum + Number(question.marks || 0), 0);
  next();
});

lmsQuizSchema.index({ subject: 1, createdAt: -1 });

module.exports = mongoose.model('LmsQuiz', lmsQuizSchema);
