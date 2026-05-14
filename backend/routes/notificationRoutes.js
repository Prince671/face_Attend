const express = require('express');
const router = express.Router();
const {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  deleteNotification,
  deleteAllNotifications
} = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

// ✅ FIX: Specific routes MUST come before parameterised routes
// otherwise  PUT /mark-all-read  is matched by  PUT /:id/read
router.get('/unread-count', getUnreadCount);
router.put('/mark-all-read', markAllAsRead);   // <-- before /:id
router.delete('/all', deleteAllNotifications);
router.get('/', getMyNotifications);
router.put('/:id/read', markAsRead);            // <-- after static routes
router.delete('/:id', deleteNotification);

module.exports = router;
