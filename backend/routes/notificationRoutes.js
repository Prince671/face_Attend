const express = require('express');
const router = express.Router();
const {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  toggleAutoDeleteProtection,
  deleteNotification,
  deleteAllNotifications
} = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');
const { invalidateAfter } = require('../utils/cacheInvalidation');

router.use(protect);

// Specific routes must come before parameterised routes.
// otherwise  PUT /mark-all-read  is matched by  PUT /:id/read
router.get('/unread-count', cacheMiddleware('notifications', 20), getUnreadCount);
router.put('/mark-all-read', invalidateAfter(markAllAsRead, ['notifications']));   // <-- before /:id
router.delete('/all', invalidateAfter(deleteAllNotifications, ['notifications']));
router.get('/', cacheMiddleware('notifications', 30), getMyNotifications);
router.put('/:id/auto-delete-protection', invalidateAfter(toggleAutoDeleteProtection, ['notifications']));
router.put('/:id/read', invalidateAfter(markAsRead, ['notifications']));            // <-- after static routes
router.delete('/:id', invalidateAfter(deleteNotification, ['notifications']));

module.exports = router;
