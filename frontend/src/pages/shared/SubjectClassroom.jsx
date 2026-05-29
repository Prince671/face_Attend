import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  AlertTriangle, ArrowLeft, BarChart3, Bell, BookOpen, CalendarDays, CheckCircle, ChevronLeft, ChevronRight,
  ClipboardList, Clock, Download, Edit3, ExternalLink, FileText, Eye, Filter, FolderOpen, HelpCircle, Image as ImageIcon,
  Megaphone, MessageSquare, Pin, Plus, RefreshCw, RotateCcw, Search, Send, ShieldCheck, Tag, Trash2, Trophy, Upload, Video, X, XCircle
} from 'lucide-react';
import { attendanceAPI, lmsAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { LoadingOverlay, PageSkeleton, CardSkeleton, SkeletonLine } from '../../components/LoadingStates';
import AppConfirmModal from '../../components/AppConfirmModal';
import { clearLmsActivity, lmsActivityBucketForType, lmsActivityEventName, markLmsActivity, readLmsActivity } from '../../utils/lmsActivity';

const emptyMaterial = { title: '', description: '', linkUrl: '', linkUrls: '', tags: '', folder: '', topic: '', category: 'notes', isPinned: false, files: [] };
const emptyAssignment = {
  title: '', description: '', dueDate: '', dueTime: '', maxMarks: 10, isUngraded: false,
  gradeCategory: 'homework', submissionMode: 'offline', allowResubmission: false, acceptLateSubmissions: false,
  tags: '', topic: '', linkUrls: '', files: []
};
const emptyAnnouncement = { title: '', message: '', priority: 'medium' };
const emptyDiscussion = { title: '', message: '' };
const emptyQuiz = {
  title: '',
  description: '',
  durationMinutes: 15,
  totalMarks: 10,
  tags: '',
  topic: '',
  startAt: '',
  endAt: '',
  releaseMode: 'manual',
  showCorrectAnswers: true,
  showPointValues: true,
  showMissedQuestions: true,
  shuffleQuestions: false,
  oneQuestionAtATime: false,
  tabSwitchWarning: true,
  maxTabSwitchWarnings: 3,
  allowLateAttempt: false,
  questions: [{
    type: 'multiple_choice',
    text: '',
    required: true,
    marks: 1,
    explanation: '',
    correctFeedback: '',
    wrongFeedback: '',
    answerKey: [],
    shuffleOptions: false,
    options: [
      { text: '', isCorrect: true },
      { text: '', isCorrect: false },
      { text: '', isCorrect: false },
      { text: '', isCorrect: false }
    ]
  }]
};
const emptyQuizImport = {
  title: '', description: '', durationMinutes: 15, totalMarks: 10, tags: '', topic: '', startAt: '', endAt: '',
  releaseMode: 'manual', shuffleQuestions: false, oneQuestionAtATime: false, tabSwitchWarning: true,
  maxTabSwitchWarnings: 3, file: null
};
const resourceUrl = (url = '') => url?.startsWith('http') ? url : url;
const resourceExtension = (name = '') => name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
const resourcePreviewType = (resource = {}) => {
  const type = String(resource.type || '').toLowerCase();
  const name = resource.fileName || resource.title || resource.url || '';
  const ext = resourceExtension(name);
  if (type === 'image' || ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return 'image';
  if (type === 'video' || ['.mp4', '.webm', '.mov', '.m4v'].includes(ext)) return 'video';
  if (ext === '.pdf' || /\/pdf($|\?)/i.test(resource.url || '')) return 'pdf';
  return '';
};
const folderNameFor = (item = {}) => String(item.folder || item.topic || 'General').trim() || 'General';
const toDateTimeInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 16);
};
const getQuizTimingState = (quizItem) => {
  const now = Date.now();
  const start = quizItem.startAt ? new Date(quizItem.startAt).getTime() : null;
  const end = quizItem.endAt ? new Date(quizItem.endAt).getTime() : null;
  if (start && now < start) return { state: 'upcoming', label: `Opens ${new Date(start).toLocaleString()}`, closeAt: null };
  const durationClose = start && quizItem.durationMinutes ? start + Number(quizItem.durationMinutes || 0) * 60 * 1000 : null;
  const closeAt = end || durationClose;
  if (closeAt && now > closeAt) return { state: 'closed', label: `Closed ${new Date(closeAt).toLocaleString()}`, closeAt };
  return { state: 'open', label: closeAt ? `Closes ${new Date(closeAt).toLocaleString()}` : 'Open', closeAt };
};
const seededShuffle = (items = [], seed = '') => {
  const shuffled = items.map((item, index) => (
    item && typeof item === 'object' && item.originalIndex === undefined ? { ...item, originalIndex: index } : item
  ));
  let hash = Array.from(String(seed)).reduce((sum, char) => sum + char.charCodeAt(0), 0) || 1;
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    hash = (hash * 9301 + 49297) % 233280;
    const swapIndex = Math.floor((hash / 233280) * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};
const formatDuration = (seconds = 0) => {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  const remainingSeconds = safe % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
};
const cloneQuizQuestion = (question = emptyQuiz.questions[0]) => ({
  type: question.type || 'multiple_choice',
  text: question.text || '',
  required: question.required !== false,
  marks: question.marks ?? 1,
  explanation: question.explanation || '',
  correctFeedback: question.correctFeedback || '',
  wrongFeedback: question.wrongFeedback || '',
  answerKey: Array.isArray(question.answerKey) ? [...question.answerKey] : [],
  shuffleOptions: Boolean(question.shuffleOptions),
  options: (question.options?.length ? question.options : emptyQuiz.questions[0].options).map(option => ({
    text: option.text || '',
    isCorrect: Boolean(option.isCorrect)
  }))
});
const distributeQuizQuestionMarks = (quizDraft = emptyQuiz) => {
  const questions = quizDraft.questions?.length ? quizDraft.questions : emptyQuiz.questions;
  const totalMarks = Math.max(0, Number(quizDraft.totalMarks || 0));
  if (!questions.length) return { ...quizDraft, questions: [] };
  let remainingMarks = totalMarks;
  const distributedQuestions = questions.map((question, index) => {
    const marks = index === questions.length - 1
      ? Number(remainingMarks.toFixed(2))
      : Number((totalMarks / questions.length).toFixed(2));
    remainingMarks -= marks;
    return { ...question, marks };
  });
  return { ...quizDraft, questions: distributedQuestions };
};
const quizToForm = (item = {}) => ({
  ...emptyQuiz,
  ...item,
  tags: Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || ''),
  startAt: toDateTimeInput(item.startAt),
  endAt: toDateTimeInput(item.endAt),
  questions: (item.questions?.length ? item.questions : emptyQuiz.questions).map(cloneQuizQuestion)
});
const itemDateInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};
const materialToForm = (item = {}) => ({
  ...emptyMaterial,
  ...item,
  tags: Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || ''),
  linkUrls: (item.attachments || []).filter(attachment => attachment.type === 'link').map(attachment => attachment.url).join('\n'),
  files: []
});
const assignmentToForm = (item = {}) => ({
  ...emptyAssignment,
  ...item,
  dueDate: itemDateInput(item.dueDate),
  tags: Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || ''),
  linkUrls: (item.attachments || []).filter(attachment => attachment.type === 'link').map(attachment => attachment.url).join('\n'),
  files: []
});
const materialFolderStorageKey = (userId, subjectId) => `studysphere_material_folders_${userId || 'guest'}_${subjectId || 'subject'}`;
const readSavedMaterialFolders = (userId, subjectId) => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(materialFolderStorageKey(userId, subjectId)) || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
};
const writeSavedMaterialFolders = (userId, subjectId, folders) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(materialFolderStorageKey(userId, subjectId), JSON.stringify([...new Set((folders || []).filter(Boolean))]));
};

const tabItems = [
  { id: 'overview', label: 'Overview', icon: BookOpen },
  { id: 'attendance', label: 'Attendance', icon: CheckCircle },
  { id: 'materials', label: 'Materials', icon: FileText },
  { id: 'assignments', label: 'Assignments', icon: ClipboardList },
  { id: 'quizzes', label: 'Quizzes', icon: Trophy },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'doubts', label: 'Doubts', icon: HelpCircle },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
];

const Section = ({ icon: Icon, title, children, action }) => (
  <section className="glass-card">
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h2 className="flex items-center gap-2 font-semibold text-white">
        <Icon className="h-5 w-5 text-primary-300" /> {title}
      </h2>
      {action}
    </div>
    {children}
  </section>
);

const MiniStat = ({ label, value, icon: Icon, tone = 'primary' }) => (
  <div className="min-w-[112px] rounded-xl border border-white/10 bg-white/[0.04] p-3 sm:min-w-0">
    <div className={`mb-2 inline-flex h-8 w-8 items-center justify-center rounded-lg ${
      tone === 'green' ? 'bg-emerald-500/15 text-emerald-300' :
      tone === 'amber' ? 'bg-amber-500/15 text-amber-300' :
      tone === 'red' ? 'bg-red-500/15 text-red-300' :
      'bg-primary-500/15 text-primary-300'
    }`}>
      <Icon className="h-4 w-4" />
    </div>
    <p className="break-words text-[10px] uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-xl font-semibold text-white">{value}</p>
  </div>
);

const StatRail = ({ children }) => (
  <div className="-mx-1 overflow-x-auto pb-1 sm:mx-0 sm:overflow-visible">
    <div className="flex min-w-max gap-3 px-1 sm:grid sm:min-w-0 sm:grid-cols-4 sm:px-0">
      {children}
    </div>
  </div>
);

const CreationModal = ({ open, title, icon: Icon, children, onClose }) => {
  if (!open) return null;

  return createPortal(
    <div className="app-modal-backdrop px-3">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        className="glass-card max-h-[90vh] w-full max-w-3xl overflow-y-auto"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Icon className="h-5 w-5 text-primary-300" /> {title}
          </h2>
          <button type="button" className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>,
    document.body
  );
};

const EmptyRow = ({ children }) => (
  <p className="rounded-2xl border border-dashed border-white/10 py-8 text-center text-sm text-slate-500">{children}</p>
);

const TagList = ({ tags = [] }) => {
  const visibleTags = tags.filter(Boolean).slice(0, 4);
  if (!visibleTags.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {visibleTags.map(tag => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-primary-400/20 bg-primary-500/10 px-2 py-1 text-[11px] text-primary-100">
          <Tag className="h-3 w-3" /> {tag}
        </span>
      ))}
    </div>
  );
};

