const Notification = require('../models/Notification');
const LmsAssignment = require('../models/LmsAssignment');
const LmsSubmission = require('../models/LmsSubmission');
const LmsQuiz = require('../models/LmsQuiz');
const LmsQuizAttempt = require('../models/LmsQuizAttempt');
const User = require('../models/User');
const { isSystemAdmin } = require('../utils/adminScope');
const { studentMatchesSubject, studentMatchForSubject } = require('../utils/subjectEnrollment');
const { canReceiveSubjectUpdates, isProfileRestricted } = require('../utils/restrictionPolicy');
const { studentCodeOf } = require('../utils/studentIdentity');

const AUTO_DELETE_MS = 24 * 60 * 60 * 1000;

const unassignedRecipientScope = () => ({
  $or: [
    { recipient: { $exists: false } },
    { recipient: null }
  ]
});

const notificationScope = (user) => {
  const scopes = [
    { recipient: user._id },
    { recipientRole: 'all', ...unassignedRecipientScope() }
  ];
  if (user.role === 'student' && studentCodeOf(user)) {
    scopes.push({ recipientStudentId: studentCodeOf(user) });
  }
  if (user.role !== 'admin' || isSystemAdmin(user)) {
    scopes.push({ recipientRole: user.role, ...unassignedRecipientScope() });
  }
  return scopes;
};

const notDeletedByUser = (user) => ({
  deletedFor: { $ne: user._id }
});

const canAccessNotification = (notif, user) => notificationScope(user).some(scope => {
  if (scope.recipientStudentId) return String(notif.recipientStudentId || '').toUpperCase() === String(scope.recipientStudentId).toUpperCase();
  if (scope.recipient) return String(notif.recipient || '') === String(scope.recipient);
  if (notif.recipient && String(notif.recipient) !== String(user._id)) return false;
  return notif.recipientRole === scope.recipientRole;
});

const isDirectNotification = (notif, user) => (
  String(notif.recipient || '') === String(user._id) ||
  (user.role === 'student' && studentCodeOf(user) && String(notif.recipientStudentId || '').toUpperCase() === studentCodeOf(user))
);

const cleanupExpiredNotifications = async () => {
  const cutoff = new Date(Date.now() - AUTO_DELETE_MS);
  await Notification.deleteMany({
    createdAt: { $lt: cutoff },
    $or: [
      { autoDeleteProtectedBy: { $exists: false } },
      { autoDeleteProtectedBy: { $size: 0 } }
    ]
  });
};

const withPreserveState = (notifications, user) => notifications.map(notification => ({
  ...notification,
  autoDeleteProtected: (notification.autoDeleteProtectedBy || []).some(id => String(id) === String(user._id))
}));

const getSubjectStudentCount = async (subject) => {
  if (!subject?._id) return 0;
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
  )).length;
};

const filterRestrictedStudentNotifications = (notifications, user) => {
  if (user.role !== 'student') return notifications;
  if (isProfileRestricted(user)) {
    return notifications.filter(notification => !notification.data?.subject);
  }
  return notifications.filter(notification => {
    const subjectId = notification.data?.subject;
    return !subjectId || canReceiveSubjectUpdates(user, subjectId);
  });
};

const enrichLmsNotification = async (notification) => {
  const data = notification.data || {};
  if (notification.type === 'lms_assignment_deadline_summary' && data.assignment) {
    const assignment = await LmsAssignment.findById(data.assignment).populate('subject', 'name code department branch semester').lean();
    if (!assignment) return notification;
    const [studentCount, submittedStudents] = await Promise.all([
      getSubjectStudentCount(assignment.subject),
      LmsSubmission.distinct('student', { assignment: assignment._id })
    ]);
    const submittedCount = submittedStudents.length;
    return {
      ...notification,
      message: `${submittedCount}/${studentCount} students submitted assignment "${assignment.title}".`,
      data: {
        ...data,
        subjectName: assignment.subject?.name,
        assignmentTitle: assignment.title,
        submittedCount,
        totalStudents: studentCount
      }
    };
  }

  if (notification.type === 'lms_quiz_deadline_summary' && data.quiz) {
    const quiz = await LmsQuiz.findById(data.quiz).populate('subject', 'name code department branch semester').lean();
    if (!quiz) return notification;
    const [studentCount, attemptedStudents] = await Promise.all([
      getSubjectStudentCount(quiz.subject),
      LmsQuizAttempt.distinct('student', { quiz: quiz._id })
    ]);
    const attemptedCount = attemptedStudents.length;
    return {
      ...notification,
      message: `${attemptedCount}/${studentCount} students attempted quiz "${quiz.title}".`,
      data: {
        ...data,
        subjectName: quiz.subject?.name,
        quizTitle: quiz.title,
        attemptedCount,
        totalStudents: studentCount
      }
    };
  }

  if (notification.type === 'lms_assignment_created' && data.assignment && !data.assignmentTitle) {
    const assignment = await LmsAssignment.findById(data.assignment).populate('subject', 'name').select('title subject').lean();
    if (assignment) {
      return {
        ...notification,
        message: `${assignment.title} is assigned in ${assignment.subject?.name || data.subjectName || 'classroom'}.`,
        data: { ...data, assignmentTitle: assignment.title, subjectName: assignment.subject?.name || data.subjectName }
      };
    }
  }

  if ((notification.type === 'lms_quiz_created' || notification.type === 'lms_quiz_released') && data.quiz && !data.quizTitle) {
    const quiz = await LmsQuiz.findById(data.quiz).populate('subject', 'name').select('title subject').lean();
    if (quiz) {
      return {
        ...notification,
        message: notification.type === 'lms_quiz_released'
          ? `${quiz.title} results are now available.`
          : `${quiz.title} is available in ${quiz.subject?.name || data.subjectName || 'classroom'}.`,
        data: { ...data, quizTitle: quiz.title, subjectName: quiz.subject?.name || data.subjectName }
      };
    }
  }

  return notification;
};

