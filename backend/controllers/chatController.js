const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const User = require('../models/User');
const ChatGroup = require('../models/ChatGroup');
const ChatGroupMember = require('../models/ChatGroupMember');
const ChatMessage = require('../models/ChatMessage');
const ChatReaction = require('../models/ChatReaction');
const ChatReadReceipt = require('../models/ChatReadReceipt');
const ChatReport = require('../models/ChatReport');
const ChatJoinRequest = require('../models/ChatJoinRequest');
const Notification = require('../models/Notification');
const { isProfileRestricted } = require('../utils/restrictionPolicy');
const { uploadFile, deleteImage } = require('../utils/cloudinary');

const objectId = (id) => new mongoose.Types.ObjectId(id);
const chatGroupRoom = (groupId) => `chat_group_${groupId}`;
const chatUserRoom = (userId) => `chat_user_${userId}`;

const messageSelect = 'name studentId profileImage role';
const memberSelect = 'name studentId profileImage department branch semester status isRestricted';

const normalizeBranch = (value) => String(value || '').trim();
const activeSemesterStudentQuery = (base, extra = {}) => ({
  role: 'student',
  status: 'active',
  isRestricted: { $ne: true },
  pendingDeletion: { $ne: true },
  department: base.department,
  semester: Number(base.semester),
  ...extra,
});

const ensureStudent = (req, res) => {
  if (req.user?.role !== 'student') {
    res.status(403).json({ success: false, message: 'Student chat is private to students.' });
    return false;
  }
  if (isProfileRestricted(req.user)) {
    res.status(403).json({ success: false, message: 'Your profile is restricted. Room/Groups is disabled.' });
    return false;
  }
  return true;
};

const memberBase = (user) => ({
  department: user.department,
  branch: normalizeBranch(user.branch),
  semester: Number(user.semester),
});

const validObjectIds = (ids = []) => [...new Set(ids.map(String).filter(id => mongoose.Types.ObjectId.isValid(id)))];
const newInviteCode = () => Math.random().toString(36).slice(2, 8).toUpperCase() + Date.now().toString(36).slice(-4).toUpperCase();
const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getActiveMembership = async (groupId, userId) => ChatGroupMember.findOne({
  group: groupId,
  user: userId,
  isActive: true,
}).populate('user', memberSelect);

const assertMember = async (req, groupId, options = {}) => {
  const [group, membership] = await Promise.all([
    ChatGroup.findOne({ _id: groupId, isDeleted: { $ne: true } }),
    getActiveMembership(groupId, req.user._id),
  ]);
  if (!group) {
    const error = new Error('Group not found');
    error.statusCode = 404;
    throw error;
  }
  if (!membership) {
    const error = new Error('You are not a member of this group.');
    error.statusCode = 403;
    throw error;
  }
  if (options.adminOnly && membership.role !== 'admin') {
    const error = new Error('Only group admins can perform this action.');
    error.statusCode = 403;
    throw error;
  }
  return { group, membership };
};

const canManageRoom = async (group, membership) => {
  if (membership?.role === 'admin') return true;
  const memberCount = await ChatGroupMember.countDocuments({ group: group._id, isActive: true });
  return memberCount <= 2;
};
const canUsePermission = (group, membership, key) => {
  if (membership?.role === 'admin') return true;
  return group?.permissions?.[key] === 'members';
};

const cloudinaryResourceType = (kind) => {
  if (['image', 'gif'].includes(kind)) return 'image';
  if (['video', 'audio', 'voice'].includes(kind)) return 'video';
  return 'raw';
};
const removeLocalFile = (filePath) => {
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => null);
};

const uploadChatAttachment = async (file, kind) => {
  const resourceType = cloudinaryResourceType(kind);
  const folder = `${process.env.CLOUDINARY_FOLDER || 'studysphere'}/chat`;
  return uploadChatFile(file, { folder, resourceType });
};

const uploadChatFile = async (file, { folder, resourceType }) => {
  try {
    const uploaded = await uploadFile(file.path, { folder, resourceType });
    return {
      url: uploaded.url,
      publicId: uploaded.publicId,
      resourceType: uploaded.resourceType || resourceType,
      bytes: uploaded.bytes,
    };
  } finally {
    removeLocalFile(file.path);
  }
};

const mediaKind = (file, explicitType = '') => {
  const type = String(explicitType || '').toLowerCase();
  const mime = String(file?.mimetype || '').toLowerCase();
  const ext = path.extname(file?.originalname || '').toLowerCase();
  if (type === 'voice') return 'voice';
  if (mime.startsWith('image/') && ext === '.gif') return 'gif';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'].includes(ext)) return 'document';
  return 'file';
};

const serializeMessage = async (message, viewerId = null) => {
  const doc = await ChatMessage.findById(message._id || message)
    .populate('sender', messageSelect)
    .populate({ path: 'replyTo', select: 'text type attachments sender isDeleted', populate: { path: 'sender', select: messageSelect } })
    .lean();
  if (!doc) return null;
  const [reactionRows, readRows] = await Promise.all([
    ChatReaction.find({ message: doc._id }).populate('user', 'name studentId').lean(),
    ChatReadReceipt.find({ message: doc._id }).populate('user', 'name studentId').lean(),
  ]);
  const reactions = reactionRows.reduce((acc, item) => {
    acc[item.emoji] = acc[item.emoji] || [];
    acc[item.emoji].push(item.user);
    return acc;
  }, {});
  const starredBy = (doc.starredBy || []).map(String);
  const deletedFor = (doc.deletedFor || []).map(String);
  const importantBy = (doc.importantBy || []).map(String);
  return {
    ...doc,
    poll: doc.poll?.question ? {
      ...doc.poll,
      options: (doc.poll.options || []).map(option => ({
        ...option,
        votes: doc.poll?.anonymous || doc.poll?.showVoters === false ? [] : (option.votes || []),
        voteCount: (option.votes || []).length,
        votedByMe: viewerId ? (option.votes || []).map(String).includes(String(viewerId)) : false,
      })),
    } : doc.poll,
    isStarredByMe: viewerId ? starredBy.includes(String(viewerId)) : false,
    isImportantByMe: viewerId ? importantBy.includes(String(viewerId)) : false,
    isReportedByMe: viewerId ? (doc.reportedBy || []).map(String).includes(String(viewerId)) : false,
    isDeletedForMe: viewerId ? deletedFor.includes(String(viewerId)) : false,
    reactions,
    readBy: readRows.map(row => ({ user: row.user, readAt: row.readAt })),
  };
};

const emitToGroup = (req, groupId, event, payload) => {
  const io = req.app.get('io');
  if (io) io.to(chatGroupRoom(groupId)).emit(event, payload);
};

const emitToUsers = async (req, groupId, event, payload) => {
  const io = req.app.get('io');
  if (!io) return;
  const members = await ChatGroupMember.find({ group: groupId, isActive: true }).select('user').lean();
  members.forEach(member => io.to(chatUserRoom(member.user)).emit(event, payload));
};