export default function SubjectClassroom() {
  const { subjectId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { socket } = useSocket();
  const isStaff = ['admin', 'teacher'].includes(user?.role);
  const basePath = isStaff ? '/admin/subjects' : '/student/subjects';
  const readableTabs = isStaff ? tabItems : tabItems.filter(tab => tab.id !== 'analytics');
  const tabIds = readableTabs.map(tab => tab.id);
  const sectionStorageKey = `studysphere_classroom_section_${user?._id || 'guest'}_${subjectId || 'subject'}`;
  const readInitialSection = () => {
    const urlSection = searchParams.get('section') || searchParams.get('tab');
    if (tabIds.includes(urlSection)) return urlSection;
    if (typeof window !== 'undefined') {
      const savedSection = localStorage.getItem(sectionStorageKey);
      if (tabIds.includes(savedSection)) return savedSection;
    }
    return 'overview';
  };
  const [activeTab, setActiveTab] = useState(readInitialSection);
  const [activeModal, setActiveModal] = useState('');
  const [reviewModal, setReviewModal] = useState(null);
  const [reviewSearch, setReviewSearch] = useState('');
  const [reviewQuery, setReviewQuery] = useState('');
  const [analyticsKind, setAnalyticsKind] = useState('');
  const [analyticsItemId, setAnalyticsItemId] = useState('');
  const [materialFolder, setMaterialFolder] = useState('all');
  const [materialPanelOpen, setMaterialPanelOpen] = useState(false);
  const [assignmentPanelOpen, setAssignmentPanelOpen] = useState(false);
  const [newMaterialFolder, setNewMaterialFolder] = useState('');
  const [savedMaterialFolders, setSavedMaterialFolders] = useState(() => readSavedMaterialFolders(user?._id, subjectId));
  const [renamingMaterialFolder, setRenamingMaterialFolder] = useState('');
  const [materialFolderDraft, setMaterialFolderDraft] = useState('');
  const [materialFolderMenu, setMaterialFolderMenu] = useState('');
  const materialFolderInputRef = useRef(null);
  const materialFolderHoldRef = useRef(null);
  const attendanceImportInputRef = useRef(null);
  const [previewResource, setPreviewResource] = useState(null);
  const [data, setData] = useState(null);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loadedOnce = useRef(false);
  const [saving, setSaving] = useState('');
  const [attendanceManagerOpen, setAttendanceManagerOpen] = useState(false);
  const [attendanceImportOpen, setAttendanceImportOpen] = useState(false);
  const [attendanceDeleteOpen, setAttendanceDeleteOpen] = useState(false);
  const [attendanceImportFile, setAttendanceImportFile] = useState(null);
  const [attendanceImporting, setAttendanceImporting] = useState(false);
  const [attendanceDeleteRange, setAttendanceDeleteRange] = useState({ startDate: '', endDate: '' });
  const [attendanceDeleting, setAttendanceDeleting] = useState(false);
  const [historyRange, setHistoryRange] = useState({ startDate: '', endDate: '' });
  const [historySearch, setHistorySearch] = useState('');
  const [historySort, setHistorySort] = useState('');
  const [historySortMenuOpen, setHistorySortMenuOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState(null);
  const [disputes, setDisputes] = useState([]);
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [resolvingDisputeId, setResolvingDisputeId] = useState('');
  const [deletingDisputeId, setDeletingDisputeId] = useState('');
  const [disputeDeleteTarget, setDisputeDeleteTarget] = useState(null);
  const [resolutionNotes, setResolutionNotes] = useState({});
  const [material, setMaterial] = useState(emptyMaterial);
  const [editingMaterialId, setEditingMaterialId] = useState('');
  const [assignment, setAssignment] = useState(emptyAssignment);
  const [editingAssignmentId, setEditingAssignmentId] = useState('');
  const [announcement, setAnnouncement] = useState(emptyAnnouncement);
  const [quiz, setQuiz] = useState(emptyQuiz);
  const [editingQuizId, setEditingQuizId] = useState('');
  const [quizPanel, setQuizPanel] = useState('');
  const [quizImport, setQuizImport] = useState(emptyQuizImport);
  const [discussion, setDiscussion] = useState(emptyDiscussion);
  const [replyDrafts, setReplyDrafts] = useState({});
  const [submissionText, setSubmissionText] = useState({});
  const [submissionFile, setSubmissionFile] = useState({});
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizStartedAt, setQuizStartedAt] = useState({});
  const [quizTabSwitches, setQuizTabSwitches] = useState({});
  const [quizQuestionSteps, setQuizQuestionSteps] = useState({});
  const [quizNow, setQuizNow] = useState(Date.now());
  const [gradeDrafts, setGradeDrafts] = useState({});
  const [lmsActivity, setLmsActivity] = useState(() => readLmsActivity(user?._id));
  const loadClassroom = useCallback(async () => {
    if (loadedOnce.current) setRefreshing(true);
    try {
      const res = await lmsAPI.getSubjectOverview(subjectId);
      setData(res.data);
      loadedOnce.current = true;
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not load classroom');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [subjectId]);

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true);
    try {
      const now = new Date();
      const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();
      const res = await lmsAPI.getSubjectCalendar(subjectId, { startDate, endDate });
      setCalendarEvents(res.data?.events || []);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not load calendar');
    } finally {
      setCalendarLoading(false);
    }
  }, [subjectId]);

  useEffect(() => {
    loadClassroom();
  }, [loadClassroom]);

  useEffect(() => {
    const urlSection = searchParams.get('section') || searchParams.get('tab');
    const nextSection = tabIds.includes(urlSection)
      ? urlSection
      : (typeof window !== 'undefined' && tabIds.includes(localStorage.getItem(sectionStorageKey))
        ? localStorage.getItem(sectionStorageKey)
        : 'overview');
    if (nextSection !== activeTab) setActiveTab(nextSection);
  }, [subjectId, isStaff]);

  useEffect(() => {
    const nextSection = tabIds.includes(activeTab) ? activeTab : 'overview';
    if (nextSection !== activeTab) {
      setActiveTab(nextSection);
      return;
    }
    if (typeof window !== 'undefined') localStorage.setItem(sectionStorageKey, nextSection);
    setSearchParams(previous => {
      const params = new URLSearchParams(previous);
      params.set('section', nextSection);
      params.delete('tab');
      return params;
    }, { replace: true });
  }, [activeTab, isStaff, sectionStorageKey, setSearchParams]);

  useEffect(() => {
    setSavedMaterialFolders(readSavedMaterialFolders(user?._id, subjectId));
    setNewMaterialFolder('');
    setMaterialFolder('all');
    setRenamingMaterialFolder('');
    setMaterialFolderDraft('');
    setMaterialFolderMenu('');
    setMaterialPanelOpen(false);
    setAssignmentPanelOpen(false);
  }, [subjectId, user?._id]);

  useEffect(() => {
    if (activeTab === 'calendar') loadCalendar();
  }, [activeTab, loadCalendar]);

  useEffect(() => {
    if (activeTab !== 'materials') {
      setMaterialFolder('all');
      setMaterialPanelOpen(false);
      setEditingMaterialId('');
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'attendance') {
      setAttendanceManagerOpen(false);
      setAttendanceImportOpen(false);
      setAttendanceDeleteOpen(false);
      return;
    }
    if (isStaff && attendanceManagerOpen) fetchSubjectDisputes();
  }, [activeTab, isStaff, subjectId, attendanceManagerOpen]);

  useEffect(() => {
    if (!renamingMaterialFolder) return;
    const timer = window.setTimeout(() => {
      materialFolderInputRef.current?.focus();
      materialFolderInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [renamingMaterialFolder]);

  useEffect(() => () => window.clearTimeout(materialFolderHoldRef.current), []);

  useEffect(() => {
    if (!isStaff && activeTab === 'analytics') setActiveTab('overview');
  }, [activeTab, isStaff]);

  useEffect(() => {
    if (!socket) return undefined;
    const refresh = (payload) => {
      if (!payload?.subjectId || String(payload.subjectId) === String(subjectId)) {
        const bucket = lmsActivityBucketForType(payload.type);
        if (payload?.subjectId && bucket && activeTab !== bucket) {
          markLmsActivity(user?._id, String(payload.subjectId), bucket);
        }
        loadClassroom();
        if (activeTab === 'calendar') loadCalendar();
      }
    };
    socket.on('lms_changed', refresh);
    socket.on('attendance_closed', refresh);
    socket.on('attendance_opened', refresh);
    return () => {
      socket.off('lms_changed', refresh);
      socket.off('attendance_closed', refresh);
      socket.off('attendance_opened', refresh);
    };
  }, [socket, subjectId, loadClassroom, loadCalendar, activeTab, user?._id]);

  useEffect(() => {
    setLmsActivity(readLmsActivity(user?._id));
  }, [user?._id]);

  useEffect(() => {
    const syncActivity = () => setLmsActivity(readLmsActivity(user?._id));
    window.addEventListener(lmsActivityEventName, syncActivity);
    return () => window.removeEventListener(lmsActivityEventName, syncActivity);
  }, [user?._id]);

  useEffect(() => {
    if (['materials', 'assignments', 'quizzes'].includes(activeTab)) {
      clearLmsActivity(user?._id, String(subjectId), activeTab);
    }
  }, [activeTab, subjectId, user?._id]);

  useEffect(() => {
    const timer = window.setTimeout(() => setReviewQuery(reviewSearch.trim().toLowerCase()), 2000);
    return () => window.clearTimeout(timer);
  }, [reviewSearch]);

  useEffect(() => {
    if (reviewModal) {
      setReviewSearch('');
      setReviewQuery('');
    }
  }, [reviewModal?.type, reviewModal?.item?._id]);

  useEffect(() => {
    if (activeTab !== 'quizzes') return undefined;
    const interval = window.setInterval(() => setQuizNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeTab]);

  useEffect(() => {
    if (isStaff || activeTab !== 'quizzes' || !data?.quizzes?.length) return;
    const attemptedQuizIds = new Set((data?.attempts || [])
      .filter(attempt => String(attempt.student?._id || attempt.student) === String(user?._id))
      .map(attempt => String(attempt.quiz?._id || attempt.quiz)));
    const nowIso = new Date().toISOString();
    setQuizStartedAt(current => {
      let changed = false;
      const next = { ...current };
      (data.quizzes || []).forEach(item => {
        const id = String(item._id);
        if (!attemptedQuizIds.has(id) && !item.resultsReleased && getQuizTimingState(item).state === 'open' && !next[id]) {
          next[id] = nowIso;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [activeTab, data?.attempts, data?.quizzes, isStaff, user?._id]);

  const submissionsByAssignment = useMemo(() => {
    const map = new Map();
    (data?.submissions || []).forEach(submission => {
      const key = String(submission.assignment?._id || submission.assignment);
      map.set(key, [...(map.get(key) || []), submission]);
    });
    return map;
  }, [data?.submissions]);

  const attemptsByQuiz = useMemo(() => {
    const map = new Map();
    (data?.attempts || []).forEach(attempt => {
      const key = String(attempt.quiz?._id || attempt.quiz);
      map.set(key, [...(map.get(key) || []), attempt]);
    });
    return map;
  }, [data?.attempts]);

  const activeQuizLock = useMemo(() => {
    if (isStaff || activeTab !== 'quizzes') return null;
    const attemptedQuizIds = new Set((data?.attempts || [])
      .filter(attempt => String(attempt.student?._id || attempt.student) === String(user?._id))
      .map(attempt => String(attempt.quiz?._id || attempt.quiz)));
    return (data?.quizzes || []).find(item => {
      const id = String(item._id);
      return quizStartedAt[id] && !attemptedQuizIds.has(id) && !item.resultsReleased && getQuizTimingState(item).state === 'open';
    }) || null;
  }, [activeTab, data?.attempts, data?.quizzes, isStaff, quizStartedAt, user?._id]);

  const registerQuizViolation = useCallback((reason = 'tab_hidden') => {
    if (!activeQuizLock || activeQuizLock.tabSwitchWarning === false) return;
    const id = String(activeQuizLock._id);
    const occurredAt = new Date().toISOString();
    setQuizTabSwitches(current => ({
      ...current,
      [id]: [...(current[id] || []), { occurredAt, reason }]
    }));
    toast.error(reason === 'navigation_blocked'
      ? 'Finish or submit the quiz before leaving this page.'
      : 'Switching tabs or leaving the quiz is not allowed during an active quiz.');
  }, [activeQuizLock]);

  useEffect(() => {
    if (!activeQuizLock) return undefined;
    const handleVisibilityChange = () => {
      if (document.hidden) registerQuizViolation('tab_hidden');
    };
    const handleWindowBlur = () => registerQuizViolation('window_blur');
    const handleBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
      registerQuizViolation('page_unload_attempt');
      return '';
    };
    const handlePopState = () => {
      window.history.pushState({ quizLocked: true }, '', window.location.href);
      registerQuizViolation('navigation_blocked');
    };
    const handleClickCapture = (event) => {
      const anchor = event.target.closest?.('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (!href || href.startsWith('#')) return;
      event.preventDefault();
      event.stopPropagation();
      registerQuizViolation('navigation_blocked');
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.history.pushState({ quizLocked: true }, '', window.location.href);
    window.addEventListener('popstate', handlePopState);
    document.addEventListener('click', handleClickCapture, true);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('click', handleClickCapture, true);
    };
  }, [activeQuizLock, registerQuizViolation]);

  const materialFolders = useMemo(() => {
    const map = new Map();
    (data?.materials || []).forEach(item => {
      const name = folderNameFor(item);
      map.set(name, { name, count: (map.get(name)?.count || 0) + 1, _id: '' });
    });
    (data?.materialFolders || []).forEach(folder => {
      const name = String(folder.name || '').trim();
      if (!name) return;
      const existing = map.get(name) || { name, count: 0 };
      map.set(name, { ...existing, _id: folder._id, name });
    });
    savedMaterialFolders.forEach(folder => {
      if (!map.has(folder)) map.set(folder, { name: folder, count: 0, _id: '' });
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [data?.materials, data?.materialFolders, savedMaterialFolders]);
  const materialFolderCountMap = useMemo(() => new Map(materialFolders.map(folder => [folder.name, folder.count])), [materialFolders]);
  const materialFolderIdMap = useMemo(() => new Map(materialFolders.map(folder => [folder.name, folder._id])), [materialFolders]);

  const visibleMaterials = useMemo(() => {
    if (materialFolder === 'all') return [];
    return (data?.materials || []).filter(item => folderNameFor(item) === materialFolder);
  }, [data?.materials, materialFolder]);

  const postForm = async (kind, handler, reset) => {
    setSaving(kind);
    try {
      await handler();
      reset();
      setActiveModal('');
      await loadClassroom();
      toast.success('Saved');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not save');
    } finally {
      setSaving('');
    }
  };

  const createMaterial = (event) => {
    event.preventDefault();
    const formData = new FormData();
    Object.entries(material).forEach(([key, value]) => {
      if (key === 'files') return;
      if (value !== '' && value !== null && value !== undefined) formData.append(key, value);
    });
    (material.files || []).forEach(file => formData.append('files', file));
    postForm(
      'material',
      () => editingMaterialId ? lmsAPI.updateMaterial(editingMaterialId, formData) : lmsAPI.createMaterial(subjectId, formData),
      () => {
        setMaterial(emptyMaterial);
        setEditingMaterialId('');
        setMaterialPanelOpen(false);
      }
    );
  };

  const createAssignment = (event) => {
    event.preventDefault();
    const formData = new FormData();
    Object.entries(assignment).forEach(([key, value]) => {
      if (key === 'files') return;
      if (value !== '' && value !== null && value !== undefined) formData.append(key, value);
    });
    (assignment.files || []).forEach(file => formData.append('files', file));
    postForm(
      'assignment',
      () => editingAssignmentId ? lmsAPI.updateAssignment(editingAssignmentId, formData) : lmsAPI.createAssignment(subjectId, formData),
      () => {
        setAssignment(emptyAssignment);
        setEditingAssignmentId('');
        setAssignmentPanelOpen(false);
      }
    );
  };

  const createAnnouncement = (event) => {
    event.preventDefault();
    postForm('announcement', () => lmsAPI.createAnnouncement(subjectId, announcement), () => setAnnouncement(emptyAnnouncement));
  };

  const createDiscussion = (event) => {
    event.preventDefault();
    postForm('discussion', () => lmsAPI.createDiscussion(subjectId, discussion), () => setDiscussion(emptyDiscussion));
  };

  const createQuiz = (event) => {
    event.preventDefault();
    const distributedQuiz = distributeQuizQuestionMarks(quiz);
    const questions = distributedQuiz.questions
      .map(question => {
        const options = ['short_answer', 'paragraph'].includes(question.type) ? [] : question.options.filter(option => option.text.trim());
        return { ...question, options };
      })
      .filter(question => question.text.trim() && (['short_answer', 'paragraph'].includes(question.type) || question.options.length >= 2));
    const payload = { ...distributedQuiz, questions };
    postForm(
      'quiz',
      () => editingQuizId ? lmsAPI.updateQuiz(editingQuizId, payload) : lmsAPI.createQuiz(subjectId, payload),
      () => {
        setQuiz(emptyQuiz);
        setEditingQuizId('');
        setQuizPanel('');
      }
    );
  };

  const importQuiz = (event) => {
    event.preventDefault();
    const formData = new FormData();
    Object.entries(quizImport).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) formData.append(key, value);
    });
    postForm('quiz-import', () => lmsAPI.importQuiz(subjectId, formData), () => {
      setQuizImport(emptyQuizImport);
      setQuizPanel('');
    });
  };

  const deleteItem = async (kind, id, handler) => {
    setSaving(`${kind}-${id}`);
    try {
      await handler(id);
      await loadClassroom();
      toast.success('Deleted');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not delete');
    } finally {
      setSaving('');
    }
  };

  const publishItem = async (kind, id, handler) => {
    setSaving(`publish-${kind}-${id}`);
    try {
      await handler(id);
      await loadClassroom();
      toast.success('Published');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not publish');
    } finally {
      setSaving('');
    }
  };

  const fetchSubjectHistory = async () => {
    if (!subjectId) return;
    if (!historyRange.startDate || !historyRange.endDate) {
      toast.error('Select a start and end date first');
      return;
    }
    setHistoryLoading(true);
    try {
      const res = await attendanceAPI.getSubjectHistory(subjectId, {
        startDate: historyRange.startDate,
        endDate: historyRange.endDate,
        search: historySearch || undefined
      });
      setHistoryData(res.data);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not load attendance history');
    } finally {
      setHistoryLoading(false);
    }
  };

  const fetchSubjectDisputes = async () => {
    if (!subjectId) return;
    setDisputeLoading(true);
    try {
      const res = await attendanceAPI.getDisputes({ subjectId });
      setDisputes(res.data.disputes || []);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not load disputes');
    } finally {
      setDisputeLoading(false);
    }
  };

  const handleAttendanceImport = async (event) => {
    event.preventDefault();
    if (!attendanceImportFile) return toast.error('Select a spreadsheet file');
    const formData = new FormData();
    formData.append('file', attendanceImportFile);
    setAttendanceImporting(true);
    try {
      const res = await attendanceAPI.importSubjectAttendance(subjectId, formData);
      const summary = res.data.importSummary;
      toast.success(`Imported ${summary?.imported || 0} records across ${summary?.lectures || 0} date${summary?.lectures === 1 ? '' : 's'}`);
      if (summary?.skipped) toast(`${summary.skipped} rows skipped.`);
      setAttendanceImportFile(null);
      setAttendanceImportOpen(false);
      attendanceImportInputRef.current && (attendanceImportInputRef.current.value = '');
      await loadClassroom();
      if (historyData) fetchSubjectHistory();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Attendance import failed');
    } finally {
      setAttendanceImporting(false);
    }
  };

  const handleImportedAttendanceDelete = async () => {
    if (!attendanceDeleteRange.startDate) return toast.error('Select a start date for delete.');
    setAttendanceDeleting(true);
    try {
      const res = await attendanceAPI.deleteImportedSubjectAttendance(subjectId, attendanceDeleteRange);
      toast.success(res.data.message || 'Imported attendance delete scheduled');
      setAttendanceDeleteRange({ startDate: '', endDate: '' });
      setAttendanceDeleteOpen(false);
      await loadClassroom();
      if (historyData) fetchSubjectHistory();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not schedule imported attendance deletion');
    } finally {
      setAttendanceDeleting(false);
    }
  };

  const resolveSubjectDispute = async (dispute, status, attendanceStatus) => {
    setResolvingDisputeId(dispute._id);
    try {
      await attendanceAPI.resolveDispute(dispute._id, {
        status,
        attendanceStatus,
        note: resolutionNotes[dispute._id] || ''
      });
      toast.success(status === 'rejected' ? 'Dispute rejected' : 'Dispute resolved');
      setResolutionNotes(current => ({ ...current, [dispute._id]: '' }));
      await fetchSubjectDisputes();
      if (historyData) fetchSubjectHistory();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not resolve dispute');
    } finally {
      setResolvingDisputeId('');
    }
  };

  const deleteSubjectDispute = async (dispute) => {
    if (!dispute?._id) return;
    setDeletingDisputeId(dispute._id);
    try {
      await attendanceAPI.deleteDispute(dispute._id);
      toast.success('Dispute deleted');
      setResolutionNotes(current => {
        const next = { ...current };
        delete next[dispute._id];
        return next;
      });
      await fetchSubjectDisputes();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not delete dispute');
    } finally {
      setDeletingDisputeId('');
      setDisputeDeleteTarget(null);
    }
  };

  const deleteAllSubjectDisputes = async () => {
    setDeletingDisputeId('all');
    try {
      const res = await attendanceAPI.deleteDisputes({ subjectId });
      toast.success(res.data?.message || 'Disputes deleted');
      setResolutionNotes({});
      await fetchSubjectDisputes();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not delete disputes');
    } finally {
      setDeletingDisputeId('');
      setDisputeDeleteTarget(null);
    }
  };

  const confirmDisputeDelete = () => {
    if (disputeDeleteTarget?.mode === 'all') return deleteAllSubjectDisputes();
    return deleteSubjectDispute(disputeDeleteTarget?.dispute);
  };

  const editQuizDraft = (item) => {
    setEditingQuizId(item._id);
    setQuiz(distributeQuizQuestionMarks(quizToForm(item)));
    setActiveTab('quizzes');
    setQuizPanel('manual');
  };

  const editMaterialDraft = (item) => {
    setEditingMaterialId(item._id);
    setMaterial(materialToForm(item));
    setActiveTab('materials');
    setMaterialFolder(folderNameFor(item));
    setMaterialPanelOpen(true);
  };

  const editAssignmentDraft = (item) => {
    setEditingAssignmentId(item._id);
    setAssignment(assignmentToForm(item));
    setActiveTab('assignments');
    setAssignmentPanelOpen(true);
  };

  const updateQuizQuestion = (questionIndex, updater) => {
    setQuiz(current => {
      const questions = current.questions.map((question, index) => (
        index === questionIndex ? updater(question) : question
      ));
      return distributeQuizQuestionMarks({ ...current, questions });
    });
  };

  const addQuizOption = (questionIndex) => {
    updateQuizQuestion(questionIndex, question => ({
      ...question,
      options: [...question.options, { text: '', isCorrect: false }]
    }));
  };

  const removeQuizOption = (questionIndex, optionIndex) => {
    updateQuizQuestion(questionIndex, question => {
      if (question.options.length <= 2) return question;
      const removedWasCorrect = question.options[optionIndex]?.isCorrect;
      const options = question.options
        .filter((_, index) => index !== optionIndex)
        .map((option, index) => ({ ...option, isCorrect: removedWasCorrect ? index === 0 : option.isCorrect }));
      return { ...question, options };
    });
  };

  const addQuizQuestion = () => {
    setQuiz(current => distributeQuizQuestionMarks({
      ...current,
      questions: [...current.questions, { ...emptyQuiz.questions[0], options: emptyQuiz.questions[0].options.map(option => ({ ...option })) }]
    }));
  };

  const removeQuizQuestion = (questionIndex) => {
    setQuiz(current => distributeQuizQuestionMarks({ ...current, questions: current.questions.filter((_, idx) => idx !== questionIndex) }));
  };

  const submitAssignment = async (assignmentId) => {
    const formData = new FormData();
    if (submissionText[assignmentId]) formData.append('text', submissionText[assignmentId]);
    if (submissionFile[assignmentId]) formData.append('file', submissionFile[assignmentId]);
    setSaving(`submit-${assignmentId}`);
    try {
      await lmsAPI.submitAssignment(assignmentId, formData);
      setSubmissionText(current => ({ ...current, [assignmentId]: '' }));
      setSubmissionFile(current => ({ ...current, [assignmentId]: null }));
      await loadClassroom();
      toast.success('Assignment submitted');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Submission failed');
    } finally {
      setSaving('');
    }
  };

  const gradeSubmission = async (submissionId) => {
    setSaving(`grade-${submissionId}`);
    try {
      const draft = gradeDrafts[submissionId] || {};
      await lmsAPI.gradeSubmission(submissionId, { marks: draft.marks, feedback: draft.feedback });
      await loadClassroom();
      toast.success('Grade saved');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not grade');
    } finally {
      setSaving('');
    }
  };

  const returnSubmission = async (submissionId) => {
    setSaving(`return-${submissionId}`);
    try {
      await lmsAPI.returnSubmission(submissionId);
      await loadClassroom();
      toast.success('Returned to student');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not return');
    } finally {
      setSaving('');
    }
  };

  const markMaterialViewed = async (materialId) => {
    setSaving(`view-material-${materialId}`);
    try {
      await lmsAPI.markMaterialViewed(materialId);
      await loadClassroom();
      toast.success('Marked as viewed');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not mark viewed');
    } finally {
      setSaving('');
    }
  };

  const getQuizRemainingSeconds = (quizItem) => {
    const id = String(quizItem._id);
    const timing = getQuizTimingState(quizItem);
    const serverCloseAt = timing.closeAt;
    const localStartedAt = quizStartedAt[id] ? new Date(quizStartedAt[id]).getTime() : quizNow;
    const localCloseAt = quizItem.durationMinutes ? localStartedAt + Number(quizItem.durationMinutes || 0) * 60 * 1000 : null;
    const closeAt = serverCloseAt || localCloseAt;
    return closeAt ? Math.max(0, Math.ceil((closeAt - quizNow) / 1000)) : null;
  };

  const quizAnswerKey = (quizId, question) => `${quizId}-${question._id}`;

  const updateQuizAnswer = (quizId, question, value) => {
    const id = String(quizId);
    setQuizStartedAt(current => current[id] ? current : { ...current, [id]: new Date().toISOString() });
    setQuizAnswers(current => ({ ...current, [quizAnswerKey(id, question)]: value }));
  };

  const attemptQuiz = async (quizItem) => {
    setSaving(`quiz-${quizItem._id}`);
    try {
      const id = String(quizItem._id);
      const answers = (quizItem.questions || []).map((question) => {
        const key = quizAnswerKey(id, question);
        if (question.type === 'checkbox') return { question: question._id, selectedIndexes: quizAnswers[key] || [] };
        if (['short_answer', 'paragraph'].includes(question.type)) return { question: question._id, textAnswer: quizAnswers[key] || '' };
        return { question: question._id, selectedIndex: Number(quizAnswers[key] ?? -1) };
      });
      const startedAt = quizStartedAt[id] || new Date().toISOString();
      await lmsAPI.attemptQuiz(quizItem._id, {
        answers,
        startedAt,
        timeSpentSeconds: Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)),
        tabSwitchCount: quizTabSwitches[id]?.length || 0,
        tabSwitches: quizTabSwitches[id] || []
      });
      await loadClassroom();
      setQuizAnswers(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${id}-`))));
      setQuizQuestionSteps(current => ({ ...current, [id]: 0 }));
      toast.success('Quiz submitted');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Quiz submission failed');
    } finally {
      setSaving('');
    }
  };

  useEffect(() => {
    if (isStaff || activeTab !== 'quizzes' || saving) return;
    const attemptedQuizIds = new Set((data?.attempts || [])
      .filter(attempt => String(attempt.student?._id || attempt.student) === String(user?._id))
      .map(attempt => String(attempt.quiz?._id || attempt.quiz)));
    const expiredQuiz = (data?.quizzes || []).find(item => {
      const id = String(item._id);
      return quizStartedAt[id] && !attemptedQuizIds.has(id) && !item.resultsReleased && getQuizTimingState(item).state === 'open' && getQuizRemainingSeconds(item) === 0;
    });
    if (expiredQuiz) {
      toast.error('Time is over. Submitting quiz automatically.');
      attemptQuiz(expiredQuiz);
    }
  }, [activeTab, data?.attempts, data?.quizzes, isStaff, quizNow, quizStartedAt, saving, user?._id]);

  const releaseQuizResults = async (quizId) => {
    setSaving(`release-${quizId}`);
    try {
      await lmsAPI.releaseQuizResults(quizId);
      await loadClassroom();
      toast.success('Quiz results released');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not release results');
    } finally {
      setSaving('');
    }
  };

  const replyDiscussion = async (discussionId) => {
    const message = replyDrafts[discussionId];
    if (!message?.trim()) return;
    setSaving(`reply-${discussionId}`);
    try {
      await lmsAPI.replyDiscussion(discussionId, { message });
      setReplyDrafts(current => ({ ...current, [discussionId]: '' }));
      await loadClassroom();
      toast.success('Reply sent');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not reply');
    } finally {
      setSaving('');
    }
  };

  const resolveDiscussion = async (discussionId) => {
    setSaving(`resolve-${discussionId}`);
    try {
      await lmsAPI.resolveDiscussion(discussionId);
      await loadClassroom();
      toast.success('Doubt resolved');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not resolve');
    } finally {
      setSaving('');
    }
  };

  if (loading) return <PageSkeleton variant="classroom" />;

  const subject = data?.subject;
  const attendance = data?.attendanceSummary || {};
  const submittedCount = (data?.submissions || []).filter(item => String(item.student?._id || item.student) === String(user?._id)).length;
  const completedQuizCount = (data?.attempts || []).filter(item => String(item.student?._id || item.student) === String(user?._id)).length;
  const pendingAssignment = !isStaff ? (data?.assignments || []).find(item => !submissionsByAssignment.get(String(item._id))?.some(sub => String(sub.student?._id || sub.student) === String(user?._id))) : null;
  const pendingQuiz = !isStaff ? (data?.quizzes || []).find(item => !attemptsByQuiz.get(String(item._id))?.some(attempt => String(attempt.student?._id || attempt.student) === String(user?._id))) : null;
  const visibleTabItems = readableTabs;
  const quizPerQuestionMarks = Math.max(0, Number(quiz.totalMarks || 0)) / Math.max(quiz.questions.length, 1);
  const filterByStudent = (rows = [], query = '') => {
    if (!query) return rows;
    return rows.filter(row => {
      const student = row.student || {};
      return [student.name, student.studentId, student.email].some(value => String(value || '').toLowerCase().includes(query));
    });
  };
  const visibleReviewSubmissions = filterByStudent(reviewModal?.submissions || [], reviewQuery);
  const visibleReviewAttempts = filterByStudent(reviewModal?.attempts || [], reviewQuery);
  const viewedMaterialIds = new Set((data?.materialViews || [])
    .filter(view => String(view.student?._id || view.student) === String(user?._id))
    .map(view => String(view.material?._id || view.material)));
  const analyticsStudents = data?.analytics?.completion?.students || 0;
  const analyticsAssignments = (data?.assignments || []).filter(item => item.isPublished !== false);
  const analyticsQuizzes = (data?.quizzes || []).filter(item => item.isPublished !== false);
  const analyticsItems = analyticsKind === 'assignment' ? analyticsAssignments : analyticsKind === 'quiz' ? analyticsQuizzes : [];
  const selectedAnalyticsItem = analyticsItems.find(item => String(item._id) === String(analyticsItemId));
  const selectedAnalyticsRows = selectedAnalyticsItem
    ? (analyticsKind === 'assignment'
      ? (submissionsByAssignment.get(String(selectedAnalyticsItem._id)) || [])
      : (attemptsByQuiz.get(String(selectedAnalyticsItem._id)) || []))
    : [];
  const selectedAnalyticsCompleted = new Set(selectedAnalyticsRows.map(row => String(row.student?._id || row.student))).size;
  const selectedAnalyticsPending = Math.max(analyticsStudents - selectedAnalyticsCompleted, 0);
  const selectedAnalyticsRate = analyticsStudents ? Math.round((selectedAnalyticsCompleted / analyticsStudents) * 100) : 0;
  const resetAnalyticsKind = (kind) => {
    setAnalyticsKind(kind);
    setAnalyticsItemId('');
  };
  const quizTimingState = getQuizTimingState;

  const materialForm = (
    <form onSubmit={createMaterial} className="grid gap-3">
      <label className="grid gap-1.5"><span className="label mb-0">Material title</span><input className="input-field" placeholder="Title" value={material.title} onChange={e => setMaterial({ ...material, title: e.target.value })} required /></label>
      <label className="grid gap-1.5"><span className="label mb-0">Description or note</span><textarea className="input-field min-h-20" placeholder="Description or note" value={material.description} onChange={e => setMaterial({ ...material, description: e.target.value })} /></label>
      <label className="grid gap-1.5"><span className="label mb-0">Optional link URL</span><input className="input-field" placeholder="Optional link URL" value={material.linkUrl} onChange={e => setMaterial({ ...material, linkUrl: e.target.value })} /></label>
      <label className="grid gap-1.5"><span className="label mb-0">More links</span><textarea className="input-field min-h-16" placeholder="Paste one link per line" value={material.linkUrls} onChange={e => setMaterial({ ...material, linkUrls: e.target.value })} /></label>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="grid gap-1.5"><span className="label mb-0">Folder</span><input className="input-field" placeholder="Unit 1 folder" value={material.folder} readOnly title="Open another folder to change where this material is saved" /></label>
        <label className="grid gap-1.5"><span className="label mb-0">Topic / unit</span><input className="input-field" placeholder="Unit 1" value={material.topic} onChange={e => setMaterial({ ...material, topic: e.target.value })} /></label>
        <label className="grid gap-1.5"><span className="label mb-0">Category</span><select className="input-field" value={material.category} onChange={e => setMaterial({ ...material, category: e.target.value })}>
          <option value="notes">Notes</option><option value="slides">Slides</option><option value="reading">Reading</option><option value="reference">Reference</option><option value="lab">Lab file</option><option value="video">Video</option><option value="other">Other</option>
        </select></label>
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-300"><input type="checkbox" checked={material.isPinned} onChange={e => setMaterial({ ...material, isPinned: e.target.checked })} /> Pin important</label>
      </div>
      <label className="grid gap-1.5"><span className="label mb-0">Topic tags</span><input className="input-field" placeholder="Unit 1, SDLC, Agile" value={material.tags} onChange={e => setMaterial({ ...material, tags: e.target.value })} /></label>
      <label className="grid gap-1.5"><span className="label mb-0">Attach files</span><input className="input-field" type="file" multiple onChange={e => setMaterial({ ...material, files: Array.from(e.target.files || []) })} /></label>
      <button className="btn-primary inline-flex items-center justify-center gap-2" disabled={saving === 'material'}><Upload className="h-4 w-4" /> {editingMaterialId ? 'Update Draft' : 'Save Draft'}</button>
    </form>
  );

  const persistMaterialFolders = (folders) => {
    const nextFolders = [...new Set((folders || []).map(folder => String(folder || '').trim()).filter(Boolean))];
    setSavedMaterialFolders(nextFolders);
    writeSavedMaterialFolders(user?._id, subjectId, nextFolders);
    return nextFolders;
  };

  const uniqueMaterialFolderName = (baseName = 'New folder') => {
    const existing = new Set(materialFolders.map(folder => folder.name.toLowerCase()));
    let name = baseName;
    let index = 2;
    while (existing.has(name.toLowerCase())) {
      name = `${baseName} (${index})`;
      index += 1;
    }
    return name;
  };

  const createMaterialFolder = async (event) => {
    event?.preventDefault?.();
    const folder = uniqueMaterialFolderName(newMaterialFolder.trim() || 'New folder');
    try {
      const res = await lmsAPI.createMaterialFolder(subjectId, { name: folder });
      persistMaterialFolders([...savedMaterialFolders, folder]);
      await loadClassroom();
      const createdName = res.data?.folder?.name || folder;
      setMaterialFolder(createdName);
      setMaterial(current => ({ ...current, folder: createdName }));
      setNewMaterialFolder('');
      setMaterialPanelOpen(false);
      setEditingMaterialId('');
      setRenamingMaterialFolder(createdName);
      setMaterialFolderDraft(createdName);
      setMaterialFolderMenu('');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not create folder');
    }
  };

  const startRenameMaterialFolder = (folder) => {
    setRenamingMaterialFolder(folder);
    setMaterialFolderDraft(folder);
    setMaterialPanelOpen(false);
    setMaterialFolderMenu('');
  };

  const commitMaterialFolderRename = async () => {
    const oldFolder = renamingMaterialFolder;
    const nextFolder = materialFolderDraft.trim();
    if (!oldFolder) return;
    if (!nextFolder) {
      toast.error('Folder name cannot be empty');
      setMaterialFolderDraft(oldFolder);
      return;
    }
    if (nextFolder !== oldFolder && materialFolders.some(folder => folder.name.toLowerCase() === nextFolder.toLowerCase())) {
      toast.error('A folder with this name already exists');
      setMaterialFolderDraft(oldFolder);
      return;
    }
    try {
      const folderId = materialFolderIdMap.get(oldFolder);
      if (folderId) await lmsAPI.updateMaterialFolder(folderId, { name: nextFolder });
      persistMaterialFolders(savedMaterialFolders.map(folder => folder === oldFolder ? nextFolder : folder));
      if (materialFolder === oldFolder) setMaterialFolder(nextFolder);
      setMaterial(current => current.folder === oldFolder ? { ...current, folder: nextFolder } : current);
      setRenamingMaterialFolder('');
      setMaterialFolderDraft('');
      setMaterialFolderMenu('');
      await loadClassroom();
      toast.success('Folder renamed');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not rename folder');
      setMaterialFolderDraft(oldFolder);
    }
  };

  const deleteMaterialFolder = async (folder) => {
    const count = materialFolderCountMap.get(folder) || 0;
    if (count > 0) {
      toast.error('Move or delete materials inside this folder first.');
      return;
    }
    try {
      const folderId = materialFolderIdMap.get(folder);
      if (folderId) await lmsAPI.deleteMaterialFolder(folderId);
      persistMaterialFolders(savedMaterialFolders.filter(item => item !== folder));
      if (materialFolder === folder) {
        setMaterialFolder('all');
        setMaterialPanelOpen(false);
        setMaterial(emptyMaterial);
      }
      if (renamingMaterialFolder === folder) {
        setRenamingMaterialFolder('');
        setMaterialFolderDraft('');
      }
      setMaterialFolderMenu('');
      await loadClassroom();
      toast.success('Folder deleted');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not delete folder');
    }
  };

  const openMaterialFolderMenu = (event, folder) => {
    event.preventDefault();
    event.stopPropagation();
    setMaterialFolderMenu(current => current === folder ? '' : folder);
  };

  const openMaterialFolder = (folder) => {
    setMaterialFolder(folder);
    setMaterialPanelOpen(false);
    setEditingMaterialId('');
    setMaterial(current => ({ ...current, folder }));
    setMaterialFolderMenu('');
  };

  const startMaterialFolderHold = (event, folder) => {
    if (event.pointerType !== 'touch') return;
    window.clearTimeout(materialFolderHoldRef.current);
    materialFolderHoldRef.current = window.setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(20);
      setMaterialFolderMenu(folder);
    }, 520);
  };

  const clearMaterialFolderHold = () => {
    window.clearTimeout(materialFolderHoldRef.current);
  };

  const openMaterialPanelForFolder = (folder = materialFolder) => {
    if (folder === 'all') {
      toast('Open or create a folder before adding material.');
      return;
    }
    const selectedFolder = folder === 'all' ? '' : folder;
    setEditingMaterialId('');
    setMaterial({ ...emptyMaterial, folder: selectedFolder });
    setMaterialPanelOpen(true);
  };

  const assignmentForm = (
    <form onSubmit={createAssignment} className="grid gap-3">
      <label className="grid gap-1.5"><span className="label mb-0">Assignment title</span><input className="input-field" placeholder="Title" value={assignment.title} onChange={e => setAssignment({ ...assignment, title: e.target.value })} required /></label>
      <label className="grid gap-1.5"><span className="label mb-0">Instructions</span><textarea className="input-field min-h-20" placeholder="Instructions" value={assignment.description} onChange={e => setAssignment({ ...assignment, description: e.target.value })} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5"><span className="label mb-0">Topic / unit</span><input className="input-field" placeholder="Unit 1" value={assignment.topic} onChange={e => setAssignment({ ...assignment, topic: e.target.value })} /></label>
        <label className="grid gap-1.5"><span className="label mb-0">Topic tags</span><input className="input-field" placeholder="Unit 1, SDLC, Agile" value={assignment.tags} onChange={e => setAssignment({ ...assignment, tags: e.target.value })} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="grid gap-1.5"><span className="label mb-0">Due date</span><input className="input-field" type="date" value={assignment.dueDate} onChange={e => setAssignment({ ...assignment, dueDate: e.target.value })} /></label>
        <label className="grid gap-1.5"><span className="label mb-0">Due time</span><input className="input-field" type="time" value={assignment.dueTime} onChange={e => setAssignment({ ...assignment, dueTime: e.target.value })} /></label>
        <label className="grid gap-1.5"><span className="label mb-0">Points</span><input className="input-field" type="number" min="0" value={assignment.maxMarks} onChange={e => setAssignment({ ...assignment, maxMarks: e.target.value })} disabled={assignment.isUngraded} /></label>
        <label className="grid gap-1.5"><span className="label mb-0">Submission mode</span><select className="input-field" value={assignment.submissionMode} onChange={e => setAssignment({ ...assignment, submissionMode: e.target.value })}>
          <option value="offline">Offline submission</option>
          <option value="online">Online submission</option>
        </select></label>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-300"><input type="checkbox" checked={assignment.isUngraded} onChange={e => setAssignment({ ...assignment, isUngraded: e.target.checked })} /> Ungraded</label>
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-300"><input type="checkbox" checked={assignment.allowResubmission} onChange={e => setAssignment({ ...assignment, allowResubmission: e.target.checked })} /> Allow resubmission</label>
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-300"><input type="checkbox" checked={assignment.acceptLateSubmissions} onChange={e => setAssignment({ ...assignment, acceptLateSubmissions: e.target.checked })} /> Accept late</label>
      </div>
      <label className="grid gap-1.5"><span className="label mb-0">Assignment links</span><textarea className="input-field min-h-16" placeholder="Paste one link per line" value={assignment.linkUrls} onChange={e => setAssignment({ ...assignment, linkUrls: e.target.value })} /></label>
      <label className="grid gap-1.5"><span className="label mb-0">Assignment attachments</span><input className="input-field" type="file" multiple onChange={e => setAssignment({ ...assignment, files: Array.from(e.target.files || []) })} /></label>
      <button className="btn-primary inline-flex items-center justify-center gap-2" disabled={saving === 'assignment'}><Send className="h-4 w-4" /> {editingAssignmentId ? 'Update Draft' : 'Save Draft'}</button>
    </form>
  );

  const quizForm = (
    <form onSubmit={createQuiz} className="grid gap-3">
      <div>
        <p className="font-semibold text-white">Manual Quiz</p>
        <p className="mt-1 text-xs text-slate-500">Duration is the quiz window after the open time when no close time is set. Total marks are split equally across all questions.</p>
      </div>
      <label className="grid gap-1.5"><span className="label mb-0">Quiz title</span><input className="input-field" placeholder="Quiz title" value={quiz.title} onChange={e => setQuiz({ ...quiz, title: e.target.value })} required /></label>
      <label className="grid gap-1.5"><span className="label mb-0">Description</span><textarea className="input-field min-h-16" placeholder="Description" value={quiz.description} onChange={e => setQuiz({ ...quiz, description: e.target.value })} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5"><span className="label mb-0">Topic / unit</span><input className="input-field" placeholder="Unit 1" value={quiz.topic} onChange={e => setQuiz({ ...quiz, topic: e.target.value })} /></label>
        <label className="grid gap-1.5"><span className="label mb-0">Topic tags</span><input className="input-field" placeholder="Unit 1, SDLC, Agile" value={quiz.tags} onChange={e => setQuiz({ ...quiz, tags: e.target.value })} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="grid gap-1.5"><span className="label mb-0">Duration minutes</span><input className="input-field" type="number" min="1" value={quiz.durationMinutes} onChange={e => setQuiz({ ...quiz, durationMinutes: e.target.value })} /></label>
        <label className="grid gap-1.5"><span className="label mb-0">Total marks</span><input className="input-field" type="number" min="0" step="0.5" value={quiz.totalMarks} onChange={e => setQuiz(current => distributeQuizQuestionMarks({ ...current, totalMarks: e.target.value }))} /></label>
        <label className="grid gap-1.5"><span className="label mb-0">Opens at</span><input className="input-field" type="datetime-local" value={quiz.startAt} onChange={e => setQuiz({ ...quiz, startAt: e.target.value })} /></label>
        <label className="grid gap-1.5"><span className="label mb-0">Closes at</span><input className="input-field" type="datetime-local" value={quiz.endAt} onChange={e => setQuiz({ ...quiz, endAt: e.target.value })} /></label>
      </div>
      <div className="rounded-xl border border-primary-400/20 bg-primary-500/10 px-3 py-2 text-xs text-primary-100">
        {quiz.questions.length} questions - {Number(quiz.totalMarks || 0)} total marks - {quizPerQuestionMarks.toFixed(2)} marks per question
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1.5"><span className="label mb-0">Result release</span><select className="input-field" value={quiz.releaseMode} onChange={e => setQuiz({ ...quiz, releaseMode: e.target.value })}>
          <option value="manual">After teacher release</option>
          <option value="immediate">Immediately when auto-graded</option>
        </select></label>
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-300"><input type="checkbox" checked={quiz.showCorrectAnswers} onChange={e => setQuiz({ ...quiz, showCorrectAnswers: e.target.checked })} /> Show correct answers</label>
        <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-300"><input type="checkbox" checked={quiz.shuffleQuestions} onChange={e => setQuiz({ ...quiz, shuffleQuestions: e.target.checked })} /> Shuffle questions</label>
      </div>
      <div className="rounded-2xl border border-primary-400/20 bg-primary-500/10 p-3">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary-100"><ShieldCheck className="h-4 w-4" /> Anti-cheating controls</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-slate-300"><input type="checkbox" checked={quiz.oneQuestionAtATime} onChange={e => setQuiz({ ...quiz, oneQuestionAtATime: e.target.checked })} /> One question at a time</label>
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-slate-300"><input type="checkbox" checked={quiz.tabSwitchWarning} onChange={e => setQuiz({ ...quiz, tabSwitchWarning: e.target.checked })} /> Tab switch warning</label>
          <label className="grid gap-1.5"><span className="label mb-0">Tab warning limit</span><input className="input-field" type="number" min="0" max="20" value={quiz.maxTabSwitchWarnings} onChange={e => setQuiz({ ...quiz, maxTabSwitchWarnings: e.target.value })} disabled={!quiz.tabSwitchWarning} /></label>
        </div>
      </div>
      {quiz.questions.map((question, questionIndex) => (
        <div key={questionIndex} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-200">Question {questionIndex + 1}</p>
            {quiz.questions.length > 1 && (
              <button type="button" className="text-xs text-red-300 hover:text-red-200" onClick={() => removeQuizQuestion(questionIndex)}>Remove question</button>
            )}
          </div>
          <div className="mb-2 grid gap-2 sm:grid-cols-3">
            <label className="grid gap-1.5"><span className="label mb-0">Question type</span><select className="input-field" value={question.type || 'multiple_choice'} onChange={e => updateQuizQuestion(questionIndex, current => ({ ...current, type: e.target.value }))}>
              <option value="multiple_choice">Multiple choice</option>
              <option value="checkbox">Checkboxes</option>
              <option value="dropdown">Dropdown</option>
              <option value="short_answer">Short answer</option>
              <option value="paragraph">Paragraph</option>
            </select></label>
            <label className="grid gap-1.5"><span className="label mb-0">Points</span><input className="input-field" type="number" min="0" step="0.5" value={question.marks || 0} readOnly title="Auto distributed from total marks" /></label>
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-300"><input type="checkbox" checked={question.required !== false} onChange={e => updateQuizQuestion(questionIndex, current => ({ ...current, required: e.target.checked }))} /> Required</label>
          </div>
          <label className="grid gap-1.5"><span className="label mb-0">Question text</span><input className="input-field" placeholder={`Question ${questionIndex + 1}`} value={question.text} onChange={e => updateQuizQuestion(questionIndex, current => ({ ...current, text: e.target.value }))} /></label>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <label className="grid gap-1.5 sm:col-span-3"><span className="label mb-0">Explanation shown after marks release</span><textarea className="input-field min-h-16" placeholder="Why is the correct answer right?" value={question.explanation || ''} onChange={e => updateQuizQuestion(questionIndex, current => ({ ...current, explanation: e.target.value }))} /></label>
            <label className="grid gap-1.5"><span className="label mb-0">Correct feedback</span><input className="input-field" placeholder="Shown when correct" value={question.correctFeedback || ''} onChange={e => updateQuizQuestion(questionIndex, current => ({ ...current, correctFeedback: e.target.value }))} /></label>
            <label className="grid gap-1.5"><span className="label mb-0">Wrong feedback</span><input className="input-field" placeholder="Shown when wrong" value={question.wrongFeedback || ''} onChange={e => updateQuizQuestion(questionIndex, current => ({ ...current, wrongFeedback: e.target.value }))} /></label>
            {['short_answer', 'paragraph'].includes(question.type) && <label className="grid gap-1.5"><span className="label mb-0">Answer key</span><input className="input-field" placeholder="Exact answer for auto-check" value={(question.answerKey || []).join(', ')} onChange={e => updateQuizQuestion(questionIndex, current => ({ ...current, answerKey: e.target.value.split(',').map(item => item.trim()).filter(Boolean) }))} /></label>}
          </div>
          {!['short_answer', 'paragraph'].includes(question.type) && <div className="mt-2 grid gap-2">
            {question.options.map((option, optionIndex) => (
              <label key={optionIndex} className="flex items-center gap-2">
                <input type={question.type === 'checkbox' ? 'checkbox' : 'radio'} checked={option.isCorrect} onChange={() => updateQuizQuestion(questionIndex, current => ({
                  ...current,
                  options: current.options.map((item, idx) => ({ ...item, isCorrect: question.type === 'checkbox' ? (idx === optionIndex ? !item.isCorrect : item.isCorrect) : idx === optionIndex }))
                }))} />
                <input className="input-field" aria-label={`Option ${optionIndex + 1}`} placeholder={`Option ${optionIndex + 1}`} value={option.text} onChange={e => updateQuizQuestion(questionIndex, current => {
                  const options = [...current.options];
                  options[optionIndex] = { ...options[optionIndex], text: e.target.value };
                  return { ...current, options };
                })} />
                <button
                  type="button"
                  className="rounded-lg p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
                  disabled={question.options.length <= 2}
                  onClick={() => removeQuizOption(questionIndex, optionIndex)}
                  title="Remove option"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </label>
            ))}
          </div>}
          {!['short_answer', 'paragraph'].includes(question.type) && <button type="button" className="btn-secondary mt-3 inline-flex items-center gap-2" onClick={() => addQuizOption(questionIndex)}><Plus className="h-4 w-4" /> Add Option</button>}
          {!['short_answer', 'paragraph'].includes(question.type) && (
            <label className="mt-3 flex w-fit items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-sm text-slate-300">
              <input type="checkbox" checked={Boolean(question.shuffleOptions)} onChange={e => updateQuizQuestion(questionIndex, current => ({ ...current, shuffleOptions: e.target.checked }))} /> Shuffle options for students
            </label>
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={addQuizQuestion}>Add Question</button>
        <button type="button" className="btn-secondary" onClick={() => { setQuizPanel(''); setEditingQuizId(''); setQuiz(emptyQuiz); }}>Cancel</button>
        <button className="btn-primary inline-flex items-center justify-center gap-2" disabled={saving === 'quiz'}><Trophy className="h-4 w-4" /> {editingQuizId ? 'Update Draft' : 'Save Draft'}</button>
      </div>
    </form>
  );

  const quizImportForm = (
    <form onSubmit={importQuiz} className="grid gap-3">
      <div>
        <p className="font-semibold text-white">Import Quiz From Excel / CSV</p>
        <p className="mt-1 text-xs text-slate-500">Use columns: questionType, question, option1..optionN, correctAnswer, marks, explanation, correctFeedback, wrongFeedback, required, topic.</p>
      </div>
      <label className="grid gap-1.5"><span className="label mb-0">Quiz title</span><input className="input-field" placeholder="Quiz title" value={quizImport.title} onChange={e => setQuizImport({ ...quizImport, title: e.target.value })} required /></label>
      <label className="grid gap-1.5"><span className="label mb-0">Description</span><textarea className="input-field min-h-16" placeholder="Description" value={quizImport.description} onChange={e => setQuizImport({ ...quizImport, description: e.target.value })} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5"><span className="label mb-0">Topic / unit</span><input className="input-field" placeholder="Unit 1" value={quizImport.topic} onChange={e => setQuizImport({ ...quizImport, topic: e.target.value })} /></label>
        <label className="grid gap-1.5"><span className="label mb-0">Topic tags</span><input className="input-field" placeholder="Unit 1, SDLC, Agile" value={quizImport.tags} onChange={e => setQuizImport({ ...quizImport, tags: e.target.value })} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="grid gap-1.5"><span className="label mb-0">Duration minutes</span><input className="input-field" type="number" min="1" value={quizImport.durationMinutes} onChange={e => setQuizImport({ ...quizImport, durationMinutes: e.target.value })} /></label>
        <label className="grid gap-1.5"><span className="label mb-0">Total marks</span><input className="input-field" type="number" min="0" step="0.5" value={quizImport.totalMarks} onChange={e => setQuizImport({ ...quizImport, totalMarks: e.target.value })} /></label>
        <label className="grid gap-1.5"><span className="label mb-0">Opens at</span><input className="input-field" type="datetime-local" value={quizImport.startAt} onChange={e => setQuizImport({ ...quizImport, startAt: e.target.value })} /></label>
        <label className="grid gap-1.5"><span className="label mb-0">Closes at</span><input className="input-field" type="datetime-local" value={quizImport.endAt} onChange={e => setQuizImport({ ...quizImport, endAt: e.target.value })} /></label>
      </div>
      <label className="grid gap-1.5"><span className="label mb-0">Result release</span><select className="input-field" value={quizImport.releaseMode} onChange={e => setQuizImport({ ...quizImport, releaseMode: e.target.value })}>
        <option value="manual">After teacher release</option>
        <option value="immediate">Immediately when auto-graded</option>
      </select></label>
      <div className="rounded-2xl border border-primary-400/20 bg-primary-500/10 p-3">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary-100"><ShieldCheck className="h-4 w-4" /> Anti-cheating controls</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-slate-300"><input type="checkbox" checked={quizImport.shuffleQuestions} onChange={e => setQuizImport({ ...quizImport, shuffleQuestions: e.target.checked })} /> Shuffle questions</label>
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-slate-300"><input type="checkbox" checked={quizImport.oneQuestionAtATime} onChange={e => setQuizImport({ ...quizImport, oneQuestionAtATime: e.target.checked })} /> One question at a time</label>
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-slate-300"><input type="checkbox" checked={quizImport.tabSwitchWarning} onChange={e => setQuizImport({ ...quizImport, tabSwitchWarning: e.target.checked })} /> Tab switch warning</label>
        </div>
      </div>
      <label className="grid gap-1.5"><span className="label mb-0">Excel or CSV file</span><input className="input-field" type="file" accept=".xlsx,.csv" onChange={e => setQuizImport({ ...quizImport, file: e.target.files?.[0] || null })} required /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => { setQuizPanel(''); setQuizImport(emptyQuizImport); }}>Cancel</button>
        <button className="btn-primary inline-flex items-center justify-center gap-2" disabled={saving === 'quiz-import'}><Upload className="h-4 w-4" /> Import as Draft</button>
      </div>
    </form>
  );

  const announcementForm = (
    <form onSubmit={createAnnouncement} className="grid gap-3">
      <input className="input-field" placeholder="Title" value={announcement.title} onChange={e => setAnnouncement({ ...announcement, title: e.target.value })} required />
      <textarea className="input-field min-h-24" placeholder="Message" value={announcement.message} onChange={e => setAnnouncement({ ...announcement, message: e.target.value })} required />
      <select className="input-field" value={announcement.priority} onChange={e => setAnnouncement({ ...announcement, priority: e.target.value })}>
        <option value="medium">Medium priority</option>
        <option value="high">High priority</option>
        <option value="low">Low priority</option>
      </select>
      <button className="btn-primary inline-flex items-center justify-center gap-2" disabled={saving === 'announcement'}><Bell className="h-4 w-4" /> Send Announcement</button>
    </form>
  );

  const renderResourceAction = (resource, label = 'Preview') => {
    if (!resource?.url) return null;
    const previewType = resourcePreviewType(resource);
    const Icon = previewType === 'image' ? ImageIcon : previewType === 'video' ? Video : FileText;
    return (
      <div className="flex flex-wrap items-center gap-2">
        {previewType ? (
          <button type="button" onClick={() => setPreviewResource(resource)} className="badge-info inline-flex items-center gap-1 hover:bg-primary-400/20">
            <Icon className="h-3 w-3" /> {label}
          </button>
        ) : (
          <a href={resourceUrl(resource.url)} target="_blank" rel="noreferrer" className="badge-info inline-flex items-center gap-1">
            <ExternalLink className="h-3 w-3" /> {resource.title || resource.fileName || 'Open'}
          </a>
        )}
        <a href={resourceUrl(resource.url)} target="_blank" rel="noreferrer" download className="badge-neutral inline-flex items-center gap-1">
          <Download className="h-3 w-3" /> Download
        </a>
      </div>
    );
  };

  const renderMaterials = () => (
    <Section icon={FileText} title={materialFolder === 'all' ? 'Study Materials' : `${materialFolder} Materials`}>
      {isStaff && (
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
          <div>
            <p className="font-semibold text-white">Material folders <span className="ml-1 rounded-full bg-primary-500/15 px-2 py-0.5 text-xs font-semibold text-primary-100">{materialFolders.length}</span></p>
            <p className="mt-1 text-xs text-slate-500">Create folders first, open one, then add PDFs, videos, docs, links, and notes inside it.</p>
          </div>
          <button type="button" onClick={createMaterialFolder} className="btn-secondary inline-flex items-center justify-center gap-2 px-4">
            <FolderOpen className="h-4 w-4" /> New Folder
          </button>
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-4">
        {materialFolders.map(({ name: folder, count }) => {
          const isRenaming = renamingMaterialFolder === folder;
          return (
            <div key={folder} role="button" tabIndex={0} onClick={() => { if (!isRenaming) openMaterialFolder(folder); }} onKeyDown={event => { if (!isRenaming && (event.key === 'Enter' || event.key === ' ')) openMaterialFolder(folder); }} className={`group relative w-24 rounded-xl p-1.5 text-center transition-colors ${materialFolder === folder ? 'bg-primary-500/10 ring-1 ring-primary-400/40' : 'hover:bg-white/[0.04]'}`}>
              <button
                type="button"
                onClick={event => { event.stopPropagation(); openMaterialFolder(folder); }}
                onContextMenu={event => openMaterialFolderMenu(event, folder)}
                onPointerDown={event => startMaterialFolderHold(event, folder)}
                onPointerUp={clearMaterialFolderHold}
                onPointerCancel={clearMaterialFolderHold}
                onPointerLeave={clearMaterialFolderHold}
                className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-primary-500/15 text-primary-200 transition-colors hover:bg-primary-500/25"
                aria-label={`Open ${folder}`}
                title="Open folder"
              >
                <FolderOpen className="h-6 w-6" />
              </button>
              {isStaff && (
                <div className="absolute right-1 top-1 hidden items-center gap-0.5 rounded-full bg-slate-950/85 p-0.5 shadow-lg group-hover:flex">
                  <button type="button" onClick={event => { event.stopPropagation(); startRenameMaterialFolder(folder); }} className="grid h-6 w-6 place-items-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Rename folder" title="Rename">
                    <Edit3 className="h-3 w-3" />
                  </button>
                  <button type="button" onClick={event => { event.stopPropagation(); deleteMaterialFolder(folder); }} className="grid h-6 w-6 place-items-center rounded-full text-slate-300 hover:bg-red-500/10 hover:text-red-300" aria-label="Delete folder" title="Delete">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              )}
              {materialFolderMenu === folder && isStaff && (
                <div className="absolute left-1/2 top-14 z-20 w-36 -translate-x-1/2 rounded-xl border border-white/10 bg-slate-950 p-1.5 text-left shadow-2xl">
                  <button type="button" onClick={event => { event.stopPropagation(); startRenameMaterialFolder(folder); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-slate-100 hover:bg-white/10">
                    <Edit3 className="h-3.5 w-3.5 text-primary-300" /> Rename
                  </button>
                  <button type="button" onClick={event => { event.stopPropagation(); deleteMaterialFolder(folder); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-red-200 hover:bg-red-500/10">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              )}
              {isRenaming ? (
                <input
                  ref={materialFolderInputRef}
                  className="mt-2 h-8 w-full rounded-lg border border-primary-400/50 bg-slate-950/80 px-2 text-center text-xs font-semibold text-white outline-none"
                  value={materialFolderDraft}
                  onChange={event => setMaterialFolderDraft(event.target.value)}
                  onClick={event => event.stopPropagation()}
                  onBlur={commitMaterialFolderRename}
                  onKeyDown={event => {
                    if (event.key === 'Enter') commitMaterialFolderRename();
                    if (event.key === 'Escape') {
                      setRenamingMaterialFolder('');
                      setMaterialFolderDraft('');
                    }
                  }}
                />
              ) : (
                <span className="mt-2 block truncate text-xs font-semibold text-white">{folder}</span>
              )}
              <span className="mt-0.5 block text-[10px] text-slate-500">{count} material{count === 1 ? '' : 's'}</span>
            </div>
          );
        })}
        {!materialFolders.length && <p className="w-full rounded-2xl border border-dashed border-white/10 py-6 text-center text-sm text-slate-500">No folders yet. Use New Folder to create one.</p>}
      </div>
      {materialFolder !== 'all' && (
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => { setMaterialFolder('all'); setMaterialPanelOpen(false); setEditingMaterialId(''); setMaterial(emptyMaterial); }}
              className="mb-2 inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to folders
            </button>
            <p className="truncate font-semibold text-white">{materialFolder}</p>
            <p className="mt-1 text-xs text-slate-500">{visibleMaterials.length} material{visibleMaterials.length === 1 ? '' : 's'} in this folder.</p>
          </div>
          {isStaff && !materialPanelOpen && (
            <button type="button" className="btn-primary inline-flex items-center justify-center gap-2 px-4" onClick={() => openMaterialPanelForFolder(materialFolder)}>
              <Upload className="h-4 w-4" /> Add Material
            </button>
          )}
        </div>
      )}
      {isStaff && materialFolder !== 'all' && !materialPanelOpen && (
        null
      )}
      {isStaff && materialPanelOpen && (
        <div className="mb-4 rounded-2xl border border-primary-400/20 bg-primary-500/5 p-3 sm:p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-white">{editingMaterialId ? 'Edit Material Draft' : 'Add Material'}</p>
              <p className="mt-1 text-xs text-slate-500">Material will be saved inside {material.folder || 'General'} folder.</p>
            </div>
            <button type="button" className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => { setMaterialPanelOpen(false); setEditingMaterialId(''); setMaterial(emptyMaterial); }} aria-label="Close material editor">
              <X className="h-5 w-5" />
            </button>
          </div>
          {materialForm}
        </div>
      )}
      <div className="space-y-3">
        {visibleMaterials.map(item => (
          <motion.article key={item._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3 shadow-sm transition-colors hover:border-primary-400/25 hover:bg-white/[0.055] sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-white">{item.isPinned && <Pin className="mr-1 inline h-3.5 w-3.5 text-amber-300" />}{item.title}</p>
              {isStaff && (
                <div className="flex items-center gap-2">
                  <span className={item.isPublished === false ? 'badge-warning' : 'badge-success'}>{item.isPublished === false ? 'Draft' : 'Published'}</span>
                  {item.isPublished === false && (
                    <>
                      <button type="button" className="badge-info hover:bg-primary-400/20" onClick={() => editMaterialDraft(item)}>
                        Edit
                      </button>
                      <button type="button" className="badge-info hover:bg-primary-400/20" disabled={saving === `publish-material-${item._id}`} onClick={() => publishItem('material', item._id, lmsAPI.publishMaterial)}>
                        Publish
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300"
                    disabled={saving === `material-${item._id}`}
                    onClick={() => deleteItem('material', item._id, lmsAPI.deleteMaterial)}
                    title="Delete material"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-slate-400">{item.description || 'Study resource'}</p>
            <TagList tags={item.tags || []} />
            <div className="mt-2 inline-flex max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-slate-300">
              <FolderOpen className="h-3 w-3 text-primary-300" /> <span className="truncate">{folderNameFor(item)}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {(item.attachments || []).map((attachment, index) => (
                <React.Fragment key={`${attachment.url}-${index}`}>{renderResourceAction(attachment, attachment.title || attachment.fileName || 'Preview')}</React.Fragment>
              ))}
              {item.fileUrl && renderResourceAction({ url: item.fileUrl, fileName: item.fileName, title: item.fileName || 'Open file', type: item.resourceType }, 'Open file')}
              {item.linkUrl && <a href={resourceUrl(item.linkUrl)} target="_blank" rel="noreferrer" className="badge-info inline-flex items-center gap-1"><ExternalLink className="h-3 w-3" /> Open link</a>}
              <span className="badge-neutral">{item.topic || item.category || item.resourceType}</span>
            </div>
          </motion.article>
        ))}
        {!visibleMaterials.length && <EmptyRow>{materialFolder === 'all' ? 'Open a folder to view its materials.' : 'No materials in this folder yet.'}</EmptyRow>}
      </div>
    </Section>
  );

  const renderAssignments = () => (
    <Section icon={ClipboardList} title="Assignments" action={isStaff && <button type="button" className="btn-primary inline-flex items-center justify-center gap-2" onClick={() => { setEditingAssignmentId(''); setAssignment(emptyAssignment); setAssignmentPanelOpen(true); }}><Plus className="h-4 w-4" /> Create Assignment</button>}>
      {isStaff && assignmentPanelOpen && (
        <div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3 sm:p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-white">{editingAssignmentId ? 'Edit Assignment Draft' : 'Create Assignment'}</p>
              <p className="mt-1 text-xs text-slate-500">Create, edit, attach files, and save assignments directly on this page.</p>
            </div>
            <button type="button" className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => { setAssignmentPanelOpen(false); setEditingAssignmentId(''); setAssignment(emptyAssignment); }} aria-label="Close assignment editor">
              <X className="h-5 w-5" />
            </button>
          </div>
          {assignmentForm}
        </div>
      )}
      <div className="lms-card-rail">
        <div className="lms-card-track">
        {(data?.assignments || []).map(item => {
          const submissions = submissionsByAssignment.get(String(item._id)) || [];
          const mySubmission = submissions.find(submission => String(submission.student?._id || submission.student) === String(user?._id));
          return (
            <div key={item._id} className="lms-compact-card">
              <div className={`grid gap-3 ${isStaff ? 'lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start' : ''}`}>
                <div className="min-w-0">
                  <p className="font-semibold leading-tight text-white">{item.title}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-400 sm:text-sm">{item.description || 'No extra instructions.'}</p>
                  <p className="mt-2 text-xs text-slate-500">Due: {item.dueDate ? new Date(item.dueDate).toLocaleDateString() : 'No due date'}{item.dueTime ? ` ${item.dueTime}` : ''} - {item.isUngraded ? 'Ungraded' : `${item.maxMarks} marks`} - {item.submissionMode === 'online' ? 'Online' : 'Offline'}</p>
                  {!isStaff && (
                    <span className={`${mySubmission?.status === 'graded' ? 'badge-success' : mySubmission ? 'badge-info' : 'badge-warning'} mt-2 inline-flex max-w-full whitespace-nowrap text-[10px] sm:text-xs`}>
                      {['graded', 'returned'].includes(mySubmission?.status) ? `${mySubmission.status === 'returned' ? 'Returned' : 'Graded'} ${mySubmission.marks}/${item.maxMarks}` : mySubmission ? (mySubmission.isLate ? 'Late submitted' : 'Submitted') : 'Pending'}
                    </span>
                  )}
                  <TagList tags={item.tags || []} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(item.attachments || []).map((attachment, index) => attachment.url && <a key={`${attachment.url}-${index}`} href={attachment.url} target="_blank" rel="noreferrer" className="badge-info">{attachment.title || attachment.fileName || 'Attachment'}</a>)}
                    {item.fileUrl && <a href={item.fileUrl} target="_blank" rel="noreferrer" className="badge-info">Attachment</a>}
                  </div>
                </div>
                {isStaff && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={item.isPublished === false ? 'badge-warning' : 'badge-success'}>{item.isPublished === false ? 'Draft' : 'Published'}</span>
                    <button type="button" className="badge-info inline-flex items-center gap-1 hover:bg-primary-400/20" onClick={() => setReviewModal({ type: 'assignment', item, submissions })} title="View submissions">
                      <Eye className="h-3 w-3" /> {submissions.length}
                    </button>
                    {submissions.length > 0 && (
                      <button type="button" className="badge-success inline-flex items-center gap-1 hover:bg-emerald-400/20" disabled={saving === `bulk-return-${item._id}`} onClick={async () => {
                        setSaving(`bulk-return-${item._id}`);
                        try {
                          await lmsAPI.bulkReturnAssignment(item._id);
                          await loadClassroom();
                          toast.success('Grades returned');
                        } catch (error) {
                          toast.error(error.response?.data?.message || 'Could not return grades');
                        } finally {
                          setSaving('');
                        }
                      }}>
                        <RotateCcw className="h-3 w-3" /> Return
                      </button>
                    )}
                    {item.isPublished === false && (
                      <>
                        <button type="button" className="badge-info hover:bg-primary-400/20" onClick={() => editAssignmentDraft(item)}>
                          Edit
                        </button>
                        <button type="button" className="badge-info hover:bg-primary-400/20" disabled={saving === `publish-assignment-${item._id}`} onClick={() => publishItem('assignment', item._id, lmsAPI.publishAssignment)}>
                          Publish
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300"
                      disabled={saving === `assignment-${item._id}`}
                      onClick={() => deleteItem('assignment', item._id, lmsAPI.deleteAssignment)}
                      title="Delete assignment"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              {!isStaff && (
                <div className="mt-4 grid gap-2">
                  {mySubmission ? (
                    <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-2.5 text-xs leading-5 text-emerald-100 sm:p-3 sm:text-sm">
                      Submitted. This assignment is locked and cannot be edited.
                    </div>
                  ) : item.submissionMode === 'online' ? (
                    <>
                      <textarea className="input-field min-h-20" placeholder="Submission note" value={submissionText[item._id] || ''} onChange={e => setSubmissionText(current => ({ ...current, [item._id]: e.target.value }))} />
                      <input className="input-field" type="file" onChange={e => setSubmissionFile(current => ({ ...current, [item._id]: e.target.files?.[0] || null }))} />
                      <button type="button" className="btn-primary" disabled={saving === `submit-${item._id}`} onClick={() => submitAssignment(item._id)}>Submit Online</button>
                    </>
                  ) : (
                    <button type="button" className="btn-primary" disabled={saving === `submit-${item._id}`} onClick={() => submitAssignment(item._id)}>Mark Submitted Offline</button>
                  )}
                  {mySubmission?.feedback && <p className="text-sm text-slate-300">Feedback: {mySubmission.feedback}</p>}
                  {mySubmission?.status === 'returned' && <p className="text-sm text-emerald-200">Returned marks are visible now.</p>}
                </div>
              )}
            </div>
          );
        })}
        </div>
        {!data?.assignments?.length && <EmptyRow>No assignments published yet.</EmptyRow>}
      </div>
    </Section>
  );

  const renderQuizzes = () => (
    <Section icon={Trophy} title="Quizzes" action={isStaff && (
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary inline-flex items-center justify-center gap-2" onClick={() => { setEditingQuizId(''); setQuiz(distributeQuizQuestionMarks(emptyQuiz)); setQuizPanel('manual'); }}><Plus className="h-4 w-4" /> Create Quiz</button>
        <button type="button" className="btn-secondary inline-flex items-center justify-center gap-2" onClick={() => { setQuizImport(emptyQuizImport); setQuizPanel('import'); }}><Upload className="h-4 w-4" /> Import CSV/XLSX</button>
      </div>
    )}>
      {isStaff && quizPanel && (
        <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-white">{quizPanel === 'import' ? 'Import Quiz' : editingQuizId ? 'Edit Quiz Draft' : 'Create Quiz'}</p>
              <p className="mt-1 text-xs text-slate-500">This opens inside the quiz page area. Total marks are distributed equally across all questions.</p>
            </div>
            <button type="button" className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white" onClick={() => { setQuizPanel(''); setEditingQuizId(''); setQuiz(emptyQuiz); setQuizImport(emptyQuizImport); }} aria-label="Close quiz editor">
              <X className="h-5 w-5" />
            </button>
          </div>
          {quizPanel === 'import' ? quizImportForm : quizForm}
        </div>
      )}
      <div className="lms-card-rail quiz-card-rail">
        <div className="lms-card-track quiz-card-track">
        {(data?.quizzes || []).map(item => {
          const attempts = attemptsByQuiz.get(String(item._id)) || [];
          const myAttempt = attempts.find(attempt => String(attempt.student?._id || attempt.student) === String(user?._id));
          const timing = quizTimingState(item);
          const isActiveQuiz = !isStaff && !myAttempt && !item.resultsReleased && timing.state === 'open';
          const isImportedDescription = String(item.description || '').trim().toLowerCase() === 'imported from spreadsheet';
          const orderedQuestions = item.shuffleQuestions ? seededShuffle(item.questions || [], `${item._id}-${user?._id || ''}`) : (item.questions || []);
          const currentStep = Math.min(quizQuestionSteps[item._id] || 0, Math.max(orderedQuestions.length - 1, 0));
          const visibleQuestions = item.oneQuestionAtATime ? orderedQuestions.slice(currentStep, currentStep + 1) : orderedQuestions;
          const remainingSeconds = isActiveQuiz ? getQuizRemainingSeconds(item) : null;
          const tabSwitchCount = quizTabSwitches[item._id]?.length || 0;
          return (
            <div key={item._id} className={`lms-compact-card ${isActiveQuiz ? 'col-span-2 sm:col-span-2 lg:col-span-3' : ''}`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold leading-tight text-white">{item.title}</p>
                  <p className={`${!isStaff && isImportedDescription ? 'hidden sm:block' : ''} line-clamp-2 text-xs text-slate-400 sm:text-sm`}>{item.description || `${item.questions?.length || 0} questions`}</p>
                  <p className="mt-1 text-xs text-slate-500">{timing.label}{item.durationMinutes ? ` - ${item.durationMinutes} min` : ''}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.releaseMode === 'immediate' ? 'Immediate result when auto-graded' : 'Result after teacher release'}</p>
                  <div className={`${isStaff ? 'flex' : 'hidden sm:flex'} mt-2 flex-wrap gap-1.5`}>
                    {item.shuffleQuestions && <span className="badge-neutral inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Random order</span>}
                    {item.oneQuestionAtATime && <span className="badge-neutral inline-flex items-center gap-1"><Eye className="h-3 w-3" /> One at a time</span>}
                    {item.tabSwitchWarning !== false && <span className="badge-neutral inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Tab warning</span>}
                  </div>
                  <TagList tags={item.tags || []} />
                </div>
                {isStaff ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={item.isPublished === false ? 'badge-warning' : 'badge-success'}>{item.isPublished === false ? 'Draft' : 'Published'}</span>
                    <button type="button" className="badge-info inline-flex items-center gap-1 hover:bg-primary-400/20" onClick={() => setReviewModal({ type: 'quiz', item, attempts })} title="View attempts">
                      <Eye className="h-3 w-3" /> {attempts.length}
                    </button>
                    {item.isPublished === false && (
                      <>
                        <button
                          type="button"
                          className="badge-info hover:bg-primary-400/20"
                          onClick={() => editQuizDraft(item)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="badge-info hover:bg-primary-400/20"
                          disabled={saving === `publish-quiz-${item._id}`}
                          onClick={() => publishItem('quiz', item._id, lmsAPI.publishQuiz)}
                        >
                          Publish
                        </button>
                      </>
                    )}
                    {item.isPublished !== false && !item.resultsReleased && (
                      <button
                        type="button"
                        className="badge-warning hover:bg-amber-400/20 disabled:opacity-50"
                        disabled={saving === `release-${item._id}`}
                        onClick={() => releaseQuizResults(item._id)}
                      >
                        Release marks
                      </button>
                    )}
                    {item.resultsReleased && <span className="badge-success">Released</span>}
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300"
                      disabled={saving === `quiz-${item._id}`}
                      onClick={() => deleteItem('quiz', item._id, lmsAPI.deleteQuiz)}
                      title="Delete quiz"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <span className={timing.state === 'closed' ? 'badge-danger' : timing.state === 'upcoming' ? 'badge-warning' : 'badge-info'}>
                    {myAttempt ? (myAttempt.resultReleased ? `${myAttempt.score}/${myAttempt.totalMarks}` : 'Submitted') : timing.state === 'open' ? `${item.totalMarks} marks` : timing.state}
                  </span>
                )}
              </div>
              {!isStaff && myAttempt && !myAttempt.resultReleased && (
                <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs text-amber-100 sm:text-sm">
                  Submitted. Result will be visible after teacher/admin releases marks.
                </div>
              )}
              {!isStaff && myAttempt?.resultReleased && (
                <div className="mt-3 flex flex-col gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-xs text-emerald-100 sm:flex-row sm:items-center sm:justify-between sm:text-sm">
                  <span>Completed. You scored {myAttempt.score}/{myAttempt.totalMarks}.</span>
                  <button type="button" className="badge-info inline-flex w-fit items-center gap-1 hover:bg-primary-400/20" onClick={() => setReviewModal({ type: 'quiz-review', item, attempt: myAttempt })}>
                    <Eye className="h-3 w-3" /> Review answers
                  </button>
                </div>
              )}
              {!isStaff && !myAttempt && timing.state !== 'open' && (
                <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-400">
                  {timing.state === 'upcoming' ? 'This quiz is not open yet.' : 'This quiz is closed.'}
                </div>
              )}
              {!isStaff && !myAttempt && !item.resultsReleased && timing.state === 'open' && (
                <div className="mt-4">
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/10 p-3 text-xs text-slate-300">
                    {remainingSeconds !== null && <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold ${remainingSeconds <= 60 ? 'bg-red-500/15 text-red-200' : 'bg-primary-500/15 text-primary-100'}`}><Clock className="h-3.5 w-3.5" /> {formatDuration(remainingSeconds)}</span>}
                    {item.oneQuestionAtATime && <span className="badge-info">Question {currentStep + 1}/{orderedQuestions.length}</span>}
                    {item.tabSwitchWarning !== false && <span className={tabSwitchCount > Number(item.maxTabSwitchWarnings || 0) ? 'badge-danger' : 'badge-warning'}>{tabSwitchCount}/{item.maxTabSwitchWarnings ?? 3} tab warnings</span>}
                  </div>
                  <div className="max-h-[30rem] space-y-4 overflow-y-auto pr-1">
                  {visibleQuestions.map((question) => {
                    const questionIndex = orderedQuestions.findIndex(itemQuestion => String(itemQuestion._id) === String(question._id));
                    const key = quizAnswerKey(item._id, question);
                    return (
                    <div key={question._id || questionIndex} className="rounded-2xl border border-white/10 bg-black/10 p-3 sm:p-4">
                      <p className="mb-2 text-sm font-medium text-white">{question.text}{question.required && <span className="ml-1 text-red-300">*</span>}</p>
                      {question.type === 'paragraph' ? (
                        <textarea className="input-field min-h-24" placeholder="Write your answer" value={quizAnswers[key] || ''} onChange={e => updateQuizAnswer(item._id, question, e.target.value)} />
                      ) : question.type === 'short_answer' ? (
                        <input className="input-field" placeholder="Short answer" value={quizAnswers[key] || ''} onChange={e => updateQuizAnswer(item._id, question, e.target.value)} />
                      ) : question.type === 'dropdown' ? (
                        <select className="input-field" value={quizAnswers[key] ?? ''} onChange={e => updateQuizAnswer(item._id, question, Number(e.target.value))}>
                          <option value="">Select answer</option>
                          {(question.shuffleOptions ? seededShuffle(question.options || [], `${item._id}-${question._id}-${user?._id || ''}`) : (question.options || []).map((option, optionIndex) => ({ ...option, originalIndex: option.originalIndex ?? optionIndex }))).map((option, optionIndex) => (
                            <option key={`${option.originalIndex ?? optionIndex}-${option.text}`} value={option.originalIndex ?? optionIndex}>{option.text}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {(question.shuffleOptions ? seededShuffle(question.options || [], `${item._id}-${question._id}-${user?._id || ''}`) : (question.options || []).map((option, optionIndex) => ({ ...option, originalIndex: option.originalIndex ?? optionIndex }))).map((option, optionIndex) => {
                            const selected = question.type === 'checkbox'
                              ? (quizAnswers[key] || []).includes(option.originalIndex ?? optionIndex)
                              : quizAnswers[key] === (option.originalIndex ?? optionIndex);
                            return (
                              <label key={optionIndex} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                                <input
                                  type={question.type === 'checkbox' ? 'checkbox' : 'radio'}
                                  name={`${item._id}-${question._id}`}
                                  checked={selected}
                                  onChange={() => {
                                    const originalIndex = option.originalIndex ?? optionIndex;
                                    if (question.type === 'checkbox') {
                                      const currentValues = quizAnswers[key] || [];
                                      const nextValues = currentValues.includes(originalIndex)
                                        ? currentValues.filter(value => value !== originalIndex)
                                        : [...currentValues, originalIndex];
                                      updateQuizAnswer(item._id, question, nextValues);
                                      return;
                                    }
                                    updateQuizAnswer(item._id, question, originalIndex);
                                  }}
                                />
                                {option.text}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );})}
                  </div>
                  {item.oneQuestionAtATime && orderedQuestions.length > 1 && (
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={currentStep <= 0} onClick={() => setQuizQuestionSteps(current => ({ ...current, [item._id]: Math.max((current[item._id] || 0) - 1, 0) }))}><ChevronLeft className="h-4 w-4" /> Previous</button>
                      <button type="button" className="btn-secondary inline-flex items-center gap-2" disabled={currentStep >= orderedQuestions.length - 1} onClick={() => setQuizQuestionSteps(current => ({ ...current, [item._id]: Math.min((current[item._id] || 0) + 1, orderedQuestions.length - 1) }))}>Next <ChevronRight className="h-4 w-4" /></button>
                    </div>
                  )}
                </div>
              )}
              {!isStaff && !myAttempt && !item.resultsReleased && timing.state === 'open' && (
                <button type="button" className="btn-primary mt-4 w-full sm:w-auto" disabled={saving === `quiz-${item._id}`} onClick={() => attemptQuiz(item)}>Submit Quiz</button>
              )}
              {!isStaff && !myAttempt && item.resultsReleased && (
                <div className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-xs text-emerald-100 sm:text-sm">
                  This quiz is completed and marks are released.
                </div>
              )}
            </div>
          );
        })}
        </div>
        {!data?.quizzes?.length && <EmptyRow>No quizzes published yet.</EmptyRow>}
      </div>
    </Section>
  );

  const renderDoubts = () => (
    <Section icon={HelpCircle} title="Doubts">
      {!isStaff && (
        <form onSubmit={createDiscussion} className="mb-4 grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <input className="input-field" placeholder="Doubt title" value={discussion.title} onChange={e => setDiscussion({ ...discussion, title: e.target.value })} required />
          <textarea className="input-field min-h-24" placeholder="Explain your doubt" value={discussion.message} onChange={e => setDiscussion({ ...discussion, message: e.target.value })} required />
          <button className="btn-primary inline-flex items-center justify-center gap-2" disabled={saving === 'discussion'}><Send className="h-4 w-4" /> Ask Doubt</button>
        </form>
      )}
      <div className="space-y-3">
        {(data?.discussions || []).map(item => (
          <div key={item._id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-semibold text-white">{item.title}</p>
                <p className="mt-1 text-sm text-slate-300">{item.message}</p>
                <p className="mt-2 text-xs text-slate-500">Asked by {item.student?.name || 'Student'} on {new Date(item.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={item.status === 'resolved' ? 'badge-success' : 'badge-warning'}>{item.status}</span>
                {isStaff && (
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300"
                    disabled={saving === `discussion-${item._id}`}
                    onClick={() => deleteItem('discussion', item._id, lmsAPI.deleteDiscussion)}
                    title="Delete doubt"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {(item.replies || []).map(reply => (
                <div key={reply._id} className="rounded-xl border border-white/10 bg-black/10 p-3">
                  <p className="text-sm text-slate-200">{reply.message}</p>
                  <p className="mt-1 text-xs text-slate-500">{reply.author?.name || 'User'} - {new Date(reply.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
            {item.status !== 'resolved' && (
              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <input className="input-field" placeholder="Write a reply" value={replyDrafts[item._id] || ''} onChange={e => setReplyDrafts(current => ({ ...current, [item._id]: e.target.value }))} />
                <button type="button" className="btn-secondary" disabled={saving === `reply-${item._id}`} onClick={() => replyDiscussion(item._id)}>Reply</button>
                {isStaff && <button type="button" className="btn-primary" disabled={saving === `resolve-${item._id}`} onClick={() => resolveDiscussion(item._id)}>Resolve</button>}
              </div>
            )}
          </div>
        ))}
        {!data?.discussions?.length && <EmptyRow>No doubts yet.</EmptyRow>}
      </div>
    </Section>
  );

  const renderAnnouncements = () => (
    <Section icon={Megaphone} title="Announcements" action={isStaff && <button type="button" className="btn-primary inline-flex items-center justify-center gap-2" onClick={() => setActiveModal('announcement')}><Plus className="h-4 w-4" /> Post</button>}>
      <div className="space-y-3">
        {(data?.announcements || []).map(item => (
          <div key={item._id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-white">{item.title}</p>
              <div className="flex items-center gap-2">
                <span className={item.priority === 'high' ? 'badge-danger' : 'badge-neutral'}>{item.priority}</span>
                {isStaff && (
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-300"
                    disabled={saving === `announcement-${item._id}`}
                    onClick={() => deleteItem('announcement', item._id, lmsAPI.deleteAnnouncement)}
                    title="Delete announcement"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <p className="mt-2 text-sm text-slate-300">{item.message}</p>
            <p className="mt-2 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</p>
          </div>
        ))}
        {!data?.announcements?.length && <EmptyRow>No announcements yet.</EmptyRow>}
      </div>
    </Section>
  );

  const renderCalendar = () => {
    const formatDateKey = (date) => {
      const value = new Date(date);
      if (Number.isNaN(value.getTime())) return '';
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const visibleEvents = calendarEvents.filter(event => ['assignment_assigned', 'assignment_deadline', 'quiz_open', 'quiz_close', 'announcement'].includes(event.type));
    const grouped = visibleEvents.reduce((acc, event) => {
      const key = formatDateKey(event.startsAt);
      if (!key) return acc;
      acc[key] = acc[key] || [];
      acc[key].push(event);
      return acc;
    }, {});
    const todayKey = formatDateKey(new Date());
    const selectedKey = selectedCalendarDate || todayKey;
    const monthStart = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const monthLabel = monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const firstCell = new Date(monthStart);
    firstCell.setDate(firstCell.getDate() - firstCell.getDay());
    const calendarDays = Array.from({ length: 42 }, (_, index) => {
      const date = new Date(firstCell);
      date.setDate(firstCell.getDate() + index);
      return date;
    });
    const isEventActive = (event) => {
      const now = Date.now();
      if (event.type === 'assignment_assigned') return event.meta?.dueDate && new Date(event.meta.dueDate).getTime() > now;
      if (event.type === 'assignment_deadline') return new Date(event.startsAt).getTime() > now;
      if (event.type === 'quiz_open' || event.type === 'quiz_close') {
        const openAt = event.meta?.opensAt ? new Date(event.meta.opensAt).getTime() : 0;
        const closeAt = event.meta?.closesAt ? new Date(event.meta.closesAt).getTime() : 0;
        return openAt && closeAt && now >= openAt && now < closeAt;
      }
      return false;
    };
    const dotClass = (type) => ({
      assignment_assigned: 'bg-emerald-400 shadow-emerald-400/40',
      assignment_deadline: 'bg-red-400 shadow-red-400/40',
      quiz_open: 'bg-sky-400 shadow-sky-400/40',
      quiz_close: 'bg-violet-400 shadow-violet-400/40',
      announcement: 'bg-amber-300 shadow-amber-300/40'
    }[type] || 'bg-slate-400 shadow-slate-400/40');
    const typeLabel = (type) => ({
      assignment_assigned: 'Assignment assigned',
      assignment_deadline: 'Assignment deadline',
      quiz_open: 'Quiz opens',
      quiz_close: 'Quiz closes',
      announcement: 'Announcement'
    }[type] || type);
    const typeClass = (type) => (
      type === 'assignment_assigned' ? 'badge-success' :
      type === 'assignment_deadline' ? 'badge-danger' :
      type?.startsWith('quiz') ? 'badge-info' :
      type === 'announcement' ? 'badge-neutral' :
      'badge-danger'
    );
    const selectedEvents = grouped[selectedKey] || [];
    const moveMonth = (offset) => {
      setCalendarMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1));
    };

    return (
      <Section icon={CalendarDays} title="LMS Calendar">
        {calendarLoading ? (
          <CardSkeleton rows={6} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(18rem,0.55fr)] xl:items-start">
            <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3 sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <button type="button" className="btn-secondary px-2.5 py-1.5 text-sm" onClick={() => moveMonth(-1)} aria-label="Previous month">&lt;</button>
                <p className="text-center text-sm font-semibold text-white sm:text-base">{monthLabel}</p>
                <button type="button" className="btn-secondary px-2.5 py-1.5 text-sm" onClick={() => moveMonth(1)} aria-label="Next month">&gt;</button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-medium uppercase tracking-wide text-slate-500 sm:text-[10px]">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day} className="py-1">{day}</div>)}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {calendarDays.map(date => {
                  const key = formatDateKey(date);
                  const events = grouped[key] || [];
                  const inMonth = date.getMonth() === calendarMonth.getMonth();
                  const isSelected = key === selectedKey;
                  const isToday = key === todayKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedCalendarDate(key)}
                      className={`relative min-h-[2.85rem] rounded-lg border p-1.5 text-left transition-colors sm:min-h-[3.6rem] ${
                        isSelected ? 'border-primary-400 bg-primary-500/15' : 'border-white/10 bg-black/10 hover:border-white/20 hover:bg-white/[0.04]'
                      } ${inMonth ? 'text-white' : 'text-slate-600'}`}
                    >
                      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${isToday ? 'bg-primary-500 text-white' : ''}`}>{date.getDate()}</span>
                      <div className="mt-1 flex flex-wrap gap-0.5 sm:gap-1">
                        {events.slice(0, 5).map(event => (
                          <span
                            key={event.id}
                            className={`h-2 w-2 rounded-full shadow-lg sm:h-2.5 sm:w-2.5 ${dotClass(event.type)} ${isEventActive(event) ? 'animate-pulse' : ''}`}
                            title={typeLabel(event.type)}
                          />
                        ))}
                        {events.length > 5 && <span className="text-[10px] text-slate-500">+{events.length - 5}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <p className="mb-3 text-sm font-semibold text-white">Dot Guide</p>
                <div className="grid gap-2 text-xs text-slate-400 sm:grid-cols-2 xl:grid-cols-1">
                  <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Assignment assigned</span>
                  <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-red-400" /> Assignment deadline</span>
                  <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-sky-400" /> Quiz opens</span>
                  <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-violet-400" /> Quiz closes</span>
                  <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-amber-300" /> Announcement</span>
                </div>
                <p className="mt-3 text-xs text-slate-500">Blinking dots mean the assignment or quiz is active. Dots stop blinking after the deadline or close time.</p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                <p className="mb-3 text-sm font-semibold text-white">
                  {new Date(`${selectedKey}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
                <div className="max-h-[18rem] space-y-2 overflow-y-auto pr-1">
                  {selectedEvents.map(event => (
                    <div key={event.id} className="rounded-xl border border-white/10 bg-black/10 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-medium text-white">{event.title}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {event.startsAt ? new Date(event.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                            {event.status ? ` - ${event.status}` : ''}
                          </p>
                          <TagList tags={event.tags || []} />
                          {event.meta?.message && <p className="mt-2 text-sm text-slate-300">{event.meta.message}</p>}
                        </div>
                        <span className={`${typeClass(event.type)} w-fit`}>{typeLabel(event.type)}</span>
                      </div>
                    </div>
                  ))}
                  {!selectedEvents.length && <EmptyRow>No assignments, quizzes, or announcements on this date.</EmptyRow>}
                </div>
              </div>
            </div>
            {!visibleEvents.length && <div className="xl:col-span-2"><EmptyRow>No assignments, quizzes, or announcements in the next 60 days.</EmptyRow></div>}
          </div>
        )}
      </Section>
    );
  };

  const renderAttendance = () => {
    const historyStudents = historyData?.students || [];
    const sortedHistoryStudents = historySort
      ? [...historyStudents].sort((a, b) => {
        const first = Number(a.percentage || 0);
        const second = Number(b.percentage || 0);
        return historySort === 'desc' ? second - first : first - second;
      })
      : historyStudents;
    const applyHistorySort = (sort) => {
      setHistorySort(sort);
      setHistorySortMenuOpen(false);
    };

    return (
      <div className="space-y-4">
        <Section icon={CheckCircle} title="Attendance">
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniStat label="Completed Lectures" value={attendance.totalLectures || 0} icon={CheckCircle} />
            <MiniStat label={isStaff ? 'Present Records' : 'Attended'} value={isStaff ? attendance.presentRecords || 0 : attendance.attended || 0} icon={Send} tone="green" />
            <MiniStat label="Rate" value={`${attendance.percentage || '0.0'}%`} icon={BarChart3} tone={Number(attendance.percentage || 0) >= 75 ? 'green' : 'amber'} />
          </div>
          {!isStaff && (
            <div className="mt-4">
              <Link to={`/student/attendance/${subjectId}`} className="btn-primary inline-flex">Open full attendance report</Link>
            </div>
          )}
          {isStaff && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => {
                  setAttendanceManagerOpen(open => {
                    const nextOpen = !open;
                    if (!nextOpen) {
                      setAttendanceImportOpen(false);
                      setAttendanceDeleteOpen(false);
                    }
                    return nextOpen;
                  });
                }}
                className="btn-primary inline-flex items-center justify-center gap-2"
              >
                <CalendarDays className="h-4 w-4" /> {attendanceManagerOpen ? 'Hide attendance tools' : 'Manage attendance'}
              </button>
            </div>
          )}
          {isStaff && attendanceManagerOpen && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
              <button type="button" onClick={() => setAttendanceImportOpen(open => !open)} className="btn-secondary inline-flex items-center justify-center gap-2">
                <Upload className="h-4 w-4" /> Import attendance
              </button>
              <button type="button" onClick={() => setAttendanceDeleteOpen(open => !open)} className="btn-secondary inline-flex items-center justify-center gap-2 text-red-200">
                <Trash2 className="h-4 w-4" /> Delete imported
              </button>
              <button type="button" onClick={fetchSubjectDisputes} disabled={disputeLoading} className="btn-secondary inline-flex items-center justify-center gap-2 disabled:opacity-60">
                <RefreshCw className={`h-4 w-4 ${disputeLoading ? 'animate-spin' : ''}`} /> Refresh disputes
              </button>
            </div>
          )}
        </Section>

        {isStaff && attendanceManagerOpen && attendanceImportOpen && (
          <section className="glass-card">
            <h3 className="mb-3 flex items-center gap-2 font-semibold text-white"><Upload className="h-5 w-5 text-primary-300" /> Import Attendance</h3>
            <form onSubmit={handleAttendanceImport} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <label className="grid gap-1.5">
                <span className="label mb-0">Spreadsheet file</span>
                <input ref={attendanceImportInputRef} className="input-field" type="file" accept=".xlsx,.xls,.csv" onChange={event => setAttendanceImportFile(event.target.files?.[0] || null)} />
              </label>
              <button type="submit" disabled={attendanceImporting || !attendanceImportFile} className="btn-primary justify-center disabled:opacity-50">
                {attendanceImporting ? 'Importing...' : 'Import Attendance'}
              </button>
            </form>
            <p className="mt-2 text-xs text-slate-500">Use your existing attendance import sheet format. Imported records will update this classroom and student reports.</p>
          </section>
        )}

        {isStaff && attendanceManagerOpen && attendanceDeleteOpen && (
          <section className="glass-card">
            <h3 className="mb-3 flex items-center gap-2 font-semibold text-white"><Trash2 className="h-5 w-5 text-red-300" /> Delete Imported Attendance</h3>
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <label className="grid gap-1.5"><span className="label mb-0">Start date</span><input className="input-field" type="date" value={attendanceDeleteRange.startDate} onChange={e => setAttendanceDeleteRange({ ...attendanceDeleteRange, startDate: e.target.value })} /></label>
              <label className="grid gap-1.5"><span className="label mb-0">End date optional</span><input className="input-field" type="date" value={attendanceDeleteRange.endDate} onChange={e => setAttendanceDeleteRange({ ...attendanceDeleteRange, endDate: e.target.value })} /></label>
              <button type="button" disabled={attendanceDeleting || !attendanceDeleteRange.startDate} onClick={handleImportedAttendanceDelete} className="btn-danger justify-center disabled:opacity-50">
                {attendanceDeleting ? 'Scheduling...' : 'Schedule delete'}
              </button>
            </div>
          </section>
        )}

        {isStaff && attendanceManagerOpen && (
          <section className="glass-card">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="flex items-center gap-2 font-semibold text-white">
                  <CalendarDays className="h-5 w-5 text-primary-300" /> Attendance History
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  {historySort ? `Sorted by attendance percentage ${historySort === 'desc' ? 'high to low' : 'low to high'}.` : 'Students are sorted by the numeric series in their student ID.'}
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-[auto_auto_minmax(220px,1fr)_auto]">
                <input className="input-field" type="date" value={historyRange.startDate} onChange={e => setHistoryRange({ ...historyRange, startDate: e.target.value })} />
                <input className="input-field" type="date" value={historyRange.endDate} onChange={e => setHistoryRange({ ...historyRange, endDate: e.target.value })} />
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input className="input-field pl-9" placeholder="Search name, ID, or email" value={historySearch} onChange={e => setHistorySearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') fetchSubjectHistory(); }} />
                </div>
                <button type="button" onClick={fetchSubjectHistory} disabled={historyLoading} className="icon-action bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60" title="View history" aria-label="View history">
                  {historyLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {historyLoading ? (
              <div className="rounded-xl border border-dashed border-white/10 p-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, index) => <SkeletonLine key={index} className="h-16 rounded-xl" />)}
                </div>
                <div className="mt-4 space-y-2">
                  {Array.from({ length: 5 }).map((_, index) => <SkeletonLine key={index} className="h-10 rounded-lg" />)}
                </div>
              </div>
            ) : historyData ? (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Lectures</p><p className="text-xl font-bold text-white">{historyData.summary.totalLectures}</p></div>
                  <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Students</p><p className="text-xl font-bold text-white">{historyData.summary.totalStudents}</p></div>
                  <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Present Marks</p><p className="text-xl font-bold text-emerald-300">{historyData.summary.totalPresent}</p></div>
                  <div className="rounded-xl bg-white/5 p-3"><p className="text-xs text-slate-400">Average</p><p className="text-xl font-bold text-primary-300">{historyData.summary.percentage}%</p></div>
                </div>
                <div className="table-scroll max-h-[24rem] overflow-y-auto rounded-xl border border-white/10">
                  <table className="data-table text-sm">
                    <thead className="bg-white/5 text-left text-xs uppercase text-slate-400">
                      <tr>
                        <th className="px-3 py-3">Student</th>
                        <th className="px-3 py-3">ID</th>
                        <th className="px-3 py-3">Present</th>
                        <th className="px-3 py-3">Absent</th>
                        <th className="px-3 py-3">
                          <div className="relative flex w-full min-w-[88px] items-center justify-between gap-2">
                            <span>%</span>
                            <button type="button" onClick={() => setHistorySortMenuOpen(open => !open)} className={`grid h-7 w-7 place-items-center rounded-lg border transition-colors ${historySort ? 'border-primary-400/40 bg-primary-500/20 text-primary-100' : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:bg-white/10 hover:text-white'}`} title="Sort attendance percentage" aria-label="Sort attendance percentage">
                              <Filter className="h-3.5 w-3.5" />
                            </button>
                            {historySortMenuOpen && (
                              <div className="absolute right-0 top-9 z-20 flex w-48 flex-col gap-1 rounded-xl border border-white/10 bg-slate-950/95 p-2 text-xs normal-case shadow-2xl shadow-black/30 backdrop-blur">
                                <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">Sort by %</p>
                                <button type="button" onClick={() => applyHistorySort('desc')} className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${historySort === 'desc' ? 'bg-primary-500/20 text-primary-100' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>High to low</button>
                                <button type="button" onClick={() => applyHistorySort('asc')} className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${historySort === 'asc' ? 'bg-primary-500/20 text-primary-100' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}>Low to high</button>
                                <button type="button" onClick={() => applyHistorySort('')} className={`mt-1 w-full rounded-lg px-3 py-2 text-left transition-colors ${!historySort ? 'bg-primary-500/20 text-primary-100' : 'text-slate-400 hover:bg-white/10 hover:text-white'}`}>Default ID order</button>
                              </div>
                            )}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {sortedHistoryStudents.map(row => (
                        <tr key={row.student._id} className="hover:bg-white/5">
                          <td className="px-3 py-3 text-white"><span className="cell-clip">{row.student.name}</span></td>
                          <td className="px-3 py-3 text-slate-400"><span className="cell-clip">{row.student.studentId}</span></td>
                          <td className="px-3 py-3 text-emerald-300">{row.present}/{row.total}</td>
                          <td className="px-3 py-3 text-red-300">{row.absent}</td>
                          <td className="px-3 py-3 text-primary-300">{row.percentage}%</td>
                        </tr>
                      ))}
                      {historyData.students.length === 0 && <tr><td colSpan="5" className="px-3 py-8 text-center text-slate-500">No matching students found.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-slate-500">Select a date range and press View.</div>
            )}
          </section>
        )}

        {isStaff && attendanceManagerOpen && (
          <section className="glass-card">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 font-semibold text-white"><MessageSquare className="h-5 w-5 text-amber-300" /> Disputes</h3>
                <p className="mt-1 text-sm text-slate-400">Student complaints appear here directly with their date and issue.</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={fetchSubjectDisputes} disabled={disputeLoading} className="icon-action bg-white/10 text-slate-200 hover:bg-white/15 disabled:opacity-60" title="Refresh disputes" aria-label="Refresh disputes">
                  <RefreshCw className={`h-4 w-4 ${disputeLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setDisputeDeleteTarget({ mode: 'all' })}
                  disabled={!disputes.length || deletingDisputeId === 'all'}
                  className="btn-danger inline-flex items-center justify-center gap-2 px-3 py-2 text-xs disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" /> Delete all
                </button>
              </div>
            </div>
            <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.35)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-600/60">
              {disputes.map(dispute => (
                <div key={dispute._id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-white">{dispute.student?.name} <span className="font-mono text-xs text-slate-500">{dispute.student?.studentId}</span></p>
                      <p className="mt-1 text-xs text-slate-500">{dispute.lecture?.date ? new Date(dispute.lecture.date).toLocaleDateString() : 'No date'} - {dispute.lecture?.title || 'Lecture'}</p>
                      <p className="mt-2 text-sm text-slate-300">{dispute.reason}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex ${dispute.status === 'approved' ? 'badge-success' : dispute.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>{dispute.status}</span>
                        <button
                          type="button"
                          onClick={() => setDisputeDeleteTarget({ mode: 'one', dispute })}
                          disabled={deletingDisputeId === dispute._id}
                          className="inline-flex items-center gap-1 rounded-full border border-red-400/20 bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-200 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      </div>
                    </div>
                    {dispute.status === 'pending' ? (
                      <div className="w-full space-y-2 lg:max-w-sm">
                        <textarea className="input-field min-h-20" placeholder="Resolution note to student" value={resolutionNotes[dispute._id] || ''} onChange={event => setResolutionNotes(current => ({ ...current, [dispute._id]: event.target.value }))} />
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <button type="button" className="icon-action bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60" title="Mark present" aria-label="Mark present" disabled={resolvingDisputeId === dispute._id} onClick={() => resolveSubjectDispute(dispute, 'approved', 'present')}><CheckCircle className="h-4 w-4" /></button>
                          <button type="button" className="icon-action bg-white/10 text-red-200 hover:bg-white/15 disabled:opacity-60" title="Keep absent" aria-label="Keep absent" disabled={resolvingDisputeId === dispute._id} onClick={() => resolveSubjectDispute(dispute, 'approved', 'absent')}><XCircle className="h-4 w-4" /></button>
                          <button type="button" className="icon-action bg-red-500/20 text-red-200 hover:bg-red-500/30 disabled:opacity-60" title="Reject dispute" aria-label="Reject dispute" disabled={resolvingDisputeId === dispute._id} onClick={() => resolveSubjectDispute(dispute, 'rejected')}><X className="h-4 w-4" /></button>
                        </div>
                      </div>
                    ) : (
                      <p className="max-w-sm text-sm text-slate-400">{dispute.resolutionNote || 'No resolution note added.'}</p>
                    )}
                  </div>
                </div>
              ))}
              {!disputes.length && <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-slate-500">No disputes found for this subject.</div>}
            </div>
          </section>
        )}
      </div>
    );
  };

  return (
    <div className="relative space-y-5">
      <AppConfirmModal
        open={Boolean(disputeDeleteTarget)}
        title={disputeDeleteTarget?.mode === 'all' ? 'Delete All Disputes?' : 'Delete Dispute?'}
        message={disputeDeleteTarget?.mode === 'all'
          ? 'This will permanently remove every attendance dispute for this subject. Attendance records will not be changed.'
          : 'This will permanently remove this attendance dispute. Attendance records will not be changed.'}
        confirmLabel={disputeDeleteTarget?.mode === 'all' ? 'Delete All' : 'Delete'}
        tone="danger"
        loading={Boolean(deletingDisputeId)}
        onCancel={() => setDisputeDeleteTarget(null)}
        onConfirm={confirmDisputeDelete}
      />
      <LoadingOverlay show={refreshing} label="Refreshing classroom..." />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button type="button" onClick={() => activeQuizLock ? registerQuizViolation('navigation_blocked') : navigate(basePath)} className="mb-3 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white">
            <ArrowLeft className="h-4 w-4" /> Back to subjects
          </button>
          <h1 className="font-display text-2xl font-bold text-white">{subject?.name} Classroom</h1>
          <p className="mt-1 text-slate-400">{subject?.code} - Semester {subject?.semester} - {subject?.branch || subject?.department}</p>
        </div>
        {!isStaff && (
          <Link to={`/student/attendance/${subjectId}`} onClick={event => {
            if (!activeQuizLock) return;
            event.preventDefault();
            registerQuizViolation('navigation_blocked');
          }} className="btn-secondary inline-flex items-center justify-center gap-2">
            <CheckCircle className="h-4 w-4" /> Attendance
          </Link>
        )}
      </div>

      <StatRail>
        <MiniStat label="Attendance" value={`${attendance.percentage || '0.0'}%`} icon={CheckCircle} tone={Number(attendance.percentage || 0) >= 75 ? 'green' : 'amber'} />
        <MiniStat label="Materials" value={data?.materials?.length || 0} icon={FileText} />
        <MiniStat label={isStaff ? 'Ungraded' : 'Pending'} value={isStaff ? (data?.submissions || []).filter(item => item.status === 'submitted').length : (pendingAssignment ? 1 : 0)} icon={ClipboardList} tone="amber" />
        <MiniStat label="Open Doubts" value={data?.analytics?.openDoubts || 0} icon={HelpCircle} tone="red" />
      </StatRail>

      <div className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03] p-2">
        {visibleTabItems.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              if (activeQuizLock && tab.id !== 'quizzes') {
                registerQuizViolation('navigation_blocked');
                return;
              }
              setActiveTab(tab.id);
            }}
            className={`inline-flex flex-shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
              activeTab === tab.id ? 'bg-primary-500 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            <span className="relative inline-flex">
              <tab.icon className="h-4 w-4" />
              {lmsActivity[String(subjectId)]?.[tab.id] && (
                <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-slate-900" aria-label={`New ${tab.label}`} />
              )}
            </span>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Section icon={BookOpen} title="Classroom Overview">
            <div className="grid gap-3 sm:grid-cols-2">
              <MiniStat label="Total Lectures" value={attendance.totalLectures || 0} icon={CheckCircle} />
              <MiniStat label="Assignments" value={`${submittedCount}/${data?.assignments?.length || 0}`} icon={ClipboardList} tone="amber" />
              <MiniStat label="Quizzes" value={`${completedQuizCount}/${data?.quizzes?.length || 0}`} icon={Trophy} />
              <MiniStat label="Doubts" value={data?.discussions?.length || 0} icon={HelpCircle} tone="red" />
            </div>
            {!isStaff && (pendingAssignment || pendingQuiz) && (
              <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                {pendingAssignment && <p>Pending assignment: {pendingAssignment.title}</p>}
                {pendingQuiz && <p className="mt-1">Pending quiz: {pendingQuiz.title}</p>}
              </div>
            )}
          </Section>
          {renderAnnouncements()}
        </div>
      )}

      {activeTab === 'attendance' && renderAttendance()}

      {activeTab === 'materials' && renderMaterials()}
      {activeTab === 'assignments' && renderAssignments()}
      {activeTab === 'quizzes' && renderQuizzes()}
      {activeTab === 'calendar' && renderCalendar()}
      {activeTab === 'doubts' && renderDoubts()}
      {isStaff && activeTab === 'analytics' && (
        <Section
          icon={BarChart3}
          title="Classroom Analytics"
          action={isStaff && (
            <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[150px_220px]">
              <select className="input-field py-2 text-sm" value={analyticsKind} onChange={e => resetAnalyticsKind(e.target.value)}>
                <option value="">Overall</option>
                <option value="assignment">Assignment</option>
                <option value="quiz">Quiz</option>
              </select>
              {analyticsKind && (
                <select className="input-field py-2 text-sm" value={analyticsItemId} onChange={e => setAnalyticsItemId(e.target.value)}>
                  <option value="">Select {analyticsKind === 'assignment' ? 'assignment' : 'quiz'}</option>
                  {analyticsItems.map((item, index) => (
                    <option key={item._id} value={item._id}>{index + 1}. {item.title}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        >
          {selectedAnalyticsItem ? (
            <div className="grid gap-3 sm:grid-cols-4">
              <MiniStat label="Total Students" value={analyticsStudents} icon={BarChart3} />
              <MiniStat label={analyticsKind === 'assignment' ? 'Submitted' : 'Attempted'} value={selectedAnalyticsCompleted} icon={analyticsKind === 'assignment' ? ClipboardList : Trophy} tone="green" />
              <MiniStat label="Pending" value={selectedAnalyticsPending} icon={HelpCircle} tone="amber" />
              <MiniStat label={`${selectedAnalyticsItem.title} Completion`} value={`${selectedAnalyticsRate}%`} icon={CheckCircle} tone={selectedAnalyticsRate >= 75 ? 'green' : 'amber'} />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <MiniStat label={`Assignments ${data?.analytics?.completion?.assignmentCompleted || 0}/${data?.analytics?.completion?.assignmentTotal || 0}`} value={`${data?.analytics?.completion?.assignmentRate || 0}%`} icon={ClipboardList} />
              <MiniStat label={`Quizzes ${data?.analytics?.completion?.quizCompleted || 0}/${data?.analytics?.completion?.quizTotal || 0}`} value={`${data?.analytics?.completion?.quizRate || 0}%`} icon={Trophy} />
              <MiniStat label="Open Doubts" value={data?.analytics?.openDoubts || 0} icon={HelpCircle} tone="red" />
            </div>
          )}
          {analyticsKind && !analyticsItemId && (
            <p className="mt-3 rounded-xl border border-dashed border-white/10 p-3 text-sm text-slate-400">
              Select a {analyticsKind === 'assignment' ? 'specific assignment' : 'specific quiz'} to view item-wise attempted/submitted analytics.
            </p>
          )}
          {!selectedAnalyticsItem && (
            <p className="mt-3 text-xs text-slate-500">
              Overall completion is calculated from {analyticsStudents} enrolled students and published LMS work only.
            </p>
          )}
          {selectedAnalyticsItem && (
            <p className="mt-3 text-xs text-slate-500">
              {selectedAnalyticsCompleted} of {analyticsStudents} students have {analyticsKind === 'assignment' ? 'submitted' : 'attempted'} this {analyticsKind}.
            </p>
          )}
        </Section>
      )}

      <CreationModal open={activeModal === 'announcement'} title="Post Announcement" icon={Megaphone} onClose={() => setActiveModal('')}>
        {announcementForm}
      </CreationModal>
      <CreationModal open={reviewModal?.type === 'quiz-review'} title="Quiz Review" icon={Trophy} onClose={() => setReviewModal(null)}>
        <div className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          Score: {reviewModal?.attempt?.score}/{reviewModal?.attempt?.totalMarks}
        </div>
        <div className="max-h-[26rem] space-y-4 overflow-y-auto pr-1">
          {(reviewModal?.item?.questions || []).map((question, questionIndex) => {
            const answer = (reviewModal?.attempt?.answers || []).find(item => String(item.question) === String(question._id)) || reviewModal?.attempt?.answers?.[questionIndex] || {};
            const selectedIndex = Number(answer.selectedIndex ?? -1);
            const selectedIndexes = answer.selectedIndexes || (selectedIndex >= 0 ? [selectedIndex] : []);
            const correctIndex = (question.options || []).findIndex(option => option.isCorrect);
            return (
              <div key={question._id || questionIndex} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-sm font-semibold text-white">Q{questionIndex + 1}. {question.text}</p>
                {['short_answer', 'paragraph'].includes(question.type) ? (
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/10 p-3 text-sm text-slate-200">
                    <p className="text-xs text-slate-500">Your answer</p>
                    <p className="mt-1">{answer.textAnswer || 'No answer'}</p>
                    {question.answerKey?.length > 0 && <p className="mt-2 text-xs text-emerald-300">Answer key: {question.answerKey.join(', ')}</p>}
                  </div>
                ) : <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {(question.options || []).map((option, optionIndex) => (
                    <div
                      key={optionIndex}
                      className={`rounded-xl border px-3 py-2 text-sm ${
                        optionIndex === correctIndex ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100' :
                        selectedIndexes.includes(optionIndex) ? 'border-red-400/40 bg-red-500/10 text-red-100' :
                        'border-white/10 bg-black/10 text-slate-300'
                      }`}
                    >
                      {option.text}
                      {selectedIndexes.includes(optionIndex) && <span className="ml-2 text-xs text-slate-400">Selected</span>}
                      {option.isCorrect && <span className="ml-2 text-xs text-emerald-300">Correct</span>}
                    </div>
                  ))}
                </div>}
                {answer.feedback && <p className="mt-2 text-xs text-primary-200">{answer.feedback}</p>}
                <p className="mt-3 rounded-xl border border-white/10 bg-black/10 p-3 text-xs text-slate-300">
                  {question.explanation || 'No explanation added by the teacher.'}
                </p>
              </div>
            );
          })}
        </div>
      </CreationModal>
      <CreationModal open={reviewModal?.type === 'assignment'} title={`Submissions (${reviewModal?.submissions?.length || 0})`} icon={ClipboardList} onClose={() => setReviewModal(null)}>
        <div className="mb-3">
          <label className="grid gap-1.5">
            <span className="label mb-0">Search student</span>
            <input className="input-field py-2 text-sm" placeholder="Search name, ID, or email" value={reviewSearch} onChange={e => setReviewSearch(e.target.value)} />
          </label>
        </div>
        <div className="-mx-1 overflow-x-auto pb-2">
          <div className="max-h-[17rem] min-w-[42rem] space-y-2 overflow-y-auto px-1 pr-2 sm:max-h-[24rem] sm:min-w-0">
            {visibleReviewSubmissions.map(submission => (
              <div key={submission._id} className="grid grid-cols-[minmax(9rem,1fr)_5.25rem_minmax(13rem,1.2fr)_4.75rem_4.75rem] items-end gap-2 rounded-xl border border-white/10 bg-black/10 p-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-white">{submission.student?.name || 'Student'}</p>
                  <p className="truncate font-mono text-[10px] text-slate-500">{submission.student?.studentId || submission.student?.email}</p>
                  <p className="mt-1 text-[10px] text-slate-500">{submission.status}{submission.isLate ? ' - late' : ''}</p>
                  {submission.fileUrl && <a href={submission.fileUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex text-[10px] text-primary-300">File</a>}
                </div>
                <label className="grid gap-1">
                  <span className="mb-0 text-[10px] font-medium text-slate-400">Marks</span>
                  <input className="input-field h-9 px-2 py-1.5 text-xs" type="number" placeholder="Marks" value={gradeDrafts[submission._id]?.marks ?? submission.marks ?? ''} onChange={e => setGradeDrafts(current => ({ ...current, [submission._id]: { ...current[submission._id], marks: e.target.value } }))} />
                </label>
                <label className="grid gap-1">
                  <span className="mb-0 text-[10px] font-medium text-slate-400">Feedback</span>
                  <input className="input-field h-9 px-2 py-1.5 text-xs" placeholder="Feedback" value={gradeDrafts[submission._id]?.feedback ?? submission.feedback ?? ''} onChange={e => setGradeDrafts(current => ({ ...current, [submission._id]: { ...current[submission._id], feedback: e.target.value } }))} />
                </label>
                <button type="button" className="btn-secondary h-9 px-2 py-1.5 text-xs" disabled={saving === `grade-${submission._id}`} onClick={() => gradeSubmission(submission._id)}>Grade</button>
                <button type="button" className="btn-secondary h-9 px-2 py-1.5 text-xs" disabled={saving === `return-${submission._id}`} onClick={() => returnSubmission(submission._id)}>Return</button>
              </div>
            ))}
            {reviewModal?.submissions?.length > 0 && visibleReviewSubmissions.length === 0 && <EmptyRow>No matching submissions.</EmptyRow>}
            {!reviewModal?.submissions?.length && <EmptyRow>No submissions yet.</EmptyRow>}
          </div>
        </div>
      </CreationModal>
      <CreationModal open={reviewModal?.type === 'quiz'} title={`Attempts (${reviewModal?.attempts?.length || 0})`} icon={Trophy} onClose={() => setReviewModal(null)}>
        <div className="mb-3">
          <label className="grid gap-1.5">
            <span className="label mb-0">Search student</span>
            <input className="input-field" placeholder="Search name, ID, or email" value={reviewSearch} onChange={e => setReviewSearch(e.target.value)} />
          </label>
        </div>
        <div className="max-h-[5rem] space-y-3 overflow-y-auto pr-1 sm:max-h-[16.5rem]">
          {visibleReviewAttempts.map(attempt => (
            <div key={attempt._id} className="grid gap-2 rounded-xl border border-white/10 bg-black/10 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="font-medium text-white">{attempt.student?.name || 'Student'}</p>
                <p className="font-mono text-xs text-slate-500">{attempt.student?.studentId || attempt.student?.email}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  {attempt.timeSpentSeconds > 0 && <span className="badge-neutral inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDuration(attempt.timeSpentSeconds)}</span>}
                  <span className={(attempt.tabSwitchCount || 0) > 0 ? 'badge-warning' : 'badge-neutral'}>{attempt.tabSwitchCount || 0} tab switches</span>
                  {(attempt.antiCheatFlags || []).map(flag => <span key={flag} className="badge-danger">{flag.replaceAll('_', ' ')}</span>)}
                </div>
              </div>
              {reviewModal?.item?.resultsReleased ? (
                <span className="badge-success w-fit">{attempt.score}/{attempt.totalMarks}</span>
              ) : (
                <span className="badge-warning w-fit">Result pending</span>
              )}
            </div>
          ))}
          {reviewModal?.attempts?.length > 0 && visibleReviewAttempts.length === 0 && <EmptyRow>No matching attempts.</EmptyRow>}
          {!reviewModal?.attempts?.length && <EmptyRow>No attempts yet.</EmptyRow>}
        </div>
      </CreationModal>

      <CreationModal open={Boolean(previewResource)} title={previewResource?.title || previewResource?.fileName || 'Resource Preview'} icon={Eye} onClose={() => setPreviewResource(null)}>
        {previewResource && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
              {resourcePreviewType(previewResource) === 'image' && (
                <img src={resourceUrl(previewResource.url)} alt={previewResource.title || previewResource.fileName || 'Resource'} className="max-h-[70vh] w-full object-contain" />
              )}
              {resourcePreviewType(previewResource) === 'video' && (
                <video src={resourceUrl(previewResource.url)} controls className="max-h-[70vh] w-full bg-black" />
              )}
              {resourcePreviewType(previewResource) === 'pdf' && (
                <iframe title={previewResource.title || previewResource.fileName || 'PDF preview'} src={resourceUrl(previewResource.url)} className="h-[70vh] w-full bg-white" />
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <a href={resourceUrl(previewResource.url)} target="_blank" rel="noreferrer" className="btn-secondary inline-flex items-center gap-2"><ExternalLink className="h-4 w-4" /> Open</a>
              <a href={resourceUrl(previewResource.url)} target="_blank" rel="noreferrer" download className="btn-primary inline-flex items-center gap-2"><Download className="h-4 w-4" /> Download</a>
            </div>
          </div>
        )}
      </CreationModal>
    </div>
  );
}
