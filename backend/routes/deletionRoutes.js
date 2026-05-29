const express = require('express');
const router = express.Router();
const { getPendingDeletions, undoDeletion, undoDeletionBatch } = require('../controllers/deletionController');
const { protect, adminOrTeacher } = require('../middleware/authMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');
const { invalidateAfter } = require('../utils/cacheInvalidation');

router.use(protect, adminOrTeacher);
router.get('/', cacheMiddleware('pending-deletions', 15), getPendingDeletions);
router.put('/batch/:batchId/undo', invalidateAfter(undoDeletionBatch, ['pending-deletions', 'dashboard', 'admin-dashboard', 'subjects', 'lectures', 'attendance']));
router.put('/:id/undo', invalidateAfter(undoDeletion, ['pending-deletions', 'dashboard', 'admin-dashboard', 'subjects', 'lectures', 'attendance']));

module.exports = router;
