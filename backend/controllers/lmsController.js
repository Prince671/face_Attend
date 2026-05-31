const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Subject = require('../models/Subject');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Lecture = require('../models/Lecture');
const Notification = require('../models/Notification');
const LmsMaterial = require('../models/LmsMaterial');
const LmsMaterialFolder = require('../models/LmsMaterialFolder');
const LmsAssignment = require('../models/LmsAssignment');
const LmsSubmission = require('../models/LmsSubmission');
const LmsQuiz = require('../models/LmsQuiz');
const LmsQuizAttempt = require('../models/LmsQuizAttempt');
const LmsAnnouncement = require('../models/LmsAnnouncement');
const LmsDiscussion = require('../models/LmsDiscussion');
const LmsDiscussionReply = require('../models/LmsDiscussionReply');
const LmsMaterialView = require('../models/LmsMaterialView');
const LmsPrivateComment = require('../models/LmsPrivateComment');
const { loadWorkbook, rowToValues } = require('../utils/excelWorkbook');
const { isSystemAdmin, getAdminDepartment, adminDepartmentRoom } = require('../utils/adminScope');
const { studentMatchesSubject, studentMatchForSubject } = require('../utils/subjectEnrollment');
const {
  canReceiveSubjectUpdates,
  isProfileRestricted,
  isRestrictedForSubject,
  restrictedSubjectErrorMessage,
} = require('../utils/restrictionPolicy');
const { uploadFile, deleteImage } = require('../utils/cloudinary');
const { invalidateLmsCache } = require('../utils/cacheInvalidation');
const { studentCodeOf, studentIdentityFilter } = require('../utils/studentIdentity');

const isStaff = (user) => ['admin', 'teacher'].includes(user?.role);
const objectId = (id) => new mongoose.Types.ObjectId(id);
const toBoolean = (value) => value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
const clampNumber = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
};
const quizControlPayload = (body = {}) => ({
  shuffleQuestions: toBoolean(body.shuffleQuestions),
  oneQuestionAtATime: toBoolean(body.oneQuestionAtATime),
  tabSwitchWarning: body.tabSwitchWarning === undefined ? true : toBoolean(body.tabSwitchWarning),
  maxTabSwitchWarnings: clampNumber(body.maxTabSwitchWarnings, 3, 0, 20),
});

const removeTempFile = (filePath) => {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    console.error(`LMS temp file cleanup failed for ${filePath}:`, error.message);
  }
};
const cloudinaryResourceType = (kind) => {
  if (kind === 'image') return 'image';
  if (['video', 'audio'].includes(kind)) return 'video';
  return 'raw';
};
const cleanupCloudinaryAsset = async (asset = {}) => {
  if (!asset?.publicId) return;
  await deleteImage(asset.publicId, { resourceType: asset.resourceType || 'raw' }).catch(() => null);
};
const cleanupAttachments = async (attachments = []) => {
  await Promise.all((attachments || []).map(cleanupCloudinaryAsset));
};
const lmsUploadedFiles = (req) => {
  if (Array.isArray(req.files)) return req.files;
  if (req.files && typeof req.files === 'object') return Object.values(req.files).flat().filter(Boolean);
  return req.file ? [req.file] : [];
};
const attachmentTypeFrom = (file) => {
  const mime = String(file?.mimetype || '').toLowerCase();
  const ext = path.extname(file?.originalname || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'].includes(ext)) return 'document';
  return 'file';
};
const uploadLmsAttachment = async (file, visibility = 'view') => {
  const type = attachmentTypeFrom(file);
  const resourceType = cloudinaryResourceType(type);
  try {
    const uploaded = await uploadFile(file.path, {
      folder: `${process.env.CLOUDINARY_FOLDER || 'studysphere'}/lms`,
      resourceType,
    });
    return {
      type,
      title: file.originalname,
      url: uploaded.url,
      fileName: file.originalname,
      fileSize: uploaded.bytes || file.size || 0,
      publicId: uploaded.publicId,
      resourceType: uploaded.resourceType || resourceType,
      visibility
    };
  } finally {
    removeTempFile(file.path);
  }
};
const buildAttachments = async (req, visibility = 'view') => {
  const files = await Promise.all(lmsUploadedFiles(req).map(file => uploadLmsAttachment(file, visibility)));
  const links = [];
  const linkUrls = Array.isArray(req.body.linkUrls) ? req.body.linkUrls : String(req.body.linkUrls || '').split('\n');
  linkUrls.map(cleanCell).filter(Boolean).forEach((url, index) => links.push({
    type: /youtu\.?be|youtube|vimeo/i.test(url) ? 'video' : 'link',
    title: `Link ${index + 1}`,
    url,
    visibility
  }));
  if (req.body.linkUrl) links.push({ type: /youtu\.?be|youtube|vimeo/i.test(req.body.linkUrl) ? 'video' : 'link', title: 'Link', url: req.body.linkUrl, visibility });
  return [...files, ...links];
};
const parseJson = (value, fallback) => {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value;
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
};
const assignmentDueAt = (assignment = {}) => {
  if (!assignment.dueDate) return null;
  const due = new Date(assignment.dueDate);
  if (Number.isNaN(due.getTime())) return null;
  if (assignment.dueTime && /^\d{2}:\d{2}/.test(assignment.dueTime)) {
    const [hours, minutes] = assignment.dueTime.split(':').map(Number);
    due.setHours(hours || 0, minutes || 0, 59, 999);
  } else {
    due.setHours(23, 59, 59, 999);
  }
  return due;
};
const publicAssignmentForStudent = (assignment = {}) => {
  if (assignment.status === 'scheduled' && assignment.scheduledPublishAt && new Date(assignment.scheduledPublishAt) > new Date()) return false;
  return assignment.isPublished !== false;
};
const publicMaterialForStudent = publicAssignmentForStudent;
const publicQuizForStudent = publicAssignmentForStudent;

const normalizeHeader = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const cleanCell = (value) => String(value == null ? '' : value).trim();
const parseTags = (value) => {
  if (Array.isArray(value)) return [...new Set(value.map(cleanCell).filter(Boolean))].slice(0, 12);
  return [...new Set(String(value || '').split(',').map(cleanCell).filter(Boolean))].slice(0, 12);
};
const getRowValue = (row, aliases = []) => {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (row[key] !== undefined && cleanCell(row[key])) return cleanCell(row[key]);
  }
  return '';
};

const parseCorrectOptionIndex = (value, options = []) => {
  const raw = cleanCell(value);
  if (!raw) return -1;
  const upper = raw.toUpperCase();
  if (/^[A-Z]$/.test(upper)) return upper.charCodeAt(0) - 65;
  if (/^[1-9]\d*$/.test(raw)) return Number(raw) - 1;
  return options.findIndex(option => option.text.trim().toLowerCase() === raw.toLowerCase());
};

const normalizeQuestionType = (value) => {
  const normalized = normalizeHeader(value);
  if (['checkbox', 'checkboxes', 'multiplecorrect', 'multipleanswers'].includes(normalized)) return 'checkbox';
  if (['dropdown', 'select'].includes(normalized)) return 'dropdown';
  if (['shortanswer', 'short'].includes(normalized)) return 'short_answer';
  if (['paragraph', 'longanswer', 'essay'].includes(normalized)) return 'paragraph';
  return 'multiple_choice';
};

const normalizeQuizQuestions = (questions = []) => questions
  .map(question => {
    const type = normalizeQuestionType(question.type);
    const options = (question.options || [])
      .map(option => ({ text: cleanCell(option.text), isCorrect: Boolean(option.isCorrect) }))
      .filter(option => option.text);
    const correctIndexes = options.map((option, index) => option.isCorrect ? index : -1).filter(index => index >= 0);
    const answerKey = Array.isArray(question.answerKey) ? question.answerKey.map(cleanCell).filter(Boolean) : [];
    return {
      type,
      text: cleanCell(question.text),
      required: question.required !== false,
      marks: Number(question.marks || 1),
      explanation: cleanCell(question.explanation || ''),
      correctFeedback: cleanCell(question.correctFeedback || ''),
      wrongFeedback: cleanCell(question.wrongFeedback || ''),
      answerKey,
      shuffleOptions: Boolean(question.shuffleOptions),
      options: options.map((option, index) => ({ ...option, isCorrect: type === 'checkbox' ? correctIndexes.includes(index) : index === correctIndexes[0] }))
    };
  })
  .filter(question => (
    question.text &&
    (['short_answer', 'paragraph'].includes(question.type) || (question.options.length >= 2 && question.options.some(option => option.isCorrect)))
  ));

const distributeQuizMarks = (questions = [], totalMarks) => {
  const total = Number(totalMarks);
  if (!Number.isFinite(total) || total <= 0 || !questions.length) return questions;
  let remaining = total;
  return questions.map((question, index) => {
    const marks = index === questions.length - 1
      ? Number(remaining.toFixed(2))
      : Number((total / questions.length).toFixed(2));
    remaining -= marks;
    return { ...question, marks };
  });
};

const arraysSame = (left = [], right = []) => (
  left.length === right.length &&
  [...left].sort((a, b) => a - b).every((value, index) => value === [...right].sort((a, b) => a - b)[index])
);

const gradeQuizAnswer = (question, answer = {}) => {
  const marks = Number(question.marks || 0);
  if (question.type === 'checkbox') {
    const selectedIndexes = Array.isArray(answer.selectedIndexes)
      ? answer.selectedIndexes.map(Number).filter(index => index >= 0)
      : [];
    const correctIndexes = (question.options || []).map((option, index) => option.isCorrect ? index : -1).filter(index => index >= 0);
    const correct = arraysSame(selectedIndexes, correctIndexes);
    return {
      selectedIndex: selectedIndexes[0] ?? -1,
      selectedIndexes,
      awardedMarks: correct ? marks : 0,
      reviewStatus: 'auto_graded'
    };
  }
  if (['short_answer', 'paragraph'].includes(question.type)) {
    const textAnswer = cleanCell(answer.textAnswer ?? answer.answer ?? '');
    const answerKey = (question.answerKey || []).map(value => cleanCell(value).toLowerCase()).filter(Boolean);
    if (!answerKey.length || question.type === 'paragraph') {
      return { textAnswer, awardedMarks: 0, reviewStatus: 'needs_review' };
    }
    const correct = answerKey.includes(textAnswer.toLowerCase());
    return { textAnswer, awardedMarks: correct ? marks : 0, reviewStatus: 'auto_graded' };
  }
  const selectedIndex = Number(answer.selectedIndex ?? answer ?? -1);
  const option = question.options?.[selectedIndex];
  return {
    selectedIndex,
    selectedIndexes: selectedIndex >= 0 ? [selectedIndex] : [],
    awardedMarks: option?.isCorrect ? marks : 0,
    reviewStatus: 'auto_graded'
  };
};

