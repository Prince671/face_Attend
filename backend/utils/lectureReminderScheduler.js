const Lecture = require('../models/Lecture');
const Notification = require('../models/Notification');

const REMINDER_BEFORE_MINUTES = Number(process.env.LECTURE_REMINDER_BEFORE_MINUTES || 5);
const WINDOW_AFTER_MS = Number(process.env.LECTURE_REMINDER_WINDOW_MS || 90 * 1000);
const APP_TIMEZONE_OFFSET_MINUTES = Number(process.env.APP_TIMEZONE_OFFSET_MINUTES || 330);

const getLectureStartMs = (lecture) => {
  if (!lecture?.date || !lecture?.startTime) return null;
  const date = new Date(lecture.date);
  const [hours, minutes] = String(lecture.startTime || '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes) -
    (APP_TIMEZONE_OFFSET_MINUTES * 60 * 1000);
};

const formatRoom = (description = '') => {
  const match = String(description).match(/Room:\s*([^|]+)/i);
  return match ? match[1].trim() : '';
};

const emitNotification = (io, notification) => {
  if (!io || !notification?.recipient) return;
  io.to(`user_${notification.recipient}`).emit('notification_created', notification);
};

const sendUpcomingLectureReminders = async (io) => {
  const now = Date.now();
  const targetStart = now + (REMINDER_BEFORE_MINUTES * 60 * 1000);
  const targetEnd = targetStart + WINDOW_AFTER_MS;
  const scanStart = new Date(now - 24 * 60 * 60 * 1000);
  const scanEnd = new Date(now + 24 * 60 * 60 * 1000);

  const lectures = await Lecture.find({
    pendingDeletion: { $ne: true },
    reminderSentAt: { $exists: false },
    status: { $in: ['scheduled', 'ongoing'] },
    date: { $gte: scanStart, $lte: scanEnd }
  }).populate('subject', 'name code semester branch department assignedTeachers').limit(200);

  for (const lecture of lectures) {
    const lectureStart = getLectureStartMs(lecture);
    if (!lectureStart || lectureStart < targetStart || lectureStart > targetEnd) continue;

    const teacherIds = [...new Set((lecture.subject?.assignedTeachers || []).map(id => String(id)).filter(Boolean))];
    const room = formatRoom(lecture.description);
    const notifications = await Promise.all(teacherIds.map(teacherId => Notification.create({
      recipient: teacherId,
      recipientRole: 'teacher',
      type: 'lecture_reminder',
      title: 'Lecture starts soon',
      message: `Your ${lecture.subject?.name || lecture.title} lecture for Semester ${lecture.subject?.semester || ''} starts at ${lecture.startTime}${room ? ` in ${room}` : ''}.`,
      data: {
        lectureId: lecture._id,
        subjectId: lecture.subject?._id,
        subjectName: lecture.subject?.name || lecture.title,
        semester: lecture.subject?.semester,
        branch: lecture.subject?.branch,
        room,
        startTime: lecture.startTime,
        endTime: lecture.endTime
      },
      priority: 'high'
    })));

    await Lecture.updateOne({ _id: lecture._id, reminderSentAt: { $exists: false } }, { reminderSentAt: new Date() });
    notifications.forEach(notification => emitNotification(io, notification));
  }
};

module.exports = { sendUpcomingLectureReminders };
