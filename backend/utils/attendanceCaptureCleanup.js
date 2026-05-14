const Attendance = require('../models/Attendance');
const { deleteImage } = require('./cloudinary');

const CAPTURE_TTL_HOURS = Number(process.env.ATTENDANCE_CAPTURE_TTL_HOURS || 24);
const DEFAULT_BATCH_SIZE = Number(process.env.ATTENDANCE_CAPTURE_CLEANUP_BATCH || 50);

const getCaptureExpiryDate = () => new Date(Date.now() - CAPTURE_TTL_HOURS * 60 * 60 * 1000);

const cleanupExpiredAttendanceCaptures = async (options = {}) => {
  const limit = Number(options.limit || DEFAULT_BATCH_SIZE);
  const expiredBefore = options.expiredBefore || getCaptureExpiryDate();

  const records = await Attendance.find({
    capturedImagePublicId: { $exists: true, $nin: [null, ''] },
    markedAt: { $lte: expiredBefore }
  })
    .select('_id capturedImagePublicId capturedImagePath markedAt')
    .sort({ markedAt: 1 })
    .limit(limit);

  let deleted = 0;
  let failed = 0;

  for (const record of records) {
    try {
      const result = await deleteImage(record.capturedImagePublicId);
      if (result.deleted) {
        record.capturedImagePath = '';
        record.capturedImagePublicId = '';
        await record.save();
        deleted += 1;
      } else {
        failed += 1;
        console.warn(`Attendance capture cleanup skipped ${record._id}: Cloudinary result ${result.result}`);
      }
    } catch (err) {
      failed += 1;
      console.error(`Attendance capture cleanup failed for ${record._id}:`, err.message);
    }
  }

  if (deleted || failed) {
    console.log(`Attendance capture cleanup finished: ${deleted} deleted, ${failed} failed`);
  }

  return { scanned: records.length, deleted, failed };
};

module.exports = {
  cleanupExpiredAttendanceCaptures,
  getCaptureExpiryDate,
  CAPTURE_TTL_HOURS
};