const parseQuizRows = async (filePath, ext) => {
  const { worksheets } = await loadWorkbook(filePath, ext);
  const rows = [];
  worksheets.forEach(worksheet => {
    const rawRows = [];
    worksheet.eachRow({ includeEmpty: false }, row => rawRows.push(rowToValues(row)));
    if (rawRows.length < 2) return;
    const headers = rawRows[0].map(normalizeHeader);
    rawRows.slice(1).forEach((values, index) => {
      const row = { __rowNumber: index + 2 };
      headers.forEach((header, colIndex) => {
        if (header) row[header] = values[colIndex];
      });
      rows.push(row);
    });
  });

  return rows.map(row => {
    const questionText = getRowValue(row, ['question', 'questions', 'question text', 'title']);
    const questionType = getRowValue(row, ['questiontype', 'question type', 'type']) || 'multiple_choice';
    const marks = Number(getRowValue(row, ['marks', 'mark', 'points', 'score']) || 1);
    const explanation = getRowValue(row, ['explanation', 'reason', 'solution']);
    const correctFeedback = getRowValue(row, ['correctfeedback', 'correct feedback', 'when right']);
    const wrongFeedback = getRowValue(row, ['wrongfeedback', 'wrong feedback', 'when wrong']);
    const required = !/^false|no|optional$/i.test(getRowValue(row, ['required', 'mandatory']));
    const topic = getRowValue(row, ['topic', 'unit', 'tag']);
    const options = [
      getRowValue(row, ['option1', 'option 1', 'a', 'optiona', 'option a']),
      getRowValue(row, ['option2', 'option 2', 'b', 'optionb', 'option b']),
      getRowValue(row, ['option3', 'option 3', 'c', 'optionc', 'option c']),
      getRowValue(row, ['option4', 'option 4', 'd', 'optiond', 'option d']),
      getRowValue(row, ['option5', 'option 5', 'e', 'optione', 'option e']),
      getRowValue(row, ['option6', 'option 6', 'f', 'optionf', 'option f'])
    ].filter(Boolean).map(text => ({ text, isCorrect: false }));
    const correctIndex = parseCorrectOptionIndex(getRowValue(row, ['correct', 'correct option', 'answer', 'correct answer']), options);
    if (correctIndex >= 0 && correctIndex < options.length) options[correctIndex].isCorrect = true;
    return { type: questionType, text: questionText, marks, explanation, correctFeedback, wrongFeedback, required, topic, answerKey: getRowValue(row, ['answer key', 'answerkey']) ? [getRowValue(row, ['answer key', 'answerkey'])] : [], options };
  });
};

const assertSubjectAccess = async (req, subjectId, options = {}) => {
  const subject = await Subject.findOne({
    _id: subjectId,
    isActive: true,
    pendingDeletion: { $ne: true }
  }).lean();
  if (!subject) {
    const err = new Error('Subject not found');
    err.statusCode = 404;
    throw err;
  }

  const user = req.user;
  if (user.role === 'teacher') {
    const assigned = (subject.assignedTeachers || []).some(id => String(id) === String(user._id));
    if (!assigned) {
      const err = new Error('This subject is not assigned to you');
      err.statusCode = 403;
      throw err;
    }
  } else if (user.role === 'admin') {
    const department = getAdminDepartment(user);
    if (department && subject.department !== department) {
      const err = new Error('Subject belongs to another department');
      err.statusCode = 403;
      throw err;
    }
  } else if (user.role === 'student') {
    const student = await User.findById(user._id).select('department branch semester enrolledSubjects status isRestricted subjectRestrictions').lean();
    const enrolled = (student?.enrolledSubjects || []).some(id => String(id) === String(subject._id));
    if (!enrolled || !studentMatchesSubject(student, subject)) {
      const err = new Error('You are not enrolled in this subject');
      err.statusCode = 403;
      throw err;
    }
    if (isProfileRestricted(student)) {
      const err = new Error('Your profile is restricted. You cannot receive subject updates or perform subject actions.');
      err.statusCode = 403;
      throw err;
    }
    if (isRestrictedForSubject(student, subject._id)) {
      const err = new Error(restrictedSubjectErrorMessage(subject.name));
      err.statusCode = 403;
      throw err;
    }
  }

  if (options.staffOnly && !isStaff(user)) {
    const err = new Error('Staff access required');
    err.statusCode = 403;
    throw err;
  }
  return subject;
};

const emitLmsEvent = async (req, subject, event, payload = {}) => {
  const io = req.app.get('io');
  if (!io || !subject) return;
  try {
    await invalidateLmsCache();
    io.to('admin_room').emit(event, payload);
    io.to(adminDepartmentRoom(subject.department)).emit(event, payload);
    (subject.assignedTeachers || []).forEach(teacherId => io.to(`user_${teacherId}`).emit(event, payload));
    const students = await getSubjectStudents(subject);
    students.forEach(student => {
      io.to(`student_${student._id}`).emit(event, payload);
      io.to(`user_${student._id}`).emit(event, payload);
    });
  } catch (error) {
    console.error('LMS socket emit failed:', error.message);
  }
};

const notifyDirect = async (req, notifications = []) => {
  const rows = notifications.filter(Boolean);
  if (!rows.length) return [];
  const studentRows = rows.filter(row => row.recipientRole === 'student' && row.recipient);
  const students = studentRows.length
    ? await User.find({ _id: { $in: studentRows.map(row => row.recipient) } })
      .select('_id role status isRestricted subjectRestrictions studentId')
      .lean()
    : [];
  const studentsById = new Map(students.map(student => [String(student._id), student]));
  const deliverableRows = rows.filter(row => {
    if (row.recipientRole !== 'student') return true;
    const subjectId = row.data?.subject || row.subject;
    const student = studentsById.get(String(row.recipient));
    if (!student) return false;
    if (!subjectId) return !isProfileRestricted(student) && student.status === 'active';
    return canReceiveSubjectUpdates(student, subjectId);
  });
  if (!deliverableRows.length) return [];
  deliverableRows.forEach(row => {
    if (row.recipientRole === 'student' && !row.recipientStudentId) {
      row.recipientStudentId = studentCodeOf(studentsById.get(String(row.recipient)));
    }
  });
  const created = await Notification.insertMany(deliverableRows, { ordered: false });
  const io = req.app.get('io');
  if (io) {
    created.forEach(notification => {
      if (!notification.recipient) return;
      io.to(`user_${notification.recipient}`).emit('notification_created', notification);
      io.to(`student_${notification.recipient}`).emit('notification_created', notification);
    });
  }
  return created;
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

const notifySubjectStudents = async (req, subject, type, title, message, data = {}) => {
  const students = await getSubjectStudents(subject);
  return notifyDirect(req, students.map(student => ({
    recipient: student._id,
    recipientRole: 'student',
    type,
    title,
    message,
    priority: type === 'lms_announcement' ? 'high' : 'medium',
    data: { subject: subject._id, ...data }
  })));
};

const getScopedSubjects = async (user) => {
  const query = { isActive: true, pendingDeletion: { $ne: true } };
  if (user.role === 'teacher') query.assignedTeachers = user._id;
  const department = getAdminDepartment(user);
  if (department) query.department = department;
  return Subject.find(query).select('_id name code department branch semester assignedTeachers').lean();
};

const publishedFilter = () => ({ $ne: false });

const getQuizCloseAt = (quiz) => {
  if (quiz.endAt) return new Date(quiz.endAt);
  if (quiz.startAt && quiz.durationMinutes) {
    return new Date(new Date(quiz.startAt).getTime() + Number(quiz.durationMinutes || 0) * 60 * 1000);
  }
  return null;
};

const getSubjectAttendanceSummary = async (subject, user) => {
  const completedLectures = await Lecture.find({
    subject: subject._id,
    status: 'completed',
    pendingDeletion: { $ne: true }
  }).select('_id').lean();
  const lectureIds = completedLectures.map(lecture => lecture._id);
  const summary = {
    totalLectures: completedLectures.length,
    attended: 0,
    percentage: '0.0',
    presentRecords: 0,
    absentRecords: 0
  };

  if (user.role === 'student') {
    const studentFilter = studentIdentityFilter(user);
    const attended = lectureIds.length
      ? await Attendance.countDocuments({ lecture: { $in: lectureIds }, ...studentFilter, status: { $in: ['present', 'late', 'excused'] } })
      : 0;
    return {
      ...summary,
      attended,
      percentage: lectureIds.length ? ((attended / lectureIds.length) * 100).toFixed(1) : '0.0'
    };
  }

  const [presentRecords, absentRecords] = lectureIds.length ? await Promise.all([
    Attendance.countDocuments({ lecture: { $in: lectureIds }, status: { $in: ['present', 'late', 'excused'] } }),
    Attendance.countDocuments({ lecture: { $in: lectureIds }, status: 'absent' })
  ]) : [0, 0];
  const totalRecords = presentRecords + absentRecords;
  return {
    ...summary,
    presentRecords,
    absentRecords,
    percentage: totalRecords ? ((presentRecords / totalRecords) * 100).toFixed(1) : '0.0'
  };
};

const buildSubjectProgress = async (subject, student = null) => {
  const studentFilter = student ? studentIdentityFilter(student) : null;
  const [assignments, quizzes, materials, submissions, attempts, recentGrade] = await Promise.all([
    LmsAssignment.find({ subject: subject._id, isPublished: publishedFilter() }).select('_id title dueDate maxMarks').sort({ dueDate: 1, createdAt: -1 }).lean(),
    LmsQuiz.find({ subject: subject._id, isPublished: publishedFilter() }).select('_id title totalMarks').sort({ createdAt: -1 }).lean(),
    LmsMaterial.find({ subject: subject._id, isActive: true, isPublished: publishedFilter() }).select('_id title resourceType createdAt').sort({ createdAt: -1 }).limit(3).lean(),
    studentFilter ? LmsSubmission.find({ subject: subject._id, ...studentFilter }).select('assignment status marks feedback gradedAt').lean() : [],
    studentFilter ? LmsQuizAttempt.find({ subject: subject._id, ...studentFilter }).select('quiz score totalMarks submittedAt').lean() : [],
    studentFilter ? LmsSubmission.findOne({ subject: subject._id, ...studentFilter, status: 'graded' }).select('assignment marks feedback gradedAt').sort({ gradedAt: -1 }).populate('assignment', 'title maxMarks').lean() : null
  ]);
  const submittedAssignments = new Set(submissions.map(item => String(item.assignment)));
  const attemptedQuizzes = new Set(attempts.map(item => String(item.quiz)));
  const pendingAssignments = assignments.filter(item => !submittedAssignments.has(String(item._id)));
  const pendingQuizzes = quizzes.filter(item => !attemptedQuizzes.has(String(item._id)));
  return {
    subject,
    materials,
    assignments: assignments.length,
    submissions: submissions.length,
    pendingAssignments,
    quizzes: quizzes.length,
    attempts: attempts.length,
    pendingQuizzes,
    recentGrade
  };
};

const handleError = (res, error, label) => {
  console.error(`${label} error:`, error);
  res.status(error.statusCode || 500).json({ success: false, message: error.message || 'Server error' });
};

const sanitizeQuiz = (quiz, user) => {
  const obj = quiz.toObject ? quiz.toObject() : { ...quiz };
  if (user?.role === 'student') {
    const released = Boolean(obj.resultsReleased);
    obj.questions = (obj.questions || []).map(question => ({
      _id: question._id,
      type: question.type || 'multiple_choice',
      text: question.text,
      required: question.required !== false,
      marks: released || obj.showPointValues !== false ? question.marks : undefined,
      explanation: released ? (question.explanation || '') : undefined,
      correctFeedback: released ? (question.correctFeedback || '') : undefined,
      wrongFeedback: released ? (question.wrongFeedback || '') : undefined,
      shuffleOptions: Boolean(question.shuffleOptions),
      options: (question.options || []).map((option, index) => (
        released && obj.showCorrectAnswers !== false
          ? { text: option.text, isCorrect: Boolean(option.isCorrect), originalIndex: index }
          : { text: option.text, originalIndex: index }
      ))
    }));
  }
  return obj;
};

const eventDateRange = (req) => {
  const start = req.query.startDate ? new Date(req.query.startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const end = req.query.endDate ? new Date(req.query.endDate) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  return {
    start: Number.isNaN(start.getTime()) ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) : start,
    end: Number.isNaN(end.getTime()) ? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) : end
  };
};