const enrichLmsNotifications = async (notifications) => Promise.all(
  notifications.map(notification => String(notification.type || '').startsWith('lms_')
    ? enrichLmsNotification(notification)
    : notification)
);

const getMyNotifications = async (req, res) => {
  try {
    await cleanupExpiredNotifications();
    const notifications = await Notification.find({
      $or: notificationScope(req.user),
      ...notDeletedByUser(req.user)
    }).sort({ createdAt: -1 }).limit(50).lean();
    const visibleNotifications = filterRestrictedStudentNotifications(notifications, req.user);
    const enriched = await enrichLmsNotifications(visibleNotifications);
    res.json({ success: true, notifications: withPreserveState(enriched, req.user) });
  } catch (err) {
    console.error('getMyNotifications error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const toggleAutoDeleteProtection = async (req, res) => {
  try {
    const { preserve } = req.body || {};
    const notif = await Notification.findById(req.params.id);
    if (!notif) return res.status(404).json({ success: false, message: 'Notification not found' });
    if (!canAccessNotification(notif, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const update = preserve
      ? { $addToSet: { autoDeleteProtectedBy: req.user._id } }
      : { $pull: { autoDeleteProtectedBy: req.user._id } };
    const updated = await Notification.findByIdAndUpdate(notif._id, update, { new: true }).lean();
    res.json({
      success: true,
      notification: withPreserveState([updated], req.user)[0]
    });
  } catch (err) {
    console.error('toggleAutoDeleteProtection error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const markAsRead = async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id);
    if (!notif) return res.status(404).json({ success: false, message: 'Notification not found' });
    const canRead = canAccessNotification(notif, req.user) &&
      !notif.deletedFor?.some(id => String(id) === String(req.user._id));
    if (!canRead) return res.status(403).json({ success: false, message: 'Access denied' });
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true, readAt: new Date() });
    res.json({ success: true });
  } catch (err) {
    console.error('markAsRead error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      {
        $or: notificationScope(req.user),
        isRead: false,
        ...notDeletedByUser(req.user)
      },
      { isRead: true, readAt: new Date() }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('markAllAsRead error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getUnreadCount = async (req, res) => {
  try {
    await cleanupExpiredNotifications();
    const notifications = await Notification.find({
      $or: notificationScope(req.user),
      isRead: false,
      ...notDeletedByUser(req.user)
    }).select('data').lean();
    res.json({ success: true, count: filterRestrictedStudentNotifications(notifications, req.user).length });
  } catch (err) {
    console.error('getUnreadCount error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id);
    if (!notif) return res.status(404).json({ success: false, message: 'Notification not found' });
    if (!canAccessNotification(notif, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (isDirectNotification(notif, req.user)) {
      await Notification.findByIdAndDelete(notif._id);
    } else {
      await Notification.findByIdAndUpdate(notif._id, { $addToSet: { deletedFor: req.user._id } });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('deleteNotification error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const deleteAllNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({
      $or: notificationScope(req.user),
      ...notDeletedByUser(req.user)
    }).select('_id recipient').lean();

    const directIds = [];
    const sharedIds = [];
    notifications.forEach(notif => {
      if (isDirectNotification(notif, req.user)) directIds.push(notif._id);
      else sharedIds.push(notif._id);
    });

    if (directIds.length) await Notification.deleteMany({ _id: { $in: directIds } });
    if (sharedIds.length) {
      await Notification.updateMany(
        { _id: { $in: sharedIds } },
        { $addToSet: { deletedFor: req.user._id } }
      );
    }

    res.json({ success: true, deleted: directIds.length + sharedIds.length });
  } catch (err) {
    console.error('deleteAllNotifications error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  toggleAutoDeleteProtection,
  deleteNotification,
  deleteAllNotifications
};
