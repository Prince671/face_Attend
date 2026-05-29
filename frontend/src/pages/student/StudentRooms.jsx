import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowDown,
  ArrowLeft,
  AlertCircle,
  Archive,
  BarChart3,
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  Clock,
  CornerUpLeft,
  Edit3,
  Eye,
  FileText,
  Flag,
  Forward,
  GalleryHorizontal,
  Image as ImageIcon,
  Info,
  Link as LinkIcon,
  Loader2,
  Lock,
  Mic,
  MoreVertical,
  Pause,
  Pin,
  Play,
  Plus,
  QrCode,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Smile,
  Star,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react';
import { chatAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import { SkeletonLine } from '../../components/LoadingStates';

const emptyGroupForm = { name: '', description: '', chatMode: 'everyone', addAll: false };
const emptyPollForm = { question: '', options: ['Yes', 'No'], allowMultiple: false, closesAt: '' };
const actionReactions = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F64F}'];
const emojiCategories = [
  {
    id: 'recent',
    label: 'Recent',
    icon: '🕘',
    items: ['😀', '😂', '😍', '🥰', '😎', '😭', '😡', '👍', '🙏', '❤️', '🔥', '🎉'],
  },
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    items: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😎', '🥳', '😏', '😒', '😔', '😢', '😭', '😤', '😡'],
  },
  {
    id: 'gestures',
    label: 'Gestures',
    icon: '👍',
    items: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '👏', '🙌', '🫶', '🙏', '💪', '🤝', '👀', '💯', '✅', '❌', '⭐', '⚡', '🔥', '✨', '🎯', '📌', '🔔'],
  },
  {
    id: 'hearts',
    label: 'Hearts',
    icon: '❤️',
    items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟'],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: '📚',
    items: ['📚', '📖', '📝', '📌', '📎', '📁', '📄', '💻', '📱', '🎧', '🎤', '📷', '🎥', '⏰', '📅', '🧠', '🏆', '🎓', '💡', '🔒', '🔗', '📊', '📈', '📣'],
  },
  {
    id: 'food',
    label: 'Food',
    icon: '🍕',
    items: ['🍎', '🍌', '🍇', '🍓', '🍉', '🍕', '🍔', '🍟', '🌮', '🍜', '🍫', '🍿', '☕', '🥤', '🍽️'],
  },
  {
    id: 'travel',
    label: 'Travel',
    icon: '🚀',
    items: ['🚀', '✈️', '🚗', '🚌', '🚆', '🏫', '🏠', '🏢', '🌍', '🌙', '☀️', '🌧️', '🌈', '🏏', '⚽', '🎮', '🎵', '🎬'],
  },
];
const CHAT_MAX_FILES = 10;
const CHAT_MAX_FILE_SIZE = 50 * 1024 * 1024;
const CHAT_BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.ps1', '.sh', '.msi', '.dll'];