const getSubjectCalendar = async (req, res) => {
  try {
    const subject = await assertSubjectAccess(req, req.params.subjectId);
    const { start, end } = eventDateRange(req);
    const visibility = req.user.role === 'student' ? publishedFilter() : { $exists: true };
    const [assignments, quizzes, announcements] = await Promise.all([
      LmsAssignment.find({
        subject: subject._id,
        isPublished: visibility,
        $or: [
          { dueDate: { $gte: start, $lte: end } },
          { publishedAt: { $gte: start, $lte: end } },
          { createdAt: { $gte: start, $lte: end } }
        ]
      }).select('title dueDate maxMarks isPublished publishedAt createdAt tags').lean(),
      LmsQuiz.find({
        subject: subject._id,
        isPublished: visibility,
        $or: [
          { startAt: { $gte: start, $lte: end } },
          { endAt: { $gte: start, $lte: end } }
        ]
      }).select('title startAt endAt durationMinutes totalMarks isPublished resultsReleased tags').lean(),
      LmsAnnouncement.find({ subject: subject._id, createdAt: { $gte: start, $lte: end } }).select('title message priority createdAt').lean()
    ]);
    const events = [
      ...assignments.flatMap(item => ([
        (item.publishedAt || item.createdAt) && {
          id: `${item._id}-assigned`,
          sourceId: item._id,
          type: 'assignment_assigned',
          title: `${item.title} assigned`,
          startsAt: item.publishedAt || item.createdAt,
          status: item.isPublished === false ? 'draft' : 'published',
          tags: item.tags || [],
          meta: { maxMarks: item.maxMarks, dueDate: item.dueDate }
        },
        item.dueDate && {
          id: `${item._id}-deadline`,
          sourceId: item._id,
          type: 'assignment_deadline',
          title: `${item.title} deadline`,
          startsAt: item.dueDate,
          status: item.isPublished === false ? 'draft' : 'published',
          tags: item.tags || [],
          meta: { maxMarks: item.maxMarks, assignedAt: item.publishedAt || item.createdAt }
        }
      ].filter(Boolean))),
      ...quizzes.flatMap(item => {
        const closeAt = item.endAt || getQuizCloseAt(item);
        return [
          item.startAt && {
            id: `${item._id}-open`,
            sourceId: item._id,
            type: 'quiz_open',
            title: `${item.title} opens`,
            startsAt: item.startAt,
            status: item.isPublished === false ? 'draft' : item.resultsReleased ? 'released' : 'published',
            tags: item.tags || [],
            meta: { durationMinutes: item.durationMinutes, totalMarks: item.totalMarks, opensAt: item.startAt, closesAt: closeAt }
          },
          closeAt && {
            id: `${item._id}-close`,
            sourceId: item._id,
            type: 'quiz_close',
            title: `${item.title} closes`,
            startsAt: closeAt,
            status: item.resultsReleased ? 'released' : 'published',
            tags: item.tags || [],
            meta: { durationMinutes: item.durationMinutes, totalMarks: item.totalMarks, opensAt: item.startAt, closesAt: closeAt }
          }
        ].filter(Boolean);
      }),
      ...announcements.map(item => ({
        id: item._id,
        type: 'announcement',
        title: item.title,
        startsAt: item.createdAt,
        status: item.priority,
        meta: { message: item.message }
      }))
    ].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    res.json({ success: true, start, end, events });
  } catch (error) {
    handleError(res, error, 'getSubjectCalendar');
  }
};

const sanitizeQuizAttempts = (attempts = [], quizzes = [], user) => {
  if (user?.role !== 'student') return attempts;
  const releaseMap = new Map(quizzes.map(quiz => [String(quiz._id), Boolean(quiz.resultsReleased || quiz.releaseMode === 'immediate')]));
  return attempts.map(attempt => {
    const released = releaseMap.get(String(attempt.quiz?._id || attempt.quiz));
    if (released) return { ...attempt, resultReleased: true };
    const { score, totalMarks, answers, ...rest } = attempt;
    return { ...rest, resultReleased: false };
  });
};

const autoReleaseExpiredQuizzes = async (req, subject, quizzes = []) => {
  const now = new Date();
  const expired = quizzes.filter(quiz => (
    quiz.isPublished !== false &&
    !quiz.resultsReleased &&
    getQuizCloseAt(quiz) &&
    getQuizCloseAt(quiz) <= now
  ));
  if (!expired.length) return quizzes;

  for (const quiz of expired) {
    quiz.resultsReleased = true;
    quiz.resultsReleasedAt = now;
    await quiz.save();
    await notifySubjectStudents(
      req,
      subject,
      'lms_quiz_released',
      'Quiz result released',
      `${quiz.title} results are now available.`,
      { quiz: quiz._id }
    );
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'quiz_auto_released', quizId: quiz._id });
  }
  return quizzes;
};

const getSubjectOverview = async (req, res) => {
  try {
    const subject = await assertSubjectAccess(req, req.params.subjectId);
    const materialQuery = { subject: subject._id, isActive: true };
    const assignmentQuery = { subject: subject._id };
    const quizQuery = { subject: subject._id };
    if (req.user.role === 'student') {
      materialQuery.isPublished = publishedFilter();
      assignmentQuery.isPublished = publishedFilter();
      quizQuery.isPublished = publishedFilter();
    }
    const currentStudentFilter = req.user.role === 'student' ? studentIdentityFilter(req.user) : null;
    const [materialsRaw, materialFolders, assignmentsRaw, quizzesRaw, announcements, submissions, attempts, discussions, attendanceSummary] = await Promise.all([
      LmsMaterial.find(materialQuery).sort({ createdAt: -1 }).populate('createdBy', 'name').lean(),
      LmsMaterialFolder.find({ subject: subject._id, isActive: true }).sort({ order: 1, createdAt: 1 }).lean(),
      LmsAssignment.find(assignmentQuery).sort({ isPublished: 1, dueDate: 1, createdAt: -1 }).populate('createdBy', 'name').lean(),
      LmsQuiz.find(quizQuery).sort({ isPublished: 1, createdAt: -1 }).populate('createdBy', 'name'),
      LmsAnnouncement.find({ subject: subject._id }).sort({ createdAt: -1 }).populate('createdBy', 'name').lean(),
      req.user.role === 'student'
        ? LmsSubmission.find({ subject: subject._id, ...currentStudentFilter }).lean()
        : LmsSubmission.find({ subject: subject._id }).populate('student', 'name studentId email').lean(),
      req.user.role === 'student'
        ? LmsQuizAttempt.find({ subject: subject._id, ...currentStudentFilter }).lean()
        : LmsQuizAttempt.find({ subject: subject._id }).populate('student', 'name studentId email').lean(),
      LmsDiscussion.find(
        req.user.role === 'student'
          ? { subject: subject._id, ...currentStudentFilter }
          : { subject: subject._id }
      ).sort({ status: 1, updatedAt: -1 }).populate('student', 'name studentId').populate('lastReplyBy', 'name role').lean(),
      getSubjectAttendanceSummary(subject, req.user)
    ]);
    const materials = req.user.role === 'student' ? materialsRaw.filter(publicMaterialForStudent) : materialsRaw;
    const assignments = req.user.role === 'student' ? assignmentsRaw.filter(publicAssignmentForStudent) : assignmentsRaw;
    const quizzes = req.user.role === 'student' ? quizzesRaw.filter(publicQuizForStudent) : quizzesRaw;
    const discussionIds = discussions.map(item => item._id);
    const [replies, materialViews, privateComments] = await Promise.all([
      discussionIds.length
        ? LmsDiscussionReply.find({ discussion: { $in: discussionIds } }).sort({ createdAt: 1 }).populate('author', 'name role studentId').lean()
        : [],
      materials.length
        ? LmsMaterialView.find({ material: { $in: materials.map(item => item._id) } }).populate('student', 'name studentId email').lean()
        : [],
      submissions.length
        ? LmsPrivateComment.find({ submission: { $in: submissions.map(item => item._id) } }).sort({ createdAt: 1 }).populate('author', 'name role studentId').lean()
        : []
    ]);
    const repliesByDiscussion = replies.reduce((acc, reply) => {
      const key = String(reply.discussion);
      acc[key] = acc[key] || [];
      acc[key].push(reply);
      return acc;
    }, {});
    await autoReleaseExpiredQuizzes(req, subject, quizzes);
    const visibleAttempts = sanitizeQuizAttempts(attempts, quizzes, req.user);
    const enrolledStudents = await getSubjectStudents(subject);
    const studentCount = enrolledStudents.length;
    const publishedAssignments = assignments.filter(item => item.isPublished !== false);
    const publishedQuizzes = quizzes.filter(item => item.isPublished !== false);
    const completedAssignmentKeys = new Set(
      submissions
        .filter(item => publishedAssignments.some(assignment => String(assignment._id) === String(item.assignment?._id || item.assignment)))
        .map(item => `${item.assignment?._id || item.assignment}:${item.student?._id || item.student}`)
    );
    const completedQuizKeys = new Set(
      attempts
        .filter(item => publishedQuizzes.some(quiz => String(quiz._id) === String(item.quiz?._id || item.quiz)))
        .map(item => `${item.quiz?._id || item.quiz}:${item.student?._id || item.student}`)
    );
    const assignmentExpected = studentCount * publishedAssignments.length;
    const quizExpected = studentCount * publishedQuizzes.length;
    res.json({
      success: true,
      subject,
      materials,
      materialFolders,
      assignments,
      quizzes: quizzes.map(quiz => sanitizeQuiz(quiz, req.user)),
      announcements,
      submissions,
      attempts: visibleAttempts,
      materialViews,
      privateComments,
      discussions: discussions.map(item => ({ ...item, replies: repliesByDiscussion[String(item._id)] || [] })),
      attendanceSummary,
      analytics: {
        completion: {
          students: studentCount,
          assignmentTotal: assignmentExpected,
          assignmentCompleted: completedAssignmentKeys.size,
          assignmentRate: assignmentExpected ? Math.round((completedAssignmentKeys.size / assignmentExpected) * 100) : 0,
          quizTotal: quizExpected,
          quizCompleted: completedQuizKeys.size,
          quizRate: quizExpected ? Math.round((completedQuizKeys.size / quizExpected) * 100) : 0
        },
        openDoubts: discussions.filter(item => item.status === 'open').length
      }
    });
  } catch (error) {
    handleError(res, error, 'getSubjectOverview');
  }
};

