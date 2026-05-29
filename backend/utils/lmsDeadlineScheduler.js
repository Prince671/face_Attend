const Subject = require('../models/Subject');
const User = require('../models/User');
const Notification = require('../models/Notification');
const LmsAssignment = require('../models/LmsAssignment');
const LmsSubmission = require('../models/LmsSubmission');
const LmsQuiz = require('../models/LmsQuiz');
const LmsQuizAttempt = require('../models/LmsQuizAttempt');
const { studentMatchesSubject, studentMatchForSubject } = require('./subjectEnrollment');
const { canReceiveSubjectUpdates } = require('./restrictionPolicy');

const ASSIGNMENT_REMINDER_HOURS = Number(process.env.LMS_ASSIGNMENT_REMINDER_HOURS || 24);
const QUIZ_REMINDER_MINUTES = Number(process.env.LMS_QUIZ_REMINDER_MINUTES || 30);

const getQuizCloseAt = (quiz) => {
  if (quiz.endAt) return new Date(quiz.endAt);
  if (quiz.startAt && quiz.durationMinutes) {
    return new Date(new Date(quiz.startAt).getTime() + Number(quiz.durationMinutes || 0) * 60 * 1000);
  }
  return null;
};

const emitNotification = (io, notification) => {
  if (!io || !notification?.recipient) return;
  io.to(`user_${notification.recipient}`).emit('notification_created', notification);
  io.to(`student_${notification.recipient}`).emit('notification_created', notification);
};

const emitLmsChange = (io, subject, type, payload = {}) => {
  if (!io || !subject?._id) return;
  const event = { subjectId: subject._id, type, ...payload };
  io.to('admin_room').emit('lms_changed', event);
  (subject.assignedTeachers || []).forEach(teacherId => io.to(`user_${teacherId}`).emit('lms_changed', event));
};

const getSubjectStudents = async (subject) => {
  const students = await User.find({
    ...studentMatchForSubject(subject),
    status: 'active',
    isRestricted: { $ne: true },
    pendingDeletion: { $ne: true },
    enrolledSubjects: subject._id
  }).select('_id role name studentId email department branch semester status isRestricted subjectRestrictions').lean();
  return students.filter(student => (
    studentMatchesSubject(student, subject) &&
    canReceiveSubjectUpdates(student, subject._id)
  ));
};

const createNotifications = async (io, rows) => {
  const payload = rows.filter(Boolean);
  if (!payload.length) return [];
  const created = await Notification.insertMany(payload, { ordered: false });
  created.forEach(notification => emitNotification(io, notification));
  return created;
};

const sendAssignmentReminders = async (io, now) => {
  const remindUntil = new Date(now.getTime() + ASSIGNMENT_REMINDER_HOURS * 60 * 60 * 1000);
  const assignments = await LmsAssignment.find({
    isPublished: true,
    dueDate: { $gt: now, $lte: remindUntil },
    reminderSentAt: { $exists: false }
  }).populate('subject', 'name code department branch semester assignedTeachers').limit(100);

  for (const assignment of assignments) {
    const subject = assignment.subject;
    if (!subject) continue;
    const students = await getSubjectStudents(subject);
    const submitted = await LmsSubmission.find({ assignment: assignment._id }).distinct('student');
    const submittedSet = new Set(submitted.map(String));
    const pendingStudents = students.filter(student => !submittedSet.has(String(student._id)));
    const updated = await LmsAssignment.updateOne(
      { _id: assignment._id, reminderSentAt: { $exists: false } },
      { reminderSentAt: now }
    );
    if (!updated.modifiedCount) continue;
    await createNotifications(io, pendingStudents.map(student => ({
      recipient: student._id,
      recipientRole: 'student',
      type: 'lms_assignment_due',
      title: 'Assignment deadline reminder',
      message: `${assignment.title} is due on ${new Date(assignment.dueDate).toLocaleString()}.`,
      data: { subject: subject._id, subjectName: subject.name, assignment: assignment._id, assignmentTitle: assignment.title },
      priority: 'high'
    })));
  }
};

