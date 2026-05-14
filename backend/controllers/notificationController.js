const Notification = require('../models/Notification');
const { isSystemAdmin } = require('../utils/adminScope');

const notificationScope = (user) => {
  const scopes = [
    { recipient: user._id },
    { recipientRole: 'all' }
  ];
  if (user.role !== 'admin' || isSystemAdmin(user)) {
    scopes.push({ recipientRole: user.role });
  }
  return scopes;
};

const notDeletedByUser = (user) => ({
  deletedFor: { $ne: user._id }
});

const canAccessNotification = (notif, user) => notificationScope(user).some(scope => {
  if (scope.recipient) return String(notif.recipient || '') === String(scope.recipient);
  return notif.recipientRole === scope.recipientRole;
});

const isDirectNotification = (notif, user) => String(notif.recipient || '') === String(user._id);

const getMyNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({
      $or: notificationScope(req.user),
      ...notDeletedByUser(req.user)
    }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ success: true, notifications });
  } catch (err) {
    console.error('getMyNotifications error:', err);
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
    const count = await Notification.countDocuments({
      $or: notificationScope(req.user),
      isRead: false,
      ...notDeletedByUser(req.user)
    });
    res.json({ success: true, count });
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
  deleteNotification,
  deleteAllNotifications
};