const createMaterial = async (req, res) => {
  try {
    const subject = await assertSubjectAccess(req, req.params.subjectId, { staffOnly: true });
    const attachments = await buildAttachments(req, req.body.attachmentVisibility === 'download' ? 'download' : 'view');
    const firstFile = lmsUploadedFiles(req)[0];
    const firstAttachment = attachments.find(item => item.publicId);
    const fileUrl = firstAttachment?.url || '';
    const scheduledPublishAt = req.body.scheduledPublishAt ? new Date(req.body.scheduledPublishAt) : undefined;
    const material = await LmsMaterial.create({
      subject: subject._id,
      title: req.body.title,
      description: req.body.description || '',
      resourceType: fileUrl ? 'file' : (req.body.linkUrl ? 'link' : 'note'),
      fileUrl,
      fileName: firstFile?.originalname || '',
      fileSize: firstAttachment?.fileSize || firstFile?.size || 0,
      filePublicId: firstAttachment?.publicId || '',
      fileResourceType: firstAttachment?.resourceType || 'raw',
      attachments,
      linkUrl: req.body.linkUrl || '',
      tags: parseTags(req.body.tags),
      folder: req.body.folder || req.body.topic || parseTags(req.body.tags)[0] || '',
      topic: req.body.topic || parseTags(req.body.tags)[0] || '',
      category: req.body.category || 'notes',
      isPinned: toBoolean(req.body.isPinned),
      order: Number(req.body.order || 0),
      createdBy: req.user._id,
      isPublished: false,
      status: scheduledPublishAt ? 'scheduled' : 'draft',
      scheduledPublishAt,
      publishedAt: scheduledPublishAt && scheduledPublishAt <= new Date() ? new Date() : undefined
    });
    if (scheduledPublishAt && scheduledPublishAt <= new Date()) {
      material.isPublished = true;
      material.publishedBy = req.user._id;
      material.status = 'published';
      await material.save();
    }
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'material' });
    res.status(201).json({ success: true, material });
  } catch (error) {
    handleError(res, error, 'createMaterial');
  }
};

const createMaterialFolder = async (req, res) => {
  try {
    const subject = await assertSubjectAccess(req, req.params.subjectId, { staffOnly: true });
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'Folder name is required' });
    const folder = await LmsMaterialFolder.findOneAndUpdate(
      { subject: subject._id, name },
      { $set: { isActive: true }, $setOnInsert: { subject: subject._id, name, createdBy: req.user._id } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'material_folder_created', folderId: folder._id });
    res.status(201).json({ success: true, folder });
  } catch (error) {
    handleError(res, error, 'createMaterialFolder');
  }
};

const updateMaterialFolder = async (req, res) => {
  try {
    const folder = await LmsMaterialFolder.findById(req.params.id);
    if (!folder || !folder.isActive) return res.status(404).json({ success: false, message: 'Folder not found' });
    const subject = await assertSubjectAccess(req, folder.subject, { staffOnly: true });
    const nextName = String(req.body.name || '').trim();
    if (!nextName) return res.status(400).json({ success: false, message: 'Folder name is required' });
    const duplicate = await LmsMaterialFolder.findOne({ subject: subject._id, name: nextName, _id: { $ne: folder._id }, isActive: true });
    if (duplicate) return res.status(409).json({ success: false, message: 'A folder with this name already exists' });
    const oldName = folder.name;
    folder.name = nextName;
    await folder.save();
    if (oldName !== nextName) {
      await LmsMaterial.updateMany({ subject: subject._id, folder: oldName, isActive: true }, { $set: { folder: nextName } });
    }
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'material_folder_updated', folderId: folder._id });
    res.json({ success: true, folder });
  } catch (error) {
    handleError(res, error, 'updateMaterialFolder');
  }
};

const deleteMaterialFolder = async (req, res) => {
  try {
    const folder = await LmsMaterialFolder.findById(req.params.id);
    if (!folder || !folder.isActive) return res.status(404).json({ success: false, message: 'Folder not found' });
    const subject = await assertSubjectAccess(req, folder.subject, { staffOnly: true });
    const materialCount = await LmsMaterial.countDocuments({ subject: subject._id, folder: folder.name, isActive: true });
    if (materialCount > 0) {
      return res.status(400).json({ success: false, message: 'Move or delete materials inside this folder first.' });
    }
    folder.isActive = false;
    await folder.save();
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'material_folder_deleted', folderId: folder._id });
    res.json({ success: true });
  } catch (error) {
    handleError(res, error, 'deleteMaterialFolder');
  }
};

const updateMaterial = async (req, res) => {
  try {
    const material = await LmsMaterial.findById(req.params.id);
    if (!material) return res.status(404).json({ success: false, message: 'Material not found' });
    const subject = await assertSubjectAccess(req, material.subject, { staffOnly: true });
    if (material.isPublished || material.status !== 'draft') {
      return res.status(400).json({ success: false, message: 'Only draft materials can be edited.' });
    }
    const newAttachments = await buildAttachments(req, req.body.attachmentVisibility === 'download' ? 'download' : 'view');
    const firstFile = lmsUploadedFiles(req)[0];
    const firstAttachment = newAttachments.find(item => item.publicId);
    if (firstFile) {
      await cleanupCloudinaryAsset({ publicId: material.filePublicId, resourceType: material.fileResourceType });
      material.fileUrl = firstAttachment?.url || '';
      material.fileName = firstFile.originalname || '';
      material.fileSize = firstAttachment?.fileSize || firstFile.size || 0;
      material.filePublicId = firstAttachment?.publicId || '';
      material.fileResourceType = firstAttachment?.resourceType || 'raw';
    }
    if (newAttachments.length) {
      await cleanupAttachments(material.attachments);
      material.attachments = newAttachments;
    }
    material.title = req.body.title;
    material.description = req.body.description || '';
    material.resourceType = material.fileUrl ? 'file' : (req.body.linkUrl ? 'link' : 'note');
    material.linkUrl = req.body.linkUrl || '';
    material.tags = parseTags(req.body.tags);
    material.folder = req.body.folder || req.body.topic || parseTags(req.body.tags)[0] || '';
    material.topic = req.body.topic || parseTags(req.body.tags)[0] || '';
    material.category = req.body.category || 'notes';
    material.isPinned = toBoolean(req.body.isPinned);
    material.order = Number(req.body.order || 0);
    await material.save();
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'material_updated', materialId: material._id });
    res.json({ success: true, material });
  } catch (error) {
    handleError(res, error, 'updateMaterial');
  }
};

const createAssignment = async (req, res) => {
  try {
    const subject = await assertSubjectAccess(req, req.params.subjectId, { staffOnly: true });
    const attachments = await buildAttachments(req, req.body.attachmentVisibility || 'view');
    const firstFile = lmsUploadedFiles(req)[0];
    const firstAttachment = attachments.find(item => item.publicId);
    const scheduledPublishAt = req.body.scheduledPublishAt ? new Date(req.body.scheduledPublishAt) : undefined;
    const rubric = parseJson(req.body.rubric, []).filter(item => item?.title && Array.isArray(item.levels) && item.levels.length);
    const assignment = await LmsAssignment.create({
      subject: subject._id,
      title: req.body.title,
      description: req.body.description || '',
      dueDate: req.body.dueDate || undefined,
      dueTime: req.body.dueTime || '',
      maxMarks: Number(req.body.maxMarks || 10),
      isUngraded: toBoolean(req.body.isUngraded),
      gradeCategory: req.body.gradeCategory || 'homework',
      submissionMode: req.body.submissionMode === 'online' ? 'online' : 'offline',
      allowResubmission: toBoolean(req.body.allowResubmission),
      acceptLateSubmissions: toBoolean(req.body.acceptLateSubmissions),
      fileUrl: firstAttachment?.url || '',
      fileName: firstFile?.originalname || '',
      filePublicId: firstAttachment?.publicId || '',
      fileResourceType: firstAttachment?.resourceType || 'raw',
      attachments,
      tags: parseTags(req.body.tags),
      topic: req.body.topic || parseTags(req.body.tags)[0] || '',
      rubric,
      status: scheduledPublishAt ? 'scheduled' : 'draft',
      createdBy: req.user._id,
      isPublished: false,
      scheduledPublishAt
    });
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'assignment' });
    res.status(201).json({ success: true, assignment });
  } catch (error) {
    handleError(res, error, 'createAssignment');
  }
};

const updateAssignment = async (req, res) => {
  try {
    const assignment = await LmsAssignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' });
    const subject = await assertSubjectAccess(req, assignment.subject, { staffOnly: true });
    if (assignment.isPublished || assignment.status !== 'draft') {
      return res.status(400).json({ success: false, message: 'Only draft assignments can be edited.' });
    }
    const newAttachments = await buildAttachments(req, req.body.attachmentVisibility || 'view');
    const firstFile = lmsUploadedFiles(req)[0];
    const firstAttachment = newAttachments.find(item => item.publicId);
    const rubric = parseJson(req.body.rubric, []).filter(item => item?.title && Array.isArray(item.levels) && item.levels.length);
    if (firstFile) {
      await cleanupCloudinaryAsset({ publicId: assignment.filePublicId, resourceType: assignment.fileResourceType });
      assignment.fileUrl = firstAttachment?.url || '';
      assignment.fileName = firstFile.originalname || '';
      assignment.filePublicId = firstAttachment?.publicId || '';
      assignment.fileResourceType = firstAttachment?.resourceType || 'raw';
    }
    if (newAttachments.length) {
      await cleanupAttachments(assignment.attachments);
      assignment.attachments = newAttachments;
    }
    assignment.title = req.body.title;
    assignment.description = req.body.description || '';
    assignment.dueDate = req.body.dueDate || undefined;
    assignment.dueTime = req.body.dueTime || '';
    assignment.maxMarks = Number(req.body.maxMarks || 10);
    assignment.isUngraded = toBoolean(req.body.isUngraded);
    assignment.gradeCategory = req.body.gradeCategory || 'homework';
    assignment.submissionMode = req.body.submissionMode === 'online' ? 'online' : 'offline';
    assignment.allowResubmission = toBoolean(req.body.allowResubmission);
    assignment.acceptLateSubmissions = toBoolean(req.body.acceptLateSubmissions);
    assignment.tags = parseTags(req.body.tags);
    assignment.topic = req.body.topic || parseTags(req.body.tags)[0] || '';
    assignment.rubric = rubric;
    await assignment.save();
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'assignment_updated', assignmentId: assignment._id });
    res.json({ success: true, assignment });
  } catch (error) {
    handleError(res, error, 'updateAssignment');
  }
};