const notifyMentions = async (req, group, message, mentionedIds = []) => {
  const ids = validObjectIds(mentionedIds).filter(id => String(id) !== String(req.user._id));
  if (!ids.length) return;
  const activeMentioned = await ChatGroupMember.find({ group: group._id, user: { $in: ids }, isActive: true }).select('user').lean();
  const notifications = await Promise.all(activeMentioned.map(member => Notification.create({
    recipient: member.user,
    recipientRole: 'student',
    type: 'chat_mention',
    title: `Mention in ${group.name}`,
    message: `${req.user.name} mentioned you in ${group.name}.`,
    data: { group: group._id, message: message._id, groupName: group.name },
    priority: 'medium'
  })));
  const io = req.app.get('io');
  if (io) {
    notifications.forEach(notification => {
      io.to(`user_${notification.recipient}`).emit('notification_created', notification);
      io.to(chatUserRoom(notification.recipient)).emit('chat_mention', { groupId: group._id, messageId: message._id });
    });
  }
};

const deliverScheduledMessage = async (req, messageId) => {
  const message = await ChatMessage.findById(messageId);
  if (!message || message.isDeleted || message.deliveredAt) return;
  const group = await ChatGroup.findOne({ _id: message.group, isDeleted: { $ne: true } });
  if (!group) return;
  message.deliveredAt = new Date();
  if (group.autoDeleteAfterHours) {
    message.expiresAt = new Date(Date.now() + Number(group.autoDeleteAfterHours) * 60 * 60 * 1000);
  }
  await message.save();
  group.lastMessage = message._id;
  group.lastMessageAt = message.deliveredAt;
  await group.save();
  await ChatReadReceipt.updateOne({ message: message._id, group: group._id, user: message.sender }, { readAt: new Date() }, { upsert: true });
  const serialized = await serializeMessage(message, message.sender);
  emitToGroup(req, group._id, 'chat_message_created', { groupId: group._id, message: serialized });
  await emitToUsers(req, group._id, 'chat_group_updated', { groupId: group._id });
};

const scheduleMessageDelivery = (req, message) => {
  if (!message.scheduledFor || message.deliveredAt) return;
  const delay = new Date(message.scheduledFor).getTime() - Date.now();
  if (delay <= 0) {
    deliverScheduledMessage(req, message._id).catch(error => console.error('scheduled chat delivery error:', error.message));
    return;
  }
  if (delay <= 24 * 60 * 60 * 1000) {
    setTimeout(() => deliverScheduledMessage(req, message._id).catch(error => console.error('scheduled chat delivery error:', error.message)), delay);
  }
};

const deliverDueScheduledMessages = async (req, groupIds = []) => {
  const ids = validObjectIds(groupIds);
  const query = {
    isDeleted: { $ne: true },
    deliveredAt: { $exists: false },
    scheduledFor: { $lte: new Date() },
  };
  if (ids.length) query.group = { $in: ids };
  const dueMessages = await ChatMessage.find(query).sort({ scheduledFor: 1 }).limit(50);
  for (const message of dueMessages) {
    await deliverScheduledMessage(req, message._id);
  }
};

const createSystemMessage = async (req, group, text, systemEvent = 'message') => {
  if (group.showSystemMessages === false) return null;
  const message = await ChatMessage.create({
    group: group._id,
    type: 'system',
    text,
    systemEvent,
  });
  group.lastMessage = message._id;
  group.lastMessageAt = message.createdAt;
  await group.save();
  const serialized = await serializeMessage(message, req.user?._id);
  emitToGroup(req, group._id, 'chat_message_created', { groupId: group._id, message: serialized });
  return serialized;
};

const groupSummary = async (group, userId) => {
  const viewerMembership = await ChatGroupMember.findOne({ group: group._id, user: userId, isActive: true }).select('clearedAt isPinned isArchived lockCode draftText hidePresence blockedUsers').lean();
  const visibleAfter = viewerMembership?.clearedAt ? { createdAt: { $gt: viewerMembership.clearedAt } } : {};
  const visibleToViewer = { ...visibleAfter, deletedFor: { $ne: userId } };
  const [members, lastMessage, unreadCount] = await Promise.all([
    ChatGroupMember.find({ group: group._id, isActive: true }).populate('user', memberSelect).lean(),
    ChatMessage.findOne({ group: group._id, ...visibleToViewer, $or: [{ scheduledFor: { $exists: false } }, { deliveredAt: { $exists: true } }, { scheduledFor: { $lte: new Date() } }] }).sort({ createdAt: -1 }).select('_id').then(message => message ? serializeMessage(message, userId) : null),
    ChatMessage.countDocuments({
      group: group._id,
      ...visibleToViewer,
      sender: { $ne: userId },
      type: { $ne: 'system' },
      isDeleted: { $ne: true },
      $or: [{ scheduledFor: { $exists: false } }, { deliveredAt: { $exists: true } }, { scheduledFor: { $lte: new Date() } }],
      _id: {
        $nin: await ChatReadReceipt.distinct('message', { group: group._id, user: userId }),
      },
    }),
  ]);
  return {
    ...(group.toObject?.() || group),
    members,
    lastMessage,
    unreadCount,
    myPrefs: {
      isPinned: Boolean(viewerMembership?.isPinned),
      isArchived: Boolean(viewerMembership?.isArchived),
      isLocked: Boolean(viewerMembership?.lockCode),
      lockCode: viewerMembership?.lockCode || '',
      draftText: viewerMembership?.draftText || '',
      hidePresence: Boolean(viewerMembership?.hidePresence),
      blockedUsers: viewerMembership?.blockedUsers || [],
    },
    myRole: members.find(member => String(member.user?._id || member.user) === String(userId))?.role || 'member',
  };
};

const getGroups = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const memberships = await ChatGroupMember.find({ user: req.user._id, isActive: true }).select('group role').lean();
    const groupIds = memberships.map(item => item.group);
    await deliverDueScheduledMessages(req, groupIds);
    const groups = await ChatGroup.find({ _id: { $in: groupIds }, isDeleted: { $ne: true } }).sort({ lastMessageAt: -1, updatedAt: -1 });
    const summaries = await Promise.all(groups.map(group => groupSummary(group, req.user._id)));
    res.json({ success: true, groups: summaries });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const searchStudents = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const query = String(req.query.search || '').trim();
    const base = memberBase(req.user);
    const match = activeSemesterStudentQuery(base);
    if (query) {
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      match.$or = [{ name: regex }, { studentId: regex }, { email: regex }];
    }
    const students = await User.find(match).select(memberSelect).sort({ studentId: 1, name: 1 }).limit(query ? 30 : 200).lean();
    res.json({ success: true, students });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