const sendAssignmentSummaries = async (io, now) => {
  const assignments = await LmsAssignment.find({
    isPublished: true,
    dueDate: { $lte: now },
    submissionSummarySentAt: { $exists: false }
  }).populate('subject', 'name code department branch semester assignedTeachers').limit(100);

  for (const assignment of assignments) {
    const subject = assignment.subject;
    if (!subject) continue;
    const [students, submittedCount] = await Promise.all([
      getSubjectStudents(subject),
      LmsSubmission.countDocuments({ assignment: assignment._id })
    ]);
    const updated = await LmsAssignment.updateOne(
      { _id: assignment._id, submissionSummarySentAt: { $exists: false } },
      { submissionSummarySentAt: now }
    );
    if (!updated.modifiedCount) continue;
    await createNotifications(io, (subject.assignedTeachers || []).map(teacherId => ({
      recipient: teacherId,
      recipientRole: 'teacher',
      type: 'lms_assignment_deadline_summary',
      title: 'Assignment deadline reached',
      message: `${submittedCount}/${students.length} students submitted assignment "${assignment.title}".`,
      data: {
        subject: subject._id,
        subjectName: subject.name,
        assignment: assignment._id,
        assignmentTitle: assignment.title,
        submittedCount,
        totalStudents: students.length
      },
      priority: 'medium'
    })));
    emitLmsChange(io, subject, 'assignment_deadline_summary', { assignmentId: assignment._id });
  }
};

const sendQuizRemindersAndSummaries = async (io, now) => {
  const scanStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const scanEnd = new Date(now.getTime() + QUIZ_REMINDER_MINUTES * 60 * 1000);
  const quizzes = await LmsQuiz.find({
    isPublished: true,
    $or: [
      { endAt: { $gte: scanStart, $lte: scanEnd } },
      { startAt: { $gte: scanStart, $lte: scanEnd } },
      { resultsReleased: false }
    ]
  }).populate('subject', 'name code department branch semester assignedTeachers').limit(150);

  for (const quiz of quizzes) {
    const closeAt = getQuizCloseAt(quiz);
    const subject = quiz.subject;
    if (!subject || !closeAt) continue;
    const students = await getSubjectStudents(subject);
    const attempted = await LmsQuizAttempt.find({ quiz: quiz._id }).distinct('student');
    const attemptedSet = new Set(attempted.map(String));

    if (closeAt > now && closeAt <= scanEnd && !quiz.reminderSentAt) {
      const updated = await LmsQuiz.updateOne(
        { _id: quiz._id, reminderSentAt: { $exists: false } },
        { reminderSentAt: now }
      );
      if (updated.modifiedCount) {
        const pendingStudents = students.filter(student => !attemptedSet.has(String(student._id)));
        await createNotifications(io, pendingStudents.map(student => ({
          recipient: student._id,
          recipientRole: 'student',
          type: 'lms_quiz_due',
          title: 'Quiz closes soon',
          message: `${quiz.title} closes on ${new Date(closeAt).toLocaleString()}.`,
          data: { subject: subject._id, subjectName: subject.name, quiz: quiz._id, quizTitle: quiz.title },
          priority: 'high'
        })));
      }
    }

    if (closeAt <= now) {
      const quizUpdate = {};
      if (!quiz.resultsReleased) {
        quizUpdate.resultsReleased = true;
        quizUpdate.resultsReleasedAt = now;
      }
      if (!quiz.attemptSummarySentAt) quizUpdate.attemptSummarySentAt = now;
      if (!Object.keys(quizUpdate).length) continue;
      const updated = await LmsQuiz.updateOne(
        { _id: quiz._id, $or: [{ resultsReleased: false }, { attemptSummarySentAt: { $exists: false } }] },
        quizUpdate
      );
      if (!updated.modifiedCount) continue;

      if (!quiz.resultsReleased) {
        await createNotifications(io, students.map(student => ({
          recipient: student._id,
          recipientRole: 'student',
          type: 'lms_quiz_released',
          title: 'Quiz result released',
          message: `${quiz.title} results are now available.`,
          data: { subject: subject._id, subjectName: subject.name, quiz: quiz._id, quizTitle: quiz.title },
          priority: 'medium'
        })));
      }

      if (!quiz.attemptSummarySentAt) {
        await createNotifications(io, (subject.assignedTeachers || []).map(teacherId => ({
          recipient: teacherId,
          recipientRole: 'teacher',
          type: 'lms_quiz_deadline_summary',
          title: 'Quiz deadline reached',
          message: `${attemptedSet.size}/${students.length} students attempted quiz "${quiz.title}".`,
          data: {
            subject: subject._id,
            subjectName: subject.name,
            quiz: quiz._id,
            quizTitle: quiz.title,
            attemptedCount: attemptedSet.size,
            totalStudents: students.length
          },
          priority: 'medium'
        })));
      }
      emitLmsChange(io, subject, 'quiz_deadline_reached', { quizId: quiz._id });
    }
  }
};

const runLmsDeadlineChecks = async (ioOrApp) => {
  const io = typeof ioOrApp?.get === 'function' ? ioOrApp.get('io') : ioOrApp;
  const now = new Date();
  await sendAssignmentReminders(io, now);
  await sendAssignmentSummaries(io, now);
  await sendQuizRemindersAndSummaries(io, now);
};

module.exports = { runLmsDeadlineChecks };