const submitAssignment = async (req, res) => {
  try {
    const assignment = await LmsAssignment.findById(req.params.assignmentId).lean();
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' });
    if (!publicAssignmentForStudent(assignment)) return res.status(404).json({ success: false, message: 'Assignment not found' });
    const subject = await assertSubjectAccess(req, assignment.subject);
    if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Students only' });
    const currentStudentFilter = studentIdentityFilter(req.user);
    const existingSubmission = await LmsSubmission.findOne({ assignment: assignment._id, ...currentStudentFilter });
    const dueAt = assignmentDueAt(assignment);
    const isLate = Boolean(dueAt && dueAt < new Date());
    if (isLate && !assignment.acceptLateSubmissions) {
      lmsUploadedFiles(req).forEach(file => removeTempFile(file.path));
      return res.status(400).json({ success: false, message: 'Assignment deadline has passed. Late submissions are disabled.' });
    }
    if (existingSubmission && (!assignment.allowResubmission || existingSubmission.isLocked)) {
      lmsUploadedFiles(req).forEach(file => removeTempFile(file.path));
      return res.status(409).json({ success: false, message: 'Assignment is already submitted and cannot be edited.' });
    }
    const uploadedAttachments = assignment.submissionMode === 'offline' ? [] : await buildAttachments(req, 'download');
    const firstAttachment = uploadedAttachments[0];
    if (existingSubmission) {
      await cleanupCloudinaryAsset({ publicId: existingSubmission.filePublicId, resourceType: existingSubmission.fileResourceType });
      await cleanupAttachments(existingSubmission.attachments);
    }
    const payload = {
      assignment: assignment._id,
      subject: subject._id,
      student: req.user._id,
      studentId: studentCodeOf(req.user),
      text: assignment.submissionMode === 'offline' ? 'Marked as submitted offline.' : (req.body.text || ''),
      fileUrl: firstAttachment?.url || '',
      fileName: firstAttachment?.fileName || '',
      filePublicId: firstAttachment?.publicId || '',
      fileResourceType: firstAttachment?.resourceType || 'raw',
      attachments: uploadedAttachments,
      status: isLate ? 'late' : 'submitted',
      isLate,
      isLocked: !assignment.allowResubmission,
      marks: null,
      feedback: '',
      gradedBy: undefined,
      gradedAt: undefined
    };
    const submission = existingSubmission
      ? await LmsSubmission.findByIdAndUpdate(existingSubmission._id, payload, { new: true })
      : await LmsSubmission.create(payload);
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'submission' });
    res.json({ success: true, submission });
  } catch (error) {
    handleError(res, error, 'submitAssignment');
  }
};

const gradeSubmission = async (req, res) => {
  try {
    const submission = await LmsSubmission.findById(req.params.submissionId).populate('assignment').populate('student', 'name');
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });
    const subject = await assertSubjectAccess(req, submission.subject, { staffOnly: true });
    submission.marks = Number(req.body.marks || 0);
    submission.feedback = req.body.feedback || '';
    submission.rubricScores = Array.isArray(req.body.rubricScores) ? req.body.rubricScores : submission.rubricScores;
    submission.status = toBoolean(req.body.returnNow) ? 'returned' : 'graded';
    submission.gradedBy = req.user._id;
    submission.gradedAt = new Date();
    if (submission.status === 'returned') {
      submission.returnedAt = new Date();
      submission.returnedBy = req.user._id;
    }
    await submission.save();
    if (submission.assignment?.rubric?.length && !submission.assignment.rubricLocked) {
      await LmsAssignment.updateOne({ _id: submission.assignment._id }, { rubricLocked: true });
    }
    await notifyDirect(req, [{
      recipient: submission.student._id,
      recipientRole: 'student',
      type: 'lms_assignment_graded',
      title: 'Assignment graded',
      message: `${submission.assignment.title} has been graded.`,
      data: { subject: subject._id, assignment: submission.assignment._id, submission: submission._id }
    }]);
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'grade' });
    res.json({ success: true, submission });
  } catch (error) {
    handleError(res, error, 'gradeSubmission');
  }
};

const returnSubmission = async (req, res) => {
  try {
    const submission = await LmsSubmission.findById(req.params.submissionId).populate('assignment').populate('student', 'name');
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });
    const subject = await assertSubjectAccess(req, submission.subject, { staffOnly: true });
    submission.status = 'returned';
    submission.returnedAt = new Date();
    submission.returnedBy = req.user._id;
    await submission.save();
    await notifyDirect(req, [{
      recipient: submission.student._id,
      recipientRole: 'student',
      type: 'lms_assignment_graded',
      title: 'Assignment returned',
      message: `${submission.assignment.title} has been returned.`,
      data: { subject: subject._id, assignment: submission.assignment._id, submission: submission._id }
    }]);
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'assignment_returned' });
    res.json({ success: true, submission });
  } catch (error) {
    handleError(res, error, 'returnSubmission');
  }
};

const bulkReturnAssignment = async (req, res) => {
  try {
    const assignment = await LmsAssignment.findById(req.params.assignmentId);
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' });
    const subject = await assertSubjectAccess(req, assignment.subject, { staffOnly: true });
    const submissions = await LmsSubmission.find({ assignment: assignment._id }).populate('student', 'name');
    const now = new Date();
    await LmsSubmission.updateMany(
      { assignment: assignment._id },
      { status: 'returned', returnedAt: now, returnedBy: req.user._id }
    );
    await notifyDirect(req, submissions.map(submission => ({
      recipient: submission.student._id,
      recipientRole: 'student',
      type: 'lms_assignment_graded',
      title: 'Assignment returned',
      message: `${assignment.title} has been returned.`,
      data: { subject: subject._id, assignment: assignment._id, submission: submission._id }
    })));
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'assignment_bulk_returned' });
    res.json({ success: true, returned: submissions.length });
  } catch (error) {
    handleError(res, error, 'bulkReturnAssignment');
  }
};

const markMaterialViewed = async (req, res) => {
  try {
    const material = await LmsMaterial.findById(req.params.id).lean();
    if (!material || !material.isActive) return res.status(404).json({ success: false, message: 'Material not found' });
    if (!publicMaterialForStudent(material)) return res.status(404).json({ success: false, message: 'Material not found' });
    const subject = await assertSubjectAccess(req, material.subject);
    if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Students only' });
    const view = await LmsMaterialView.findOneAndUpdate(
      { material: material._id, ...studentIdentityFilter(req.user) },
      { material: material._id, subject: subject._id, student: req.user._id, studentId: studentCodeOf(req.user), viewedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'material_viewed', materialId: material._id });
    res.json({ success: true, view });
  } catch (error) {
    handleError(res, error, 'markMaterialViewed');
  }
};

const getSubmissionComments = async (req, res) => {
  try {
    const submission = await LmsSubmission.findById(req.params.submissionId).lean();
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });
    await assertSubjectAccess(req, submission.subject, isStaff(req.user) ? { staffOnly: true } : {});
    if (req.user.role === 'student' && String(submission.student) !== String(req.user._id) && String(submission.studentId || '').toUpperCase() !== studentCodeOf(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const comments = await LmsPrivateComment.find({ submission: submission._id }).sort({ createdAt: 1 }).populate('author', 'name role studentId').lean();
    res.json({ success: true, comments });
  } catch (error) {
    handleError(res, error, 'getSubmissionComments');
  }
};

const addSubmissionComment = async (req, res) => {
  try {
    const submission = await LmsSubmission.findById(req.params.submissionId).populate('assignment').populate('student', 'name _id studentId');
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });
    const subject = await assertSubjectAccess(req, submission.subject, isStaff(req.user) ? { staffOnly: true } : {});
    if (req.user.role === 'student' && String(submission.student?._id || submission.student) !== String(req.user._id) && String(submission.studentId || submission.student?.studentId || '').toUpperCase() !== studentCodeOf(req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    const comment = await LmsPrivateComment.create({
      assignment: submission.assignment._id || submission.assignment,
      submission: submission._id,
      subject: subject._id,
      student: submission.student._id || submission.student,
      author: req.user._id,
      authorRole: req.user.role,
      message: req.body.message
    });
    const recipient = isStaff(req.user) ? submission.student._id : submission.assignment.createdBy;
    if (recipient) {
      await notifyDirect(req, [{
        recipient,
        recipientRole: isStaff(req.user) ? 'student' : 'teacher',
        type: 'lms_private_comment',
        title: 'Assignment private comment',
        message: `${req.user.name} commented on ${submission.assignment.title}.`,
        data: { subject: subject._id, assignment: submission.assignment._id, submission: submission._id }
      }]);
    }
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'private_comment' });
    res.status(201).json({ success: true, comment });
  } catch (error) {
    handleError(res, error, 'addSubmissionComment');
  }
};

const createQuiz = async (req, res) => {
  try {
    const subject = await assertSubjectAccess(req, req.params.subjectId, { staffOnly: true });
    const questions = distributeQuizMarks(
      normalizeQuizQuestions(Array.isArray(req.body.questions) ? req.body.questions : JSON.parse(req.body.questions || '[]')),
      req.body.totalMarks
    );
    if (!questions.length) return res.status(400).json({ success: false, message: 'Add at least one quiz question' });
    const quiz = await LmsQuiz.create({
      subject: subject._id,
      title: req.body.title,
      description: req.body.description || '',
      startAt: req.body.startAt || undefined,
      endAt: req.body.endAt || undefined,
      durationMinutes: Number(req.body.durationMinutes || 15),
      questions,
      tags: parseTags(req.body.tags),
      topic: req.body.topic || parseTags(req.body.tags)[0] || '',
      releaseMode: req.body.releaseMode === 'immediate' ? 'immediate' : 'manual',
      showCorrectAnswers: req.body.showCorrectAnswers === undefined ? true : toBoolean(req.body.showCorrectAnswers),
      showPointValues: req.body.showPointValues === undefined ? true : toBoolean(req.body.showPointValues),
      showMissedQuestions: req.body.showMissedQuestions === undefined ? true : toBoolean(req.body.showMissedQuestions),
      ...quizControlPayload(req.body),
      allowLateAttempt: toBoolean(req.body.allowLateAttempt),
      attemptLimit: Number(req.body.attemptLimit || 1),
      status: req.body.scheduledPublishAt ? 'scheduled' : 'draft',
      scheduledPublishAt: req.body.scheduledPublishAt || undefined,
      createdBy: req.user._id,
      isPublished: false
    });
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'quiz' });
    res.status(201).json({ success: true, quiz: sanitizeQuiz(quiz, req.user) });
  } catch (error) {
    handleError(res, error, 'createQuiz');
  }
};