const fileUrl = (url = '') => url?.startsWith('http') ? url : url;
const initials = (name = '') => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?';
const tempMessageId = () => `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const formatTime = (value) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
const formatDateTime = (value) => value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const formatMessageDay = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
};
const formatDuration = (seconds = 0) => {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
};
const formatBytes = (bytes = 0) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
};
const fileExtension = (name = '') => name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
const autoDeleteLabel = (hours = 0) => {
  const value = Number(hours || 0);
  if (!value) return 'Auto-delete off';
  if (value === 8) return 'Auto-delete after 8 hours';
  if (value === 24) return 'Auto-delete after 24 hours';
  if (value === 168) return 'Auto-delete after 7 days';
  return `Auto-delete after ${value} hours`;
};
const chatPrefsKey = (userId) => `studysphere_chat_prefs_${userId || 'guest'}`;
const chatDraftsKey = (userId) => `studysphere_chat_drafts_${userId || 'guest'}`;
const quickRepliesKey = (userId) => `studysphere_quick_replies_${userId || 'guest'}`;
const readChatPrefs = (userId) => {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(chatPrefsKey(userId)) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};
const writeChatPrefs = (userId, prefs) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(chatPrefsKey(userId), JSON.stringify(prefs || {}));
};
const readChatDrafts = (userId) => {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(chatDraftsKey(userId)) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};
const writeChatDrafts = (userId, drafts) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(chatDraftsKey(userId), JSON.stringify(drafts || {}));
};
const readQuickReplies = (userId) => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(quickRepliesKey(userId)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const writeQuickReplies = (userId, replies) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(quickRepliesKey(userId), JSON.stringify(replies || []));
};
const buildMessagePreview = (text = '') => {
  const lines = String(text).split('\n');
  const linePreview = lines.slice(0, 7).join('\n');
  const preview = linePreview.length > 520 ? `${linePreview.slice(0, 520).trimEnd()}...` : linePreview;
  return { preview, isLong: lines.length > 7 || String(text).length > 520 };
};
const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const messageUrlPattern = /((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,!?:;"'])/gi;
const normalizedHref = (value = '') => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};
const renderMarqueeName = (name = '', className = '') => {
  const label = String(name || '').trim();
  if (label.length > 24) {
    return <marquee className={className} scrollamount="3" behavior="scroll">{label}</marquee>;
  }
  return <span className={className}>{label}</span>;
};
const inviteLinkForCode = (code = '') => {
  if (!code || typeof window === 'undefined') return code;
  return `${window.location.origin}/student/rooms?invite=${encodeURIComponent(code)}`;
};
const inviteCodeFromValue = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return (url.searchParams.get('invite') || url.searchParams.get('code') || raw).trim();
  } catch {
    const match = raw.match(/[?&](?:invite|code)=([^&\s]+)/i);
    return decodeURIComponent(match?.[1] || raw).trim();
  }
};
const memberUser = (member) => member?.user || member;
const attachmentIcon = (kind) => {
  if (['image', 'gif'].includes(kind)) return ImageIcon;
  if (kind === 'video') return Video;
  if (['audio', 'voice'].includes(kind)) return Mic;
  return FileText;
};
const localAttachmentFromFile = (file, explicitType = '') => {
  const mime = String(file?.type || '').toLowerCase();
  const ext = fileExtension(file?.name || '');
  const kind = explicitType === 'voice'
    ? 'voice'
    : mime.startsWith('image/') && ext === '.gif'
      ? 'gif'
      : mime.startsWith('image/')
        ? 'image'
        : mime.startsWith('video/')
          ? 'video'
          : mime.startsWith('audio/')
            ? 'audio'
            : ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'].includes(ext)
              ? 'document'
              : 'file';
  return {
    url: URL.createObjectURL(file),
    localPreview: true,
    name: file.name,
    mimeType: file.type,
    size: file.size,
    kind,
  };
};
const revokeLocalAttachments = (attachments = []) => {
  attachments.forEach(item => {
    if (item.localPreview && item.url) URL.revokeObjectURL(item.url);
  });
};
const defaultPermissions = { editInfo: 'admins', addMembers: 'admins', sendMessages: 'members', pinMessages: 'admins' };
const permissionsForGroup = (group) => ({ ...defaultPermissions, ...(group?.permissions || {}) });

const Avatar = ({ user, className = 'h-10 w-10' }) => (
  <div className={`${className} flex-shrink-0 overflow-hidden rounded-full bg-primary-500/20 text-primary-200 ring-1 ring-white/10 grid place-items-center text-xs font-semibold`}>
    {user?.profileImage ? <img src={user.profileImage} alt="" className="h-full w-full object-cover" /> : initials(user?.name)}
  </div>
);

const GroupAvatar = ({ group, className = 'h-10 w-10' }) => (
  <div className={`${className} grid flex-shrink-0 place-items-center overflow-hidden rounded-full bg-primary-500/15 text-primary-200 ring-1 ring-white/10`}>
    {group?.avatarUrl ? <img src={fileUrl(group.avatarUrl)} alt="" className="h-full w-full object-cover" /> : <span className="text-sm font-bold">{initials(group?.name).slice(0, 1)}</span>}
  </div>
);

const VoiceAttachment = ({ attachment }) => {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [speed, setSpeed] = useState(1);
  const progress = duration ? Math.min(100, (current / duration) * 100) : 0;
  const speeds = [1, 1.5, 2];

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const toggle = async (event) => {
    event.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  };

  return (
    <div className="mt-2 flex min-w-[230px] max-w-full items-center gap-3 rounded-full border border-white/10 bg-white/10 px-3 py-2">
      <button type="button" onClick={toggle} className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-primary-500 text-white shadow hover:bg-primary-600" aria-label={playing ? 'Pause voice note' : 'Play voice note'}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex h-7 items-center gap-0.5 overflow-hidden">
          {Array.from({ length: 24 }).map((_, index) => {
            const active = (index / 24) * 100 <= progress;
            const height = 8 + ((index * 7) % 18);
            return <span key={index} className={`w-1 rounded-full ${active ? 'bg-primary-200' : 'bg-slate-500/60'}`} style={{ height }} />;
          })}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-slate-400">
          <span>Voice note</span>
          <span>{formatDuration(Math.floor(current || duration || 0))}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          const index = speeds.indexOf(speed);
          setSpeed(speeds[(index + 1) % speeds.length]);
        }}
        className="rounded-full bg-white/10 px-2 py-1 text-[11px] font-semibold text-primary-100 hover:bg-white/15"
        aria-label="Change voice note speed"
      >
        {speed}x
      </button>
      <audio
        ref={audioRef}
        src={fileUrl(attachment.url)}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={event => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={event => setCurrent(event.currentTarget.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
      />
    </div>
  );
};

const Modal = ({ open, title, children, onClose }) => {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex h-[100dvh] w-screen items-center justify-center overflow-y-auto bg-slate-950/80 p-3 backdrop-blur-sm">
      <div className="my-auto w-full max-w-xl overflow-hidden rounded-xl border border-white/10 bg-slate-950 shadow-2xl max-h-[calc(100dvh-1.5rem)]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="font-display text-base font-semibold text-white">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[calc(100dvh-5rem)] overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
};

const CompactModal = ({ open, title, children, onClose, action }) => {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex h-[100dvh] w-screen items-center justify-center overflow-y-auto bg-slate-950/80 p-3 backdrop-blur-sm">
      <div className="my-auto w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-slate-950 shadow-2xl max-h-[calc(100dvh-1.5rem)]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="font-display text-base font-semibold text-white">{title}</h2>
          <div className="flex items-center gap-1">
            {action}
            <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="max-h-[calc(100dvh-5rem)] overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
};

const FeaturePanel = ({ open, title, children, onClose, action, wide = false }) => {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-[70] flex bg-slate-950 text-slate-100">
      <div className={`${wide ? 'w-full' : 'w-full md:w-[430px]'} flex min-h-0 flex-col border-r border-white/10 bg-slate-950 shadow-2xl`}>
        <header className="flex h-16 flex-shrink-0 items-center gap-3 border-b border-white/10 bg-slate-900/95 px-4">
          <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full text-slate-300 hover:bg-white/10" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-white">{title}</h2>
          {action}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
      {!wide && <div className="wa-chat-bg hidden min-w-0 flex-1 md:block" />}
    </div>
  );
};

const QrScannerModal = ({ open, onClose, onDetected }) => {
  const videoRef = useRef(null);
  const scannerControlsRef = useRef(null);
  const frameRef = useRef(0);
  const detectedRef = useRef(false);
  const [error, setError] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [scannerStatus, setScannerStatus] = useState('');
  const [scanPhase, setScanPhase] = useState('idle');
  const [scanAttempt, setScanAttempt] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let stopped = false;
    const stop = () => {
      stopped = true;
      window.cancelAnimationFrame(frameRef.current);
      scannerControlsRef.current?.stop();
      scannerControlsRef.current = null;
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks?.().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    };

    const handleDetected = async (value) => {
      const code = inviteCodeFromValue(value);
      if (!code || stopped || detectedRef.current) return;
      detectedRef.current = true;
      setError('');
      setScanPhase('complete');
      setScannerStatus('QR found. Scanning complete. Joining room...');
      stop();
      const joined = await onDetected(code);
      if (!joined) {
        setError('QR was scanned, but this invite could not be joined. Check the invite or try again.');
        setScannerStatus('');
      }
    };

    const start = async () => {
      detectedRef.current = false;
      setError('');
      setScanPhase('starting');
      setScannerStatus('');
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Camera scanning is not available in this browser. Enter the invite code manually.');
        setScannerStatus('');
        setScanPhase('idle');
        return;
      }

      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        if (stopped) return;
        const reader = new BrowserQRCodeReader(undefined, {
          delayBetweenScanAttempts: 120,
          tryPlayVideoTimeout: 1800,
        });
        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          },
          videoRef.current,
          async (result, scanError, controlsRef) => {
            if (stopped || detectedRef.current) return;
            if (result) {
              const value = result.getText?.() || result.text || '';
              if (value.trim()) {
                controlsRef?.stop?.();
                await handleDetected(value);
              }
            } else if (scanError && !/NotFoundException/i.test(scanError?.name || scanError?.message || '')) {
              console.debug?.('QR scanner retry:', scanError?.message || scanError);
            }
          }
        );
        if (stopped) {
          controls.stop();
          return;
        }
        scannerControlsRef.current = controls;
        setScanPhase('scanning');
        setScannerStatus('');
      } catch (err) {
        const message = err?.name === 'NotAllowedError'
          ? 'Camera permission is required to scan a room QR.'
          : 'Could not start the QR scanner. Use HTTPS or localhost, allow camera access, or enter the invite code manually.';
        setError(message);
        setScannerStatus('');
        setScanPhase('idle');
      }
    };

    start();
    return stop;
  }, [open, onDetected, scanAttempt]);

  return (
    <FeaturePanel open={open} title="Scan Room QR" onClose={onClose}>
      <div className="space-y-4">
        <div className="relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-8 rounded-3xl border-2 border-primary-300/80 shadow-[0_0_0_999px_rgba(2,6,23,0.32)]" />
          <span className={`room-qr-scan-line pointer-events-none absolute left-10 right-10 top-10 h-0.5 rounded-full bg-primary-200 shadow-[0_0_18px_rgba(165,180,252,0.9)] ${scanPhase === 'complete' ? 'room-qr-scan-line-complete' : ''}`} />
          <span className="pointer-events-none absolute left-8 top-8 h-8 w-8 rounded-tl-3xl border-l-4 border-t-4 border-primary-200" />
          <span className="pointer-events-none absolute right-8 top-8 h-8 w-8 rounded-tr-3xl border-r-4 border-t-4 border-primary-200" />
          <span className="pointer-events-none absolute bottom-8 left-8 h-8 w-8 rounded-bl-3xl border-b-4 border-l-4 border-primary-200" />
          <span className="pointer-events-none absolute bottom-8 right-8 h-8 w-8 rounded-br-3xl border-b-4 border-r-4 border-primary-200" />
          <QrCode className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 text-white/25" />
        </div>
        {scannerStatus && !error && <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200">{scannerStatus}</p>}
        {error && <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{error}</p>}
        {(error || scanPhase === 'complete') && (
          <button
            type="button"
            onClick={() => {
              setScanAttempt(value => value + 1);
              setError('');
              setScannerStatus('');
              setScanPhase('idle');
            }}
            className="btn-secondary w-full justify-center"
          >
            Scan again
          </button>
        )}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (manualCode.trim()) onDetected(manualCode);
          }}
        >
          <input className="input-field h-10 flex-1" value={manualCode} onChange={event => setManualCode(event.target.value)} placeholder="Invite code or link" />
          <button type="submit" className="btn-primary px-4">Join</button>
        </form>
      </div>
    </FeaturePanel>
  );
};

export default function StudentRooms() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialRoomId = searchParams.get('room') || '';
  const initialChatFilter = ['all', 'unread', 'groups', 'archived', 'starred'].includes(searchParams.get('filter'))
    ? searchParams.get('filter')
    : 'all';
  const [groups, setGroups] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState(initialRoomId);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [groupForm, setGroupForm] = useState(emptyGroupForm);
  const [studentSearch, setStudentSearch] = useState('');
  const [studentOptions, setStudentOptions] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [typingUsers, setTypingUsers] = useState({});
  const [isMobile, setIsMobile] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState([]);
  const [actionMessage, setActionMessage] = useState(null);
  const [fullScreenMedia, setFullScreenMedia] = useState(null);
  const [receipts, setReceipts] = useState(null);
  const [forwardMessage, setForwardMessage] = useState(null);
  const [touchStart, setTouchStart] = useState(null);
  const [messageSearch, setMessageSearch] = useState('');
  const [messageFilter, setMessageFilter] = useState('');
  const [confirmAction, setConfirmAction] = useState(null);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [undoDelete, setUndoDelete] = useState(null);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [attachmentAccept, setAttachmentAccept] = useState('');
  const [attachmentMediaType, setAttachmentMediaType] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [infoDraft, setInfoDraft] = useState({ name: '', chatMode: 'everyone', autoDeleteAfterHours: 0, inviteEnabled: true, permissions: defaultPermissions, hidePresence: false });
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [showMessageSearch, setShowMessageSearch] = useState(false);
  const [hoverReactionMessage, setHoverReactionMessage] = useState(null);
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [showPoll, setShowPoll] = useState(false);
  const [pollForm, setPollForm] = useState(emptyPollForm);
  const [gallery, setGallery] = useState(null);
  const [galleryTab, setGalleryTab] = useState('images');
  const [invite, setInvite] = useState(null);
  const [showInviteQr, setShowInviteQr] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [qrImageSourceIndex, setQrImageSourceIndex] = useState(0);
  const [inviteRecipientSearch, setInviteRecipientSearch] = useState('');
  const [inviteSendingId, setInviteSendingId] = useState('');
  const [inviteControls, setInviteControls] = useState({ expiresAt: '', maxUses: 0, requireApproval: false });
  const [joinRequests, setJoinRequests] = useState([]);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastRecipients, setBroadcastRecipients] = useState([]);
  const [starredMessages, setStarredMessages] = useState([]);
  const [scheduledMessages, setScheduledMessages] = useState([]);
  const [showStarred, setShowStarred] = useState(false);
  const [showScheduledList, setShowScheduledList] = useState(false);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [expandedMessages, setExpandedMessages] = useState([]);
  const [joinCode, setJoinCode] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState('');
  const [chatSearch, setChatSearch] = useState('');
  const [chatFilter, setChatFilter] = useState(initialChatFilter);
  const [chatPrefs, setChatPrefs] = useState(() => readChatPrefs(user?._id));
  const [chatActionMenuGroupId, setChatActionMenuGroupId] = useState('');
  const [lockDraft, setLockDraft] = useState('');
  const [selectingMessages, setSelectingMessages] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const [lastSeenByUserId, setLastSeenByUserId] = useState({});
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [unreadDivider, setUnreadDivider] = useState(null);
  const [swipePreview, setSwipePreview] = useState({ id: '', offset: 0 });
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [lastFailedSend, setLastFailedSend] = useState(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState('');
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [quickReplies, setQuickReplies] = useState(() => readQuickReplies(user?._id));
  const [quickReplyDraft, setQuickReplyDraft] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState('recent');
  const [mentionState, setMentionState] = useState({ open: false, query: '', start: -1, activeIndex: 0 });
  const [selectedMentionIds, setSelectedMentionIds] = useState([]);
  const groupsRef = useRef([]);
  const attachmentMediaTypeRef = useRef('');
  const longPressRef = useRef(null);
  const undoTimerRef = useRef(null);
  const attachmentInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const discardRecordingRef = useRef(false);
  const endRef = useRef(null);
  const chatBodyRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const unreadDividerTimerRef = useRef(null);
  const openingUnreadCountRef = useRef(0);
  const composerInputRef = useRef(null);
  const panelHistoryGuardRef = useRef(false);

  const activeGroup = useMemo(() => groups.find(group => String(group._id) === String(activeGroupId)), [groups, activeGroupId]);
  const myMembership = useMemo(() => activeGroup?.members?.find(member => String(memberUser(member)?._id) === String(user?._id)), [activeGroup, user?._id]);
  const activePermissions = useMemo(() => permissionsForGroup(activeGroup), [activeGroup?.permissions]);
  const canSend = activeGroup && (activeGroup.chatMode !== 'admins_only' && activePermissions.sendMessages !== 'admins' || myMembership?.role === 'admin');
  const activePinned = messages.find(item => item.isPinned && !item.isDeleted && !item.isDeletedForMe && (!item.pinnedUntil || new Date(item.pinnedUntil) > new Date()));
  const selectedMessageRows = useMemo(() => messages.filter(message => selectedMessages.includes(message._id)), [messages, selectedMessages]);
  const singleSelectedMessage = selectedMessageRows.length === 1 ? selectedMessageRows[0] : null;
  const deleteConfirmRows = confirmAction?.type === 'delete' && confirmAction?.messages?.length ? confirmAction.messages : selectedMessageRows;
  const selectedCanDeleteForEveryone = deleteConfirmRows.length > 0 && deleteConfirmRows.every(message => (
    !message.isDeleted &&
    !message.isDeletedForMe &&
    String(message.sender?._id) === String(user?._id)
  ));
  const isGroupAdmin = myMembership?.role === 'admin';
  const activeInviteCode = invite?.inviteCode || activeGroup?.inviteCode || '';
  const activeInviteLink = inviteLinkForCode(activeInviteCode);
  const qrSources = activeInviteCode ? [
    `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=14&data=${encodeURIComponent(activeInviteLink)}`,
    `https://quickchart.io/qr?size=260&margin=2&text=${encodeURIComponent(activeInviteLink)}`,
  ] : [];
  const infoDirty = activeGroup && (
    infoDraft.name !== activeGroup.name ||
    infoDraft.chatMode !== activeGroup.chatMode ||
    Number(infoDraft.autoDeleteAfterHours || 0) !== Number(activeGroup.autoDeleteAfterHours || 0) ||
    Boolean(infoDraft.inviteEnabled) !== Boolean(activeGroup.inviteEnabled !== false) ||
    Boolean(infoDraft.hidePresence) !== Boolean(activeGroup.myPrefs?.hidePresence) ||
    Object.keys(defaultPermissions).some(key => infoDraft.permissions?.[key] !== activePermissions[key])
  );
  const pinnedGroupIds = useMemo(() => new Set(chatPrefs.pinned || []), [chatPrefs.pinned]);
  const hiddenGroupIds = useMemo(() => new Set(chatPrefs.hidden || []), [chatPrefs.hidden]);
  const archivedGroupIds = useMemo(() => new Set(chatPrefs.archived || []), [chatPrefs.archived]);
  const lockedGroups = chatPrefs.locked || {};
  const chatDrafts = useMemo(() => readChatDrafts(user?._id), [user?._id, activeGroupId, text]);
  const isPrivateGroup = (group) => (group?.members?.length || 0) <= 2;
  const canManageGroup = isGroupAdmin || isPrivateGroup(activeGroup);
  const activeOnlineMembers = useMemo(() => {
    const online = new Set(onlineUserIds.map(String));
    return (activeGroup?.members || [])
      .map(memberUser)
      .filter(member => online.has(String(member?._id)));
  }, [activeGroup?.members, onlineUserIds]);
  const mentionParticipants = useMemo(() => {
    const query = mentionState.query.trim().toLowerCase();
    return [...(activeGroup?.members || [])]
      .map(memberUser)
      .filter(member => member?._id)
      .filter(member => {
        if (!query) return true;
        return [member.name, member.studentId, member.email].some(value => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true }))
      .slice(0, 8);
  }, [activeGroup?.members, mentionState.query]);

  useEffect(() => {
    if (!mentionState.open) return;
    setMentionState(current => ({
      ...current,
      activeIndex: Math.min(current.activeIndex || 0, Math.max(mentionParticipants.length - 1, 0)),
    }));
  }, [mentionParticipants.length, mentionState.open]);
  const otherPrivateMember = useMemo(() => {
    if (!isPrivateGroup(activeGroup)) return null;
    return (activeGroup?.members || []).map(memberUser).find(member => String(member?._id) !== String(user?._id)) || null;
  }, [activeGroup?.members, user?._id]);
  const localNicknames = useMemo(() => chatPrefs.nicknames || {}, [chatPrefs.nicknames]);
  const displayNameForUser = (person) => localNicknames[String(person?._id)] || person?.name || 'Student';
  const displayUserName = (member) => displayNameForUser(memberUser(member) || member);
  const mentionLabels = useMemo(() => {
    const labels = [];
    (activeGroup?.members || []).map(memberUser).forEach(member => {
      if (!member?._id) return;
      [displayNameForUser(member), member.name, member.studentId].forEach(label => {
        const clean = String(label || '').trim();
        if (clean) labels.push(clean);
      });
    });
    return [...new Set(labels)].sort((a, b) => b.length - a.length);
  }, [activeGroup?.members, localNicknames]);
  const renderTextWithMentions = useCallback((value = '') => {
    const textValue = String(value || '');
    if (!textValue) return null;
    const renderMentionParts = (segment = '', keyPrefix = 'text') => {
      const fallback = () => segment.split(/(@[^\s@]+)/g).map((part, index) => (
        part.startsWith('@')
          ? <span key={`${keyPrefix}-mention-${index}-${part}`} className="font-semibold text-emerald-300">{part}</span>
          : part
      ));
      if (!mentionLabels.length) return fallback();
      const pattern = new RegExp(`@(${mentionLabels.map(escapeRegExp).join('|')})(?=$|[\\s.,!?;:)\\]])`, 'gi');
      const parts = [];
      let lastIndex = 0;
      let match = pattern.exec(segment);
      while (match) {
        if (match.index > lastIndex) parts.push(segment.slice(lastIndex, match.index));
        parts.push(
          <span key={`${keyPrefix}-mention-${match.index}-${match[0]}`} className="font-semibold text-emerald-300">
            {match[0]}
          </span>
        );
        lastIndex = match.index + match[0].length;
        match = pattern.exec(segment);
      }
      if (!parts.length) return fallback();
      if (lastIndex < segment.length) parts.push(segment.slice(lastIndex));
      return parts;
    };
    const urlParts = [];
    let lastUrlIndex = 0;
    let urlMatch = messageUrlPattern.exec(textValue);
    while (urlMatch) {
      if (urlMatch.index > lastUrlIndex) {
        urlParts.push(...renderMentionParts(textValue.slice(lastUrlIndex, urlMatch.index), `text-${lastUrlIndex}`));
      }
      const urlText = urlMatch[0];
      urlParts.push(
        <a
          key={`url-${urlMatch.index}-${urlText}`}
          href={normalizedHref(urlText)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={event => event.stopPropagation()}
          className="font-semibold text-sky-300 underline decoration-sky-300/40 underline-offset-2 hover:text-sky-200"
        >
          {urlText}
        </a>
      );
      lastUrlIndex = urlMatch.index + urlText.length;
      urlMatch = messageUrlPattern.exec(textValue);
    }
    messageUrlPattern.lastIndex = 0;
    if (urlParts.length) {
      if (lastUrlIndex < textValue.length) urlParts.push(...renderMentionParts(textValue.slice(lastUrlIndex), `text-${lastUrlIndex}`));
      return urlParts;
    }
    return renderMentionParts(textValue);
  }, [mentionLabels]);
  const visibleMessages = useMemo(() => {
    const query = messageSearch.trim().toLowerCase();
    if (!query) return messages;
    return messages.filter(message => [
      message.text,
      message.sender?.name,
      displayNameForUser(message.sender),
      message.sender?.studentId,
      ...(message.attachments || []).map(file => file.name),
    ].some(value => String(value || '').toLowerCase().includes(query)));
  }, [messages, messageSearch, localNicknames]);
  const displayedGroups = useMemo(() => {
    const query = chatSearch.trim();
    const lowered = query.toLowerCase();
    return groups
      .filter(group => {
        if (hiddenGroupIds.has(String(group._id))) return false;
        const archived = archivedGroupIds.has(String(group._id));
        if (chatFilter === 'archived') {
          if (!archived) return false;
        } else if (archived) {
          return false;
        }
        const lock = lockedGroups[String(group._id)];
        if (lock?.code && query !== lock.code) return false;
        if (lock?.code && query === lock.code) return true;
        if (chatFilter === 'unread' && !(Number(group.unreadCount || 0) > 0)) return false;
        if (chatFilter === 'groups' && isPrivateGroup(group)) return false;
        if (!lowered) return true;
        return [
          group.name,
          group.description,
          group.lastMessage?.text,
          ...(group.members || []).map(member => memberUser(member)?.name),
          ...(group.members || []).map(member => memberUser(member)?.studentId),
        ].some(value => String(value || '').toLowerCase().includes(lowered));
      })
      .sort((a, b) => {
        const aPinned = pinnedGroupIds.has(String(a._id));
        const bPinned = pinnedGroupIds.has(String(b._id));
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        return new Date(b.lastMessageAt || b.updatedAt || 0) - new Date(a.lastMessageAt || a.updatedAt || 0);
      });
  }, [groups, hiddenGroupIds, archivedGroupIds, lockedGroups, chatFilter, chatSearch, pinnedGroupIds]);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await chatAPI.getGroups();
      const rows = res.data.groups || [];
      setGroups(rows);
      setChatPrefs(current => {
        const next = { ...current };
        next.pinned = rows.filter(group => group.myPrefs?.isPinned).map(group => String(group._id));
        next.archived = rows.filter(group => group.myPrefs?.isArchived).map(group => String(group._id));
        next.locked = rows.reduce((acc, group) => {
          if (group.myPrefs?.isLocked) acc[String(group._id)] = { code: group.myPrefs?.lockCode || lockedGroups[String(group._id)]?.code || '', lockedAt: new Date().toISOString() };
          return acc;
        }, current.locked || {});
        return next;
      });
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not load rooms');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (groupId = activeGroupId, overrides = {}) => {
    if (!groupId) {
      setMessages([]);
      return;
    }
    setMessagesLoading(true);
    try {
      const params = {
        q: (overrides.q ?? messageSearch) || undefined,
        filter: (overrides.filter ?? messageFilter) || undefined,
      };
      const res = await chatAPI.getMessages(groupId, params);
      const rows = res.data.messages || [];
      setMessages(rows);
      const last = rows[rows.length - 1];
      if (last?._id) chatAPI.markRead(last._id).catch(() => {});
      setGroups(current => current.map(group => String(group._id) === String(groupId) ? { ...group, unreadCount: 0 } : group));
      const unreadCount = Number(overrides.unreadCount || 0);
      window.clearTimeout(unreadDividerTimerRef.current);
      if (unreadCount > 0) {
        const firstUnread = rows.slice(-unreadCount).find(message => message.type !== 'system');
        if (firstUnread?._id) {
          setUnreadDivider({ groupId: String(groupId), messageId: firstUnread._id, count: unreadCount });
          unreadDividerTimerRef.current = window.setTimeout(() => setUnreadDivider(null), 5000);
        }
      } else {
        setUnreadDivider(null);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not load messages');
    } finally {
      setMessagesLoading(false);
      window.setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 60);
    }
  }, [activeGroupId, messageFilter, messageSearch]);

  useEffect(() => {
    const syncMode = () => setIsMobile(window.innerWidth < 768);
    syncMode();
    window.addEventListener('resize', syncMode);
    return () => window.removeEventListener('resize', syncMode);
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    const urlRoom = searchParams.get('room') || '';
    const urlFilter = searchParams.get('filter') || 'all';
    if (urlRoom !== activeGroupId) setActiveGroupId(urlRoom);
    if (['all', 'unread', 'groups', 'archived', 'starred'].includes(urlFilter) && urlFilter !== chatFilter) {
      setChatFilter(urlFilter);
    }
  }, [searchParams]);

  useEffect(() => {
    setSearchParams(previous => {
      const params = new URLSearchParams(previous);
      if (activeGroupId) params.set('room', String(activeGroupId));
      else params.delete('room');
      if (chatFilter && chatFilter !== 'all') params.set('filter', chatFilter);
      else params.delete('filter');
      return params;
    }, { replace: !activeGroupId });
  }, [activeGroupId, chatFilter, setSearchParams]);

  useEffect(() => {
    const panelOpen = showQrScanner || showInfo || showInviteQr || showAddMembers || showCreate || showBroadcast || showStarred || showScheduledList || Boolean(fullScreenMedia);
    if (panelOpen && !panelHistoryGuardRef.current) {
      window.history.pushState({ studysphereRoomPanel: true }, '', window.location.href);
      panelHistoryGuardRef.current = true;
    }
    if (!panelOpen) panelHistoryGuardRef.current = false;

    const handlePopState = () => {
      if (showQrScanner) setShowQrScanner(false);
      else if (showInfo) {
        setShowInfo(false);
        setShowGroupSettings(false);
        setEditingGroupName(false);
      } else if (showInviteQr) setShowInviteQr(false);
      else if (showAddMembers) setShowAddMembers(false);
      else if (showCreate) setShowCreate(false);
      else if (showBroadcast) setShowBroadcast(false);
      else if (showStarred) setShowStarred(false);
      else if (showScheduledList) setShowScheduledList(false);
      else if (fullScreenMedia) setFullScreenMedia(null);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [showQrScanner, showInfo, showInviteQr, showAddMembers, showCreate, showBroadcast, showStarred, showScheduledList, fullScreenMedia]);

  useEffect(() => {
    const unreadCount = openingUnreadCountRef.current;
    openingUnreadCountRef.current = 0;
    loadMessages(activeGroupId, { unreadCount });
  }, [activeGroupId, loadMessages]);

  useEffect(() => {
    setChatPrefs(readChatPrefs(user?._id));
    setQuickReplies(readQuickReplies(user?._id));
  }, [user?._id]);

  useEffect(() => {
    if (!activeGroupId) {
      setText('');
      setMentionState({ open: false, query: '', start: -1, activeIndex: 0 });
      setSelectedMentionIds([]);
      return;
    }
    const drafts = readChatDrafts(user?._id);
    const serverDraft = groups.find(group => String(group._id) === String(activeGroupId))?.myPrefs?.draftText || '';
    setText(drafts[String(activeGroupId)] || serverDraft || '');
    setMentionState({ open: false, query: '', start: -1, activeIndex: 0 });
    setSelectedMentionIds([]);
  }, [activeGroupId, user?._id]);

  useEffect(() => {
    if (!activeGroupId || editing) return;
    const timer = window.setTimeout(() => {
      const drafts = readChatDrafts(user?._id);
      const next = { ...drafts };
      if (text.trim()) next[String(activeGroupId)] = text;
      else delete next[String(activeGroupId)];
      writeChatDrafts(user?._id, next);
      chatAPI.updateMemberPrefs(activeGroupId, { draftText: text.trim() }).catch(() => {});
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeGroupId, text, editing, user?._id]);

  useEffect(() => {
    if (!activeGroupId) return undefined;
    const timer = window.setTimeout(() => loadMessages(activeGroupId), 350);
    return () => window.clearTimeout(timer);
  }, [activeGroupId, loadMessages, messageFilter, messageSearch]);

  useEffect(() => {
    if (isMobile) setActiveGroupId('');
  }, [isMobile]);

  useEffect(() => () => {
    window.clearTimeout(undoTimerRef.current);
    window.clearTimeout(unreadDividerTimerRef.current);
  }, []);

  useEffect(() => {
    if (!activeGroup) return;
    setInfoDraft({
      name: activeGroup.name || '',
      chatMode: activeGroup.chatMode || 'everyone',
      autoDeleteAfterHours: activeGroup.autoDeleteAfterHours || 0,
      inviteEnabled: activeGroup.inviteEnabled !== false,
      permissions: permissionsForGroup(activeGroup),
      hidePresence: Boolean(activeGroup.myPrefs?.hidePresence),
    });
    setShowGroupSettings(false);
    setInvite(null);
    setMemberSearch('');
    setInviteRecipientSearch('');
    setQrImageSourceIndex(0);
    setInviteControls({
      expiresAt: activeGroup.inviteExpiresAt ? new Date(activeGroup.inviteExpiresAt).toISOString().slice(0, 16) : '',
      maxUses: activeGroup.inviteMaxUses || 0,
      requireApproval: Boolean(activeGroup.inviteRequireApproval),
    });
  }, [activeGroup?._id, activeGroup?.name, activeGroup?.chatMode, activeGroup?.autoDeleteAfterHours, activeGroup?.inviteEnabled, activeGroup?.inviteExpiresAt, activeGroup?.inviteMaxUses, activeGroup?.inviteRequireApproval, activeGroup?.permissions, activeGroup?.myPrefs?.hidePresence]);

  useEffect(() => {
    if (loading || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('invite') || params.get('code');
    if (!code) return;
    joinInviteCode(code);
    params.delete('invite');
    params.delete('code');
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [loading]);

  useEffect(() => {
    const closeFloatingMenus = (event) => {
      if (event.target.closest('[data-chat-popover]')) return;
      setActionMessage(null);
      setMobileMoreOpen(false);
      setAttachmentMenuOpen(false);
      setShowEmojiPicker(false);
      setGroupMenuOpen(false);
      setChatActionMenuGroupId('');
      setHoverReactionMessage(null);
    };
    document.addEventListener('pointerdown', closeFloatingMenus);
    return () => document.removeEventListener('pointerdown', closeFloatingMenus);
  }, []);

  useEffect(() => {
    if (!recording) {
      setRecordingSeconds(0);
      return undefined;
    }
    const timer = window.setInterval(() => setRecordingSeconds(value => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (!socket || !activeGroupId) return undefined;
    socket.emit('chat_join_room', activeGroupId);
    setOnlineUserIds([]);
    return () => {
      socket.emit('chat_leave_room', activeGroupId);
      setOnlineUserIds([]);
    };
  }, [socket, activeGroupId]);

  useEffect(() => {
    if (!socket) return undefined;
    const onMessage = ({ groupId, message }) => {
      const groupExists = groupsRef.current.some(group => String(group._id) === String(groupId));
      persistChatPrefs(current => {
        const hidden = (current.hidden || []).filter(id => String(id) !== String(groupId));
        return hidden.length === (current.hidden || []).length ? current : { ...current, hidden };
      });
      setGroups(current => current.map(group => String(group._id) === String(groupId)
        ? { ...group, lastMessage: message, lastMessageAt: message.createdAt, unreadCount: String(activeGroupId) === String(groupId) ? 0 : (group.unreadCount || 0) + 1 }
        : group));
      if (!groupExists) loadGroups();
      if (String(groupId) === String(activeGroupId)) {
        setMessages(current => current.some(item => item._id === message._id) ? current : [...current, message]);
        chatAPI.markRead(message._id).catch(() => {});
        window.setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 40);
      }
    };
    const onUpdated = ({ groupId, message }) => {
      if (String(groupId) === String(activeGroupId)) setMessages(current => current.map(item => item._id === message._id ? message : item));
    };
    const onDeleted = ({ groupId, message }) => {
      if (String(groupId) === String(activeGroupId)) {
        setMessages(current => current.map(item => item._id === message._id ? message : item));
        setGroups(current => current.map(group => String(group._id) === String(groupId) ? { ...group, unreadCount: 0 } : group));
      } else {
        loadGroups();
      }
    };
    const refreshGroups = () => loadGroups();
    const onGroupUpdated = ({ groupId, group }) => {
      if (group?._id) {
        setGroups(current => current.map(item => String(item._id) === String(group._id) ? group : item));
        return;
      }
      if (groupId && !groupsRef.current.some(item => String(item._id) === String(groupId))) loadGroups();
    };
    const onTyping = ({ groupId, userId, typing, mode }) => {
      if (String(groupId) !== String(activeGroupId) || String(userId) === String(user?._id)) return;
      setTypingUsers(current => {
        const next = { ...current };
        if (typing) next[String(userId)] = mode === 'recording' ? 'recording' : 'typing';
        else delete next[String(userId)];
        return next;
      });
    };
    const onPresence = ({ groupId, onlineUserIds: ids = [], lastSeenByUserId: lastSeen = {} }) => {
      if (String(groupId) !== String(activeGroupId)) return;
      setOnlineUserIds(ids);
      setLastSeenByUserId(lastSeen);
    };
    socket.on('chat_message_created', onMessage);
    socket.on('chat_message_updated', onUpdated);
    socket.on('chat_message_deleted', onDeleted);
    socket.on('chat_reaction_updated', onUpdated);
    socket.on('chat_group_created', refreshGroups);
    socket.on('chat_group_updated', onGroupUpdated);
    socket.on('chat_group_deleted', refreshGroups);
    socket.on('chat_member_added', refreshGroups);
    socket.on('chat_member_removed', refreshGroups);
    socket.on('chat_member_left', refreshGroups);
    socket.on('chat_typing', onTyping);
    socket.on('chat_presence_updated', onPresence);
    return () => {
      socket.off('chat_message_created', onMessage);
      socket.off('chat_message_updated', onUpdated);
      socket.off('chat_message_deleted', onDeleted);
      socket.off('chat_reaction_updated', onUpdated);
      socket.off('chat_group_created', refreshGroups);
      socket.off('chat_group_updated', onGroupUpdated);
      socket.off('chat_group_deleted', refreshGroups);
      socket.off('chat_member_added', refreshGroups);
      socket.off('chat_member_removed', refreshGroups);
      socket.off('chat_member_left', refreshGroups);
      socket.off('chat_typing', onTyping);
      socket.off('chat_presence_updated', onPresence);
    };
  }, [socket, activeGroupId, loadGroups, user?._id]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const search = inviteRecipientSearch || studentSearch || undefined;
        const res = await chatAPI.searchStudents({ search });
        setStudentOptions(res.data.students || []);
      } catch {
        setStudentOptions([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [studentSearch, inviteRecipientSearch]);

  const selectGroup = (groupId) => {
    const lock = lockedGroups[String(groupId)];
    if (lock?.code && chatSearch.trim() !== lock.code) {
      toast.error('Enter the secret code in search to unlock this chat.');
      return;
    }
    const group = groups.find(item => String(item._id) === String(groupId));
    openingUnreadCountRef.current = Number(group?.unreadCount || 0);
    setActiveGroupId(groupId);
    setGroups(current => current.map(group => String(group._id) === String(groupId) ? { ...group, unreadCount: 0 } : group));
    setReplyTo(null);
    setEditing(null);
    setSelectedMessages([]);
    setActionMessage(null);
    setSelectingMessages(false);
    setChatActionMenuGroupId('');
    setShowMessageSearch(false);
    setMessageSearch('');
  };

  const cancelMessageSelection = () => {
    setSelectedMessages([]);
    setSelectingMessages(false);
    setMobileMoreOpen(false);
    setActionMessage(null);
  };

  const handleCreateGroup = async (event) => {
    event.preventDefault();
    try {
      const res = await chatAPI.createGroup({
        ...groupForm,
        memberIds: selectedMembers.map(member => member._id),
      });
      setGroups(current => [res.data.group, ...current.filter(group => group._id !== res.data.group._id)]);
      setShowCreate(false);
      setGroupForm(emptyGroupForm);
      setSelectedMembers([]);
      toast.success('Room created');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not create room');
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    if (!activeGroup || !canSend) return;
    if (editing) {
      try {
        const res = await chatAPI.updateMessage(editing._id, { text });
        setMessages(current => current.map(item => item._id === editing._id ? res.data.message : item));
        setEditing(null);
        setText('');
      } catch (error) {
        toast.error(error.response?.data?.message || 'Could not edit message');
      }
      return;
    }
    if (!text.trim() && files.length === 0) return;
    const fileError = validateChatFiles(files);
    if (fileError) {
      setUploadError(fileError);
      toast.error(fileError);
      return;
    }
    const pendingText = text;
    const pendingFiles = [...files];
    const pendingReplyTo = replyTo;
    const pendingScheduledFor = scheduledFor;
    const pendingMediaType = attachmentMediaTypeRef.current || attachmentMediaType;
    const optimisticId = pendingFiles.length && !pendingScheduledFor ? tempMessageId() : '';
    let optimisticAttachments = [];
    if (optimisticId) {
      optimisticAttachments = pendingFiles.map(file => localAttachmentFromFile(file, pendingMediaType));
      const optimisticMessage = {
        _id: optimisticId,
        group: activeGroup._id,
        sender: user,
        type: 'media',
        text: pendingText.trim(),
        attachments: optimisticAttachments,
        replyTo: pendingReplyTo,
        createdAt: new Date().toISOString(),
        readBy: [user],
        reactions: {},
        uploadState: 'uploading',
        uploadProgress: 4,
      };
      setMessages(current => [...current, optimisticMessage]);
      window.setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 30);
    }
    setSending(true);
    setUploadError('');
    const form = new FormData();
    form.append('text', pendingText);
    if (pendingReplyTo?._id) form.append('replyTo', pendingReplyTo._id);
    if (pendingScheduledFor) form.append('scheduledFor', pendingScheduledFor);
    if (pendingMediaType) {
      form.append('mediaType', pendingMediaType);
    }
    const lowered = pendingText.toLowerCase();
    const mentions = new Set((activeGroup.members || [])
      .map(member => memberUser(member))
      .filter(member => member?._id && (
        lowered.includes(`@${String(member.studentId || '').toLowerCase()}`) ||
        lowered.includes(`@${String(member.name || '').toLowerCase()}`)
      ))
      .map(member => member._id));
    selectedMentionIds.forEach(id => {
      const member = (activeGroup.members || []).map(memberUser).find(item => String(item?._id) === String(id));
      const displayMention = `@${displayNameForUser(member)}`.toLowerCase();
      if (member && lowered.includes(displayMention)) mentions.add(id);
    });
    if (mentions.size) form.append('mentions', [...mentions].join(','));
    pendingFiles.forEach(file => form.append('files', file));
    try {
      setText('');
      setFiles([]);
      setSelectedMentionIds([]);
      setMentionState({ open: false, query: '', start: -1, activeIndex: 0 });
      setAttachmentMediaType('');
      attachmentMediaTypeRef.current = '';
      setReplyTo(null);
      setScheduledFor('');
      const res = await chatAPI.sendMessage(activeGroup._id, form, {
        onUploadProgress: (progressEvent) => {
          if (!optimisticId || !progressEvent.total) return;
          const percent = Math.max(4, Math.min(96, Math.round((progressEvent.loaded * 100) / progressEvent.total)));
          setMessages(current => current.map(item => item._id === optimisticId ? { ...item, uploadProgress: percent } : item));
        },
      });
      const serverMessage = res.data.message;
      if (optimisticId && serverMessage) {
        revokeLocalAttachments(optimisticAttachments);
        setMessages(current => {
          const withoutOptimistic = current.filter(item => item._id !== optimisticId);
          return withoutOptimistic.some(item => item._id === serverMessage._id) ? withoutOptimistic : [...withoutOptimistic, serverMessage];
        });
      }
      setText('');
      const drafts = readChatDrafts(user?._id);
      delete drafts[String(activeGroup._id)];
      writeChatDrafts(user?._id, drafts);
      setLastFailedSend(null);
      if (pendingScheduledFor) toast.success('Message scheduled');
    } catch (error) {
      const message = error.response?.data?.message || (error.code === 'ERR_CANCELED' ? 'Upload canceled before it finished.' : 'Could not send message');
      if (optimisticId) {
        setMessages(current => current.map(item => item._id === optimisticId ? { ...item, uploadState: 'failed', uploadError: message } : item));
        setFiles(pendingFiles);
        setText(pendingText);
        setReplyTo(pendingReplyTo);
        setScheduledFor(pendingScheduledFor);
        setAttachmentMediaType(pendingMediaType);
        attachmentMediaTypeRef.current = pendingMediaType;
      }
      setUploadError(message);
      setLastFailedSend({ groupId: activeGroup._id, fileNames: pendingFiles.map(file => file.name), failedAt: Date.now() });
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  const updateMentionStateFromInput = (value, caretIndex = value.length) => {
    const beforeCaret = value.slice(0, caretIndex);
    const match = beforeCaret.match(/(^|\s)@([^\s@]{0,40})$/);
    if (!match || !activeGroup?.members?.length) {
      setMentionState({ open: false, query: '', start: -1, activeIndex: 0 });
      return;
    }
    const start = beforeCaret.length - match[2].length - 1;
    setMentionState(current => ({
      open: true,
      query: match[2],
      start,
      activeIndex: Math.min(current.activeIndex || 0, Math.max(mentionParticipants.length - 1, 0)),
    }));
  };

  const emitTyping = (value, caretIndex = value.length) => {
    setText(value);
    updateMentionStateFromInput(value, caretIndex);
    if (!socket || !activeGroupId) return;
    socket.emit('chat_typing', { groupId: activeGroupId, typing: true, mode: 'typing' });
    window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => socket.emit('chat_typing', { groupId: activeGroupId, typing: false, mode: 'typing' }), 1200);
  };

  const insertMention = (participant) => {
    if (!participant?._id || mentionState.start < 0) return;
    const mentionText = `@${displayNameForUser(participant)}`;
    const input = composerInputRef.current;
    const caret = input?.selectionStart ?? text.length;
    const before = text.slice(0, mentionState.start);
    const after = text.slice(caret).replace(/^\s*/, '');
    const nextText = `${before}${mentionText} ${after}`;
    const nextCaret = before.length + mentionText.length + 1;
    setText(nextText);
    setSelectedMentionIds(current => current.includes(participant._id) ? current : [...current, participant._id]);
    setMentionState({ open: false, query: '', start: -1, activeIndex: 0 });
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
      composerInputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const insertEmoji = (emoji) => {
    if (!canSend) return;
    const input = composerInputRef.current;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? text.length;
    const nextText = `${text.slice(0, start)}${emoji}${text.slice(end)}`;
    const nextCaret = start + emoji.length;
    setText(nextText);
    setMentionState({ open: false, query: '', start: -1, activeIndex: 0 });
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
      composerInputRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const startVoice = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      discardRecordingRef.current = false;
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        if (!discardRecordingRef.current && chunksRef.current.length) {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          setAttachmentMediaType('voice');
          attachmentMediaTypeRef.current = 'voice';
          setFiles(current => {
            const nextFiles = [...current, new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' })];
            const error = validateChatFiles(nextFiles);
            if (error) {
              toast.error(error);
              setUploadError(error);
              return current;
            }
            setUploadError('');
            return nextFiles;
          });
        }
        stream.getTracks().forEach(track => track.stop());
        chunksRef.current = [];
        discardRecordingRef.current = false;
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setAttachmentMenuOpen(false);
      socket?.emit('chat_typing', { groupId: activeGroupId, typing: true, mode: 'recording' });
    } catch {
      toast.error('Microphone permission is required for voice notes');
    }
  };

  const stopVoice = (discard = false) => {
    discardRecordingRef.current = discard;
    mediaRecorderRef.current?.stop();
    setRecording(false);
    socket?.emit('chat_typing', { groupId: activeGroupId, typing: false, mode: 'recording' });
  };

  const updateGroup = async (payload) => {
    try {
      const res = await chatAPI.updateGroup(activeGroup._id, payload);
      setGroups(current => current.map(group => group._id === res.data.group._id ? res.data.group : group));
      toast.success('Group changes saved');
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not update room');
      return false;
    }
  };

  const saveGroupInfo = async () => {
    if (!activeGroup || !canManageGroup || !infoDirty) return;
    const saved = await updateGroup({
      name: infoDraft.name.trim(),
      chatMode: infoDraft.chatMode,
      autoDeleteAfterHours: Number(infoDraft.autoDeleteAfterHours || 0),
      inviteEnabled: infoDraft.inviteEnabled,
      permissions: infoDraft.permissions,
    });
    if (!saved) return;
    if (Boolean(infoDraft.hidePresence) !== Boolean(activeGroup.myPrefs?.hidePresence)) {
      try {
        const res = await chatAPI.updateMemberPrefs(activeGroup._id, { hidePresence: Boolean(infoDraft.hidePresence) });
        setGroups(current => current.map(group => group._id === res.data.group._id ? res.data.group : group));
        socket?.emit('chat_presence_set_hidden', { groupId: activeGroup._id, hidden: Boolean(infoDraft.hidePresence) });
      } catch (error) {
        toast.error(error.response?.data?.message || 'Could not update privacy setting');
      }
    }
    setEditingGroupName(false);
    setShowGroupSettings(false);
  };

  const savePresencePrivacy = async (hidePresence) => {
    if (!activeGroup) return;
    setInfoDraft(current => ({ ...current, hidePresence }));
    try {
      const res = await chatAPI.updateMemberPrefs(activeGroup._id, { hidePresence });
      setGroups(current => current.map(group => group._id === res.data.group._id ? res.data.group : group));
      socket?.emit('chat_presence_set_hidden', { groupId: activeGroup._id, hidden: hidePresence });
      toast.success(hidePresence ? 'Online status hidden' : 'Online status visible');
    } catch (error) {
      setInfoDraft(current => ({ ...current, hidePresence: !hidePresence }));
      toast.error(error.response?.data?.message || 'Could not update privacy setting');
    }
  };

  const discardGroupInfoChanges = () => {
    if (!activeGroup) return;
    setInfoDraft({
      name: activeGroup.name || '',
      chatMode: activeGroup.chatMode || 'everyone',
      autoDeleteAfterHours: activeGroup.autoDeleteAfterHours || 0,
      inviteEnabled: activeGroup.inviteEnabled !== false,
      permissions: permissionsForGroup(activeGroup),
      hidePresence: Boolean(activeGroup.myPrefs?.hidePresence),
    });
    setEditingGroupName(false);
  };

  const persistChatPrefs = (updater) => {
    const next = typeof updater === 'function' ? updater(readChatPrefs(user?._id)) : updater;
    setChatPrefs(next);
    writeChatPrefs(user?._id, next);
    return next;
  };

  const togglePinChat = (groupId) => {
    let nextPinned = false;
    persistChatPrefs(current => {
      const pinned = new Set(current.pinned || []);
      if (pinned.has(String(groupId))) {
        pinned.delete(String(groupId));
        nextPinned = false;
      } else {
        pinned.add(String(groupId));
        nextPinned = true;
      }
      return { ...current, pinned: [...pinned] };
    });
    chatAPI.updateMemberPrefs(groupId, { isPinned: nextPinned }).catch(() => {});
    setChatActionMenuGroupId('');
  };

  const toggleArchiveChat = (groupId) => {
    let nextArchived = false;
    persistChatPrefs(current => {
      const archived = new Set(current.archived || []);
      if (archived.has(String(groupId))) {
        archived.delete(String(groupId));
        nextArchived = false;
      } else {
        archived.add(String(groupId));
        nextArchived = true;
      }
      return { ...current, archived: [...archived] };
    });
    chatAPI.updateMemberPrefs(groupId, { isArchived: nextArchived }).catch(() => {});
    if (String(activeGroupId) === String(groupId)) setActiveGroupId('');
    setChatActionMenuGroupId('');
    setGroupMenuOpen(false);
  };

  const openLockChat = (group) => {
    setLockDraft(lockedGroups[String(group?._id)]?.code || '');
    setConfirmAction({ type: 'lock_chat', group });
    setChatActionMenuGroupId('');
    setGroupMenuOpen(false);
  };

  const saveLockedChat = () => {
    const group = confirmAction?.group;
    if (!group?._id) return;
    const code = lockDraft;
    if (!code) {
      toast.error('Enter a secret code');
      return;
    }
    persistChatPrefs(current => ({
      ...current,
      locked: {
        ...(current.locked || {}),
        [group._id]: { code, lockedAt: new Date().toISOString() },
      },
    }));
    if (String(activeGroupId) === String(group._id)) setActiveGroupId('');
    setConfirmAction(null);
    setLockDraft('');
    chatAPI.updateMemberPrefs(group._id, { lockCode: code }).catch(() => {});
    toast.success('Chat locked');
  };

  const unlockChat = (groupId) => {
    persistChatPrefs(current => {
      const locked = { ...(current.locked || {}) };
      delete locked[String(groupId)];
      return { ...current, locked };
    });
    chatAPI.updateMemberPrefs(groupId, { lockCode: '' }).catch(() => {});
    setConfirmAction(null);
    setChatActionMenuGroupId('');
    setGroupMenuOpen(false);
    toast.success('Chat unlocked');
  };

  const deleteChatFromList = async () => {
    const group = confirmAction?.group;
    if (!group?._id) return;
    try {
      if (isPrivateGroup(group)) {
        persistChatPrefs(current => ({
          ...current,
          hidden: [...new Set([...(current.hidden || []), String(group._id)])],
        }));
        toast.success('Private chat deleted from your list');
      } else {
        await chatAPI.clearGroupChat(group._id);
        setGroups(current => current.map(item => item._id === group._id ? { ...item, lastMessage: null, unreadCount: 0 } : item));
        toast.success('Group chat cleared. Group name remains in your list.');
      }
      if (String(activeGroupId) === String(group._id)) setActiveGroupId('');
      setConfirmAction(null);
      setChatActionMenuGroupId('');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not delete chat');
    }
  };

  const leaveGroup = async () => {
    try {
      await chatAPI.leaveGroup(activeGroup._id);
      setGroups(current => current.filter(group => group._id !== activeGroup._id));
      setActiveGroupId('');
      setShowInfo(false);
      setConfirmAction(null);
      toast.success('Left room');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not leave room');
    }
  };

  const deleteGroup = async () => {
    try {
      await chatAPI.deleteGroup(activeGroup._id);
      setGroups(current => current.filter(group => group._id !== activeGroup._id));
      setActiveGroupId('');
      setShowInfo(false);
      setConfirmAction(null);
      toast.success('Room deleted');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not delete room');
    }
  };

  const promote = async (member, isAdmin) => {
    try {
      const res = await chatAPI.setMemberAdmin(activeGroup._id, memberUser(member)._id, isAdmin);
      setGroups(current => current.map(group => group._id === activeGroup._id ? res.data.group : group));
      setConfirmAction(null);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not update member');
    }
  };

  const removeMember = async (member) => {
    try {
      await chatAPI.removeMember(activeGroup._id, memberUser(member)._id);
      loadGroups();
      setConfirmAction(null);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not remove member');
    }
  };

  const react = async (message, emoji) => {
    try {
      const res = await chatAPI.reactMessage(message._id, emoji);
      setMessages(current => current.map(item => item._id === message._id ? res.data.message : item));
      setHoverReactionMessage(null);
      setActionMessage(null);
      setMobileMoreOpen(false);
    } catch {
      toast.error('Could not react');
    }
  };

  const star = async (message) => {
    try {
      const res = await chatAPI.starMessage(message._id);
      setMessages(current => current.map(item => item._id === message._id ? res.data.message : item));
      setActionMessage(null);
      setMobileMoreOpen(false);
    } catch {
      toast.error('Could not star message');
    }
  };

  const toggleImportant = async (message) => {
    try {
      const res = await chatAPI.markImportant(message._id, !message.isImportant);
      setMessages(current => current.map(item => item._id === message._id ? res.data.message : item));
      setActionMessage(null);
      setMobileMoreOpen(false);
      toast.success(res.data.message.isImportant ? 'Marked important for this room' : 'Important mark removed');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not update important message');
    }
  };

  const starSelected = async () => {
    await Promise.all(selectedMessageRows.map(message => star(message)));
    cancelMessageSelection();
  };

  const pin = async (message, duration = 'always') => {
    try {
      const res = await chatAPI.pinMessage(message._id, duration);
      setMessages(current => current.map(item => ({ ...item, isPinned: item._id === res.data.message._id, pinnedUntil: item._id === res.data.message._id ? res.data.message.pinnedUntil : item.pinnedUntil })));
      setActionMessage(null);
      setSelectedMessages([]);
      setMobileMoreOpen(false);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not pin message');
    }
  };

  const jumpToMessage = (messageId) => {
    if (!messageId) return;
    const node = document.getElementById(`chat-message-${messageId}`);
    if (!node) {
      toast.error('Original message is not loaded in this view');
      return;
    }
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(String(messageId));
    window.setTimeout(() => setHighlightedMessageId(current => current === String(messageId) ? '' : current), 1600);
  };

  const persistQuickReplies = (updater) => {
    const next = typeof updater === 'function' ? updater(readQuickReplies(user?._id)) : updater;
    setQuickReplies(next);
    writeQuickReplies(user?._id, next);
    return next;
  };

  const saveQuickReply = () => {
    const value = (quickReplyDraft || text).trim();
    if (!value) return;
    persistQuickReplies(current => [{ id: `${Date.now()}`, text: value }, ...current.filter(item => item.text !== value)].slice(0, 30));
    setQuickReplyDraft('');
    toast.success('Quick reply saved');
  };

  const insertQuickReply = (reply) => {
    setText(current => current ? `${current}${current.endsWith(' ') ? '' : ' '}${reply.text}` : reply.text);
    setShowQuickReplies(false);
  };

  const removeMsg = async (message, scope = 'everyone', options = {}) => {
    const { allowUndo = true } = options;
    try {
      const res = await chatAPI.deleteMessage(message._id, { scope });
      setMessages(current => current.map(item => item._id === message._id ? res.data.message : item));
      setSelectedMessages(current => current.filter(id => id !== message._id));
      setActionMessage(null);
      if (res.data.deletedForMe && allowUndo) {
        window.clearTimeout(undoTimerRef.current);
        setUndoDelete({ messageId: message._id });
        undoTimerRef.current = window.setTimeout(() => setUndoDelete(null), 5000);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not delete message');
    }
  };

  const removeSelected = async (scope = 'everyone') => {
    const source = confirmAction?.messages?.length ? confirmAction.messages : selectedMessageRows;
    const rows = source.filter(message => !message.isDeletedForMe);
    const alreadyDeletedRows = rows.filter(message => message.isDeleted);
    const activeRows = rows.filter(message => !message.isDeleted);
    const deleteTasks = scope === 'me'
      ? [
        ...alreadyDeletedRows.map(message => removeMsg(message, 'me', { allowUndo: false })),
        ...activeRows.map(message => removeMsg(message, 'me', { allowUndo: true })),
      ]
      : activeRows.map(message => removeMsg(message, 'everyone'));
    await Promise.all(deleteTasks);
    setConfirmAction(null);
    cancelMessageSelection();
  };

  const clearChatForMe = async () => {
    if (!activeGroup) return;
    try {
      await chatAPI.clearGroupChat(activeGroup._id);
      setMessages([]);
      setGroups(current => current.map(group => group._id === activeGroup._id ? { ...group, lastMessage: null, unreadCount: 0 } : group));
      setGroupMenuOpen(false);
      setConfirmAction(null);
      toast.success('Chat cleared from your side');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not clear chat');
    }
  };

  const undoDeleteForMe = async () => {
    if (!undoDelete?.messageId) return;
    try {
      const res = await chatAPI.undoDeleteForMe(undoDelete.messageId);
      setMessages(current => current.map(item => item._id === res.data.message._id ? res.data.message : item));
      setUndoDelete(null);
      window.clearTimeout(undoTimerRef.current);
    } catch {
      toast.error('Could not restore message');
    }
  };

  const uploadGroupAvatar = async (file) => {
    if (!file || !activeGroup || !canManageGroup) return;
    const form = new FormData();
    form.append('avatar', file);
    try {
      const res = await chatAPI.updateGroupAvatar(activeGroup._id, form);
      setGroups(current => current.map(group => group._id === activeGroup._id ? res.data.group : group));
      toast.success('Group image updated');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not update group image');
    }
  };

  const openDeleteConfirm = async (messagesToDelete) => {
    const rows = (Array.isArray(messagesToDelete) ? messagesToDelete : [messagesToDelete]).filter(message => !message.isDeletedForMe);
    if (!rows.length) return;
    const alreadyDeletedRows = rows.filter(message => message.isDeleted);
    const activeRows = rows.filter(message => !message.isDeleted);
    if (alreadyDeletedRows.length) {
      await Promise.all(alreadyDeletedRows.map(message => removeMsg(message, 'me', { allowUndo: false })));
    }
    if (!activeRows.length) {
      setConfirmAction(null);
      cancelMessageSelection();
      setActionMessage(null);
      setMobileMoreOpen(false);
      return;
    }
    setConfirmAction({ type: 'delete', messages: activeRows });
    setActionMessage(null);
    setMobileMoreOpen(false);
  };

  const openPinConfirm = (message) => {
    if (!message) return;
    setConfirmAction({ type: 'pin', message });
    setActionMessage(null);
    setMobileMoreOpen(false);
  };

  const openAttachmentPicker = (accept, mediaType = '') => {
    setAttachmentAccept(accept);
    setAttachmentMediaType(mediaType);
    attachmentMediaTypeRef.current = mediaType;
    setAttachmentMenuOpen(false);
    window.requestAnimationFrame(() => {
      if (!attachmentInputRef.current) return;
      attachmentInputRef.current.accept = accept;
      attachmentInputRef.current.click();
    });
  };

  const validateChatFiles = (nextFiles) => {
    if (nextFiles.length > CHAT_MAX_FILES) return `You can attach up to ${CHAT_MAX_FILES} files at once.`;
    const oversized = nextFiles.find(file => file.size > CHAT_MAX_FILE_SIZE);
    if (oversized) return `${oversized.name} is too large. Max size is ${formatBytes(CHAT_MAX_FILE_SIZE)}.`;
    const blocked = nextFiles.find(file => CHAT_BLOCKED_EXTENSIONS.includes(fileExtension(file.name)));
    if (blocked) return `${blocked.name} is not allowed for security reasons.`;
    return '';
  };

  const handleAttachmentFiles = (event) => {
    const picked = Array.from(event.target.files || []);
    if (picked.length) {
      setFiles(current => {
        const nextFiles = [...current, ...picked];
        const error = validateChatFiles(nextFiles);
        if (error) {
          toast.error(error);
          setUploadError(error);
          return current;
        }
        setUploadError('');
        setLastFailedSend(null);
        return nextFiles;
      });
    }
    event.target.value = '';
  };

  const handleComposerKeyDown = (event) => {
    if (mentionState.open && mentionParticipants.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setMentionState(current => ({ ...current, activeIndex: (current.activeIndex + 1) % mentionParticipants.length }));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setMentionState(current => ({ ...current, activeIndex: (current.activeIndex - 1 + mentionParticipants.length) % mentionParticipants.length }));
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        insertMention(mentionParticipants[mentionState.activeIndex] || mentionParticipants[0]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionState({ open: false, query: '', start: -1, activeIndex: 0 });
        return;
      }
    }
    if (!isMobile && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const showReceipts = async (message) => {
    try {
      const res = await chatAPI.getReceipts(message._id);
      setReceipts({ message, ...res.data });
      setActionMessage(null);
      setMobileMoreOpen(false);
    } catch {
      toast.error('Could not load message info');
    }
  };

  const createPoll = async (event) => {
    event.preventDefault();
    if (!activeGroup) return;
    try {
      const res = await chatAPI.createPoll(activeGroup._id, {
        question: pollForm.question,
        options: pollForm.options,
        allowMultiple: pollForm.allowMultiple,
        closesAt: pollForm.closesAt || undefined,
      });
      setMessages(current => current.some(item => item._id === res.data.message._id) ? current : [...current, res.data.message]);
      setPollForm(emptyPollForm);
      setShowPoll(false);
      toast.success('Poll posted');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not create poll');
    }
  };

  const votePoll = async (message, optionId) => {
    try {
      const res = await chatAPI.votePoll(message._id, optionId);
      setMessages(current => current.map(item => item._id === message._id ? res.data.message : item));
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not vote');
    }
  };

  const reportMessage = async (message) => {
    try {
      const res = await chatAPI.reportMessage(message._id, 'Reported from chat');
      setMessages(current => current.map(item => item._id === message._id ? res.data.message : item));
      setActionMessage(null);
      toast.success('Reported to group admins');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not report message');
    }
  };

  const saveNickname = () => {
    const person = confirmAction?.user;
    if (!person?._id) return;
    persistChatPrefs(current => {
      const nicknames = { ...(current.nicknames || {}) };
      if (nicknameDraft.trim()) nicknames[String(person._id)] = nicknameDraft.trim();
      else delete nicknames[String(person._id)];
      return { ...current, nicknames };
    });
    setConfirmAction(null);
    setNicknameDraft('');
    toast.success('Nickname saved on this device');
  };

  const openGallery = async () => {
    if (!activeGroup) return;
    try {
      const res = await chatAPI.getGallery(activeGroup._id);
      setGallery(res.data.gallery);
      setGalleryTab('images');
      setShowInfo(true);
      setGroupMenuOpen(false);
    } catch {
      toast.error('Could not load media gallery');
    }
  };

  const loadGalleryInline = async (tab = galleryTab) => {
    if (!activeGroup) return;
    try {
      const res = await chatAPI.getGallery(activeGroup._id);
      setGallery(res.data.gallery);
      setGalleryTab(tab);
    } catch {
      toast.error('Could not load media');
    }
  };

  const loadInvite = async () => {
    if (!activeGroup || !canManageGroup) return;
    try {
      const res = await chatAPI.getInvite(activeGroup._id);
      setInvite(res.data);
      setInviteControls({
        expiresAt: res.data.inviteExpiresAt ? new Date(res.data.inviteExpiresAt).toISOString().slice(0, 16) : '',
        maxUses: res.data.inviteMaxUses || 0,
        requireApproval: Boolean(res.data.inviteRequireApproval),
      });
      setShowInviteQr(true);
      setQrImageSourceIndex(0);
    } catch {
      toast.error('Could not load invite');
    }
  };

  const regenerateInviteLink = async () => {
    if (!activeGroup || !canManageGroup) return;
    try {
      const res = await chatAPI.regenerateInvite(activeGroup._id, {
        expiresAt: inviteControls.expiresAt || undefined,
        maxUses: Number(inviteControls.maxUses || 0),
        requireApproval: inviteControls.requireApproval,
      });
      setInvite(res.data);
      setGroups(current => current.map(group => group._id === activeGroup._id ? { ...group, ...res.data } : group));
      setQrImageSourceIndex(0);
      toast.success('Invite link reset');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not reset invite');
    }
  };

  const saveInviteControls = async () => {
    if (!activeGroup || !canManageGroup) return;
    const saved = await updateGroup({
      inviteRequireApproval: inviteControls.requireApproval,
      inviteExpiresAt: inviteControls.expiresAt || '',
      inviteMaxUses: Number(inviteControls.maxUses || 0),
    });
    if (saved) toast.success('Invite controls saved');
  };

  const loadJoinRequests = async () => {
    if (!activeGroup || !canManageGroup) return;
    try {
      const res = await chatAPI.getJoinRequests(activeGroup._id);
      setJoinRequests(res.data.requests || []);
    } catch {
      setJoinRequests([]);
    }
  };

  const reviewJoinRequest = async (requestId, status) => {
    try {
      const res = await chatAPI.reviewJoinRequest(activeGroup._id, requestId, status);
      setGroups(current => current.map(group => group._id === activeGroup._id ? res.data.group : group));
      setJoinRequests(current => current.filter(item => item._id !== requestId));
      toast.success(status === 'rejected' ? 'Join request rejected' : 'Join request approved');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not review request');
    }
  };

  const loadStarredMessages = async () => {
    try {
      const res = await chatAPI.getStarredMessages();
      setStarredMessages(res.data.messages || []);
      setShowStarred(true);
    } catch {
      toast.error('Could not load starred messages');
    }
  };

  const loadScheduledMessages = async () => {
    try {
      const res = await chatAPI.getScheduledMessages();
      setScheduledMessages(res.data.messages || []);
      setShowScheduledList(true);
    } catch {
      toast.error('Could not load scheduled messages');
    }
  };

  const cancelScheduled = async (messageId) => {
    try {
      await chatAPI.cancelScheduledMessage(messageId);
      setScheduledMessages(current => current.filter(message => message._id !== messageId));
      toast.success('Scheduled message canceled');
    } catch {
      toast.error('Could not cancel scheduled message');
    }
  };

  const sendBroadcast = async (event) => {
    event.preventDefault();
    if (!broadcastText.trim() || !broadcastRecipients.length) return;
    try {
      const res = await chatAPI.broadcast({ text: broadcastText, memberIds: broadcastRecipients.map(item => item._id) });
      setGroups(current => [...(res.data.groups || []), ...current.filter(group => !(res.data.groups || []).some(next => next._id === group._id))]);
      setBroadcastText('');
      setBroadcastRecipients([]);
      setShowBroadcast(false);
      toast.success('Broadcast sent');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not send broadcast');
    }
  };

  const joinInviteCode = useCallback(async (value) => {
    const code = inviteCodeFromValue(value);
    if (!code) return false;
    try {
      const res = await chatAPI.joinByInvite(code);
      setGroups(current => [res.data.group, ...current.filter(group => group._id !== res.data.group._id)]);
      setActiveGroupId(res.data.group._id);
      setJoinCode('');
      setShowQrScanner(false);
      toast.success(res.data.alreadyMember ? 'Room opened' : 'Joined room');
      return true;
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not join room');
      return false;
    }
  }, []);

  const joinByInvite = async (event) => {
    event.preventDefault();
    await joinInviteCode(joinCode);
  };

  const sendInviteToStudent = async (student) => {
    if (!activeGroup || !student?._id || !activeInviteCode) return;
    setInviteSendingId(student._id);
    try {
      const res = await chatAPI.sendInvite(activeGroup._id, {
        studentId: student.studentId,
        inviteLink: activeInviteLink,
      });
      setGroups(current => [res.data.group, ...current.filter(group => group._id !== res.data.group._id)]);
      setInviteRecipientSearch('');
      toast.success(`Invite sent to ${student.name}`);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not send invite');
    } finally {
      setInviteSendingId('');
    }
  };

  const forwardToGroup = async (groupId) => {
    if (!forwardMessage) return;
    try {
      await chatAPI.forwardMessage(forwardMessage._id, [groupId]);
      setForwardMessage(null);
      toast.success('Message forwarded');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not forward message');
    }
  };

  const copyMessage = async (message) => {
    const value = message?.text || message?.attachments?.[0]?.url || '';
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Message copied');
      setActionMessage(null);
    } catch {
      toast.error('Could not copy message');
    }
  };

  const toggleMessageSelection = (message) => {
    if (!message || message.type === 'system') return;
    setSelectingMessages(true);
    setSelectedMessages(current => current.includes(message._id) ? current.filter(id => id !== message._id) : [...current, message._id]);
    setActionMessage(null);
  };

  const handleMessagePointerDown = (event, message) => {
    if (message.type === 'system' || event.button > 0 || event.target.closest('button, a, input, textarea, select, [data-chat-popover]')) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setTouchStart({ id: message._id, x: event.clientX, y: event.clientY, pointerId: event.pointerId });
    window.clearTimeout(longPressRef.current);
    if (isMobile) longPressRef.current = window.setTimeout(() => toggleMessageSelection(message), 520);
  };

  const handleMessagePointerMove = (event, message) => {
    if (!touchStart || touchStart.id !== message._id) return;
    const dx = event.clientX - touchStart.x;
    const dy = Math.abs(event.clientY - touchStart.y);
    if (Math.abs(dx) > 18 || dy > 18) window.clearTimeout(longPressRef.current);
    if (dx > 0 && dy < 48) {
      event.preventDefault();
      setSwipePreview({ id: message._id, offset: Math.min(dx, 76) });
    }
  };

  const handleMessagePointerUp = (event, message) => {
    window.clearTimeout(longPressRef.current);
    if (!touchStart || touchStart.id !== message._id) return;
    event.currentTarget.releasePointerCapture?.(touchStart.pointerId);
    const dx = event.clientX - touchStart.x;
    const dy = Math.abs(event.clientY - touchStart.y);
    if (dx > 70 && dy < 45) {
      setReplyTo(message);
      setSelectedMessages([]);
      setSelectingMessages(false);
      setActionMessage(null);
    }
    setTouchStart(null);
    setSwipePreview({ id: '', offset: 0 });
  };

  const handleChatBodyScroll = (event) => {
    const el = event.currentTarget;
    setShowScrollBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 180);
  };

  const renderHoverControls = (message, align = 'left') => (
    <div data-chat-popover className="relative mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100">
      {!message.isDeleted && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setHoverReactionMessage(hoverReactionMessage?._id === message._id ? null : message);
            setActionMessage(null);
          }}
          className="grid h-7 w-7 place-items-center rounded-full bg-slate-950/90 text-slate-300 shadow hover:bg-white/10 hover:text-white"
          aria-label="React"
        >
          <Smile className="h-4 w-4" />
        </button>
      )}
      {hoverReactionMessage?._id === message._id && (
        <div className={`absolute bottom-9 z-30 flex items-center gap-1 rounded-full border border-white/10 bg-slate-950 p-1 shadow-2xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {actionReactions.map(emoji => (
            <button key={emoji} type="button" onClick={() => react(message, emoji)} className="grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-white/10" aria-label="React">
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const renderMessageText = (message) => {
    const { preview, isLong } = buildMessagePreview(message.text || '');
    const expanded = expandedMessages.includes(message._id);
    const visibleText = expanded || !isLong ? message.text : preview;
    return (
      <div>
        <p className="whitespace-pre-wrap text-[14px] leading-5 text-slate-100">{renderTextWithMentions(visibleText)}</p>
        {isLong && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setExpandedMessages(current => current.includes(message._id) ? current.filter(id => id !== message._id) : [...current, message._id]);
            }}
            className="mt-1 text-xs font-semibold text-primary-200 hover:text-primary-100"
          >
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}
      </div>
    );
  };

  const renderMessageActionMenu = (message, openAbove = false) => (
    <div data-chat-popover className={`absolute right-1 z-30 w-56 rounded-xl border border-white/10 bg-slate-950 p-2 text-sm shadow-2xl ${openAbove ? 'bottom-8' : 'top-8'}`}>
      {!message.isDeleted && <div className="mb-2 flex items-center justify-center gap-2 rounded-full bg-white/5 px-2 py-1">
        {actionReactions.map(emoji => <button key={emoji} type="button" onClick={() => react(message, emoji)} className="grid h-8 w-8 place-items-center rounded-full text-lg hover:bg-white/10">{emoji}</button>)}
        <button type="button" className="grid h-8 w-8 place-items-center rounded-full text-slate-100 hover:bg-white/10"><Plus className="h-4 w-4" /></button>
      </div>}
      <div className="max-h-44 space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.35)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-600/60">
        {!message.isDeleted && <button type="button" onClick={() => showReceipts(message)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-slate-100 hover:bg-white/10"><Info className="h-4 w-4" /> Message info</button>}
        {!message.isDeleted && <button type="button" onClick={() => { setReplyTo(message); setSelectedMessages([]); setActionMessage(null); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-slate-100 hover:bg-white/10"><CornerUpLeft className="h-4 w-4" /> Reply</button>}
        {!message.isDeleted && <button type="button" onClick={() => copyMessage(message)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-slate-100 hover:bg-white/10"><FileText className="h-4 w-4" /> Copy</button>}
        {!message.isDeleted && <button type="button" onClick={() => { setForwardMessage(message); setActionMessage(null); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-slate-100 hover:bg-white/10"><Forward className="h-4 w-4" /> Forward</button>}
        {!message.isDeleted && <button type="button" onClick={() => openPinConfirm(message)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-slate-100 hover:bg-white/10"><Pin className="h-4 w-4" /> Pin</button>}
        {!message.isDeleted && <button type="button" onClick={() => toggleImportant(message)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-slate-100 hover:bg-white/10"><Flag className="h-4 w-4" /> {message.isImportant ? 'Remove important' : 'Mark important'}</button>}
        {!message.isDeleted && <button type="button" onClick={() => star(message)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-slate-100 hover:bg-white/10"><Star className="h-4 w-4" /> {message.isStarredByMe ? 'Unstar' : 'Star'}</button>}
        {!message.isDeleted && <button type="button" onClick={() => reportMessage(message)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-amber-100 hover:bg-amber-500/10"><Flag className="h-4 w-4" /> {message.isReportedByMe ? 'Reported' : 'Report'}</button>}
        <button type="button" onClick={() => toggleMessageSelection(message)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-slate-100 hover:bg-white/10"><Check className="h-4 w-4" /> Select</button>
        {!message.isDeleted && String(message.sender?._id) === String(user?._id) && <button type="button" onClick={() => { setEditing(message); setText(message.text || ''); setActionMessage(null); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-slate-100 hover:bg-white/10"><Edit3 className="h-4 w-4" /> Edit</button>}
        <button type="button" onClick={() => openDeleteConfirm(message)} className="flex w-full items-center gap-3 rounded-lg border-t border-white/10 px-3 py-2.5 text-red-200 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /> Delete</button>
      </div>
    </div>
  );

  const renderAttachment = (attachment, message = {}) => {
    const Icon = attachmentIcon(attachment.kind);
    const uploading = message.uploadState === 'uploading';
    const failed = message.uploadState === 'failed';
    const progress = Math.max(4, Math.min(100, Number(message.uploadProgress || 0)));
    const mediaOverlay = (className = '') => (uploading || failed) ? (
      <div className={`absolute inset-0 grid place-items-center bg-slate-950/45 backdrop-blur-[1px] ${className}`}>
        <div className="grid place-items-center gap-2 text-center text-xs font-semibold text-white">
          {failed ? (
            <AlertCircle className="h-8 w-8 text-red-200" />
          ) : (
            <div className="relative grid h-12 w-12 place-items-center rounded-full bg-slate-950/70">
              <svg className="h-12 w-12 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
                <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="4" />
                <circle cx="22" cy="22" r="18" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(progress / 100) * 113} 113`} className="text-primary-200 transition-all duration-200" />
              </svg>
              <ArrowDown className="absolute h-5 w-5 animate-pulse text-white" />
            </div>
          )}
          <span>{failed ? 'Upload failed' : `${progress}%`}</span>
        </div>
      </div>
    ) : null;
    if (['image', 'gif'].includes(attachment.kind)) {
      return <button key={attachment.url} type="button" disabled={uploading} onClick={(event) => { event.stopPropagation(); setFullScreenMedia(attachment); }} className="relative mt-2 block overflow-hidden rounded-xl disabled:cursor-wait"><img src={fileUrl(attachment.url)} alt={attachment.name} className="max-h-64 object-cover" />{mediaOverlay()}</button>;
    }
    if (attachment.kind === 'video') {
      return <button key={attachment.url} type="button" disabled={uploading} onClick={(event) => { event.stopPropagation(); setFullScreenMedia(attachment); }} className="relative mt-2 block overflow-hidden rounded-xl disabled:cursor-wait"><video src={fileUrl(attachment.url)} className="max-h-64 rounded-xl" />{mediaOverlay()}</button>;
    }
    if (['audio', 'voice'].includes(attachment.kind)) {
      return <VoiceAttachment key={attachment.url} attachment={attachment} />;
    }
    return (
      <a key={attachment.url} href={uploading ? undefined : fileUrl(attachment.url)} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} className="relative mt-2 flex items-center gap-2 overflow-hidden rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200 hover:bg-white/10">
        <Icon className="h-4 w-4 text-primary-300" />
        <span className="min-w-0 truncate">{attachment.name || 'Attachment'}</span>
        {uploading && <span className="ml-auto text-xs text-primary-200">{progress}%</span>}
        {failed && <span className="ml-auto text-xs text-red-200">Failed</span>}
        {uploading && <span className="absolute bottom-0 left-0 h-0.5 bg-primary-300 transition-all duration-200" style={{ width: `${progress}%` }} />}
      </a>
    );
  };

  const renderPoll = (message) => {
    const totalVotes = (message.poll?.options || []).reduce((sum, option) => sum + Number(option.voteCount || 0), 0);
    return (
      <div className="mt-2 min-w-[15rem] rounded-xl border border-primary-400/20 bg-primary-500/10 p-3">
        <p className="text-sm font-semibold text-white">{message.poll?.question || message.text}</p>
        <div className="mt-3 space-y-2">
          {(message.poll?.options || []).map(option => {
            const pct = totalVotes ? Math.round((Number(option.voteCount || 0) / totalVotes) * 100) : 0;
            return (
              <button key={option._id} type="button" onClick={(event) => { event.stopPropagation(); votePoll(message, option._id); }} className={`relative w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-xs transition-colors ${option.votedByMe ? 'border-primary-300 bg-primary-500/20 text-white' : 'border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/10'}`}>
                <span className="absolute inset-y-0 left-0 bg-primary-400/20" style={{ width: `${pct}%` }} />
                <span className="relative flex items-center justify-between gap-3">
                  <span>{option.text}</span>
                  <span>{option.voteCount || 0} - {pct}%</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">{totalVotes} vote{totalVotes === 1 ? '' : 's'}{message.poll?.allowMultiple ? ' - multiple choices allowed' : ''}</p>
      </div>
    );
  };

  const selectedIds = new Set(selectedMembers.map(member => member._id));
  const activeMemberIds = new Set((activeGroup?.members || []).map(member => String(memberUser(member)?._id)));
  const isMobileChat = Boolean(activeGroupId);
  const inlineGalleryItems = gallery?.[galleryTab] || [];
  const sortedMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    return [...(activeGroup?.members || [])]
      .sort((a, b) => {
        if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
        const aUser = memberUser(a);
        const bUser = memberUser(b);
        return String(aUser?.studentId || '').localeCompare(String(bUser?.studentId || ''), undefined, { numeric: true, sensitivity: 'base' });
      })
      .filter(member => {
        if (!query) return true;
        const person = memberUser(member);
        return [displayUserName(member), person?.name, person?.studentId, person?.email]
          .some(value => String(value || '').toLowerCase().includes(query));
      });
  }, [activeGroup?.members, memberSearch, localNicknames]);

  return (
    <div className="student-rooms relative -m-3 h-[calc(100dvh-3.5rem)] w-[calc(100%+1.5rem)] overflow-hidden border-0 bg-slate-950/70 sm:-m-6 sm:h-[calc(100dvh-4rem)] sm:w-[calc(100%+3rem)]">
      <div className="flex h-full w-full min-w-0">
        <aside className={`${isMobileChat ? 'hidden md:flex' : 'flex'} h-full w-full min-w-0 flex-col border-r border-white/10 bg-slate-950/90 md:w-[390px]`}>
          <div className="border-b border-white/10 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-white">Chats</h1>
                <p className="text-xs text-slate-500">Private student groups</p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setShowBroadcast(true)} className="grid h-10 w-10 place-items-center rounded-full text-slate-300 hover:bg-white/10" aria-label="Broadcast message" title="Broadcast">
                  <Send className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => setShowQrScanner(true)} className="grid h-10 w-10 place-items-center rounded-full text-slate-300 hover:bg-white/10" aria-label="Scan room QR" title="Scan room QR">
                  <Camera className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => setShowCreate(true)} className="grid h-10 w-10 place-items-center rounded-full text-slate-300 hover:bg-white/10" aria-label="Create room" title="Create room">
                  <Plus className="h-5 w-5" />
                </button>
                <Avatar user={user} className="h-8 w-8 sm:h-10 sm:w-10" />
              </div>
            </div>
            <form onSubmit={joinByInvite} className="mt-3 flex gap-2">
              <input value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase())} className="h-9 min-w-0 flex-1 rounded-full border border-white/10 bg-white/5 px-3 text-xs text-white outline-none placeholder:text-slate-500 focus:border-primary-400/60" placeholder="Invite code" />
              <button type="submit" className="rounded-full bg-primary-500/20 px-3 text-xs font-semibold text-primary-100 hover:bg-primary-500/30">Join</button>
            </form>
            <div className="relative mt-4">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={chatSearch}
                onChange={event => setChatSearch(event.target.value)}
                className="h-10 w-full rounded-full border border-white/10 bg-white/5 pl-11 pr-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-primary-400/60"
                placeholder="Search or enter lock code"
              />
            </div>
            <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.35)_transparent] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-600/50">
              {[
                ['all', 'All'],
                ['unread', 'Unread'],
                ['groups', 'Groups'],
                ['archived', 'Archived'],
              ].map(([value, chip]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setChatFilter(value)}
                  className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs ${chatFilter === value ? 'bg-primary-500/15 text-primary-200' : 'border border-white/10 text-slate-300 hover:bg-white/5'}`}
                >
                  {chip}
                </button>
              ))}
              <button type="button" onClick={loadStarredMessages} className="whitespace-nowrap rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">Starred</button>
              <button type="button" onClick={loadScheduledMessages} className="whitespace-nowrap rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">Scheduled</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="space-y-3 p-2">{Array.from({ length: 6 }).map((_, index) => <SkeletonLine key={index} className="h-16 rounded-xl" />)}</div>
            ) : displayedGroups.length ? displayedGroups.map(group => {
              const isPinnedChat = pinnedGroupIds.has(String(group._id));
              const isLockedChat = Boolean(lockedGroups[String(group._id)]?.code);
              const isArchivedChat = archivedGroupIds.has(String(group._id));
              const isPrivateChat = isPrivateGroup(group);
              const draftText = chatDrafts[String(group._id)];
              return (
              <div
                key={group._id}
                role="button"
                tabIndex={0}
                onClick={() => selectGroup(group._id)}
                onKeyDown={event => { if (event.key === 'Enter') selectGroup(group._id); }}
                className={`group/chatrow relative mb-1 flex w-full cursor-pointer items-center gap-3 rounded-xl p-3 pr-36 text-left transition-colors ${activeGroupId === group._id ? 'bg-primary-500/15' : 'hover:bg-white/5'}`}
              >
                <GroupAvatar group={group} className="h-11 w-11" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-1.5 truncate text-[15px] font-medium text-white">
                      {isArchivedChat && <Archive className="h-3 w-3 flex-shrink-0 text-slate-400" />}
                      {isLockedChat && <Lock className="h-3 w-3 flex-shrink-0 text-amber-300" />}
                      {renderMarqueeName(group.name, 'block min-w-0 max-w-full truncate')}
                    </p>
                  </div>
                  <div className="mt-0.5 flex min-w-0 items-center gap-2">
                    <p className="min-w-0 truncate text-sm text-slate-400">
                      {isLockedChat ? 'Locked chat' : draftText ? <><span className="font-semibold text-primary-200">Draft: </span>{draftText}</> : (group.lastMessage?.text ? renderTextWithMentions(group.lastMessage.text) : `${group.members?.length || 0} members`)}
                    </p>
                  </div>
                </div>
                <div className="absolute right-3 top-3 flex max-w-[128px] items-center justify-end gap-1.5">
                  {isPrivateChat && <span className="rounded-full bg-primary-500/10 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-primary-200">Private</span>}
                  {isPinnedChat && <Pin className="h-3 w-3 flex-shrink-0 text-primary-300" />}
                  <span className={`shrink-0 text-[11px] ${group.unreadCount > 0 ? 'text-red-300' : 'text-slate-500'}`}>{formatTime(group.lastMessageAt)}</span>
                </div>
                {group.unreadCount > 0 && <span className="absolute bottom-3 right-3 grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white shadow-[0_0_0_4px_rgba(239,68,68,0.12)]">{group.unreadCount}</span>}
                <div data-chat-popover className="absolute right-3 top-8 flex items-center opacity-0 transition-opacity group-hover/chatrow:opacity-100">
                  <button type="button" onClick={(event) => { event.stopPropagation(); setChatActionMenuGroupId(chatActionMenuGroupId === group._id ? '' : group._id); }} className="grid h-9 w-9 place-items-center rounded-full bg-slate-950/80 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Chat actions">
                    <MoreVertical className="h-[18px] w-[18px]" />
                  </button>
                </div>
                {chatActionMenuGroupId === group._id && (
                  <div data-chat-popover className="absolute right-3 top-16 z-40 w-48 rounded-xl border border-white/10 bg-slate-950 p-1.5 shadow-2xl">
                    <button type="button" onClick={(event) => { event.stopPropagation(); togglePinChat(group._id); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-100 hover:bg-white/10"><Pin className="h-4 w-4 text-primary-300" /> {isPinnedChat ? 'Unpin chat' : 'Pin chat'}</button>
                    {isLockedChat ? (
                      <button type="button" onClick={(event) => { event.stopPropagation(); unlockChat(group._id); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-100 hover:bg-white/10"><Lock className="h-4 w-4 text-amber-300" /> Unlock chat</button>
                    ) : (
                      <button type="button" onClick={(event) => { event.stopPropagation(); openLockChat(group); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-100 hover:bg-white/10"><Lock className="h-4 w-4 text-amber-300" /> Lock chat</button>
                    )}
                    <button type="button" onClick={(event) => { event.stopPropagation(); toggleArchiveChat(group._id); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-100 hover:bg-white/10"><Archive className="h-4 w-4 text-slate-300" /> {isArchivedChat ? 'Unarchive' : 'Archive'}</button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); setConfirmAction({ type: 'delete_chat_list', group }); setChatActionMenuGroupId(''); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-200 hover:bg-red-500/10"><Trash2 className="h-4 w-4" /> Delete chat</button>
                  </div>
                )}
              </div>
            );}) : (
              <div className="grid h-full place-items-center px-8 text-center text-sm text-slate-500">
                <div>
                  <Users className="mx-auto mb-3 h-9 w-9 text-slate-600" />
                  {groups.length ? 'No chats match this view.' : 'Create your first room with students from your semester.'}
                </div>
              </div>
            )}
          </div>
        </aside>

        <section className={`${isMobileChat ? 'flex' : 'hidden md:flex'} relative h-full min-w-0 flex-1 flex-col`}>
          {activeGroup ? (
            <>
              {showInfo && (
                <div className="relative z-40 flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-950">
                  <header className="flex h-14 items-center justify-between gap-2 border-b border-white/10 px-2.5 sm:h-16 sm:px-4">
                    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                      <button type="button" onClick={() => { setShowInfo(false); setShowGroupSettings(false); setEditingGroupName(false); }} className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-slate-300 hover:bg-white/10" aria-label="Back">
                        <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
                      </button>
                      <GroupAvatar group={activeGroup} className="h-8 w-8 sm:h-10 sm:w-10" />
                      <div className="min-w-0">
                        <h2 className="min-w-0 text-sm font-semibold text-white sm:text-base">{renderMarqueeName(infoDraft.name || activeGroup.name, 'block min-w-0 max-w-full truncate')}</h2>
                        <p className="truncate text-[10px] text-slate-500 sm:text-xs">{activeGroup.members?.length || 0} members - {activeOnlineMembers.length} online</p>
                      </div>
                    </div>
                    {canManageGroup && (
                      <button type="button" onClick={() => setShowGroupSettings(value => !value)} className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl ${showGroupSettings ? 'bg-primary-500/20 text-primary-100' : 'text-slate-400 hover:bg-white/10 hover:text-white'}`} aria-label="Room settings">
                        <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
                      </button>
                    )}
                  </header>
                  <div className="flex-1 overflow-y-auto overflow-x-hidden p-2.5 sm:p-4">
                    <div className="mx-auto w-full max-w-4xl space-y-2.5 sm:space-y-4">
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:rounded-2xl sm:p-4">
                        <div className="flex items-center gap-3 sm:gap-4">
                          <label className={`relative ${canManageGroup ? 'cursor-pointer' : ''}`}>
                            <GroupAvatar group={activeGroup} className="h-14 w-14 sm:h-20 sm:w-20" />
                            {canManageGroup && (
                              <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-primary-500 text-white shadow-lg sm:h-7 sm:w-7">
                                <ImageIcon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                              </span>
                            )}
                            {canManageGroup && <input type="file" accept="image/*" className="hidden" onChange={event => uploadGroupAvatar(event.target.files?.[0])} />}
                          </label>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {editingGroupName ? (
                                <input className="input-field h-9 flex-1 text-sm sm:h-10" autoFocus value={infoDraft.name} disabled={!canManageGroup} onChange={e => setInfoDraft(current => ({ ...current, name: e.target.value }))} />
                              ) : (
                                <p className="min-w-0 text-base font-semibold text-white sm:text-xl">{renderMarqueeName(infoDraft.name || activeGroup.name, 'block min-w-0 max-w-full truncate')}</p>
                              )}
                              {canManageGroup && <button type="button" onClick={() => setEditingGroupName(value => !value)} className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Edit group name"><Edit3 className="h-3.5 w-3.5 sm:h-4 sm:w-4" /></button>}
                            </div>
                            {canManageGroup && infoDirty && (
                              <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-3 sm:gap-2">
                                <button type="button" disabled={!infoDraft.name.trim()} onClick={saveGroupInfo} className="btn-primary h-8 w-8 justify-center p-0 text-xs disabled:opacity-50 sm:h-auto sm:w-auto sm:px-4 sm:py-2" aria-label="Save changes"><Check className="h-4 w-4" /><span className="hidden sm:inline">Save changes</span></button>
                                <button type="button" onClick={discardGroupInfoChanges} className="btn-secondary h-8 w-8 justify-center p-0 text-xs sm:h-auto sm:w-auto sm:px-4 sm:py-2" aria-label="Cancel changes"><X className="h-4 w-4" /><span className="hidden sm:inline">Cancel</span></button>
                              </div>
                            )}
                            <div className="mt-2 flex flex-wrap gap-1.5 sm:gap-2">
                              <span className="rounded-full bg-primary-500/15 px-2 py-0.5 text-[10px] font-semibold text-primary-100 sm:px-3 sm:py-1 sm:text-[11px]">{activeGroup.chatMode === 'admins_only' ? 'Admins only' : 'Everyone'}</span>
                              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-300 sm:px-3 sm:py-1 sm:text-[11px]">{Number(activeGroup.autoDeleteAfterHours || 0) ? autoDeleteLabel(activeGroup.autoDeleteAfterHours) : 'Auto-delete off'}</span>
                            </div>
                          </div>
                        </div>
                        {showGroupSettings && canManageGroup && (
                          <div className="mt-3 grid gap-2 sm:mt-4 sm:grid-cols-2 sm:gap-3">
                            {isPrivateGroup(activeGroup) && (
                              <div className="rounded-xl border border-primary-400/20 bg-primary-500/10 px-3 py-2 text-[11px] leading-4 text-primary-100 sm:col-span-2 sm:text-xs">
                                Private chat settings are shared by both members. Deleting this chat from your list only hides it for you; it will not remove messages or the chat for the other person.
                              </div>
                            )}
                            <select className="input-field h-9 text-xs sm:h-10 sm:text-sm" value={infoDraft.chatMode} onChange={e => setInfoDraft(current => ({ ...current, chatMode: e.target.value }))}>
                              <option value="everyone">Everyone can send</option>
                              <option value="admins_only">Only admins can send</option>
                            </select>
                            <select className="input-field h-9 text-xs sm:h-10 sm:text-sm" value={infoDraft.autoDeleteAfterHours} onChange={e => setInfoDraft(current => ({ ...current, autoDeleteAfterHours: e.target.value }))}>
                              <option value="0">Auto-delete off</option>
                              <option value="8">After 8 hours</option>
                              <option value="24">After 24 hours</option>
                              <option value="168">After 7 days</option>
                            </select>
                            {[
                              ['editInfo', 'Who can edit group info'],
                              ['addMembers', 'Who can add members'],
                              ['pinMessages', 'Who can pin or mark important'],
                            ].map(([key, label]) => (
                              <label key={key} className="grid gap-1 text-[11px] font-semibold text-slate-400 sm:text-xs">
                                <span>{label}</span>
                                <select className="input-field h-9 text-xs font-normal sm:h-10 sm:text-sm" value={infoDraft.permissions?.[key] || defaultPermissions[key]} onChange={event => setInfoDraft(current => ({ ...current, permissions: { ...(current.permissions || defaultPermissions), [key]: event.target.value } }))}>
                                  <option value="admins">Admins only</option>
                                  <option value="members">All members</option>
                                </select>
                              </label>
                            ))}
                            <label className="grid gap-1 text-[11px] font-semibold text-slate-400 sm:text-xs">
                              <span>Who can send messages</span>
                              <select
                                className="input-field h-9 text-xs font-normal sm:h-10 sm:text-sm"
                                value={infoDraft.chatMode === 'admins_only' ? 'admins' : 'members'}
                                onChange={event => setInfoDraft(current => ({
                                  ...current,
                                  chatMode: event.target.value === 'admins' ? 'admins_only' : 'everyone',
                                  permissions: { ...(current.permissions || defaultPermissions), sendMessages: event.target.value },
                                }))}
                              >
                                <option value="members">All members</option>
                                <option value="admins">Admins only</option>
                              </select>
                            </label>
                            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-200 sm:gap-3 sm:text-sm">
                              <input type="checkbox" checked={Boolean(infoDraft.inviteEnabled)} onChange={event => setInfoDraft(current => ({ ...current, inviteEnabled: event.target.checked }))} />
                              Enable invite code
                            </label>
                            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-200 sm:gap-3 sm:text-sm">
                              <input type="checkbox" checked={Boolean(infoDraft.hidePresence)} onChange={event => setInfoDraft(current => ({ ...current, hidePresence: event.target.checked }))} />
                              Hide my online and last seen
                            </label>
                            <button type="button" disabled={!infoDirty || !infoDraft.name.trim()} onClick={saveGroupInfo} className="btn-primary h-9 justify-center text-xs disabled:opacity-50 sm:h-auto sm:text-sm"><Check className="h-4 w-4" /><span>Save</span><span className="hidden sm:inline"> changes</span></button>
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:rounded-2xl sm:p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-xs font-semibold text-white sm:text-sm">Online and last seen</h3>
                            <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-slate-500 sm:mt-1 sm:text-xs">Hide your presence from other members in this room.</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => savePresencePrivacy(!infoDraft.hidePresence)}
                            className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-xs font-semibold sm:w-auto sm:px-3 sm:py-1.5 ${infoDraft.hidePresence ? 'bg-primary-500 text-white' : 'border border-white/10 text-slate-300 hover:bg-white/5'}`}
                            aria-label={infoDraft.hidePresence ? 'Presence hidden' : 'Presence visible'}
                          >
                            <Eye className="h-4 w-4 sm:hidden" />
                            <span className="hidden sm:inline">{infoDraft.hidePresence ? 'Hidden' : 'Visible'}</span>
                          </button>
                        </div>
                      </div>

                      {canManageGroup && (
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:rounded-2xl sm:p-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="flex items-center gap-2 text-xs font-semibold text-white sm:text-sm"><QrCode className="h-4 w-4 flex-shrink-0 text-primary-300" /> <span className="truncate">Invite link</span></h3>
                              <p className="mt-1 hidden text-xs text-slate-500 sm:block">Create a WhatsApp-style link or QR, then send it by student ID.</p>
                            </div>
                            <button type="button" onClick={loadInvite} className="btn-secondary inline-flex h-9 w-9 flex-shrink-0 items-center justify-center gap-2 p-0 text-xs sm:w-auto sm:min-w-[9.5rem] sm:px-3 sm:py-2" aria-label="Create invite">
                              <QrCode className="h-4 w-4" /> <span className="hidden sm:inline">Create invite</span>
                            </button>
                          </div>
                          {(activeInviteCode || invite?.inviteCode) && (
                            <div className="space-y-3">
                              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 sm:p-3">
                                <p className="text-[10px] uppercase tracking-wide text-slate-500 sm:text-xs">Invite link</p>
                                <p className="mt-1 break-all font-mono text-[10px] leading-4 text-primary-100 sm:text-xs">{activeInviteLink}</p>
                              </div>
                              <div className="grid gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 sm:grid-cols-3 sm:p-3">
                                <label className="grid gap-1 text-left">
                                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-[11px]">Expires at</span>
                                  <input type="datetime-local" className="input-field h-9 text-xs sm:h-10" value={inviteControls.expiresAt} onChange={event => setInviteControls(current => ({ ...current, expiresAt: event.target.value }))} />
                                </label>
                                <label className="grid gap-1 text-left">
                                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 sm:text-[11px]">Join limit</span>
                                  <input type="number" min="0" className="input-field h-9 text-xs sm:h-10" value={inviteControls.maxUses} onChange={event => setInviteControls(current => ({ ...current, maxUses: event.target.value }))} />
                                </label>
                                <label className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-left text-[11px] text-slate-200 sm:text-xs">
                                  <input type="checkbox" checked={inviteControls.requireApproval} onChange={event => setInviteControls(current => ({ ...current, requireApproval: event.target.checked }))} />
                                  Admin approval
                                </label>
                                <div className="grid gap-2 sm:col-span-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(12rem,2fr)]">
                                  <button type="button" onClick={saveInviteControls} className="btn-secondary inline-flex h-9 min-w-0 items-center justify-center gap-2 px-3 py-2 text-xs leading-none"><Check className="h-4 w-4 flex-shrink-0" /><span className="sm:hidden">Save</span><span className="hidden truncate sm:inline">Save controls</span></button>
                                  <button type="button" onClick={regenerateInviteLink} className="btn-danger inline-flex h-9 min-w-0 items-center justify-center gap-2 px-3 py-2 text-xs leading-none"><RotateCcw className="h-4 w-4 flex-shrink-0" /><span className="sm:hidden">Reset</span><span className="hidden truncate sm:inline">Reset invite link</span></button>
                                </div>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(6rem,auto)_minmax(6rem,auto)]">
                                <div className="relative">
                                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 sm:h-4 sm:w-4" />
                                  <input
                                    value={inviteRecipientSearch}
                                    onChange={event => setInviteRecipientSearch(event.target.value)}
                                    className="h-9 w-full rounded-xl border border-white/10 bg-white/5 pl-8 pr-3 text-xs text-white outline-none placeholder:text-slate-500 focus:border-primary-400/60 sm:h-10 sm:pl-9 sm:text-sm"
                                    placeholder="Search student ID to send"
                                  />
                                </div>
                                <button type="button" onClick={() => navigator.clipboard?.writeText(activeInviteLink).then(() => toast.success('Invite link copied'))} className="btn-secondary inline-flex h-9 min-w-0 items-center justify-center gap-2 px-3 py-2 text-xs leading-none sm:whitespace-nowrap" aria-label="Copy link">
                                  <LinkIcon className="h-4 w-4" /><span className="hidden sm:inline">Copy link</span><span className="sm:hidden">Copy</span>
                                </button>
                                <button type="button" onClick={() => setShowInviteQr(true)} className="btn-primary inline-flex h-9 min-w-0 items-center justify-center gap-2 px-3 py-2 text-xs leading-none sm:whitespace-nowrap" aria-label="Show QR">
                                  <QrCode className="h-4 w-4" /><span className="hidden sm:inline">Show QR</span><span className="sm:hidden">QR</span>
                                </button>
                              </div>
                              {inviteRecipientSearch.trim() && (
                                <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-white/10 p-2">
                                  {studentOptions
                                    .filter(student => String(student._id) !== String(user?._id))
                                    .filter(student => [student.name, student.studentId, student.email].some(value => String(value || '').toLowerCase().includes(inviteRecipientSearch.trim().toLowerCase())))
                                    .slice(0, 8)
                                    .map(student => (
                                      <button key={student._id} type="button" onClick={() => sendInviteToStudent(student)} disabled={inviteSendingId === student._id} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-white/5 disabled:opacity-60">
                                        <Avatar user={student} className="h-9 w-9" />
                                        <div className="min-w-0 flex-1">
                                          <p className="truncate text-sm text-white">{student.name}</p>
                                          <p className="font-mono text-xs text-slate-500">{student.studentId}</p>
                                        </div>
                                        <Send className="h-4 w-4 text-primary-300" />
                                      </button>
                                    ))}
                                  {!studentOptions.filter(student => [student.name, student.studentId, student.email].some(value => String(value || '').toLowerCase().includes(inviteRecipientSearch.trim().toLowerCase()))).length && (
                                    <p className="py-4 text-center text-xs text-slate-500">No eligible student found.</p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="mt-3">
                            <button type="button" onClick={loadJoinRequests} className="btn-secondary inline-flex h-9 w-full items-center justify-center gap-2 px-3 py-2 text-xs leading-none"><UserPlus className="h-4 w-4 flex-shrink-0" /><span className="hidden sm:inline">Load join requests</span><span className="sm:hidden">Requests</span></button>
                            {joinRequests.length > 0 && (
                              <div className="mt-2 space-y-1 rounded-xl border border-white/10 p-2">
                                {joinRequests.map(request => (
                                  <div key={request._id} className="flex items-center gap-2 rounded-xl bg-white/[0.03] p-2">
                                    <Avatar user={request.user} className="h-8 w-8" />
                                    <div className="min-w-0 flex-1 text-left">
                                      <p className="truncate text-sm text-white">{request.user?.name}</p>
                                      <p className="font-mono text-[11px] text-slate-500">{request.user?.studentId}</p>
                                    </div>
                                    <button type="button" onClick={() => reviewJoinRequest(request._id, 'rejected')} className="grid h-8 w-8 place-items-center rounded-lg text-red-200 hover:bg-red-500/10 sm:w-auto sm:px-2 sm:py-1" aria-label="Reject"><X className="h-4 w-4" /><span className="hidden sm:inline">Reject</span></button>
                                    <button type="button" onClick={() => reviewJoinRequest(request._id, 'approved')} className="grid h-8 w-8 place-items-center rounded-lg bg-primary-500 text-xs font-semibold text-white sm:w-auto sm:px-2 sm:py-1" aria-label="Approve"><Check className="h-4 w-4" /><span className="hidden sm:inline">Approve</span></button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:rounded-2xl sm:p-4">
                        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <h3 className="text-xs font-semibold text-white sm:text-sm">Media</h3>
                          <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
                            {[['images', 'Photos'], ['videos', 'Videos'], ['documents', 'Docs'], ['links', 'Links']].map(([key, label]) => (
                              <button key={key} type="button" onClick={() => loadGalleryInline(key)} className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold sm:px-3 sm:py-1.5 sm:text-xs ${galleryTab === key ? 'bg-primary-500/20 text-primary-100' : 'border border-white/10 text-slate-300 hover:bg-white/5'}`}>
                                {label} ({gallery?.[key]?.length || 0})
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-2">
                          {inlineGalleryItems.slice(0, 12).map((item, index) => (
                            galleryTab === 'links' ? (
                              <a key={`${galleryTab}-${index}`} href={(item.text || '').match(/https?:\/\/\S+/)?.[0]} target="_blank" rel="noreferrer" className="min-w-[11rem] max-w-[13rem] rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-[11px] text-primary-200 hover:bg-white/10 sm:min-w-[14rem] sm:max-w-[16rem] sm:p-3 sm:text-xs">
                                <LinkIcon className="mb-2 h-4 w-4" />
                                <span className="line-clamp-3">{item.text}</span>
                              </a>
                            ) : (
                              <a key={`${item.url}-${index}`} href={fileUrl(item.url)} target="_blank" rel="noreferrer" className="min-w-[7rem] max-w-[8rem] rounded-xl border border-white/10 bg-white/[0.03] p-2 text-[11px] text-slate-200 hover:bg-white/10 sm:min-w-[8.5rem] sm:max-w-[10rem] sm:text-xs">
                                {['image', 'gif'].includes(item.kind) ? <img src={fileUrl(item.url)} alt="" className="mb-2 h-20 w-full rounded-lg object-cover sm:h-24" /> : item.kind === 'video' ? <video src={fileUrl(item.url)} className="mb-2 h-20 w-full rounded-lg object-cover sm:h-24" /> : <FileText className="mb-2 h-5 w-5 text-primary-300" />}
                                <span className="line-clamp-2">{item.name || item.kind}</span>
                              </a>
                            )
                          ))}
                          {!inlineGalleryItems.length && <p className="min-w-full rounded-xl border border-dashed border-white/10 py-6 text-center text-xs text-slate-500">No items in this section yet.</p>}
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 sm:rounded-2xl sm:p-4">
                        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <h3 className="flex items-center gap-2 text-xs font-semibold text-white sm:text-sm"><Users className="h-4 w-4 text-primary-300" /> Members</h3>
                          <div className="relative sm:w-64">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                            <input
                              value={memberSearch}
                              onChange={event => setMemberSearch(event.target.value)}
                              placeholder="Search members"
                            className="h-9 w-full rounded-full border border-white/10 bg-white/5 pl-9 pr-3 text-xs text-white outline-none placeholder:text-slate-500 focus:border-primary-400/60"
                            />
                          </div>
                        </div>
                        <div className="max-h-[17.5rem] space-y-1 overflow-y-auto pr-1">
                          {sortedMembers.map(member => {
                            const mUser = memberUser(member);
                            const isMe = String(mUser?._id) === String(user?._id);
                            return (
                              <div key={mUser?._id} className="flex items-center gap-2 rounded-xl bg-white/[0.03] p-2 sm:gap-3">
                                <Avatar user={mUser} className="h-8 w-8 sm:h-9 sm:w-9" />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs text-white sm:text-sm">{displayUserName(member)} {isMe && <span className="text-slate-500">(You)</span>}</p>
                                  <p className="font-mono text-[10px] text-slate-500 sm:text-xs">{mUser?.studentId}</p>
                                </div>
                                {member.role === 'admin' && <span className="rounded-full bg-primary-500/15 px-2 py-1 text-[10px] font-semibold text-primary-200">Admin</span>}
                                <button type="button" onClick={() => { setNicknameDraft(localNicknames[String(mUser?._id)] || ''); setConfirmAction({ type: 'nickname', user: mUser }); }} className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg text-slate-300 hover:bg-white/10 sm:w-auto sm:px-2 sm:py-1 sm:text-xs" aria-label="Set nickname"><Edit3 className="h-4 w-4" /><span className="hidden sm:inline">Nickname</span></button>
                              </div>
                            );
                          })}
                          {!sortedMembers.length && <p className="rounded-xl border border-dashed border-white/10 py-6 text-center text-xs text-slate-500">No members match your search.</p>}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-row">
                        {canManageGroup && <button onClick={() => { setSelectedMembers([]); setShowAddMembers(true); setShowInfo(false); }} className="btn-secondary min-w-0 flex-1 justify-center px-2"><UserPlus className="h-4 w-4" /><span className="hidden sm:inline">Add members</span></button>}
                        <button onClick={() => setConfirmAction({ type: 'leave_group' })} className="btn-secondary min-w-0 flex-1 justify-center px-2 text-amber-200"><UserMinus className="h-4 w-4" /><span className="hidden sm:inline">Leave Room</span></button>
                        {isGroupAdmin && !isPrivateGroup(activeGroup) && <button onClick={() => setConfirmAction({ type: 'delete_group' })} className="btn-danger min-w-0 flex-1 justify-center px-2"><Trash2 className="h-4 w-4" /> <span className="hidden sm:inline">Delete</span></button>}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {!showInfo && (
                <>
              {!selectingMessages && selectedMessages.length === 0 && <header className="flex h-16 items-center justify-between gap-3 border-b border-white/10 bg-slate-950/95 px-4 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <button type="button" onClick={() => setActiveGroupId('')} className="rounded-full p-2 text-slate-300 hover:bg-white/10" aria-label="Close chat">
                    <ArrowLeft className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={() => { setShowInfo(true); loadGalleryInline('images'); }} className="flex min-w-0 items-center gap-3 rounded-xl px-1 py-1 text-left hover:bg-white/5" aria-label="Room info">
                  <GroupAvatar group={activeGroup} className="h-10 w-10" />
                  <div className="min-w-0">
                    <h2 className="min-w-0 text-[15px] font-semibold text-white">{renderMarqueeName(activeGroup.name, 'block min-w-0 max-w-full truncate')}</h2>
                    <p className="truncate text-xs text-slate-500">
                      {activeGroup.members?.length || 0} members - {activeOnlineMembers.length} online
                      {otherPrivateMember && !onlineUserIds.map(String).includes(String(otherPrivateMember._id)) && lastSeenByUserId[String(otherPrivateMember._id)] ? ` - last seen ${formatDateTime(lastSeenByUserId[String(otherPrivateMember._id)])}` : ''}
                      {' - '}{activeGroup.chatMode === 'admins_only' || activePermissions.sendMessages === 'admins' ? 'Only admins can send' : 'Everyone can send'}
                    </p>
                  </div>
                  </button>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {showMessageSearch && <div className="relative hidden w-56 sm:block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input value={messageSearch} onChange={event => setMessageSearch(event.target.value)} placeholder="Search" className="h-10 w-full rounded-full border border-white/10 bg-white/5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-primary-400/60" />
                  </div>}
                  {showMessageSearch && <select value={messageFilter} onChange={event => setMessageFilter(event.target.value)} className="hidden h-10 rounded-full border border-white/10 bg-slate-950 px-3 text-xs text-slate-200 outline-none sm:block">
                    <option value="">All</option>
                    <option value="media">Media</option>
                    <option value="documents">Docs</option>
                    <option value="links">Links</option>
                    <option value="starred">Starred</option>
                  </select>}
                  <div data-chat-popover className="relative">
                    <button type="button" onClick={() => setGroupMenuOpen(value => !value)} className="grid h-10 w-10 place-items-center rounded-full text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Chat options"><MoreVertical className="h-5 w-5" /></button>
                    {groupMenuOpen && (
                      <div className="absolute right-0 top-11 z-30 w-52 rounded-2xl border border-white/10 bg-slate-950 p-2 shadow-2xl">
                        <button type="button" onClick={() => { setShowInfo(true); loadGalleryInline('images'); setGroupMenuOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-100 hover:bg-white/10">
                          <Info className="h-4 w-4 text-primary-300" /> Group info
                        </button>
                        <button type="button" onClick={() => { setSelectingMessages(true); setSelectedMessages([]); setGroupMenuOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-100 hover:bg-white/10">
                          <Check className="h-4 w-4 text-primary-300" /> Select messages
                        </button>
                        {lockedGroups[String(activeGroup._id)]?.code ? (
                          <button type="button" onClick={() => unlockChat(activeGroup._id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-100 hover:bg-white/10">
                            <Lock className="h-4 w-4 text-amber-300" /> Unlock chat
                          </button>
                        ) : (
                          <button type="button" onClick={() => openLockChat(activeGroup)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-100 hover:bg-white/10">
                            <Lock className="h-4 w-4 text-amber-300" /> Lock chat
                          </button>
                        )}
                        <button type="button" onClick={() => toggleArchiveChat(activeGroup._id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-100 hover:bg-white/10">
                          <Archive className="h-4 w-4 text-slate-300" /> {archivedGroupIds.has(String(activeGroup._id)) ? 'Unarchive chat' : 'Archive chat'}
                        </button>
                        <div className="my-1 border-t border-white/10" />
                        <button type="button" onClick={openGallery} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-100 hover:bg-white/10">
                          <GalleryHorizontal className="h-4 w-4 text-primary-300" /> Media gallery
                        </button>
                        {canManageGroup && (
                          <button type="button" onClick={() => { loadInvite(); setGroupMenuOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-100 hover:bg-white/10">
                            <QrCode className="h-4 w-4 text-primary-300" /> Invite QR
                          </button>
                        )}
                        <button type="button" onClick={() => { setShowMessageSearch(value => !value); setGroupMenuOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-100 hover:bg-white/10">
                          <Search className="h-4 w-4 text-primary-300" /> Search
                        </button>
                        <button type="button" onClick={() => { setConfirmAction({ type: 'clear_chat' }); setGroupMenuOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-red-200 hover:bg-red-500/10">
                          <Trash2 className="h-4 w-4" /> Clear chat
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </header>}

              {(selectingMessages || selectedMessages.length > 0) && (
                <header className="relative flex h-14 items-center justify-between border-b border-white/10 bg-slate-950/95 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={cancelMessageSelection} className="rounded-xl p-2 text-slate-200 hover:bg-white/10" aria-label="Back"><ArrowLeft className="h-5 w-5" /></button>
                    <span className="text-lg font-semibold text-white">{selectedMessages.length}</span>
                    <button type="button" onClick={cancelMessageSelection} className="rounded-xl p-2 text-slate-300 hover:bg-white/10" aria-label="Cancel selection"><X className="h-5 w-5" /></button>
                  </div>
                  <div className="flex items-center gap-1">
                    {singleSelectedMessage && <button type="button" onClick={() => { setReplyTo(singleSelectedMessage); setSelectedMessages([]); }} className="rounded-xl p-2 text-slate-200 hover:bg-white/10" aria-label="Reply"><CornerUpLeft className="h-5 w-5" /></button>}
                    <button type="button" disabled={!selectedMessages.length} onClick={starSelected} className="rounded-xl p-2 text-slate-200 hover:bg-white/10 disabled:opacity-40" aria-label="Star"><Star className="h-5 w-5" /></button>
                    <button type="button" disabled={!selectedMessages.length} onClick={() => openDeleteConfirm(selectedMessageRows)} className="rounded-xl p-2 text-red-200 hover:bg-red-500/10 disabled:opacity-40" aria-label="Delete"><Trash2 className="h-5 w-5" /></button>
                    {singleSelectedMessage && <button type="button" onClick={() => setForwardMessage(singleSelectedMessage)} className="rounded-xl p-2 text-slate-200 hover:bg-white/10" aria-label="Forward"><Forward className="h-5 w-5" /></button>}
                    {singleSelectedMessage && <button type="button" onClick={() => { setMobileMoreOpen(value => !value); setActionMessage(singleSelectedMessage); }} className="grid h-10 w-10 place-items-center rounded-xl text-slate-200 hover:bg-white/10" aria-label="More"><MoreVertical className="h-5 w-5" /></button>}
                  </div>
                  {mobileMoreOpen && singleSelectedMessage && (
                    <div data-chat-popover className="absolute right-3 top-12 z-20 w-48 rounded-xl border border-white/10 bg-slate-950 p-1 shadow-2xl">
                      <button type="button" onClick={() => openPinConfirm(singleSelectedMessage)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10"><Pin className="h-4 w-4" /> Pin</button>
                      <button type="button" onClick={() => toggleImportant(singleSelectedMessage)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10"><Flag className="h-4 w-4" /> {singleSelectedMessage.isImportant ? 'Remove important' : 'Important'}</button>
                      <button type="button" onClick={() => showReceipts(singleSelectedMessage)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/10"><Eye className="h-4 w-4" /> Info</button>
                    </div>
                  )}
                </header>
              )}

              {isMobile && singleSelectedMessage && (
                <div className="flex justify-center gap-2 border-b border-white/10 bg-slate-950/90 px-3 py-2">
                  {actionReactions.map(emoji => (
                    <button key={emoji} type="button" onClick={() => react(singleSelectedMessage, emoji)} className="grid h-9 w-9 place-items-center rounded-full bg-white/5 text-base hover:bg-white/10" aria-label="React">
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {isMobile && showMessageSearch && selectedMessages.length === 0 && (
                <div className="border-b border-white/10 bg-slate-950/90 px-3 py-2 md:hidden">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input value={messageSearch} onChange={event => setMessageSearch(event.target.value)} placeholder="Search messages" className="input-field h-10 pl-9 text-sm" />
                  </div>
                </div>
              )}

              {activePinned && (
                <button type="button" onClick={() => document.getElementById(`msg-${activePinned._id}`)?.scrollIntoView({ behavior: 'smooth' })} className="flex items-center gap-2 border-b border-primary-500/20 bg-primary-500/10 px-4 py-2 text-left text-xs text-primary-100">
                  <Pin className="h-4 w-4" /> <span className="truncate">{activePinned.text || activePinned.attachments?.[0]?.name || 'Pinned message'}</span>
                </button>
              )}

              <div ref={chatBodyRef} onScroll={handleChatBodyScroll} className="wa-chat-bg relative flex-1 overflow-y-auto p-3 sm:p-5">
                {messagesLoading ? (
                  <div className="space-y-4">{Array.from({ length: 8 }).map((_, index) => <SkeletonLine key={index} className={`h-12 rounded-2xl ${index % 2 ? 'ml-auto w-2/3' : 'w-3/4'}`} />)}</div>
                ) : visibleMessages.map((message, index) => {
                  const mine = String(message.sender?._id) === String(user?._id);
                  const previous = visibleMessages[index - 1];
                  const next = visibleMessages[index + 1];
                  const showDay = !previous || formatMessageDay(previous.createdAt) !== formatMessageDay(message.createdAt);
                  const showUnread = unreadDivider?.groupId === String(activeGroupId) && unreadDivider.messageId === message._id;
                  const swipeOffset = swipePreview.id === message._id ? swipePreview.offset : 0;
                  const nextSameSender = next?.type !== 'system' && String(next?.sender?._id || '') === String(message.sender?._id || '');
                  const showIncomingAvatar = !mine && message.type !== 'system' && !nextSameSender;
                  const openActionsAbove = index >= visibleMessages.length - 2;
                  const isSelected = selectedMessages.includes(message._id);
                  if (message.type === 'system') {
                    return (
                      <React.Fragment key={message._id}>
                        {showDay && (
                          <div className="sticky top-2 z-10 my-3 flex justify-center">
                            <span className="rounded-full border border-white/10 bg-slate-950/85 px-3 py-1 text-[11px] font-semibold text-slate-300 shadow-lg backdrop-blur">{formatMessageDay(message.createdAt)}</span>
                          </div>
                        )}
                        {showUnread && (
                          <div className="sticky top-10 z-10 my-3 flex justify-center">
                            <span className="rounded-full bg-slate-950/90 px-3 py-1 text-[11px] font-semibold text-white shadow-xl">{unreadDivider.count} unread message{unreadDivider.count === 1 ? '' : 's'}</span>
                          </div>
                        )}
                        <div className="my-3 text-center text-xs text-slate-500"><span className="rounded-full bg-white/5 px-3 py-1">{message.text}</span></div>
                      </React.Fragment>
                    );
                  }
                  return (
                    <React.Fragment key={message._id}>
                      {showDay && (
                        <div className="sticky top-2 z-10 my-3 flex justify-center">
                          <span className="rounded-full border border-white/10 bg-slate-950/85 px-3 py-1 text-[11px] font-semibold text-slate-300 shadow-lg backdrop-blur">{formatMessageDay(message.createdAt)}</span>
                        </div>
                      )}
                      {showUnread && (
                        <div className="sticky top-10 z-10 my-3 flex justify-center">
                          <span className="rounded-full bg-slate-950/90 px-3 py-1 text-[11px] font-semibold text-white shadow-xl">{unreadDivider.count} unread message{unreadDivider.count === 1 ? '' : 's'}</span>
                        </div>
                      )}
                      <div
                        id={`msg-${message._id}`}
                        onPointerDown={event => handleMessagePointerDown(event, message)}
                        onPointerMove={event => handleMessagePointerMove(event, message)}
                        onPointerUp={event => handleMessagePointerUp(event, message)}
                        onPointerCancel={() => {
                          window.clearTimeout(longPressRef.current);
                          setTouchStart(null);
                          setSwipePreview({ id: '', offset: 0 });
                        }}
                        className={`group/message relative -mx-2 mb-2 flex items-start gap-2 rounded-xl px-2 py-1 transition-colors ${isSelected ? 'bg-primary-500/15 ring-1 ring-primary-300/30' : 'hover:bg-white/[0.02]'} ${mine ? 'justify-end' : 'justify-start'}`}
                      >
                      {swipeOffset > 8 && (
                        <span className={`absolute left-8 top-1/2 z-0 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-primary-500/20 text-primary-200 transition-opacity`}>
                          <CornerUpLeft className="h-4 w-4 scale-x-[-1]" />
                        </span>
                      )}
                      {!mine && (
                        showIncomingAvatar
                          ? <Avatar user={message.sender} className="mt-1 h-8 w-8" />
                          : <span className="mt-1 h-8 w-8 flex-shrink-0" aria-hidden="true" />
                      )}
                      {!isMobile && mine && !message.isDeletedForMe && message.type !== 'system' && renderHoverControls(message, 'left')}
                      {!isMobile && (selectingMessages || selectedMessages.length > 0) && (
                        <button
                          type="button"
                          onClick={() => toggleMessageSelection(message)}
                          className={`mt-3 grid h-5 w-5 flex-shrink-0 place-items-center rounded border ${isSelected ? 'border-primary-300 bg-primary-500 text-white' : 'border-white/20 bg-slate-950/80 text-transparent hover:text-slate-400'}`}
                          aria-label="Select message"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <div
                        id={`chat-message-${message._id}`}
                        onClick={() => (selectingMessages || selectedMessages.length) ? toggleMessageSelection(message) : null}
                        role="button"
                        tabIndex={0}
                        style={swipeOffset ? { transform: `translateX(${swipeOffset}px)` } : undefined}
                        className={`relative max-w-[78%] touch-pan-y cursor-pointer rounded-lg border px-2.5 py-1 pr-7 text-left shadow transition-transform duration-150 ease-out sm:max-w-[64%] sm:px-3 sm:py-1.5 sm:pr-8 ${isSelected || highlightedMessageId === String(message._id) ? 'ring-2 ring-primary-300' : ''} ${highlightedMessageId === String(message._id) ? 'bg-primary-500/30' : ''} ${mine ? 'border-primary-400/20 bg-primary-500/20 text-white' : 'border-white/10 bg-slate-900/95 text-slate-100'}`}
                      >
                        {!isMobile && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setActionMessage(actionMessage?._id === message._id ? null : message);
                              setHoverReactionMessage(null);
                            }}
                            className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-sm bg-slate-950/50 text-slate-300 opacity-0 transition-opacity hover:bg-white/10 hover:text-white group-hover/message:opacity-100"
                            aria-label="Message options"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        )}
                        {actionMessage?._id === message._id && !isMobile && renderMessageActionMenu(message, openActionsAbove)}
                        {!mine && (
                          <div className="mb-1 flex items-center gap-2 text-xs">
                            <span className="font-semibold text-primary-200">{displayNameForUser(message.sender)}</span>
                            <span className="font-mono text-slate-500">{message.sender?.studentId}</span>
                          </div>
                        )}
                        {message.replyTo && (
                          <button type="button" onClick={(event) => { event.stopPropagation(); jumpToMessage(message.replyTo?._id); }} className="mb-2 block w-full rounded-lg border-l-2 border-primary-300 bg-white/5 px-2 py-1 text-left text-xs text-slate-400 hover:bg-white/10">
                            {message.replyTo?.sender?.name && <p className="font-semibold text-slate-300">{displayNameForUser(message.replyTo.sender)}</p>}
                            <p className="line-clamp-2">{message.replyTo.isDeleted ? 'Deleted message' : (message.replyTo.text || message.replyTo.attachments?.[0]?.name || 'Media')}</p>
                          </button>
                        )}
                        {message.isDeletedForMe ? <p className="text-sm italic text-slate-500">This message is deleted</p> : message.isDeleted ? <p className="text-sm italic text-slate-500">{String(message.deletedBy) === String(user?._id) || String(message.deletedBy?._id) === String(user?._id) ? 'This message is deleted from everyone' : 'This message was deleted'}</p> : (
                          <>
                            {message.isForwarded && <p className="mb-1 text-[11px] italic text-slate-400">Forwarded</p>}
                            {message.type === 'poll' ? renderPoll(message) : message.text && renderMessageText(message)}
                            {(message.attachments || []).map(attachment => renderAttachment(attachment, message))}
                          </>
                        )}
                        <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500">
                          {message.isPinned && <Pin className="h-3 w-3 text-primary-300" />}
                          {message.editedAt && <span>edited</span>}
                          <span>{formatTime(message.createdAt)}</span>
                          {message.uploadState === 'uploading' && <span className="text-primary-200">sending</span>}
                          {message.uploadState === 'failed' && <span className="text-red-200">failed</span>}
                          {mine && ((message.readBy || []).length > 1 ? <CheckCheck className="h-3 w-3 text-sky-300" /> : <Check className="h-3 w-3 text-primary-300" />)}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1">
                          {Object.entries(message.reactions || {}).map(([emoji, users]) => (
                            <button key={emoji} onClick={() => react(message, emoji)} className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white">{emoji} {users.length}</button>
                          ))}
                          {message.isStarredByMe && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                              <Star className="h-3 w-3 fill-amber-300 text-amber-300" /> Starred
                            </span>
                          )}
                          {message.isImportant && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-400/10 px-2 py-0.5 text-[10px] font-semibold text-rose-100">
                              <Flag className="h-3 w-3 text-rose-200" /> Important
                            </span>
                          )}
                        </div>
                      </div>
                      {!isMobile && !mine && !message.isDeletedForMe && message.type !== 'system' && renderHoverControls(message, 'right')}
                      </div>
                    </React.Fragment>
                  );
                })}
                {Object.values(typingUsers).some(Boolean) && (
                  <p className="px-2 text-xs text-primary-300">
                    {Object.values(typingUsers).includes('recording')
                      ? `${(activeGroup.members || []).map(memberUser).find(member => typingUsers[String(member?._id)] === 'recording')?.name || 'Someone'} is recording audio...`
                      : `${(activeGroup.members || [])
                        .map(memberUser)
                        .filter(member => typingUsers[String(member?._id)])
                        .map(member => member?.name)
                        .filter(Boolean)
                        .slice(0, 2)
                        .join(', ') || 'Someone'} is typing...`}
                  </p>
                )}
                <div ref={endRef} />
              </div>

              {showScrollBottom && (
                <button
                  type="button"
                  onClick={() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
                  className="absolute bottom-24 right-5 z-20 grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-slate-950/90 text-primary-200 shadow-2xl backdrop-blur hover:bg-white/10"
                  aria-label="Go to latest message"
                >
                  <ArrowDown className="h-5 w-5" />
                </button>
              )}

              {(replyTo || editing || files.length > 0) && (
                <div className="border-t border-white/10 bg-slate-950/80 px-4 py-2 text-xs text-slate-300">
                  {replyTo && <button onClick={() => setReplyTo(null)} className="mr-2 rounded-lg bg-white/5 px-2 py-1">Replying to {displayNameForUser(replyTo.sender) || 'message'} x</button>}
                  {editing && <button onClick={() => { setEditing(null); setText(''); }} className="mr-2 rounded-lg bg-white/5 px-2 py-1">Editing message x</button>}
                  {files.map(file => <span key={file.name} className="mr-2 inline-flex rounded-lg bg-white/5 px-2 py-1">{file.name} · {formatBytes(file.size)}</span>)}
                  {files.length > 0 && <button type="button" onClick={() => { setFiles([]); setAttachmentMediaType(''); attachmentMediaTypeRef.current = ''; setUploadError(''); setLastFailedSend(null); }} className="text-red-300">clear</button>}
                </div>
              )}

              {uploadError && (
                <div className="border-t border-white/10 bg-slate-950/85 px-4 py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-red-100">
                    <span>{uploadError}</span>
                    {lastFailedSend && files.length > 0 && <button type="submit" form="chat-composer-form" className="rounded-lg bg-red-400/20 px-3 py-1 font-semibold hover:bg-red-400/30">Retry</button>}
                  </div>
                </div>
              )}

              {scheduledFor && (
                <div className="border-t border-white/10 bg-slate-950/80 px-4 py-2 text-xs text-primary-200">
                  <button type="button" onClick={() => setScheduledFor('')} className="rounded-lg bg-primary-500/10 px-2 py-1">
                    Scheduled for {new Date(scheduledFor).toLocaleString()} x
                  </button>
                </div>
              )}

              <form id="chat-composer-form" onSubmit={sendMessage} className="border-t border-white/10 bg-slate-900/95 p-3">
                {!canSend && <p className="mb-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-200">Only group admins can send messages in this room.</p>}
                {mentionState.open && canSend && (
                  <div data-chat-popover className="mb-2 max-h-64 overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-2xl backdrop-blur">
                    {mentionParticipants.map((participant, index) => (
                      <button
                        key={participant._id}
                        type="button"
                        onMouseDown={event => event.preventDefault()}
                        onClick={() => insertMention(participant)}
                        className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors ${index === mentionState.activeIndex ? 'bg-primary-500/20' : 'hover:bg-white/10'}`}
                      >
                        <Avatar user={participant} className="h-9 w-9" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-white">{displayNameForUser(participant)}</p>
                          <p className="truncate font-mono text-xs text-slate-500">{participant.studentId || participant.email || 'Participant'}</p>
                        </div>
                        <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-semibold text-primary-100">@</span>
                      </button>
                    ))}
                    {!mentionParticipants.length && (
                      <p className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-xs text-slate-500">No participant found.</p>
                    )}
                  </div>
                )}
                <div className="flex min-h-14 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2 py-1.5 shadow-inner">
                  <div data-chat-popover className="relative flex-shrink-0">
                    <button type="button" disabled={!canSend} onClick={() => setAttachmentMenuOpen(value => !value)} className="grid h-10 w-10 place-items-center rounded-full text-slate-300 hover:bg-white/10 disabled:opacity-50" aria-label="Attach">
                      <Plus className="h-6 w-6" />
                    </button>
                    {attachmentMenuOpen && (
                      <div className="absolute bottom-14 left-0 z-20 w-56 rounded-2xl border border-white/10 bg-slate-950 p-2 shadow-2xl">
                        <button type="button" onClick={() => openAttachmentPicker('image/*,video/*')} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-100 hover:bg-white/10"><GalleryHorizontal className="h-4 w-4 text-fuchsia-300" /> Photos & Videos</button>
                        <button type="button" onClick={() => openAttachmentPicker('.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,application/pdf,text/*')} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-100 hover:bg-white/10"><FileText className="h-4 w-4 text-sky-300" /> Document</button>
                        <button type="button" onClick={() => { setShowPoll(true); setAttachmentMenuOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-100 hover:bg-white/10"><BarChart3 className="h-4 w-4 text-emerald-300" /> Poll</button>
                        <button type="button" onClick={() => { setShowQuickReplies(true); setAttachmentMenuOpen(false); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-100 hover:bg-white/10"><Edit3 className="h-4 w-4 text-indigo-300" /> Quick replies</button>
                        <button type="button" onClick={startVoice} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-100 hover:bg-white/10"><Mic className="h-4 w-4 text-rose-300" /> Voice note</button>
                        <button type="button" onClick={() => { setAttachmentMenuOpen(false); setScheduleDraft(scheduledFor || ''); setShowScheduleModal(true); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-100 hover:bg-white/10"><Clock className="h-4 w-4 text-amber-300" /> Schedule</button>
                      </div>
                    )}
                    <input ref={attachmentInputRef} type="file" multiple accept={attachmentAccept} className="hidden" onChange={handleAttachmentFiles} />
                  </div>
                  {recording ? (
                    <div className="flex min-h-11 flex-1 items-center gap-3 rounded-full border border-red-400/20 bg-red-500/10 px-3 text-sm text-red-100">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-300" />
                      <span className="font-mono text-xs">{formatDuration(recordingSeconds)}</span>
                      <div className="flex flex-1 items-center gap-1">
                        {[10, 18, 26, 14, 22, 30, 16, 24, 12].map((height, index) => (
                          <span key={index} className="w-1 animate-pulse rounded-full bg-red-200/70" style={{ height: `${height}px`, animationDelay: `${index * 70}ms` }} />
                        ))}
                      </div>
                      <button type="button" onClick={() => stopVoice(true)} className="rounded-full px-2 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10">Cancel</button>
                      <button type="button" onClick={() => stopVoice(false)} className="rounded-full bg-red-400/20 px-3 py-1 text-xs font-semibold text-red-50 hover:bg-red-400/30">Done</button>
                    </div>
                  ) : (
                    <>
                      <div data-chat-popover className="relative flex-shrink-0">
                        {showEmojiPicker && (
                          <div className="absolute bottom-12 left-0 z-40 w-[min(21rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-slate-950/98 shadow-2xl backdrop-blur-xl">
                            <div className="flex gap-1 overflow-x-auto border-b border-white/10 p-2 [scrollbar-width:thin]">
                              {emojiCategories.map(category => (
                                <button
                                  key={category.id}
                                  type="button"
                                  onClick={() => setEmojiCategory(category.id)}
                                  className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl text-lg transition-colors ${emojiCategory === category.id ? 'bg-primary-500/20' : 'hover:bg-white/10'}`}
                                  title={category.label}
                                  aria-label={category.label}
                                >
                                  {category.icon}
                                </button>
                              ))}
                            </div>
                            <div className="max-h-60 overflow-y-auto p-2 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.35)_transparent]">
                              <div className="grid grid-cols-8 gap-1 sm:grid-cols-10">
                                {(emojiCategories.find(category => category.id === emojiCategory)?.items || emojiCategories[0].items).map((emoji, index) => (
                                  <button
                                    key={`${emoji}-${index}`}
                                    type="button"
                                    onClick={() => insertEmoji(emoji)}
                                    className="grid h-9 w-9 place-items-center rounded-xl text-xl leading-none transition-transform hover:scale-110 hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                                    aria-label={`Insert ${emoji}`}
                                  >
                                    <span className="font-emoji text-[22px] leading-none">{emoji}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={!canSend}
                          onClick={() => { setShowEmojiPicker(value => !value); setAttachmentMenuOpen(false); }}
                          className={`grid h-10 w-10 place-items-center rounded-full transition-colors disabled:opacity-50 ${showEmojiPicker ? 'bg-primary-500/20 text-primary-100' : 'text-slate-300 hover:bg-white/10'}`}
                          aria-label="Emoji"
                          aria-expanded={showEmojiPicker}
                        >
                          <Smile className="h-5 w-5" />
                        </button>
                      </div>
                      <textarea
                        ref={composerInputRef}
                        value={text}
                        disabled={!canSend || sending}
                        onChange={event => emitTyping(event.target.value, event.target.selectionStart)}
                        onClick={event => updateMentionStateFromInput(event.currentTarget.value, event.currentTarget.selectionStart)}
                        onKeyUp={event => updateMentionStateFromInput(event.currentTarget.value, event.currentTarget.selectionStart)}
                        onKeyDown={handleComposerKeyDown}
                        placeholder="Type a message"
                        rows={1}
                        className="max-h-28 min-h-10 flex-1 resize-none border-0 bg-transparent px-1 py-2.5 text-sm text-white outline-none placeholder:text-slate-500"
                      />
                    </>
                  )}
                  <button
                    type={text.trim() || files.length ? 'submit' : 'button'}
                    disabled={!canSend || sending || recording}
                    onClick={(event) => {
                      if (!text.trim() && files.length === 0) {
                        event.preventDefault();
                        startVoice();
                      }
                    }}
                    className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-full transition-colors disabled:opacity-50 ${text.trim() || files.length ? 'bg-primary-500 text-white hover:bg-primary-600' : 'text-slate-300 hover:bg-white/10'}`}
                    aria-label={text.trim() || files.length ? 'Send message' : 'Record voice note'}
                  >
                    {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : (text.trim() || files.length ? <Send className="h-5 w-5" /> : <Mic className="h-5 w-5" />)}
                  </button>
                </div>
              </form>
                </>
              )}
            </>
          ) : (
            <div className="grid h-full place-items-center p-8 text-center text-slate-500">
              <div>
                <Users className="mx-auto mb-3 h-12 w-12 text-slate-700" />
                <h2 className="text-lg font-semibold text-white">Select or create a room</h2>
                <p className="mt-1 text-sm">Your private semester groups will appear here.</p>
              </div>
            </div>
          )}
        </section>
      </div>

      <FeaturePanel open={showCreate} title="Create Room" onClose={() => setShowCreate(false)}>
        <form onSubmit={handleCreateGroup} className="space-y-4">
          <input className="input-field" placeholder="Group name" value={groupForm.name} onChange={e => setGroupForm({ ...groupForm, name: e.target.value })} required />
          <textarea className="input-field min-h-20" placeholder="Description optional" value={groupForm.description} onChange={e => setGroupForm({ ...groupForm, description: e.target.value })} />
          <select className="input-field" value={groupForm.chatMode} onChange={e => setGroupForm({ ...groupForm, chatMode: e.target.value })}>
            <option value="everyone">Everyone can send</option>
            <option value="admins_only">Only admins can send</option>
          </select>
          <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-200">
            <input type="checkbox" checked={groupForm.addAll} onChange={e => setGroupForm({ ...groupForm, addAll: e.target.checked })} />
            Add all students of my semester
          </label>
          {!groupForm.addAll && (
            <div>
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input className="input-field pl-9" placeholder="Search by name or student ID" value={studentSearch} onChange={e => setStudentSearch(e.target.value)} />
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-white/10 p-2">
                {studentOptions.map(student => (
                  <button key={student._id} type="button" onClick={() => {
                    setSelectedMembers(current => selectedIds.has(student._id) ? current.filter(item => item._id !== student._id) : [...current, student]);
                  }} className={`flex w-full items-center gap-3 rounded-xl p-2 text-left ${selectedIds.has(student._id) ? 'bg-primary-500/15' : 'hover:bg-white/5'}`}>
                    <Avatar user={student} className="h-9 w-9" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-white">{student.name}</p>
                      <p className="font-mono text-xs text-slate-500">{student.studentId}</p>
                    </div>
                    {selectedIds.has(student._id) && <Check className="h-4 w-4 text-primary-300" />}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button className="btn-primary w-full" type="submit">Create Room</button>
        </form>
      </FeaturePanel>

      <FeaturePanel open={showPoll && Boolean(activeGroup)} title="Create Poll" onClose={() => setShowPoll(false)}>
        <form onSubmit={createPoll} className="space-y-4">
          <input className="input-field" placeholder="Poll question" value={pollForm.question} onChange={event => setPollForm(current => ({ ...current, question: event.target.value }))} required />
          <div className="space-y-2">
            {pollForm.options.map((option, index) => (
              <div key={index} className="flex gap-2">
                <input className="input-field" placeholder={`Option ${index + 1}`} value={option} onChange={event => setPollForm(current => ({ ...current, options: current.options.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} required />
                {pollForm.options.length > 2 && <button type="button" onClick={() => setPollForm(current => ({ ...current, options: current.options.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded-xl border border-white/10 px-3 text-red-200 hover:bg-red-500/10"><X className="h-4 w-4" /></button>}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setPollForm(current => ({ ...current, options: [...current.options, ''] }))} className="btn-secondary text-sm">Add option</button>
            <label className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200">
              <input type="checkbox" checked={pollForm.allowMultiple} onChange={event => setPollForm(current => ({ ...current, allowMultiple: event.target.checked }))} />
              Multiple choices
            </label>
          </div>
          <label className="grid gap-1">
            <span className="label mb-0">Close poll at optional</span>
            <input className="input-field" type="datetime-local" value={pollForm.closesAt} onChange={event => setPollForm(current => ({ ...current, closesAt: event.target.value }))} />
          </label>
          <button type="submit" className="btn-primary w-full">Post Poll</button>
        </form>
      </FeaturePanel>

      <FeaturePanel open={showQuickReplies && Boolean(activeGroup)} title="Quick Replies" onClose={() => setShowQuickReplies(false)}>
        <div className="space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <textarea className="input-field min-h-24 resize-none" value={quickReplyDraft} onChange={event => setQuickReplyDraft(event.target.value)} placeholder={text.trim() ? 'Edit the current message before saving' : 'Write a saved reply'} />
            <button type="button" onClick={saveQuickReply} disabled={!quickReplyDraft.trim() && !text.trim()} className="btn-primary mt-3 w-full justify-center disabled:opacity-50">Save quick reply</button>
          </div>
          <div className="space-y-2">
            {quickReplies.map(reply => (
              <div key={reply.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <button type="button" onClick={() => insertQuickReply(reply)} className="block w-full text-left text-sm leading-5 text-slate-100 hover:text-primary-100">{reply.text}</button>
                <button type="button" onClick={() => persistQuickReplies(current => current.filter(item => item.id !== reply.id))} className="mt-2 text-xs font-semibold text-red-300 hover:text-red-200">Delete</button>
              </div>
            ))}
            {!quickReplies.length && <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-sm text-slate-500">No saved replies yet.</p>}
          </div>
        </div>
      </FeaturePanel>

      <FeaturePanel open={showScheduleModal} title="Schedule Message" onClose={() => setShowScheduleModal(false)}>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!scheduleDraft) return;
            const selected = new Date(scheduleDraft);
            if (Number.isNaN(selected.getTime()) || selected.getTime() <= Date.now() + 30000) {
              toast.error('Choose a time at least 30 seconds from now');
              return;
            }
            setScheduledFor(scheduleDraft);
            setShowScheduleModal(false);
            toast.success('Message schedule added');
          }}
        >
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Send at</span>
            <input className="input-field" type="datetime-local" value={scheduleDraft} onChange={event => setScheduleDraft(event.target.value)} autoFocus />
          </label>
          <p className="text-xs leading-5 text-slate-500">Write the message or attach media after choosing a time. It will be sent automatically at the selected time.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="btn-secondary justify-center" onClick={() => { setScheduledFor(''); setScheduleDraft(''); setShowScheduleModal(false); }}>Clear schedule</button>
            <button type="submit" className="btn-primary justify-center">Set schedule</button>
          </div>
        </form>
      </FeaturePanel>

      <FeaturePanel open={showInviteQr && Boolean(activeGroup)} title="Invite QR" onClose={() => setShowInviteQr(false)}>
        <div className="space-y-4 text-center">
          <div className="mx-auto grid h-64 w-64 place-items-center rounded-3xl border border-white/10 bg-white p-4 shadow-2xl">
            {activeInviteCode ? (
              <div className="relative h-full w-full">
                {qrSources[qrImageSourceIndex] ? (
                  <img
                    src={qrSources[qrImageSourceIndex]}
                    alt="Room invite QR"
                    className="h-full w-full object-contain"
                    onError={() => setQrImageSourceIndex(index => Math.min(index + 1, qrSources.length))}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
                    <p className="break-all font-mono text-sm font-semibold text-slate-900">{activeInviteCode}</p>
                  </div>
                )}
                <div className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl border-4 border-white bg-primary-600 p-2 shadow-lg">
                  <img src="/favicon.svg" alt="StudySphere" className="h-full w-full object-contain" />
                </div>
              </div>
            ) : (
              <SkeletonLine className="h-28 w-28 rounded-xl bg-slate-200" />
            )}
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Invite code</p>
            <p className="mt-1 font-mono text-lg font-semibold text-primary-100">{activeInviteCode}</p>
            <p className="mt-2 break-all font-mono text-[11px] text-slate-500">{activeInviteLink}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(activeInviteCode || '');
                toast.success('Invite code copied');
              }}
              className="btn-secondary w-full justify-center"
            >
              Copy code
            </button>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(activeInviteLink || activeInviteCode || '');
                toast.success('Invite link copied');
              }}
              className="btn-primary w-full justify-center"
            >
              Copy link
            </button>
          </div>
        </div>
      </FeaturePanel>

      <QrScannerModal
        open={showQrScanner}
        onClose={() => setShowQrScanner(false)}
        onDetected={joinInviteCode}
      />

      <FeaturePanel open={showAddMembers && Boolean(activeGroup)} title="Add Members" onClose={() => setShowAddMembers(false)}>
        <div className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className="input-field pl-9" placeholder="Search by name or student ID" value={studentSearch} onChange={e => setStudentSearch(e.target.value)} />
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-white/10 p-2">
            {studentOptions.filter(student => !activeMemberIds.has(String(student._id))).map(student => (
              <button key={student._id} type="button" onClick={() => {
                setSelectedMembers(current => selectedIds.has(student._id) ? current.filter(item => item._id !== student._id) : [...current, student]);
              }} className={`flex w-full items-center gap-3 rounded-xl p-2 text-left ${selectedIds.has(student._id) ? 'bg-primary-500/15' : 'hover:bg-white/5'}`}>
                <Avatar user={student} className="h-9 w-9" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">{student.name}</p>
                  <p className="font-mono text-xs text-slate-500">{student.studentId}</p>
                </div>
                {selectedIds.has(student._id) && <Check className="h-4 w-4 text-primary-300" />}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!selectedMembers.length}
            onClick={async () => {
              try {
                const res = await chatAPI.addMembers(activeGroup._id, selectedMembers.map(member => member._id));
                setGroups(current => current.map(group => group._id === activeGroup._id ? res.data.group : group));
                setSelectedMembers([]);
                setShowAddMembers(false);
                toast.success('Members added');
              } catch (error) {
                toast.error(error.response?.data?.message || 'Could not add members');
              }
            }}
            className="btn-primary w-full disabled:opacity-50"
          >
            Add Selected Members
          </button>
        </div>
      </FeaturePanel>

      <FeaturePanel open={confirmAction?.type === 'pin'} title="Pin Message" onClose={() => setConfirmAction(null)}>
        <div className="space-y-3">
          <p className="text-sm text-slate-400">Choose how long this message should stay pinned.</p>
          {[
            ['always', 'Always'],
            ['7d', 'For 7 days'],
            ['8h', 'For 8 hours'],
          ].map(([value, label]) => (
            <button key={value} type="button" onClick={() => { pin(confirmAction.message, value); setConfirmAction(null); }} className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-slate-200 hover:bg-white/10">
              <Pin className="h-4 w-4 text-primary-300" /> {label}
            </button>
          ))}
        </div>
      </FeaturePanel>

      <Modal open={confirmAction?.type === 'delete'} title="Delete Message" onClose={() => setConfirmAction(null)}>
        <div className="space-y-3">
          <p className="text-sm text-slate-400">Delete {confirmAction?.messages?.length || 1} selected message{(confirmAction?.messages?.length || 1) === 1 ? '' : 's'}.</p>
          <button type="button" onClick={() => removeSelected('me')} className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-slate-200 hover:bg-white/10">
            <Trash2 className="h-4 w-4 text-amber-300" /> Delete from me
          </button>
          {selectedCanDeleteForEveryone && (
            <button type="button" onClick={() => removeSelected('everyone')} className="flex w-full items-center gap-3 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-left text-red-100 hover:bg-red-500/20">
              <Trash2 className="h-4 w-4" /> Delete from everyone
            </button>
          )}
        </div>
      </Modal>

      <FeaturePanel open={confirmAction?.type === 'lock_chat'} title={lockedGroups[String(confirmAction?.group?._id)]?.code ? 'Update Chat Lock' : 'Lock Chat'} onClose={() => { setConfirmAction(null); setLockDraft(''); }}>
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-sm font-semibold text-white">{confirmAction?.group?.name}</p>
            <p className="mt-1 text-xs text-slate-400">Set a case-sensitive secret code. To open this locked chat later, type the exact code in the chat search bar.</p>
          </div>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Secret code</span>
            <input
              className="input-field"
              value={lockDraft}
              onChange={event => setLockDraft(event.target.value)}
              placeholder="Case-sensitive code"
              autoFocus
            />
          </label>
          <div className="flex justify-end gap-2">
            {lockedGroups[String(confirmAction?.group?._id)]?.code && (
              <button type="button" onClick={() => unlockChat(confirmAction.group._id)} className="btn-secondary">Remove lock</button>
            )}
            <button type="button" onClick={() => { setConfirmAction(null); setLockDraft(''); }} className="btn-secondary">Cancel</button>
            <button type="button" onClick={saveLockedChat} className="btn-primary"><Lock className="h-4 w-4" /> Save lock</button>
          </div>
        </div>
      </FeaturePanel>

      <FeaturePanel open={confirmAction?.type === 'nickname'} title="Set Nickname" onClose={() => { setConfirmAction(null); setNicknameDraft(''); }}>
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <Avatar user={confirmAction?.user} className="h-12 w-12" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{confirmAction?.user?.name || 'Student'}</p>
              <p className="font-mono text-xs text-slate-500">{confirmAction?.user?.studentId}</p>
            </div>
          </div>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nickname visible only to you</span>
            <input
              className="input-field"
              value={nicknameDraft}
              onChange={event => setNicknameDraft(event.target.value)}
              placeholder={confirmAction?.user?.name || 'Nickname'}
              autoFocus
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => setNicknameDraft('')} className="btn-secondary justify-center">Clear</button>
            <button type="button" onClick={saveNickname} className="btn-primary justify-center">Save Nickname</button>
          </div>
        </div>
      </FeaturePanel>

      <CompactModal open={confirmAction?.type === 'delete_chat_list'} title="Delete Chat" onClose={() => setConfirmAction(null)}>
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-sm font-semibold text-white">{confirmAction?.group?.name}</p>
            <p className="mt-1 text-xs text-slate-400">
              {isPrivateGroup(confirmAction?.group)
                ? 'This removes the private chat from your list only. Other members and the messages are not deleted.'
                : 'This clears the group chat from your side only. The group name remains visible in your list.'}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmAction(null)} className="btn-secondary">Cancel</button>
            <button type="button" onClick={deleteChatFromList} className="btn-danger"><Trash2 className="h-4 w-4" /> Delete chat</button>
          </div>
        </div>
      </CompactModal>

      <Modal open={confirmAction?.type === 'clear_chat'} title="Clear Chat" onClose={() => setConfirmAction(null)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-400">This clears all messages from your side only. Other members will still keep their chat history.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmAction(null)} className="btn-secondary">Cancel</button>
            <button type="button" onClick={clearChatForMe} className="btn-danger"><Trash2 className="h-4 w-4" /> Clear chat</button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmAction?.type === 'leave_group'} title="Leave Room" onClose={() => setConfirmAction(null)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-400">You will stop receiving messages from this room. Your previous messages will remain visible to other members.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmAction(null)} className="btn-secondary">Cancel</button>
            <button type="button" onClick={leaveGroup} className="btn-secondary text-amber-200">Leave Room</button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmAction?.type === 'delete_group'} title="Delete Room" onClose={() => setConfirmAction(null)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-400">This permanently deletes the room for every member. This action cannot be undone.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmAction(null)} className="btn-secondary">Cancel</button>
            <button type="button" onClick={deleteGroup} className="btn-danger"><Trash2 className="h-4 w-4" /> Delete Room</button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmAction?.type === 'remove_member'} title="Remove Member" onClose={() => setConfirmAction(null)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Remove {memberUser(confirmAction?.member)?.name || 'this member'} from this room?
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmAction(null)} className="btn-secondary">Cancel</button>
            <button type="button" onClick={() => removeMember(confirmAction.member)} className="btn-danger"><UserMinus className="h-4 w-4" /> Remove</button>
          </div>
        </div>
      </Modal>

      <Modal open={confirmAction?.type === 'member_admin'} title={confirmAction?.isAdmin ? 'Make Group Admin' : 'Remove Admin'} onClose={() => setConfirmAction(null)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            {confirmAction?.isAdmin ? 'Give admin permissions to' : 'Remove admin permissions from'} {memberUser(confirmAction?.member)?.name || 'this member'}?
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmAction(null)} className="btn-secondary">Cancel</button>
            <button type="button" onClick={() => promote(confirmAction.member, confirmAction.isAdmin)} className="btn-primary">
              <ShieldCheck className="h-4 w-4" /> Confirm
            </button>
          </div>
        </div>
      </Modal>

      {undoDelete && createPortal(
        <div className="fixed bottom-5 left-1/2 z-[130] flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-slate-200 shadow-2xl">
          <span>Message deleted</span>
          <button type="button" onClick={undoDeleteForMe} className="font-semibold text-primary-300 hover:text-primary-200">Undo</button>
        </div>,
        document.body
      )}

      <FeaturePanel open={Boolean(fullScreenMedia)} title={fullScreenMedia?.name || 'Media'} onClose={() => setFullScreenMedia(null)} wide>
        <div className="wa-chat-bg flex min-h-[calc(100dvh-10rem)] items-center justify-center p-3">
          {fullScreenMedia?.kind === 'video' ? (
            <video src={fileUrl(fullScreenMedia?.url)} controls autoPlay className="max-h-[92dvh] max-w-full rounded-xl" />
          ) : (
            <img src={fileUrl(fullScreenMedia?.url)} alt={fullScreenMedia?.name || 'Media'} className="max-h-[92dvh] max-w-full rounded-xl object-contain" />
          )}
        </div>
      </FeaturePanel>

      <FeaturePanel open={Boolean(receipts)} title="Message Info" onClose={() => setReceipts(null)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><CheckCheck className="h-4 w-4 text-primary-300" /> Seen</h3>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {(receipts?.seen || []).map(item => (
                <div key={item.user?._id} className="flex items-center gap-2 rounded-xl bg-white/[0.03] p-2">
                  <Avatar user={item.user} className="h-8 w-8" />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{displayNameForUser(item.user)}</p>
                    <p className="text-[11px] text-slate-500">{formatDateTime(item.readAt)}</p>
                  </div>
                </div>
              ))}
              {!receipts?.seen?.length && <p className="text-sm text-slate-500">No seen receipts yet.</p>}
            </div>
          </div>
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Check className="h-4 w-4 text-slate-300" /> Delivered</h3>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {(receipts?.delivered || []).map(item => (
                <div key={item.user?._id} className="flex items-center gap-2 rounded-xl bg-white/[0.03] p-2">
                  <Avatar user={item.user} className="h-8 w-8" />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{displayNameForUser(item.user)}</p>
                    <p className="font-mono text-[11px] text-slate-500">{item.user?.studentId}</p>
                  </div>
                </div>
              ))}
              {!receipts?.delivered?.length && <p className="text-sm text-slate-500">Everyone has seen this message.</p>}
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Clock className="h-4 w-4 text-primary-300" /> Edit history</h3>
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {(receipts?.message?.editHistory || []).map((entry, index) => (
              <div key={`${entry.editedAt || index}`} className="rounded-xl bg-slate-950/60 p-2 text-xs">
                <p className="whitespace-pre-wrap text-slate-200">{entry.text || entry.previousText || 'No text'}</p>
                <p className="mt-1 text-[10px] text-slate-500">{formatDateTime(entry.editedAt || entry.createdAt)}{entry.editedBy?.name ? ` by ${displayNameForUser(entry.editedBy)}` : ''}</p>
              </div>
            ))}
            {!receipts?.message?.editHistory?.length && <p className="text-sm text-slate-500">No edits for this message.</p>}
          </div>
        </div>
      </FeaturePanel>

      <FeaturePanel open={Boolean(forwardMessage)} title="Forward To" onClose={() => setForwardMessage(null)}>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {groups.filter(group => group._id !== activeGroupId).map(group => (
            <button key={group._id} type="button" onClick={() => forwardToGroup(group._id)} className="flex w-full items-center gap-3 rounded-xl bg-white/[0.03] p-3 text-left hover:bg-white/10">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-primary-500/15 text-primary-200"><Users className="h-5 w-5" /></div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{group.name}</p>
                <p className="text-xs text-slate-500">{group.members?.length || 0} members</p>
              </div>
            </button>
          ))}
          {groups.filter(group => group._id !== activeGroupId).length === 0 && <p className="text-sm text-slate-500">No other rooms available.</p>}
        </div>
      </FeaturePanel>

      <FeaturePanel open={showBroadcast} title="Broadcast Message" onClose={() => setShowBroadcast(false)}>
        <form onSubmit={sendBroadcast} className="space-y-4">
          <textarea className="input-field min-h-28 resize-none" value={broadcastText} onChange={event => setBroadcastText(event.target.value)} placeholder="Write a broadcast message" />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className="input-field pl-9" placeholder="Search recipients" value={studentSearch} onChange={event => setStudentSearch(event.target.value)} />
          </div>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-white/10 p-2">
            {studentOptions.filter(student => String(student._id) !== String(user?._id)).map(student => {
              const selected = broadcastRecipients.some(item => item._id === student._id);
              return (
                <button key={student._id} type="button" onClick={() => setBroadcastRecipients(current => selected ? current.filter(item => item._id !== student._id) : [...current, student])} className={`flex w-full items-center gap-3 rounded-xl p-2 text-left ${selected ? 'bg-primary-500/15' : 'hover:bg-white/5'}`}>
                  <Avatar user={student} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white">{student.name}</p>
                    <p className="font-mono text-xs text-slate-500">{student.studentId}</p>
                  </div>
                  {selected && <Check className="h-4 w-4 text-primary-300" />}
                </button>
              );
            })}
          </div>
          <button type="submit" disabled={!broadcastText.trim() || !broadcastRecipients.length} className="btn-primary w-full justify-center disabled:opacity-50">Send Broadcast ({broadcastRecipients.length})</button>
        </form>
      </FeaturePanel>

      <FeaturePanel open={showStarred} title="Starred Messages" onClose={() => setShowStarred(false)}>
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {starredMessages.map(message => (
            <button key={message._id} type="button" onClick={() => { setShowStarred(false); setActiveGroupId(message.group); }} className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left hover:bg-white/10">
              <p className="line-clamp-2 text-sm text-white">{message.text || message.attachments?.[0]?.name || 'Media message'}</p>
              <p className="mt-1 text-xs text-slate-500">{formatDateTime(message.createdAt)}</p>
            </button>
          ))}
          {!starredMessages.length && <p className="py-8 text-center text-sm text-slate-500">No starred messages yet.</p>}
        </div>
      </FeaturePanel>

      <FeaturePanel open={showScheduledList} title="Scheduled Messages" onClose={() => setShowScheduledList(false)}>
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {scheduledMessages.map(message => (
            <div key={message._id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="line-clamp-2 text-sm text-white">{message.text || message.attachments?.[0]?.name || 'Scheduled media'}</p>
              <p className="mt-1 text-xs text-primary-200">Sends {formatDateTime(message.scheduledFor)}</p>
              <button type="button" onClick={() => cancelScheduled(message._id)} className="mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/10">Cancel</button>
            </div>
          ))}
          {!scheduledMessages.length && <p className="py-8 text-center text-sm text-slate-500">No scheduled messages.</p>}
        </div>
      </FeaturePanel>
    </div>
  );
}
