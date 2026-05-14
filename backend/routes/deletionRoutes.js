const express = require('express');
const router = express.Router();
const { getPendingDeletions, undoDeletion } = require('../controllers/deletionController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

router.use(protect, adminOnly);
router.get('/', getPendingDeletions);
router.put('/:id/undo', undoDeletion);

module.exports = router;