const updateQuiz = async (req, res) => {
  try {
    const quiz = await LmsQuiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });
    const subject = await assertSubjectAccess(req, quiz.subject, { staffOnly: true });
    if (quiz.isPublished || quiz.status !== 'draft') {
      return res.status(400).json({ success: false, message: 'Only draft quizzes can be edited.' });
    }
    const questions = distributeQuizMarks(
      normalizeQuizQuestions(Array.isArray(req.body.questions) ? req.body.questions : JSON.parse(req.body.questions || '[]')),
      req.body.totalMarks
    );
    if (!questions.length) return res.status(400).json({ success: false, message: 'Add at least one quiz question' });
    quiz.title = cleanCell(req.body.title);
    quiz.description = cleanCell(req.body.description || '');
    quiz.startAt = req.body.startAt || undefined;
    quiz.endAt = req.body.endAt || undefined;
    quiz.durationMinutes = Number(req.body.durationMinutes || 15);
    quiz.questions = questions;
    quiz.tags = parseTags(req.body.tags);
    quiz.topic = req.body.topic || parseTags(req.body.tags)[0] || '';
    quiz.releaseMode = req.body.releaseMode === 'immediate' ? 'immediate' : 'manual';
    quiz.showCorrectAnswers = req.body.showCorrectAnswers === undefined ? true : toBoolean(req.body.showCorrectAnswers);
    quiz.showPointValues = req.body.showPointValues === undefined ? true : toBoolean(req.body.showPointValues);
    quiz.showMissedQuestions = req.body.showMissedQuestions === undefined ? true : toBoolean(req.body.showMissedQuestions);
    Object.assign(quiz, quizControlPayload(req.body));
    quiz.allowLateAttempt = toBoolean(req.body.allowLateAttempt);
    quiz.attemptLimit = Number(req.body.attemptLimit || 1);
    await quiz.save();
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'quiz_updated', quizId: quiz._id });
    res.json({ success: true, quiz: sanitizeQuiz(quiz, req.user) });
  } catch (error) {
    handleError(res, error, 'updateQuiz');
  }
};

const importQuiz = async (req, res) => {
  try {
    const subject = await assertSubjectAccess(req, req.params.subjectId, { staffOnly: true });
    if (!req.file) return res.status(400).json({ success: false, message: 'Upload an Excel or CSV file.' });
    const ext = path.extname(req.file.originalname || '').toLowerCase();
    if (!['.xlsx', '.csv'].includes(ext)) {
      removeTempFile(req.file.path);
      return res.status(400).json({ success: false, message: 'Only .xlsx or .csv quiz files are supported.' });
    }
    const parsedQuestions = await parseQuizRows(req.file.path, ext);
    removeTempFile(req.file.path);
    const questions = distributeQuizMarks(normalizeQuizQuestions(parsedQuestions), req.body.totalMarks);
    if (!questions.length) {
      return res.status(400).json({
        success: false,
        message: 'No valid questions found. Use columns: question, option1, option2, option3, option4, correct.'
      });
    }
    const quiz = await LmsQuiz.create({
      subject: subject._id,
      title: req.body.title || path.basename(req.file.originalname || 'Imported Quiz', path.extname(req.file.originalname || '')),
      description: req.body.description || 'Imported from spreadsheet',
      startAt: req.body.startAt || undefined,
      endAt: req.body.endAt || undefined,
      durationMinutes: Number(req.body.durationMinutes || 15),
      questions,
      tags: parseTags(req.body.tags),
      topic: req.body.topic || parseTags(req.body.tags)[0] || '',
      releaseMode: req.body.releaseMode === 'immediate' ? 'immediate' : 'manual',
      showCorrectAnswers: req.body.showCorrectAnswers === undefined ? true : toBoolean(req.body.showCorrectAnswers),
      showPointValues: req.body.showPointValues === undefined ? true : toBoolean(req.body.showPointValues),
      showMissedQuestions: req.body.showMissedQuestions === undefined ? true : toBoolean(req.body.showMissedQuestions),
      ...quizControlPayload(req.body),
      status: req.body.scheduledPublishAt ? 'scheduled' : 'draft',
      scheduledPublishAt: req.body.scheduledPublishAt || undefined,
      createdBy: req.user._id,
      isPublished: false
    });
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'quiz' });
    res.status(201).json({ success: true, quiz: sanitizeQuiz(quiz, req.user), imported: questions.length });
  } catch (error) {
    removeTempFile(req.file?.path);
    handleError(res, error, 'importQuiz');
  }
};

const attemptQuiz = async (req, res) => {
  try {
    const quiz = await LmsQuiz.findById(req.params.quizId);
    if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });
    if (!publicQuizForStudent(quiz)) return res.status(404).json({ success: false, message: 'Quiz not found' });
    const subject = await assertSubjectAccess(req, quiz.subject);
    if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Students only' });
    if (quiz.resultsReleased) return res.status(400).json({ success: false, message: 'Quiz is completed and results are released.' });
    const now = new Date();
    if (quiz.startAt && new Date(quiz.startAt) > now) {
      return res.status(400).json({ success: false, message: 'Quiz has not opened yet' });
    }
    const quizCloseAt = getQuizCloseAt(quiz);
    if (quizCloseAt && quizCloseAt < now && !quiz.allowLateAttempt) {
      await autoReleaseExpiredQuizzes(req, subject, [quiz]);
      return res.status(400).json({ success: false, message: 'Quiz is closed' });
    }
    const existingAttempts = await LmsQuizAttempt.countDocuments({ quiz: quiz._id, ...studentIdentityFilter(req.user) });
    if (existingAttempts >= Number(quiz.attemptLimit || 1)) {
      return res.status(409).json({ success: false, message: 'Quiz is already submitted and cannot be edited.' });
    }
    const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
    const answersByQuestionId = new Map(
      answers
        .filter(answer => answer?.question)
        .map(answer => [String(answer.question), answer])
    );
    const normalizedAnswers = quiz.questions.map((question, index) => {
      const submittedAnswer = answersByQuestionId.get(String(question._id)) || answers[index] || {};
      const graded = gradeQuizAnswer(question, submittedAnswer);
      return { question: question._id, ...graded };
    });
    const score = normalizedAnswers.reduce((sum, answer) => sum + Number(answer.awardedMarks || 0), 0);
    const needsReview = normalizedAnswers.some(answer => answer.reviewStatus === 'needs_review');
    const tabSwitchCount = clampNumber(req.body.tabSwitchCount, 0, 0, 1000);
    const timeSpentSeconds = clampNumber(req.body.timeSpentSeconds, 0, 0, 24 * 60 * 60);
    const startedAt = req.body.startedAt ? new Date(req.body.startedAt) : undefined;
    const tabSwitches = Array.isArray(req.body.tabSwitches)
      ? req.body.tabSwitches.slice(0, 50).map(item => ({
        occurredAt: item?.occurredAt ? new Date(item.occurredAt) : new Date(),
        reason: cleanCell(item?.reason || 'visibility_hidden').slice(0, 80)
      }))
      : [];
    const antiCheatFlags = [];
    if (quiz.tabSwitchWarning && tabSwitchCount > 0) antiCheatFlags.push('tab_switch_detected');
    if (quiz.tabSwitchWarning && tabSwitchCount > Number(quiz.maxTabSwitchWarnings || 0)) antiCheatFlags.push('tab_switch_limit_exceeded');
    if (quiz.durationMinutes && timeSpentSeconds > (Number(quiz.durationMinutes) * 60 + 60)) antiCheatFlags.push('timer_overtime');
    const attempt = await LmsQuizAttempt.create({
      quiz: quiz._id,
      subject: subject._id,
      student: req.user._id,
      studentId: studentCodeOf(req.user),
      answers: normalizedAnswers,
      score,
      totalMarks: quiz.totalMarks,
      status: needsReview ? 'needs_review' : 'submitted',
      gradingSource: needsReview ? 'mixed' : 'auto',
      startedAt: startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : undefined,
      timeSpentSeconds,
      tabSwitchCount,
      tabSwitches,
      antiCheatFlags,
      submittedAt: new Date()
    });
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'quiz_attempt', quizId: quiz._id });
    const resultVisible = quiz.resultsReleased || (quiz.releaseMode === 'immediate' && !needsReview);
    res.json({
      success: true,
      attempt: resultVisible
        ? { ...attempt.toObject(), resultReleased: true }
        : {
          _id: attempt._id,
          quiz: attempt.quiz,
          subject: attempt.subject,
          student: attempt.student,
          submittedAt: attempt.submittedAt,
          resultReleased: false
        }
    });
  } catch (error) {
    handleError(res, error, 'attemptQuiz');
  }
};

const releaseQuizResults = async (req, res) => {
  try {
    const quiz = await LmsQuiz.findById(req.params.quizId);
    if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });
    if (quiz.isPublished === false) return res.status(400).json({ success: false, message: 'Publish the quiz before releasing results' });
    const subject = await assertSubjectAccess(req, quiz.subject, { staffOnly: true });
    quiz.resultsReleased = true;
    quiz.resultsReleasedAt = new Date();
    quiz.resultsReleasedBy = req.user._id;
    await quiz.save();
    await notifySubjectStudents(
      req,
      subject,
      'lms_quiz_released',
      'Quiz result released',
      `${quiz.title} results are now available.`,
      { quiz: quiz._id }
    );
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'quiz_results_released', quizId: quiz._id });
    res.json({ success: true, quiz: sanitizeQuiz(quiz, req.user) });
  } catch (error) {
    handleError(res, error, 'releaseQuizResults');
  }
};

const getAssignmentAnalytics = async (req, res) => {
  try {
    const assignment = await LmsAssignment.findById(req.params.id).lean();
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' });
    const subject = await assertSubjectAccess(req, assignment.subject, { staffOnly: true });
    const [students, submissions] = await Promise.all([
      getSubjectStudents(subject),
      LmsSubmission.find({ assignment: assignment._id }).populate('student', 'name studentId email').lean()
    ]);
    const marks = submissions.map(item => Number(item.marks)).filter(Number.isFinite);
    res.json({
      success: true,
      assignment,
      analytics: {
        assigned: students.length,
        submitted: new Set(submissions.map(item => String(item.student?._id || item.student))).size,
        missing: Math.max(students.length - submissions.length, 0),
        late: submissions.filter(item => item.isLate || item.status === 'late').length,
        graded: submissions.filter(item => ['graded', 'returned'].includes(item.status)).length,
        returned: submissions.filter(item => item.status === 'returned').length,
        averageMarks: marks.length ? Number((marks.reduce((sum, mark) => sum + mark, 0) / marks.length).toFixed(2)) : 0
      },
      submissions
    });
  } catch (error) {
    handleError(res, error, 'getAssignmentAnalytics');
  }
};