const createGroup = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'Group name is required.' });
    const addAll = req.body.addAll === true;
    const requestedIds = validObjectIds(Array.isArray(req.body.memberIds) ? req.body.memberIds : []);
    const base = memberBase(req.user);
    if (!base.department || !base.semester) {
      return res.status(400).json({ success: false, message: 'Your student profile is missing department or semester details.' });
    }
    const memberQuery = activeSemesterStudentQuery(base);
    if (!addAll) memberQuery._id = { $in: [...new Set([...requestedIds, String(req.user._id)])] };
    const students = await User.find(memberQuery).select(memberSelect);
    if (!students.some(student => String(student._id) === String(req.user._id))) {
      return res.status(400).json({ success: false, message: 'Your student profile must be active with department and semester details before creating a room.' });
    }

    const group = await ChatGroup.create({
      name,
      description: req.body.description || '',
      createdBy: req.user._id,
      department: base.department,
      branch: base.branch,
      semester: base.semester,
      chatMode: req.body.chatMode === 'admins_only' ? 'admins_only' : 'everyone',
      inviteCode: newInviteCode(),
      autoDeleteAfterHours: Math.max(0, Number(req.body.autoDeleteAfterHours || 0) || 0),
    });
    await ChatGroupMember.bulkWrite(students.map(student => ({
      updateOne: {
        filter: { group: group._id, user: student._id },
        update: {
          $set: {
            role: String(student._id) === String(req.user._id) ? 'admin' : 'member',
            addedBy: req.user._id,
            isActive: true,
            leftAt: null,
          },
          $setOnInsert: { joinedAt: new Date() },
        },
        upsert: true,
      },
    })));
    await createSystemMessage(req, group, `${req.user.name} (${req.user.studentId}) created the group.`, 'group_created');
    const summary = await groupSummary(group, req.user._id);
    await emitToUsers(req, group._id, 'chat_group_created', { group: summary });
    res.status(201).json({ success: true, group: summary });
  } catch (error) {
    res.status(error.code === 11000 ? 400 : 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const getMessages = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { membership } = await assertMember(req, req.params.groupId);
    await deliverDueScheduledMessages(req, [req.params.groupId]);
    const before = req.query.before ? { createdAt: { $lt: new Date(req.query.before) } } : {};
    const visibleAfter = membership.clearedAt ? { createdAt: { $gt: membership.clearedAt } } : {};
    const query = {
      group: req.params.groupId,
      ...before,
      ...visibleAfter,
      $or: [{ scheduledFor: { $exists: false } }, { deliveredAt: { $exists: true } }, { scheduledFor: { $lte: new Date() } }, { sender: req.user._id }],
    };
    if (req.query.q) {
      const regex = new RegExp(escapeRegex(req.query.q), 'i');
      query.$and = [{ $or: [{ text: regex }, { 'attachments.name': regex }, { 'poll.question': regex }] }];
    }
    if (req.query.filter === 'starred') query.starredBy = req.user._id;
    if (req.query.filter === 'media') query['attachments.kind'] = { $in: ['image', 'gif', 'video', 'audio', 'voice'] };
    if (req.query.filter === 'documents') query['attachments.kind'] = { $in: ['document', 'file'] };
    if (req.query.filter === 'links') query.text = /https?:\/\//i;
    const messages = await ChatMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(req.query.limit || 50), 100))
      .select('_id');
    const serialized = await Promise.all(messages.reverse().map(message => serializeMessage(message, req.user._id)));
    res.json({ success: true, messages: serialized.filter(Boolean) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const createMessage = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group, membership } = await assertMember(req, req.params.groupId);
    if (group.chatMode === 'admins_only' || group.permissions?.sendMessages === 'admins') {
      if (!canUsePermission(group, membership, 'sendMessages')) {
        return res.status(403).json({ success: false, message: 'Only permitted members can send messages in this group.' });
      }
    }
    const text = String(req.body.text || '').trim();
    const attachments = [];
    for (const file of req.files || []) {
      const kind = mediaKind(file, req.body.mediaType);
      const uploaded = await uploadChatAttachment(file, kind);
      attachments.push({
        url: uploaded.url,
        name: file.originalname,
        mimeType: file.mimetype,
        size: file.size || uploaded.bytes,
        kind,
        duration: Number(req.body.duration || 0) || undefined,
        publicId: uploaded.publicId,
        resourceType: uploaded.resourceType,
      });
    }
    if (!text && !attachments.length) return res.status(400).json({ success: false, message: 'Message text or media is required.' });
    const mentionIds = validObjectIds(Array.isArray(req.body.mentions) ? req.body.mentions : String(req.body.mentions || '').split(','));
    const scheduledFor = req.body.scheduledFor ? new Date(req.body.scheduledFor) : null;
    const shouldSchedule = scheduledFor && !Number.isNaN(scheduledFor.getTime()) && scheduledFor.getTime() > Date.now() + 30000;
    const message = await ChatMessage.create({
      group: group._id,
      sender: req.user._id,
      type: attachments.length ? 'media' : 'text',
      text,
      attachments,
      replyTo: req.body.replyTo || undefined,
      mentions: mentionIds,
      scheduledFor: shouldSchedule ? scheduledFor : undefined,
      deliveredAt: shouldSchedule ? undefined : new Date(),
      expiresAt: !shouldSchedule && group.autoDeleteAfterHours ? new Date(Date.now() + Number(group.autoDeleteAfterHours) * 60 * 60 * 1000) : undefined,
    });
    if (!shouldSchedule) {
      group.lastMessage = message._id;
      group.lastMessageAt = message.createdAt;
      await group.save();
    }
    await ChatReadReceipt.updateOne({ message: message._id, group: group._id, user: req.user._id }, { readAt: new Date() }, { upsert: true });
    const serialized = await serializeMessage(message, req.user._id);
    if (shouldSchedule) {
      scheduleMessageDelivery(req, message);
    } else {
      emitToGroup(req, group._id, 'chat_message_created', { groupId: group._id, message: serialized });
      await emitToUsers(req, group._id, 'chat_group_updated', { groupId: group._id });
      await notifyMentions(req, group, message, mentionIds);
    }
    res.status(201).json({ success: true, message: serialized });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const updateGroup = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group, membership } = await assertMember(req, req.params.groupId);
    if (!canUsePermission(group, membership, 'editInfo') && !(await canManageRoom(group, membership))) return res.status(403).json({ success: false, message: 'Only permitted members can update this room.' });
    if (req.body.name !== undefined) group.name = String(req.body.name || '').trim() || group.name;
    if (req.body.description !== undefined) group.description = String(req.body.description || '').trim();
    if (['everyone', 'admins_only'].includes(req.body.chatMode)) group.chatMode = req.body.chatMode;
    if (req.body.inviteEnabled !== undefined) group.inviteEnabled = req.body.inviteEnabled !== false;
    if (req.body.inviteRequireApproval !== undefined) group.inviteRequireApproval = req.body.inviteRequireApproval === true;
    if (req.body.inviteExpiresAt !== undefined) {
      const expiry = req.body.inviteExpiresAt ? new Date(req.body.inviteExpiresAt) : null;
      group.inviteExpiresAt = expiry && !Number.isNaN(expiry.getTime()) ? expiry : undefined;
    }
    if (req.body.inviteMaxUses !== undefined) group.inviteMaxUses = Math.max(0, Number(req.body.inviteMaxUses || 0) || 0);
    if (req.body.autoDeleteAfterHours !== undefined) group.autoDeleteAfterHours = Math.max(0, Number(req.body.autoDeleteAfterHours || 0) || 0);
    if (req.body.showSystemMessages !== undefined) group.showSystemMessages = req.body.showSystemMessages !== false;
    group.permissions = group.permissions || {};
    if (req.body.permissions?.editInfo && ['admins', 'members'].includes(req.body.permissions.editInfo)) group.permissions.editInfo = req.body.permissions.editInfo;
    if (req.body.permissions?.sendMessages && ['admins', 'members'].includes(req.body.permissions.sendMessages)) group.permissions.sendMessages = req.body.permissions.sendMessages;
    if (req.body.permissions?.addMembers && ['admins', 'members'].includes(req.body.permissions.addMembers)) group.permissions.addMembers = req.body.permissions.addMembers;
    if (req.body.permissions?.pinMessages && ['admins', 'members'].includes(req.body.permissions.pinMessages)) group.permissions.pinMessages = req.body.permissions.pinMessages;
    await group.save();
    await createSystemMessage(req, group, `${req.user.name} (${req.user.studentId}) updated group settings.`, 'group_updated');
    const summary = await groupSummary(group, req.user._id);
    await emitToUsers(req, group._id, 'chat_group_updated', { group: summary });
    res.json({ success: true, group: summary });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const updateGroupAvatar = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group, membership } = await assertMember(req, req.params.groupId);
    if (!canUsePermission(group, membership, 'editInfo') && !(await canManageRoom(group, membership))) return res.status(403).json({ success: false, message: 'Only permitted members can update this room.' });
    if (!req.file) return res.status(400).json({ success: false, message: 'Select a group image first.' });
    const previousPublicId = group.avatarPublicId;
    const previousResourceType = group.avatarResourceType || 'image';
    const uploaded = await uploadChatFile(req.file, {
      folder: `${process.env.CLOUDINARY_FOLDER || 'studysphere'}/chat-groups`,
      resourceType: 'image',
    });
    group.avatarUrl = uploaded.url;
    group.avatarPublicId = uploaded.publicId;
    group.avatarResourceType = uploaded.resourceType || 'image';
    await group.save();
    await createSystemMessage(req, group, `${req.user.name} (${req.user.studentId}) updated the group image.`, 'group_updated');
    if (previousPublicId) {
      deleteImage(previousPublicId, { resourceType: previousResourceType }).catch(() => null);
    }
    const summary = await groupSummary(group, req.user._id);
    await emitToUsers(req, group._id, 'chat_group_updated', { group: summary });
    res.json({ success: true, group: summary });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const deleteGroup = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group, membership } = await assertMember(req, req.params.groupId);
    if (!(await canManageRoom(group, membership))) return res.status(403).json({ success: false, message: 'Only permitted members can delete this room.' });
    const members = await ChatGroupMember.find({ group: group._id, isActive: true }).select('user').lean();
    group.isDeleted = true;
    group.deletedAt = new Date();
    await group.save();
    await ChatGroupMember.updateMany({ group: group._id }, { isActive: false, leftAt: new Date() });
    if (group.avatarPublicId) {
      deleteImage(group.avatarPublicId, { resourceType: group.avatarResourceType || 'image' }).catch(() => null);
    }
    const io = req.app.get('io');
    if (io) {
      io.to(chatGroupRoom(group._id)).emit('chat_group_deleted', { groupId: group._id });
      members.forEach(member => io.to(chatUserRoom(member.user)).emit('chat_group_deleted', { groupId: group._id }));
    }
    res.json({ success: true, message: 'Group deleted' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const addMembers = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group, membership } = await assertMember(req, req.params.groupId);
    if (!canUsePermission(group, membership, 'addMembers')) return res.status(403).json({ success: false, message: 'Only permitted members can add members.' });
    const ids = validObjectIds(req.body.memberIds || []);
    if (!ids.length) return res.status(400).json({ success: false, message: 'Select at least one student to add.' });
    const base = memberBase(group);
    const students = await User.find(activeSemesterStudentQuery(base, { _id: { $in: ids } })).select(memberSelect);
    if (!students.length) return res.status(400).json({ success: false, message: 'No eligible active students found in this semester.' });
    for (const student of students) {
      await ChatGroupMember.updateOne(
        { group: group._id, user: student._id },
        { role: 'member', isActive: true, joinedAt: new Date(), leftAt: null, addedBy: req.user._id },
        { upsert: true }
      );
    }
    if (students.length) {
      await createSystemMessage(req, group, `${req.user.name} added ${students.length} member${students.length === 1 ? '' : 's'}.`, 'member_added');
    }
    const summary = await groupSummary(group, req.user._id);
    await emitToUsers(req, group._id, 'chat_member_added', { group: summary });
    res.json({ success: true, group: summary });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const removeMember = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group } = await assertMember(req, req.params.groupId, { adminOnly: true });
    if (String(req.params.studentId) === String(req.user._id)) return res.status(400).json({ success: false, message: 'Use Leave Group to leave yourself.' });
    const member = await ChatGroupMember.findOneAndUpdate(
      { group: group._id, user: req.params.studentId, isActive: true },
      { isActive: false, leftAt: new Date() },
      { new: true }
    ).populate('user', memberSelect);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found' });
    await createSystemMessage(req, group, `${member.user.name} (${member.user.studentId}) was removed from the group.`, 'member_removed');
    await emitToUsers(req, group._id, 'chat_member_removed', { groupId: group._id, studentId: req.params.studentId });
    res.json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const leaveGroup = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group } = await assertMember(req, req.params.groupId);
    const activeAdmins = await ChatGroupMember.countDocuments({ group: group._id, isActive: true, role: 'admin', user: { $ne: req.user._id } });
    const mine = await ChatGroupMember.findOne({ group: group._id, user: req.user._id, isActive: true });
    if (mine?.role === 'admin' && activeAdmins === 0) {
      return res.status(400).json({ success: false, message: 'Make another member admin before leaving.' });
    }
    mine.isActive = false;
    mine.leftAt = new Date();
    await mine.save();
    await createSystemMessage(req, group, `${req.user.name} (${req.user.studentId}) left the group.`, 'member_left');
    emitToGroup(req, group._id, 'chat_member_left', { groupId: group._id, userId: req.user._id });
    res.json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const setMemberAdmin = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group } = await assertMember(req, req.params.groupId, { adminOnly: true });
    const member = await ChatGroupMember.findOneAndUpdate(
      { group: group._id, user: req.params.studentId, isActive: true },
      { role: req.body.isAdmin === false ? 'member' : 'admin' },
      { new: true }
    ).populate('user', memberSelect);
    if (!member) return res.status(404).json({ success: false, message: 'Member not found' });
    await createSystemMessage(req, group, `${member.user.name} (${member.user.studentId}) is now ${member.role === 'admin' ? 'a group admin' : 'a member'}.`, 'member_promoted');
    const summary = await groupSummary(group, req.user._id);
    await emitToUsers(req, group._id, 'chat_group_updated', { group: summary });
    res.json({ success: true, group: summary });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const updateMessage = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const message = await ChatMessage.findById(req.params.messageId);
    if (!message || message.isDeleted) return res.status(404).json({ success: false, message: 'Message not found' });
    await assertMember(req, message.group);
    if (String(message.sender) !== String(req.user._id)) return res.status(403).json({ success: false, message: 'You can edit only your messages.' });
    const previousText = message.text || '';
    message.text = String(req.body.text || '').trim();
    message.editHistory = [...(message.editHistory || []), { text: previousText, editedAt: new Date() }].slice(-10);
    message.editedAt = new Date();
    await message.save();
    const serialized = await serializeMessage(message, req.user._id);
    emitToGroup(req, message.group, 'chat_message_updated', { groupId: message.group, message: serialized });
    res.json({ success: true, message: serialized });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const deleteMessage = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const message = await ChatMessage.findById(req.params.messageId);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });
    const { membership } = await assertMember(req, message.group);
    const owns = String(message.sender) === String(req.user._id);
    const scope = req.body.scope === 'me' ? 'me' : 'everyone';
    if (scope === 'me') {
      await ChatMessage.updateOne({ _id: message._id }, { $addToSet: { deletedFor: req.user._id } });
      const serialized = await serializeMessage(message._id, req.user._id);
      return res.json({ success: true, deletedForMe: true, message: serialized });
    }
    if (message.isDeleted) return res.status(404).json({ success: false, message: 'Message not found' });
    if (!owns && membership.role !== 'admin') return res.status(403).json({ success: false, message: 'You can delete only your messages.' });
    const attachments = [...(message.attachments || [])];
    message.isDeleted = true;
    message.deletedAt = new Date();
    message.deletedBy = req.user._id;
    message.text = 'This message was deleted';
    message.attachments = [];
    await message.save();
    await Promise.all(attachments.map(file => deleteImage(file.publicId, { resourceType: file.resourceType || cloudinaryResourceType(file.kind) }).catch(() => null)));
    const serialized = await serializeMessage(message, req.user._id);
    emitToGroup(req, message.group, 'chat_message_deleted', { groupId: message.group, message: serialized });
    res.json({ success: true, message: serialized });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const clearGroupChat = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group } = await assertMember(req, req.params.groupId);
    await ChatGroupMember.updateOne(
      { group: group._id, user: req.user._id, isActive: true },
      { $set: { clearedAt: new Date(), lastReadAt: new Date() }, $unset: { lastReadMessage: '' } }
    );
    res.json({ success: true, message: 'Chat cleared from your side.' });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const undoDeleteForMe = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const message = await ChatMessage.findById(req.params.messageId).select('group');
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });
    await assertMember(req, message.group);
    await ChatMessage.updateOne({ _id: message._id }, { $pull: { deletedFor: req.user._id } });
    const serialized = await serializeMessage(message._id, req.user._id);
    res.json({ success: true, message: serialized });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const reactMessage = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const emoji = String(req.body.emoji || '').trim().slice(0, 16);
    const message = await ChatMessage.findById(req.params.messageId).select('group isDeleted');
    if (!message || message.isDeleted) return res.status(404).json({ success: false, message: 'Message not found' });
    await assertMember(req, message.group);
    if (!emoji) await ChatReaction.deleteOne({ message: message._id, user: req.user._id });
    else await ChatReaction.updateOne({ message: message._id, user: req.user._id }, { group: message.group, emoji }, { upsert: true });
    const serialized = await serializeMessage(message, req.user._id);
    emitToGroup(req, message.group, 'chat_reaction_updated', { groupId: message.group, message: serialized });
    res.json({ success: true, message: serialized });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const markMessageRead = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const message = await ChatMessage.findById(req.params.messageId).select('group createdAt');
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });
    await assertMember(req, message.group);
    const readableMessages = await ChatMessage.find({
      group: message.group,
      createdAt: { $lte: message.createdAt },
      sender: { $ne: req.user._id },
      type: { $ne: 'system' },
      isDeleted: { $ne: true },
      deletedFor: { $ne: req.user._id },
      $or: [{ scheduledFor: { $exists: false } }, { deliveredAt: { $exists: true } }, { scheduledFor: { $lte: new Date() } }],
    }).select('_id').lean();
    if (readableMessages.length) {
      await ChatReadReceipt.bulkWrite(readableMessages.map(row => ({
        updateOne: {
          filter: { message: row._id, group: message.group, user: req.user._id },
          update: { readAt: new Date() },
          upsert: true,
        },
      })));
    }
    await ChatGroupMember.updateOne(
      { group: message.group, user: req.user._id },
      { lastReadMessage: message._id, lastReadAt: new Date() }
    );
    emitToGroup(req, message.group, 'chat_read_updated', { groupId: message.group, messageId: message._id, userId: req.user._id });
    res.json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const pinMessage = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const message = await ChatMessage.findById(req.params.messageId);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });
    const { group, membership } = await assertMember(req, message.group);
    if (!canUsePermission(group, membership, 'pinMessages')) return res.status(403).json({ success: false, message: 'Only permitted members can pin messages.' });
    await ChatMessage.updateMany({ group: group._id }, { isPinned: false });
    message.isPinned = true;
    const mode = String(req.body.duration || 'always');
    const ms = mode === '7d' ? 7 * 24 * 60 * 60 * 1000 : mode === '8h' ? 8 * 60 * 60 * 1000 : 0;
    message.pinnedUntil = ms ? new Date(Date.now() + ms) : undefined;
    await message.save();
    group.pinnedMessage = message._id;
    await group.save();
    const serialized = await serializeMessage(message, req.user._id);
    emitToGroup(req, group._id, 'chat_message_updated', { groupId: group._id, message: serialized });
    res.json({ success: true, message: serialized });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const markImportant = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const message = await ChatMessage.findById(req.params.messageId);
    if (!message || message.isDeleted) return res.status(404).json({ success: false, message: 'Message not found' });
    const { group, membership } = await assertMember(req, message.group);
    if (!canUsePermission(group, membership, 'pinMessages')) return res.status(403).json({ success: false, message: 'Only permitted members can mark important messages.' });
    const isImportant = req.body.important !== false;
    message.isImportant = isImportant;
    if (isImportant) {
      message.importantBy = [...new Set([...(message.importantBy || []).map(String), String(req.user._id)])];
    } else {
      message.importantBy = (message.importantBy || []).filter(id => String(id) !== String(req.user._id));
    }
    await message.save();
    const serialized = await serializeMessage(message, req.user._id);
    emitToGroup(req, group._id, 'chat_message_updated', { groupId: group._id, message: serialized });
    res.json({ success: true, message: serialized });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const createPoll = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group, membership } = await assertMember(req, req.params.groupId);
    if (group.chatMode === 'admins_only' && membership.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only group admins can create polls in this group.' });
    }
    const question = String(req.body.question || '').trim();
    const options = (Array.isArray(req.body.options) ? req.body.options : []).map(item => String(item || '').trim()).filter(Boolean).slice(0, 10);
    if (!question || options.length < 2) return res.status(400).json({ success: false, message: 'Poll needs a question and at least two options.' });
    const message = await ChatMessage.create({
      group: group._id,
      sender: req.user._id,
      type: 'poll',
      text: question,
      poll: {
        question,
        options: options.map(text => ({ text, votes: [] })),
        allowMultiple: req.body.allowMultiple === true,
        closesAt: req.body.closesAt ? new Date(req.body.closesAt) : undefined,
      },
      deliveredAt: new Date(),
      expiresAt: group.autoDeleteAfterHours ? new Date(Date.now() + Number(group.autoDeleteAfterHours) * 60 * 60 * 1000) : undefined,
    });
    group.lastMessage = message._id;
    group.lastMessageAt = message.createdAt;
    await group.save();
    const serialized = await serializeMessage(message, req.user._id);
    emitToGroup(req, group._id, 'chat_message_created', { groupId: group._id, message: serialized });
    await emitToUsers(req, group._id, 'chat_group_updated', { groupId: group._id });
    res.status(201).json({ success: true, message: serialized });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const votePoll = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const message = await ChatMessage.findById(req.params.messageId);
    if (!message || message.type !== 'poll' || message.isDeleted) return res.status(404).json({ success: false, message: 'Poll not found' });
    await assertMember(req, message.group);
    if (message.poll?.closesAt && new Date(message.poll.closesAt) < new Date()) return res.status(400).json({ success: false, message: 'This poll is closed.' });
    const optionId = String(req.body.optionId || '');
    const option = (message.poll.options || []).id(optionId);
    if (!option) return res.status(404).json({ success: false, message: 'Poll option not found.' });
    if (!message.poll.allowMultiple) {
      message.poll.options.forEach(row => { row.votes = (row.votes || []).filter(id => String(id) !== String(req.user._id)); });
    }
    const hasVote = (option.votes || []).some(id => String(id) === String(req.user._id));
    option.votes = hasVote
      ? option.votes.filter(id => String(id) !== String(req.user._id))
      : [...(option.votes || []), req.user._id];
    await message.save();
    const serialized = await serializeMessage(message, req.user._id);
    emitToGroup(req, message.group, 'chat_message_updated', { groupId: message.group, message: serialized });
    res.json({ success: true, message: serialized });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const getMediaGallery = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { membership } = await assertMember(req, req.params.groupId);
    const visibleAfter = membership.clearedAt ? { createdAt: { $gt: membership.clearedAt } } : {};
    const messages = await ChatMessage.find({
      group: req.params.groupId,
      ...visibleAfter,
      isDeleted: { $ne: true },
      attachments: { $exists: true, $ne: [] },
      $or: [{ scheduledFor: { $exists: false } }, { deliveredAt: { $exists: true } }, { scheduledFor: { $lte: new Date() } }],
    }).populate('sender', messageSelect).sort({ createdAt: -1 }).limit(300).lean();
    const items = [];
    messages.forEach(message => (message.attachments || []).forEach(file => {
      items.push({ ...file, messageId: message._id, sender: message.sender, createdAt: message.createdAt });
    }));
    const grouped = {
      images: items.filter(item => ['image', 'gif'].includes(item.kind)),
      videos: items.filter(item => item.kind === 'video'),
      audio: items.filter(item => ['audio', 'voice'].includes(item.kind)),
      documents: items.filter(item => ['document', 'file'].includes(item.kind)),
      links: messages.filter(message => /https?:\/\//i.test(message.text || '')).map(message => ({ messageId: message._id, text: message.text, sender: message.sender, createdAt: message.createdAt })),
    };
    res.json({ success: true, gallery: grouped });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const reportMessage = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const message = await ChatMessage.findById(req.params.messageId).populate('sender', 'name studentId');
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });
    const { group } = await assertMember(req, message.group);
    await ChatReport.updateOne(
      { message: message._id, reporter: req.user._id },
      { group: group._id, reportedUser: message.sender?._id, reason: String(req.body.reason || '').trim(), status: 'open' },
      { upsert: true }
    );
    await ChatMessage.updateOne({ _id: message._id }, { $addToSet: { reportedBy: req.user._id } });
    const admins = await ChatGroupMember.find({ group: group._id, role: 'admin', isActive: true, user: { $ne: req.user._id } }).select('user').lean();
    await Promise.all(admins.map(admin => Notification.create({
      recipient: admin.user,
      recipientRole: 'student',
      type: 'chat_report',
      title: `Message reported in ${group.name}`,
      message: `${req.user.name} reported a message${message.sender?.name ? ` from ${message.sender.name}` : ''}.`,
      data: { group: group._id, message: message._id, groupName: group.name },
      priority: 'high'
    })));
    const serialized = await serializeMessage(message._id, req.user._id);
    res.json({ success: true, message: serialized });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const inviteInfo = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group, membership } = await assertMember(req, req.params.groupId);
    if (!(await canManageRoom(group, membership))) return res.status(403).json({ success: false, message: 'Only group admins can manage invites.' });
    if (!group.inviteCode) {
      group.inviteCode = newInviteCode();
      await group.save();
    }
    res.json({
      success: true,
      inviteCode: group.inviteCode,
      inviteEnabled: group.inviteEnabled !== false,
      inviteExpiresAt: group.inviteExpiresAt,
      inviteMaxUses: group.inviteMaxUses,
      inviteUses: group.inviteUses,
      inviteRequireApproval: group.inviteRequireApproval,
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const regenerateInvite = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group, membership } = await assertMember(req, req.params.groupId);
    if (!(await canManageRoom(group, membership))) return res.status(403).json({ success: false, message: 'Only group admins can manage invites.' });
    group.inviteCode = newInviteCode();
    group.inviteEnabled = true;
    group.inviteUses = 0;
    if (req.body?.expiresAt !== undefined) {
      const expiry = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
      group.inviteExpiresAt = expiry && !Number.isNaN(expiry.getTime()) ? expiry : undefined;
    }
    if (req.body?.maxUses !== undefined) group.inviteMaxUses = Math.max(0, Number(req.body.maxUses || 0) || 0);
    if (req.body?.requireApproval !== undefined) group.inviteRequireApproval = req.body.requireApproval === true;
    await group.save();
    res.json({ success: true, inviteCode: group.inviteCode, inviteEnabled: true, inviteExpiresAt: group.inviteExpiresAt, inviteMaxUses: group.inviteMaxUses, inviteUses: group.inviteUses, inviteRequireApproval: group.inviteRequireApproval });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const findOrCreatePrivateGroup = async (req, target) => {
  const sharedGroupIds = await ChatGroupMember.aggregate([
    { $match: { user: { $in: [objectId(req.user._id), objectId(target._id)] }, isActive: true } },
    { $group: { _id: '$group', users: { $addToSet: '$user' }, count: { $sum: 1 } } },
    { $match: { count: 2 } },
  ]);
  for (const row of sharedGroupIds) {
    const activeCount = await ChatGroupMember.countDocuments({ group: row._id, isActive: true });
    if (activeCount !== 2) continue;
    const group = await ChatGroup.findOne({ _id: row._id, isDeleted: { $ne: true } });
    if (group) return group;
  }

  const base = memberBase(req.user);
  const group = await ChatGroup.create({
    name: `${req.user.name} & ${target.name}`,
    description: 'Private chat',
    createdBy: req.user._id,
    department: base.department,
    branch: base.branch,
    semester: base.semester,
    chatMode: 'everyone',
    inviteEnabled: false,
  });
  await ChatGroupMember.bulkWrite([req.user._id, target._id].map(userId => ({
    updateOne: {
      filter: { group: group._id, user: userId },
      update: {
        $set: {
          role: 'admin',
          addedBy: req.user._id,
          isActive: true,
          leftAt: null,
        },
        $setOnInsert: { joinedAt: new Date() },
      },
      upsert: true,
    },
  })));
  return group;
};

const sendInvite = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group, membership } = await assertMember(req, req.params.groupId);
    if (!(await canManageRoom(group, membership))) return res.status(403).json({ success: false, message: 'Only group admins can send invites.' });
    if (!group.inviteCode) group.inviteCode = newInviteCode();
    group.inviteEnabled = true;
    await group.save();

    const query = String(req.body.studentId || req.body.search || '').trim();
    if (!query) return res.status(400).json({ success: false, message: 'Student ID is required.' });
    const base = memberBase(group);
    const target = await User.findOne(activeSemesterStudentQuery(base, {
      _id: { $ne: req.user._id },
      $or: [
        { studentId: new RegExp(`^${escapeRegex(query)}$`, 'i') },
        { email: new RegExp(`^${escapeRegex(query)}$`, 'i') },
      ],
    })).select(memberSelect);
    if (!target) return res.status(404).json({ success: false, message: 'No eligible student found for this room invite.' });

    const privateGroup = await findOrCreatePrivateGroup(req, target);
    const inviteLink = String(req.body.inviteLink || '').trim();
    const text = [
      `${req.user.name} invited you to join "${group.name}".`,
      inviteLink || `Invite code: ${group.inviteCode}`,
      `Invite code: ${group.inviteCode}`,
    ].filter(Boolean).join('\n');
    const message = await ChatMessage.create({
      group: privateGroup._id,
      sender: req.user._id,
      type: 'text',
      text,
    });
    privateGroup.lastMessage = message._id;
    privateGroup.lastMessageAt = message.createdAt;
    await privateGroup.save();
    await ChatReadReceipt.updateOne({ message: message._id, group: privateGroup._id, user: req.user._id }, { readAt: new Date() }, { upsert: true });
    const serialized = await serializeMessage(message, req.user._id);
    emitToGroup(req, privateGroup._id, 'chat_message_created', { groupId: privateGroup._id, message: serialized });
    await emitToUsers(req, privateGroup._id, 'chat_group_updated', { groupId: privateGroup._id });
    const summary = await groupSummary(privateGroup, req.user._id);
    res.json({ success: true, inviteCode: group.inviteCode, group: summary, sentTo: target });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const joinByInvite = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const rawCode = String(req.body.code || '').trim();
    let code = rawCode;
    try {
      const url = new URL(rawCode);
      code = url.searchParams.get('invite') || url.searchParams.get('code') || rawCode;
    } catch (_) {}
    code = String(code || '').trim().toUpperCase();
    const group = await ChatGroup.findOne({ inviteCode: code, inviteEnabled: true, isDeleted: { $ne: true } });
    if (!group) return res.status(404).json({ success: false, message: 'Invite link is invalid or expired.' });
    if (group.inviteExpiresAt && group.inviteExpiresAt < new Date()) return res.status(410).json({ success: false, message: 'This invite link has expired.' });
    if (group.inviteMaxUses && Number(group.inviteUses || 0) >= Number(group.inviteMaxUses)) return res.status(410).json({ success: false, message: 'This invite link has reached its join limit.' });
    const base = memberBase(group);
    if (req.user.department !== base.department || Number(req.user.semester) !== Number(base.semester)) {
      return res.status(403).json({ success: false, message: 'This invite is only for students in the same semester.' });
    }
    const existing = await ChatGroupMember.findOne({ group: group._id, user: req.user._id, isActive: true });
    if (!existing && group.inviteRequireApproval) {
      await ChatJoinRequest.updateOne(
        { group: group._id, user: req.user._id, status: 'pending' },
        { requestedByInviteCode: code },
        { upsert: true }
      );
      await createSystemMessage(req, group, `${req.user.name} (${req.user.studentId}) requested to join using invite link.`, 'message');
      return res.json({ success: true, pendingApproval: true, message: 'Join request sent to room admins.' });
    }
    await ChatGroupMember.updateOne(
      { group: group._id, user: req.user._id },
      { isActive: true, role: 'member', joinedAt: new Date(), leftAt: null },
      { upsert: true }
    );
    if (!existing) {
      group.inviteUses = Number(group.inviteUses || 0) + 1;
      await group.save();
    }
    await createSystemMessage(req, group, `${req.user.name} (${req.user.studentId}) joined using invite link.`, 'member_added');
    const summary = await groupSummary(group, req.user._id);
    await emitToUsers(req, group._id, 'chat_member_added', { group: summary });
    res.json({ success: true, group: summary });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const starMessage = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const message = await ChatMessage.findById(req.params.messageId).select('group isDeleted starredBy');
    if (!message || message.isDeleted) return res.status(404).json({ success: false, message: 'Message not found' });
    await assertMember(req, message.group);
    const isStarred = (message.starredBy || []).some(id => String(id) === String(req.user._id));
    await ChatMessage.updateOne(
      { _id: message._id },
      isStarred ? { $pull: { starredBy: req.user._id } } : { $addToSet: { starredBy: req.user._id } }
    );
    const serialized = await serializeMessage(message._id, req.user._id);
    res.json({ success: true, message: serialized });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const getMessageReceipts = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const message = await ChatMessage.findById(req.params.messageId).select('group');
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });
    const { group } = await assertMember(req, message.group);
    const [members, reads] = await Promise.all([
      ChatGroupMember.find({ group: group._id, isActive: true }).populate('user', 'name studentId profileImage').lean(),
      ChatReadReceipt.find({ message: message._id }).populate('user', 'name studentId profileImage').lean(),
    ]);
    const seenIds = new Set(reads.map(item => String(item.user?._id || item.user)));
    res.json({
      success: true,
      seen: reads.map(item => ({ user: item.user, readAt: item.readAt })),
      delivered: members.filter(member => !seenIds.has(String(member.user?._id || member.user))).map(member => ({ user: member.user })),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const updateMemberPrefs = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    await assertMember(req, req.params.groupId);
    const update = {};
    if (req.body.isPinned !== undefined) update.isPinned = req.body.isPinned === true;
    if (req.body.isArchived !== undefined) update.isArchived = req.body.isArchived === true;
    if (req.body.lockCode !== undefined) update.lockCode = String(req.body.lockCode || '').slice(0, 80);
    if (req.body.draftText !== undefined) update.draftText = String(req.body.draftText || '').slice(0, 5000);
    if (req.body.hidePresence !== undefined) update.hidePresence = req.body.hidePresence === true;
    if (req.body.blockUserId !== undefined) {
      const op = req.body.blocked === false ? '$pull' : '$addToSet';
      await ChatGroupMember.updateOne({ group: req.params.groupId, user: req.user._id }, { [op]: { blockedUsers: req.body.blockUserId } });
    }
    if (Object.keys(update).length) await ChatGroupMember.updateOne({ group: req.params.groupId, user: req.user._id }, update);
    const group = await ChatGroup.findById(req.params.groupId);
    const summary = await groupSummary(group, req.user._id);
    res.json({ success: true, group: summary });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const getStarredMessages = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const memberships = await ChatGroupMember.find({ user: req.user._id, isActive: true }).select('group').lean();
    const groupIds = memberships.map(item => item.group);
    const rows = await ChatMessage.find({ group: { $in: groupIds }, starredBy: req.user._id, isDeleted: { $ne: true } }).sort({ createdAt: -1 }).limit(100).select('_id');
    const messages = await Promise.all(rows.map(row => serializeMessage(row._id, req.user._id)));
    res.json({ success: true, messages: messages.filter(Boolean) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const getScheduledMessages = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const memberships = await ChatGroupMember.find({ user: req.user._id, isActive: true }).select('group').lean();
    const groupIds = memberships.map(item => item.group);
    const rows = await ChatMessage.find({ group: { $in: groupIds }, sender: req.user._id, scheduledFor: { $exists: true }, deliveredAt: { $exists: false }, isDeleted: { $ne: true } }).sort({ scheduledFor: 1 }).select('_id');
    const messages = await Promise.all(rows.map(row => serializeMessage(row._id, req.user._id)));
    res.json({ success: true, messages: messages.filter(Boolean) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const cancelScheduledMessage = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const message = await ChatMessage.findOne({ _id: req.params.messageId, sender: req.user._id, deliveredAt: { $exists: false }, scheduledFor: { $exists: true } });
    if (!message) return res.status(404).json({ success: false, message: 'Scheduled message not found.' });
    await assertMember(req, message.group);
    message.isDeleted = true;
    message.deletedAt = new Date();
    message.deletedBy = req.user._id;
    await message.save();
    res.json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const getJoinRequests = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group, membership } = await assertMember(req, req.params.groupId);
    if (!(await canManageRoom(group, membership))) return res.status(403).json({ success: false, message: 'Only admins can review join requests.' });
    const requests = await ChatJoinRequest.find({ group: group._id, status: 'pending' }).populate('user', memberSelect).sort({ createdAt: 1 }).lean();
    res.json({ success: true, requests });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const reviewJoinRequest = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const { group, membership } = await assertMember(req, req.params.groupId);
    if (!(await canManageRoom(group, membership))) return res.status(403).json({ success: false, message: 'Only admins can review join requests.' });
    const request = await ChatJoinRequest.findOne({ _id: req.params.requestId, group: group._id, status: 'pending' }).populate('user', memberSelect);
    if (!request) return res.status(404).json({ success: false, message: 'Join request not found.' });
    const approve = req.body.status !== 'rejected';
    request.status = approve ? 'approved' : 'rejected';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    await request.save();
    if (approve) {
      await ChatGroupMember.updateOne(
        { group: group._id, user: request.user._id },
        { isActive: true, role: 'member', joinedAt: new Date(), leftAt: null },
        { upsert: true }
      );
      group.inviteUses = Number(group.inviteUses || 0) + 1;
      await group.save();
      await createSystemMessage(req, group, `${request.user.name} (${request.user.studentId}) joined after admin approval.`, 'member_added');
    }
    const summary = await groupSummary(group, req.user._id);
    await emitToUsers(req, group._id, 'chat_group_updated', { group: summary });
    res.json({ success: true, request, group: summary });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const broadcastMessage = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const ids = validObjectIds(req.body.memberIds || []);
    const text = String(req.body.text || '').trim();
    if (!ids.length || !text) return res.status(400).json({ success: false, message: 'Select recipients and write a message.' });
    const base = memberBase(req.user);
    const targets = await User.find(activeSemesterStudentQuery(base, { _id: { $in: ids, $ne: req.user._id } })).select(memberSelect);
    const groups = [];
    for (const target of targets) {
      const group = await findOrCreatePrivateGroup(req, target);
      const message = await ChatMessage.create({ group: group._id, sender: req.user._id, type: 'text', text, isForwarded: true });
      group.lastMessage = message._id;
      group.lastMessageAt = message.createdAt;
      await group.save();
      emitToGroup(req, group._id, 'chat_message_created', { groupId: group._id, message: await serializeMessage(message, req.user._id) });
      await emitToUsers(req, group._id, 'chat_group_updated', { groupId: group._id });
      groups.push(await groupSummary(group, req.user._id));
    }
    res.json({ success: true, groups });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

const forwardMessage = async (req, res) => {
  try {
    if (!ensureStudent(req, res)) return;
    const source = await ChatMessage.findById(req.params.messageId).lean();
    if (!source || source.isDeleted) return res.status(404).json({ success: false, message: 'Message not found' });
    await assertMember(req, source.group);
    const groupIds = validObjectIds(req.body.groupIds || []);
    if (!groupIds.length) return res.status(400).json({ success: false, message: 'Select at least one room to forward.' });
    const created = [];
    for (const groupId of groupIds) {
      const { group, membership } = await assertMember(req, groupId);
      if (group.chatMode === 'admins_only' && membership.role !== 'admin') continue;
      const message = await ChatMessage.create({
        group: group._id,
        sender: req.user._id,
        type: source.attachments?.length ? 'media' : 'text',
        text: source.text || '',
        attachments: source.attachments || [],
        isForwarded: true,
      });
      group.lastMessage = message._id;
      group.lastMessageAt = message.createdAt;
      await group.save();
      await ChatReadReceipt.updateOne({ message: message._id, group: group._id, user: req.user._id }, { readAt: new Date() }, { upsert: true });
      const serialized = await serializeMessage(message, req.user._id);
      emitToGroup(req, group._id, 'chat_message_created', { groupId: group._id, message: serialized });
      await emitToUsers(req, group._id, 'chat_group_updated', { groupId: group._id });
      created.push(serialized);
    }
    res.json({ success: true, messages: created });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
  }
};

module.exports = {
  chatGroupRoom,
  chatUserRoom,
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
  reportMessage,
  inviteInfo,
  regenerateInvite,
  sendInvite,
  joinByInvite,
};
