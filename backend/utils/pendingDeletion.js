const PendingDeletion = require('../models/PendingDeletion');
const User = require('../models/User');
const Subject = require('../models/Subject');
const Lecture = require('../models/Lecture');
const Attendance = require('../models/Attendance');
const { deleteImage } = require('./cloudinary');

const UNDO_WINDOW_MINUTES = Number(process.env.DELETE_UNDO_WINDOW_MINUTES || 10);

const getUndoExpiry = () => new Date(Date.now() + UNDO_WINDOW_MINUTES * 60 * 1000);

const cleanupCloudinaryPublicIds = async (publicIds = []) => {
  for (const publicId of publicIds.filter(Boolean)) {
    try {
      await deleteImage(publicId);
    } catch (err) {
      console.error(`Cloudinary cleanup failed for ${publicId}:`, err.message);
    }
  }
};

const schedulePendingDeletion = async ({ resourceType, resourceId, resourceName, targetDepartment, requestedBy }) => {
  const expiresAt = getUndoExpiry();
  await PendingDeletion.updateMany(
    { resourceType, resourceId, status: 'pending' },
    { status: 'undone', undoneAt: new Date() }
  );

  return PendingDeletion.create({
    resourceType,
    resourceId,
    resourceName,
    targetDepartment,
    requestedBy,
    expiresAt
  });
};

const undoPendingDeletion = async (id, actor) => {
  const deletion = await PendingDeletion.findById(id);
  if (!deletion || deletion.status !== 'pending') {
    const err = new Error('Undo is no longer available for this delete request.');
    err.statusCode = 404;
    throw err;
  }
  if (deletion.expiresAt <= new Date()) {
    const err = new Error('Undo time has expired.');
    err.statusCode = 410;
    throw err;
  }

  const clear = {
    pendingDeletion: false,
    deletionScheduledAt: null,
    deletionExpiresAt: null
  };

  if (deletion.resourceType === 'student') {
    await User.findByIdAndUpdate(deletion.resourceId, clear);
  } else if (deletion.resourceType === 'lecture') {
    await Lecture.findByIdAndUpdate(deletion.resourceId, clear);
  } else if (deletion.resourceType === 'subject') {
    await Subject.findByIdAndUpdate(deletion.resourceId, { ...clear, isActive: true });
    const subject = await Subject.findById(deletion.resourceId).select('department semester');
    if (subject) {
      await User.updateMany(
        {
          role: 'student',
          status: 'active',
          pendingDeletion: { $ne: true },
          department: subject.department,
          semester: Number(subject.semester)
        },
        { $addToSet: { enrolledSubjects: subject._id } }
      );
    }
  }

  deletion.status = 'undone';
  deletion.undoneAt = new Date();
  await deletion.save();
  return deletion;
};

const finalizeStudentDeletion = async (deletion) => {
  const student = await User.findById(deletion.resourceId);
  if (!student) return;
  const attendance = await Attendance.find({ student: student._id }).select('capturedImagePublicId');
  await cleanupCloudinaryPublicIds([
    student.profileImagePublicId,
    ...attendance.map(item => item.capturedImagePublicId)
  ]);
  await Attendance.deleteMany({ student: student._id });
  await User.findByIdAndDelete(student._id);
};

const finalizeLectureDeletion = async (deletion) => {
  const attendance = await Attendance.find({ lecture: deletion.resourceId }).select('capturedImagePublicId');
  await cleanupCloudinaryPublicIds(attendance.map(item => item.capturedImagePublicId));
  await Attendance.deleteMany({ lecture: deletion.resourceId });
  await Lecture.findByIdAndDelete(deletion.resourceId);
};

const finalizeSubjectDeletion = async (deletion) => {
  const lectures = await Lecture.find({ subject: deletion.resourceId }).select('_id');
  const lectureIds = lectures.map(lecture => lecture._id);
  const attendance = await Attendance.find({
    $or: [
      { subject: deletion.resourceId },
      { lecture: { $in: lectureIds } }
    ]
  }).select('capturedImagePublicId');

  await cleanupCloudinaryPublicIds(attendance.map(item => item.capturedImagePublicId));
  await Attendance.deleteMany({
    $or: [
      { subject: deletion.resourceId },
      { lecture: { $in: lectureIds } }
    ]
  });
  await Lecture.deleteMany({ subject: deletion.resourceId });
  await User.updateMany(
    { enrolledSubjects: deletion.resourceId },
    { $pull: { enrolledSubjects: deletion.resourceId } }
  );
  await Subject.findByIdAndDelete(deletion.resourceId);
};

const finalizePendingDeletion = async (deletion) => {
  if (deletion.resourceType === 'student') await finalizeStudentDeletion(deletion);
  else if (deletion.resourceType === 'lecture') await finalizeLectureDeletion(deletion);
  else if (deletion.resourceType === 'subject') await finalizeSubjectDeletion(deletion);

  deletion.status = 'completed';
  deletion.completedAt = new Date();
  await deletion.save();
};

const processExpiredPendingDeletions = async (limit = 25) => {
  const expired = await PendingDeletion.find({
    status: 'pending',
    expiresAt: { $lte: new Date() }
  }).sort({ expiresAt: 1 }).limit(limit);

  for (const deletion of expired) {
    try {
      await finalizePendingDeletion(deletion);
    } catch (err) {
      console.error(`Pending deletion failed (${deletion._id}):`, err.message);
    }
  }

  return { processed: expired.length };
};

module.exports = {
  UNDO_WINDOW_MINUTES,
  schedulePendingDeletion,
  undoPendingDeletion,
  processExpiredPendingDeletions
};