const getQuizAnalytics = async (req, res) => {
  try {
    const quiz = await LmsQuiz.findById(req.params.id).lean();
    if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });
    const subject = await assertSubjectAccess(req, quiz.subject, { staffOnly: true });
    const [students, attempts] = await Promise.all([
      getSubjectStudents(subject),
      LmsQuizAttempt.find({ quiz: quiz._id }).populate('student', 'name studentId email').lean()
    ]);
    const scores = attempts.map(item => Number(item.score)).filter(Number.isFinite);
    const questionStats = (quiz.questions || []).map((question, index) => {
      const correct = attempts.filter(attempt => Number(attempt.answers?.[index]?.awardedMarks || 0) >= Number(question.marks || 0)).length;
      return {
        question: question.text,
        correct,
        missed: Math.max(attempts.length - correct, 0),
        correctnessRate: attempts.length ? Math.round((correct / attempts.length) * 100) : 0
      };
    });
    res.json({
      success: true,
      quiz: sanitizeQuiz(quiz, req.user),
      analytics: {
        assigned: students.length,
        attempted: new Set(attempts.map(item => String(item.student?._id || item.student))).size,
        notAttempted: Math.max(students.length - attempts.length, 0),
        averageScore: scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)) : 0,
        highestScore: scores.length ? Math.max(...scores) : 0,
        lowestScore: scores.length ? Math.min(...scores) : 0,
        needsReview: attempts.filter(item => item.status === 'needs_review').length,
        questionStats
      },
      attempts
    });
  } catch (error) {
    handleError(res, error, 'getQuizAnalytics');
  }
};

const getMaterialAnalytics = async (req, res) => {
  try {
    const material = await LmsMaterial.findById(req.params.id).lean();
    if (!material || !material.isActive) return res.status(404).json({ success: false, message: 'Material not found' });
    const subject = await assertSubjectAccess(req, material.subject, { staffOnly: true });
    const [students, views] = await Promise.all([
      getSubjectStudents(subject),
      LmsMaterialView.find({ material: material._id }).sort({ viewedAt: -1 }).populate('student', 'name studentId email').lean()
    ]);
    const viewed = new Set(views.map(item => String(item.student?._id || item.student))).size;
    res.json({
      success: true,
      material,
      analytics: {
        assigned: students.length,
        viewed,
        notViewed: Math.max(students.length - viewed, 0),
        viewRate: students.length ? Math.round((viewed / students.length) * 100) : 0,
        recentViewers: views.slice(0, 10)
      },
      views
    });
  } catch (error) {
    handleError(res, error, 'getMaterialAnalytics');
  }
};

const publishMaterial = async (req, res) => {
  try {
    const material = await LmsMaterial.findById(req.params.id);
    if (!material || !material.isActive) return res.status(404).json({ success: false, message: 'Material not found' });
    const subject = await assertSubjectAccess(req, material.subject, { staffOnly: true });
    material.isPublished = true;
    material.status = 'published';
    material.publishedAt = new Date();
    material.publishedBy = req.user._id;
    await material.save();
    await notifySubjectStudents(req, subject, 'lms_material_added', 'New study material', `${material.title} was published in ${subject.name}.`, { material: material._id, materialTitle: material.title, subjectName: subject.name });
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'material_published', materialId: material._id });
    res.json({ success: true, material });
  } catch (error) {
    handleError(res, error, 'publishMaterial');
  }
};

const publishAssignment = async (req, res) => {
  try {
    const assignment = await LmsAssignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' });
    const subject = await assertSubjectAccess(req, assignment.subject, { staffOnly: true });
    assignment.isPublished = true;
    assignment.status = 'published';
    assignment.publishedAt = new Date();
    assignment.publishedBy = req.user._id;
    await assignment.save();
    await notifySubjectStudents(req, subject, 'lms_assignment_created', 'New assignment', `${assignment.title} is assigned in ${subject.name}.`, { assignment: assignment._id, assignmentTitle: assignment.title, subjectName: subject.name });
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'assignment_published', assignmentId: assignment._id });
    res.json({ success: true, assignment });
  } catch (error) {
    handleError(res, error, 'publishAssignment');
  }
};

const publishQuiz = async (req, res) => {
  try {
    const quiz = await LmsQuiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });
    const subject = await assertSubjectAccess(req, quiz.subject, { staffOnly: true });
    quiz.isPublished = true;
    quiz.status = 'published';
    quiz.publishedAt = new Date();
    quiz.publishedBy = req.user._id;
    await quiz.save();
    await notifySubjectStudents(req, subject, 'lms_quiz_created', 'New quiz', `${quiz.title} is available in ${subject.name}.`, { quiz: quiz._id, quizTitle: quiz.title, subjectName: subject.name });
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'quiz_published', quizId: quiz._id });
    res.json({ success: true, quiz: sanitizeQuiz(quiz, req.user) });
  } catch (error) {
    handleError(res, error, 'publishQuiz');
  }
};

const createAnnouncement = async (req, res) => {
  try {
    const subject = await assertSubjectAccess(req, req.params.subjectId, { staffOnly: true });
    const announcement = await LmsAnnouncement.create({
      subject: subject._id,
      department: subject.department,
      branch: subject.branch || '',
      semester: subject.semester,
      title: req.body.title,
      message: req.body.message,
      priority: req.body.priority || 'medium',
      createdBy: req.user._id
    });
    await notifySubjectStudents(req, subject, 'lms_announcement', announcement.title, announcement.message, { announcement: announcement._id });
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'announcement' });
    res.status(201).json({ success: true, announcement });
  } catch (error) {
    handleError(res, error, 'createAnnouncement');
  }
};

const deleteMaterial = async (req, res) => {
  try {
    const material = await LmsMaterial.findById(req.params.id);
    if (!material) return res.status(404).json({ success: false, message: 'Material not found' });
    const subject = await assertSubjectAccess(req, material.subject, { staffOnly: true });
    await cleanupCloudinaryAsset({ publicId: material.filePublicId, resourceType: material.fileResourceType });
    await cleanupAttachments(material.attachments);
    await LmsMaterialView.deleteMany({ material: material._id });
    await material.deleteOne();
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'material_deleted' });
    res.json({ success: true, message: 'Material deleted' });
  } catch (error) {
    handleError(res, error, 'deleteMaterial');
  }
};

const deleteAssignment = async (req, res) => {
  try {
    const assignment = await LmsAssignment.findById(req.params.id);
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' });
    const subject = await assertSubjectAccess(req, assignment.subject, { staffOnly: true });
    await cleanupCloudinaryAsset({ publicId: assignment.filePublicId, resourceType: assignment.fileResourceType });
    await cleanupAttachments(assignment.attachments);
    const submissions = await LmsSubmission.find({ assignment: assignment._id }).select('filePublicId fileResourceType attachments');
    await Promise.all(submissions.map(async (submission) => {
      await cleanupCloudinaryAsset({ publicId: submission.filePublicId, resourceType: submission.fileResourceType });
      await cleanupAttachments(submission.attachments);
    }));
    await LmsPrivateComment.deleteMany({ assignment: assignment._id });
    await LmsSubmission.deleteMany({ assignment: assignment._id });
    await assignment.deleteOne();
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'assignment_deleted' });
    res.json({ success: true, message: 'Assignment and submissions deleted' });
  } catch (error) {
    handleError(res, error, 'deleteAssignment');
  }
};

const deleteQuiz = async (req, res) => {
  try {
    const quiz = await LmsQuiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });
    const subject = await assertSubjectAccess(req, quiz.subject, { staffOnly: true });
    await LmsQuizAttempt.deleteMany({ quiz: quiz._id });
    await quiz.deleteOne();
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'quiz_deleted' });
    res.json({ success: true, message: 'Quiz and attempts deleted' });
  } catch (error) {
    handleError(res, error, 'deleteQuiz');
  }
};

const deleteAnnouncement = async (req, res) => {
  try {
    const announcement = await LmsAnnouncement.findById(req.params.id);
    if (!announcement) return res.status(404).json({ success: false, message: 'Announcement not found' });
    const subject = await assertSubjectAccess(req, announcement.subject, { staffOnly: true });
    await announcement.deleteOne();
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'announcement_deleted' });
    res.json({ success: true, message: 'Announcement deleted' });
  } catch (error) {
    handleError(res, error, 'deleteAnnouncement');
  }
};

const getStudentProgress = async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Students only' });
    const student = await User.findById(req.user._id).select('enrolledSubjects status isRestricted subjectRestrictions').lean();
    if (!student || isProfileRestricted(student)) {
      return res.json({
        success: true,
        progress: {
          materials: 0,
          assignments: 0,
          submissions: 0,
          pendingAssignments: 0,
          quizzes: 0,
          attempts: 0,
          pendingQuizzes: 0,
          openDoubts: 0,
          recentMaterials: [],
          subjects: []
        }
      });
    }
    const subjectIds = student?.enrolledSubjects || [];
    const subjects = await Subject.find({ _id: { $in: subjectIds }, isActive: true, pendingDeletion: { $ne: true } })
      .select('_id name code department branch semester')
      .sort({ semester: 1, name: 1 })
      .lean();
    const visibleSubjects = subjects.filter(subject => !isRestrictedForSubject(student, subject._id));
    const visibleSubjectIds = visibleSubjects.map(subject => subject._id);
    const currentStudentFilter = studentIdentityFilter(req.user);
    const [assignments, submissions, quizzes, attempts, materials, discussions, subjectProgress] = await Promise.all([
      LmsAssignment.countDocuments({ subject: { $in: visibleSubjectIds }, isPublished: publishedFilter() }),
      LmsSubmission.countDocuments({ subject: { $in: visibleSubjectIds }, ...currentStudentFilter }),
      LmsQuiz.countDocuments({ subject: { $in: visibleSubjectIds }, isPublished: publishedFilter() }),
      LmsQuizAttempt.countDocuments({ subject: { $in: visibleSubjectIds }, ...currentStudentFilter }),
      LmsMaterial.countDocuments({ subject: { $in: visibleSubjectIds }, isActive: true, isPublished: publishedFilter() }),
      LmsDiscussion.countDocuments({ subject: { $in: visibleSubjectIds }, ...currentStudentFilter, status: 'open' }),
      Promise.all(visibleSubjects.map(subject => buildSubjectProgress(subject, req.user)))
    ]);
    const recentMaterials = await LmsMaterial.find({ subject: { $in: visibleSubjectIds }, isActive: true, isPublished: publishedFilter() })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('subject', 'name code')
      .lean();
    res.json({
      success: true,
      progress: {
        materials,
        assignments,
        submissions,
        pendingAssignments: Math.max(assignments - submissions, 0),
        quizzes,
        attempts,
        pendingQuizzes: Math.max(quizzes - attempts, 0),
        openDoubts: discussions,
        recentMaterials,
        subjects: subjectProgress
      }
    });
  } catch (error) {
    handleError(res, error, 'getStudentProgress');
  }
};

