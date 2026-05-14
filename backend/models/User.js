const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  role: { type: String, enum: ['admin', 'student'], default: 'student' },
  studentId: { type: String, unique: true, sparse: true },
  department: { type: String },
  semester: { type: Number, min: 1, max: 8 },
  fatherName: { type: String, trim: true },
  dateOfBirth: { type: Date },
  profileImage: { type: String },           // Cloudinary URL for passport photo
  profileImagePublicId: { type: String },
  faceEncoding: { type: [Number] },          // 128-dim face vector from ML
  faceImagePath: { type: String },           // Cloudinary URL used to rebuild face data if needed
  status: {
    type: String,
    enum: ['pending', 'active', 'inactive', 'restricted'],
    default: 'pending'
  },
  isRestricted: { type: Boolean, default: false },
  restrictionReason: { type: String },
  enrolledSubjects: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Subject' }],
  createdAt: { type: Date, default: Date.now },
  approvedAt: { type: Date },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  adminAcademicYear: { type: Number, min: 1, max: 4 },
  adminSemesterScope: { type: Number, min: 1, max: 8 },
  adminScopeSetAt: { type: Date },
  lastLogin: { type: Date },
  phone: { type: String },
  address: { type: String },
  pendingDeletion: { type: Boolean, default: false, index: true },
  deletionScheduledAt: { type: Date },
  deletionExpiresAt: { type: Date },
  biometricCredential: {
    credentialId: { type: String, index: true },
    publicKeyJwk: { type: mongoose.Schema.Types.Mixed },
    counter: { type: Number, default: 0 },
    transports: [{ type: String }],
    registeredAt: { type: Date },
    deviceName: { type: String }
  },
  biometricChallenge: { type: String, select: false },
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.toSafeObject = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.faceEncoding;
  return obj;
};

userSchema.index({ role: 1, status: 1, pendingDeletion: 1 });
userSchema.index({ role: 1, department: 1, semester: 1, status: 1, pendingDeletion: 1 });
userSchema.index({ department: 1, semester: 1, pendingDeletion: 1 });
userSchema.index({ enrolledSubjects: 1, status: 1, pendingDeletion: 1 });
userSchema.index({ adminSemesterScope: 1, department: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);
