const mongoose = require('mongoose');

const otpVerificationSchema = new mongoose.Schema({
  purpose: {
    type: String,
    enum: ['student_registration', 'forgot_password', 'student_email_update'],
    required: true,
    index: true
  },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  emailOtpHash: { type: String },
  emailVerified: { type: Boolean, default: false },
  resetTokenHash: { type: String },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
  verifiedAt: { type: Date },
  consumedAt: { type: Date }
}, { timestamps: true });

otpVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpVerificationSchema.index({ purpose: 1, email: 1, consumedAt: 1, createdAt: -1 });

module.exports = mongoose.model('OtpVerification', otpVerificationSchema);