const getTeacherSummary = async (req, res) => {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ success: false, message: 'Staff only' });
    const subjects = await getScopedSubjects(req.user);
    const subjectIds = subjects.map(subject => subject._id);
    const [materials, assignments, submissions, ungraded, quizzes, attempts, announcements, openDoubts, recentDiscussions, recentMaterials, publishedAssignments, publishedQuizzes, submissionRows, attemptRows, subjectStudentRows] = await Promise.all([
      LmsMaterial.countDocuments({ subject: { $in: subjectIds }, isActive: true, isPublished: publishedFilter() }),
      LmsAssignment.countDocuments({ subject: { $in: subjectIds }, isPublished: publishedFilter() }),
      LmsSubmission.countDocuments({ subject: { $in: subjectIds } }),
      LmsSubmission.countDocuments({ subject: { $in: subjectIds }, status: 'submitted' }),
      LmsQuiz.countDocuments({ subject: { $in: subjectIds }, isPublished: publishedFilter() }),
      LmsQuizAttempt.countDocuments({ subject: { $in: subjectIds } }),
      LmsAnnouncement.countDocuments({ subject: { $in: subjectIds } }),
      LmsDiscussion.countDocuments({ subject: { $in: subjectIds }, status: 'open' }),
      LmsDiscussion.find({ subject: { $in: subjectIds }, status: 'open' }).sort({ updatedAt: -1 }).limit(5).populate('subject', 'name code').populate('student', 'name studentId').lean(),
      LmsMaterial.find({ subject: { $in: subjectIds }, isActive: true, isPublished: publishedFilter() }).sort({ createdAt: -1 }).limit(5).populate('subject', 'name code').lean(),
      LmsAssignment.find({ subject: { $in: subjectIds }, isPublished: publishedFilter() }).select('_id subject').lean(),
      LmsQuiz.find({ subject: { $in: subjectIds }, isPublished: publishedFilter() }).select('_id subject').lean(),
      LmsSubmission.find({ subject: { $in: subjectIds } }).select('assignment student').lean(),
      LmsQuizAttempt.find({ subject: { $in: subjectIds } }).select('quiz student').lean(),
      Promise.all(subjects.map(async subject => ({ subjectId: String(subject._id), count: (await getSubjectStudents(subject)).length })))
    ]);
    const studentCountBySubject = new Map(subjectStudentRows.map(row => [row.subjectId, row.count]));
    const expectedAssignmentCompletions = publishedAssignments.reduce((sum, item) => sum + (studentCountBySubject.get(String(item.subject)) || 0), 0);
    const expectedQuizCompletions = publishedQuizzes.reduce((sum, item) => sum + (studentCountBySubject.get(String(item.subject)) || 0), 0);
    const publishedAssignmentIds = new Set(publishedAssignments.map(item => String(item._id)));
    const publishedQuizIds = new Set(publishedQuizzes.map(item => String(item._id)));
    const completedAssignments = new Set(submissionRows
      .filter(item => publishedAssignmentIds.has(String(item.assignment)))
      .map(item => `${item.assignment}:${item.student}`));
    const completedQuizzes = new Set(attemptRows
      .filter(item => publishedQuizIds.has(String(item.quiz)))
      .map(item => `${item.quiz}:${item.student}`));
    res.json({
      success: true,
      summary: {
        subjects: subjects.length,
        materials,
        assignments,
        submissions,
        ungraded,
        quizzes,
        attempts,
        announcements,
        openDoubts,
        quizCompletionRate: expectedQuizCompletions ? Math.min(100, Math.round((completedQuizzes.size / expectedQuizCompletions) * 100)) : 0,
        assignmentCompletionRate: expectedAssignmentCompletions ? Math.min(100, Math.round((completedAssignments.size / expectedAssignmentCompletions) * 100)) : 0,
        recentDiscussions,
        recentMaterials
      }
    });
  } catch (error) {
    handleError(res, error, 'getTeacherSummary');
  }
};

const getDiscussions = async (req, res) => {
  try {
    await assertSubjectAccess(req, req.params.subjectId);
    const query = req.user.role === 'student'
      ? { subject: req.params.subjectId, ...studentIdentityFilter(req.user) }
      : { subject: req.params.subjectId };
    const discussions = await LmsDiscussion.find(query)
      .sort({ status: 1, updatedAt: -1 })
      .populate('student', 'name studentId')
      .populate('lastReplyBy', 'name role')
      .lean();
    const replies = discussions.length
      ? await LmsDiscussionReply.find({ discussion: { $in: discussions.map(item => item._id) } }).sort({ createdAt: 1 }).populate('author', 'name role studentId').lean()
      : [];
    const repliesByDiscussion = replies.reduce((acc, reply) => {
      const key = String(reply.discussion);
      acc[key] = acc[key] || [];
      acc[key].push(reply);
      return acc;
    }, {});
    res.json({ success: true, discussions: discussions.map(item => ({ ...item, replies: repliesByDiscussion[String(item._id)] || [] })) });
  } catch (error) {
    handleError(res, error, 'getDiscussions');
  }
};

const createDiscussion = async (req, res) => {
  try {
    const subject = await assertSubjectAccess(req, req.params.subjectId);
    if (req.user.role !== 'student') return res.status(403).json({ success: false, message: 'Students only' });
    const discussion = await LmsDiscussion.create({
      subject: subject._id,
      student: req.user._id,
      studentId: studentCodeOf(req.user),
      title: req.body.title,
      message: req.body.message
    });
    await notifyDirect(req, (subject.assignedTeachers || []).map(teacherId => ({
      recipient: teacherId,
      recipientRole: 'teacher',
      type: 'lms_discussion_created',
      title: 'New student doubt',
      message: `${req.user.name} asked a doubt in ${subject.name}.`,
      data: { subject: subject._id, discussion: discussion._id }
    })));
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'discussion' });
    res.status(201).json({ success: true, discussion });
  } catch (error) {
    handleError(res, error, 'createDiscussion');
  }
};

const replyDiscussion = async (req, res) => {
  try {
    const discussion = await LmsDiscussion.findById(req.params.discussionId).populate('student', 'name _id');
    if (!discussion) return res.status(404).json({ success: false, message: 'Discussion not found' });
    const subject = await assertSubjectAccess(req, discussion.subject);
    const isOwner = String(discussion.student?._id || discussion.student) === String(req.user._id);
    if (!isStaff(req.user) && !isOwner) return res.status(403).json({ success: false, message: 'Access denied' });
    const reply = await LmsDiscussionReply.create({
      discussion: discussion._id,
      subject: subject._id,
      author: req.user._id,
      authorRole: req.user.role,
      message: req.body.message
    });
    discussion.lastReplyAt = new Date();
    discussion.lastReplyBy = req.user._id;
    await discussion.save();
    if (isStaff(req.user)) {
      await notifyDirect(req, [{
        recipient: discussion.student._id,
        recipientRole: 'student',
        type: 'lms_discussion_replied',
        title: 'Teacher replied to your doubt',
        message: `${req.user.name} replied in ${subject.name}.`,
        data: { subject: subject._id, discussion: discussion._id }
      }]);
    } else {
      await notifyDirect(req, (subject.assignedTeachers || []).map(teacherId => ({
        recipient: teacherId,
        recipientRole: 'teacher',
        type: 'lms_discussion_replied',
        title: 'Student added a doubt reply',
        message: `${req.user.name} replied in ${subject.name}.`,
        data: { subject: subject._id, discussion: discussion._id }
      })));
    }
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'discussion_reply' });
    res.status(201).json({ success: true, reply });
  } catch (error) {
    handleError(res, error, 'replyDiscussion');
  }
};

const resolveDiscussion = async (req, res) => {
  try {
    const discussion = await LmsDiscussion.findById(req.params.discussionId);
    if (!discussion) return res.status(404).json({ success: false, message: 'Discussion not found' });
    const subject = await assertSubjectAccess(req, discussion.subject, { staffOnly: true });
    discussion.status = 'resolved';
    discussion.resolvedAt = new Date();
    discussion.resolvedBy = req.user._id;
    await discussion.save();
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'discussion_resolved' });
    res.json({ success: true, discussion });
  } catch (error) {
    handleError(res, error, 'resolveDiscussion');
  }
};

const deleteDiscussion = async (req, res) => {
  try {
    const discussion = await LmsDiscussion.findById(req.params.discussionId);
    if (!discussion) return res.status(404).json({ success: false, message: 'Discussion not found' });
    const subject = await assertSubjectAccess(req, discussion.subject, { staffOnly: true });
    await LmsDiscussionReply.deleteMany({ discussion: discussion._id });
    await discussion.deleteOne();
    emitLmsEvent(req, subject, 'lms_changed', { subjectId: subject._id, type: 'discussion_deleted' });
    res.json({ success: true, message: 'Doubt deleted' });
  } catch (error) {
    handleError(res, error, 'deleteDiscussion');
  }
};

const getAdminOverview = async (req, res) => {
  try {
    if (!isStaff(req.user)) return res.status(403).json({ success: false, message: 'Staff only' });
    const subjects = await getScopedSubjects(req.user);
    const subjectIds = subjects.map(subject => subject._id);
    const [summaryRes, subjectRows] = await Promise.all([
      new Promise((resolve, reject) => {
        const resShim = { json: resolve, status: () => ({ json: reject }) };
        getTeacherSummary(req, resShim).catch?.(reject);
      }),
      Promise.all(subjects.map(async (subject) => {
        const [materials, assignments, submissions, quizzes, attempts, openDoubts] = await Promise.all([
          LmsMaterial.countDocuments({ subject: subject._id, isActive: true, isPublished: publishedFilter() }),
          LmsAssignment.countDocuments({ subject: subject._id, isPublished: publishedFilter() }),
          LmsSubmission.countDocuments({ subject: subject._id }),
          LmsQuiz.countDocuments({ subject: subject._id, isPublished: publishedFilter() }),
          LmsQuizAttempt.countDocuments({ subject: subject._id }),
          LmsDiscussion.countDocuments({ subject: subject._id, status: 'open' })
        ]);
        return { subject, materials, assignments, submissions, quizzes, attempts, openDoubts };
      }))
    ]);
    res.json({ success: true, summary: summaryRes.summary || {}, subjects: subjectRows, subjectCount: subjectIds.length });
  } catch (error) {
    handleError(res, error, 'getAdminOverview');
  }
};

module.exports = {
  getSubjectOverview,
  getSubjectCalendar,
  createMaterial,
  createMaterialFolder,
  updateMaterialFolder,
  deleteMaterialFolder,
  updateMaterial,
  createAssignment,
  updateAssignment,
  submitAssignment,
  gradeSubmission,
  returnSubmission,
  bulkReturnAssignment,
  markMaterialViewed,
  getSubmissionComments,
  addSubmissionComment,
  createQuiz,
  updateQuiz,
  importQuiz,
  attemptQuiz,
  releaseQuizResults,
  getAssignmentAnalytics,
  getQuizAnalytics,
  getMaterialAnalytics,
  publishMaterial,
  publishAssignment,
  publishQuiz,
  createAnnouncement,
  deleteMaterial,
  deleteAssignment,
  deleteQuiz,
  deleteAnnouncement,
  getStudentProgress,
  getTeacherSummary,
  getDiscussions,
  createDiscussion,
  replyDiscussion,
  resolveDiscussion,
  deleteDiscussion,
  getAdminOverview
};
