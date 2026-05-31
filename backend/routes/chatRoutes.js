const express = require('express');
const {
  getGroups,
  searchStudents,
  createGroup,
  getMessages,
  createMessage,
  updateGroup,
  updateGroupAvatar,
  deleteGroup,
  addMembers,
  removeMember,
  leaveGroup,
  setMemberAdmin,
  updateMessage,
  deleteMessage,
  clearGroupChat,
  undoDeleteForMe,
  reactMessage,
  starMessage,
  forwardMessage,
  markMessageRead,
  getMessageReceipts,
  updateMemberPrefs,
  getStarredMessages,
  getScheduledMessages,
  cancelScheduledMessage,
  getJoinRequests,
  reviewJoinRequest,
  broadcastMessage,
  pinMessage,
  markImportant,
  createPoll,
  votePoll,
  getMediaGallery,
  getPinnedResources,
  getActivityLog,
  translateMessage,
  reportMessage,
  inviteInfo,
  regenerateInvite,
  sendInvite,
  joinByInvite,
} = require('../controllers/chatController');
const { protect, studentOnly } = require('../middleware/authMiddleware');
const { uploadChatFile } = require('../middleware/uploadMiddleware');
const { cacheMiddleware } = require('../middleware/cacheMiddleware');
const { invalidateAfter } = require('../utils/cacheInvalidation');

const router = express.Router();

router.use(protect, studentOnly);

const formatUploadError = (error) => {
  if (!error) return '';
  if (error.code === 'LIMIT_FILE_SIZE') return 'Each chat attachment must be 50MB or smaller.';
  if (error.code === 'LIMIT_FILE_COUNT') return 'You can attach up to 10 files at once.';
  return error.message || 'Could not upload chat attachment.';
};

const handleUpload = (upload) => (req, res, next) => {
  upload(req, res, (error) => {
    if (error) return res.status(400).json({ success: false, message: formatUploadError(error) });
    return next();
  });
};

router.get('/students/search', searchStudents);
router.get('/groups', cacheMiddleware('chat-groups', 15), getGroups);
router.post('/groups', invalidateAfter(createGroup, ['chat-groups']));
router.post('/groups/join', invalidateAfter(joinByInvite, ['chat-groups']));
router.get('/messages/starred', getStarredMessages);
router.get('/messages/scheduled', getScheduledMessages);
router.post('/broadcasts', broadcastMessage);
router.get('/groups/:groupId/messages', getMessages);
router.post('/groups/:groupId/messages', handleUpload(uploadChatFile.array('files', 10)), invalidateAfter(createMessage, ['chat-groups', 'chat-gallery']));
router.post('/groups/:groupId/media', handleUpload(uploadChatFile.array('files', 10)), invalidateAfter(createMessage, ['chat-groups', 'chat-gallery']));
router.post('/groups/:groupId/polls', invalidateAfter(createPoll, ['chat-groups']));
router.get('/groups/:groupId/gallery', cacheMiddleware('chat-gallery', 30), getMediaGallery);
router.get('/groups/:groupId/resources', cacheMiddleware('chat-gallery', 30), getPinnedResources);
router.get('/groups/:groupId/activity', getActivityLog);
router.get('/groups/:groupId/invite', inviteInfo);
router.post('/groups/:groupId/invite/regenerate', invalidateAfter(regenerateInvite, ['chat-groups']));
router.post('/groups/:groupId/invite/send', invalidateAfter(sendInvite, ['chat-groups', 'notifications']));
router.get('/groups/:groupId/join-requests', getJoinRequests);
router.put('/groups/:groupId/join-requests/:requestId', reviewJoinRequest);
router.put('/groups/:groupId/preferences', invalidateAfter(updateMemberPrefs, ['chat-groups']));
router.put('/groups/:groupId', invalidateAfter(updateGroup, ['chat-groups', 'chat-gallery']));
router.post('/groups/:groupId/avatar', handleUpload(uploadChatFile.single('avatar')), invalidateAfter(updateGroupAvatar, ['chat-groups']));
router.delete('/groups/:groupId', invalidateAfter(deleteGroup, ['chat-groups', 'chat-gallery']));
router.post('/groups/:groupId/leave', invalidateAfter(leaveGroup, ['chat-groups']));
router.post('/groups/:groupId/members', invalidateAfter(addMembers, ['chat-groups']));
router.post('/groups/:groupId/clear', invalidateAfter(clearGroupChat, ['chat-groups', 'chat-gallery']));
router.delete('/groups/:groupId/members/:studentId', invalidateAfter(removeMember, ['chat-groups']));
router.put('/groups/:groupId/members/:studentId/admin', invalidateAfter(setMemberAdmin, ['chat-groups']));
router.put('/messages/:messageId', invalidateAfter(updateMessage, ['chat-groups', 'chat-gallery']));
router.delete('/messages/:messageId', invalidateAfter(deleteMessage, ['chat-groups', 'chat-gallery']));
router.post('/messages/:messageId/undo-delete', invalidateAfter(undoDeleteForMe, ['chat-groups', 'chat-gallery']));
router.post('/messages/:messageId/reactions', invalidateAfter(reactMessage, ['chat-groups']));
router.post('/messages/:messageId/star', invalidateAfter(starMessage, ['chat-groups']));
router.post('/messages/:messageId/forward', invalidateAfter(forwardMessage, ['chat-groups', 'chat-gallery']));
router.post('/messages/:messageId/read', markMessageRead);
router.get('/messages/:messageId/receipts', getMessageReceipts);
router.delete('/messages/:messageId/schedule', cancelScheduledMessage);
router.post('/messages/:messageId/pin', invalidateAfter(pinMessage, ['chat-groups', 'chat-gallery']));
router.post('/messages/:messageId/important', invalidateAfter(markImportant, ['chat-groups', 'chat-gallery']));
router.post('/messages/:messageId/translate', translateMessage);
router.post('/messages/:messageId/vote', invalidateAfter(votePoll, ['chat-groups']));
router.post('/messages/:messageId/report', reportMessage);

module.exports = router;
