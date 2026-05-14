const Lecture = require('../models/Lecture');

const getLectureEndDateTime = (lecture) => {
  if (!lecture?.date || !lecture?.endTime) return null;
  const [hours, minutes] = String(lecture.endTime).split(':').map(Number);
  const end = new Date(lecture.date);
  end.setHours(hours || 0, minutes || 0, 0, 0);
  return end;
};

const getAttendanceExpiry = (lecture, durationMinutes = null) => {
  if (durationMinutes && Number(durationMinutes) > 0) {
    return new Date(Date.now() + Number(durationMinutes) * 60 * 1000);
  }

  const lectureEnd = getLectureEndDateTime(lecture);
  if (lectureEnd && lectureEnd > new Date()) return lectureEnd;

  return new Date(Date.now() + 60 * 60 * 1000);
};

const closeExpiredAttendance = async (io = null) => {
  const now = new Date();
  const openLectures = await Lecture.find({ attendanceOpen: true }).select('_id date endTime codeExpiresAt attendanceOpenedAt');
  const expiredLectures = openLectures.filter(lecture => {
    const codeExpired = lecture.codeExpiresAt && lecture.codeExpiresAt <= now;
    const lectureEnd = getLectureEndDateTime(lecture);
    const normalLectureWindow = !lecture.attendanceOpenedAt || !lectureEnd || lecture.attendanceOpenedAt <= lectureEnd;
    const lectureEnded = normalLectureWindow && lectureEnd && lectureEnd <= now;
    return codeExpired || lectureEnded;
  });

  if (expiredLectures.length === 0) return 0;

  const ids = expiredLectures.map(lecture => lecture._id);
  await Lecture.updateMany(
    { _id: { $in: ids } },
    {
      $set: {
        attendanceOpen: false,
        attendanceClosedAt: now,
        status: 'completed'
      }
    }
  );

  if (io) {
    ids.forEach(id => io.emit('attendance_closed', { lectureId: id, automatic: true }));
  }

  return ids.length;
};

module.exports = { closeExpiredAttendance, getAttendanceExpiry };
