import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ArrowLeft, Play, Square, Copy, CheckCircle, XCircle, Key, Download, Trash2, GripVertical, CalendarDays, Filter, ShieldAlert, Lock, X, WifiOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { lectureAPI, attendanceAPI } from '../../services/api';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageSkeleton, CardSkeleton } from '../../components/LoadingStates';
import AppConfirmModal from '../../components/AppConfirmModal';
import { handleDeleteScheduled } from '../../utils/deleteUndo';
import { useSocket } from '../../context/SocketContext';

const toLocalDate = (value) => {
  if (!value) return new Date();
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(value);
};

const toDateInputValue = (value) => {
  const date = toLocalDate(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const isRestrictedProfile = (student = {}, subjectId) => Boolean(
  student?.isRestricted ||
  student?.status === 'restricted' ||
  (student?.subjectRestrictions || []).some(item => (
    item?.active !== false &&
    String(item.subject?._id || item.subject) === String(subjectId)
  ))
);

const profileFilterOptions = [
  { value: 'all', label: 'All Profiles' },
  { value: 'valid', label: 'Valid Profiles' },
  { value: 'restricted', label: 'Restricted Profiles' },
];

const OFFLINE_ATTENDANCE_QUEUE_KEY = 'studysphere_offline_attendance_queue_v1';

const readOfflineQueue = () => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(OFFLINE_ATTENDANCE_QUEUE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeOfflineQueue = (queue) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(OFFLINE_ATTENDANCE_QUEUE_KEY, JSON.stringify(queue));
};

const isNetworkFailure = (error) => !error?.response;

const getStudentStatus = (studentId, presentRows = [], absentRows = []) => {
  if (presentRows.some(item => String(item.student?._id) === String(studentId))) return 'present';
  if (absentRows.some(item => String(item._id) === String(studentId))) return 'absent';
  return 'unknown';
};

const calculateStats = (presentRows = [], absentRows = []) => {
  const present = presentRows.length;
  const absentCount = absentRows.length;
  const total = present + absentCount;
  return {
    total,
    present,
    absent: absentCount,
    percentage: total ? ((present / total) * 100).toFixed(1) : '0.0',
  };
};

export default function AdminLectureDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const [lecture, setLecture] = useState(null);
  const [attendance, setAttendance] = useState([]);
  const [absent, setAbsent] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [activeCode, setActiveCode] = useState(null);
  const [restartMinutes, setRestartMinutes] = useState('15');
  const [restartPromptOpen, setRestartPromptOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copySources, setCopySources] = useState([]);
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyingId, setCopyingId] = useState('');
  const [copyDate, setCopyDate] = useState(() => toDateInputValue());
  const [profileFilter, setProfileFilter] = useState('all');
  const [selectionMode, setSelectionMode] = useState(null);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [offlineQueue, setOfflineQueue] = useState(() => readOfflineQueue());
  const [syncingOfflineQueue, setSyncingOfflineQueue] = useState(false);

  const fetchData = async () => {
    try {
      const res = await lectureAPI.getAttendance(id);
      setLecture(res.data.lecture);
      setAttendance(res.data.attendance);
      setAbsent(res.data.absentStudents || []);
      setStats(res.data.stats);
    } catch { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [id]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const persistOfflineQueue = (nextQueue) => {
    setOfflineQueue(nextQueue);
    writeOfflineQueue(nextQueue);
  };

  const queueOfflineAttendanceChange = ({ studentIds, status, previousStatuses }) => {
    const ids = studentIds.map(String);
    const queuedItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      lectureId: String(id),
      lectureTitle: lecture?.title || 'Lecture',
      subjectName: lecture?.subject?.name || '',
      status,
      studentIds: ids,
      previousStatuses,
      queuedAt: new Date().toISOString(),
      state: 'pending',
    };
    persistOfflineQueue([...readOfflineQueue(), queuedItem]);
    toast.success(`Saved offline. ${ids.length} attendance change${ids.length === 1 ? '' : 's'} will sync automatically.`);
  };

  const applyLocalAttendanceStatus = (studentIds, status) => {
    const ids = new Set(studentIds.map(String));
    const now = new Date().toISOString();
    let nextPresent = [...attendance];
    let nextAbsent = [...absent];
    const studentMap = new Map();

    nextPresent.forEach(item => {
      if (item.student?._id) studentMap.set(String(item.student._id), item.student);
    });
    nextAbsent.forEach(student => {
      if (student?._id) studentMap.set(String(student._id), student);
    });

    if (status === 'present') {
      const existingPresentIds = new Set(nextPresent.map(item => String(item.student?._id)));
      nextAbsent = nextAbsent.filter(student => !ids.has(String(student._id)));
      ids.forEach(studentId => {
        if (!existingPresentIds.has(studentId)) {
          const student = studentMap.get(studentId);
          if (student) {
            nextPresent.push({
              _id: `offline-${studentId}-${Date.now()}`,
              student,
              status: 'present',
              faceConfidence: null,
              markedAt: now,
              createdAt: now,
              offlinePending: true,
            });
          }
        }
      });
    } else {
      nextPresent = nextPresent.filter(item => !ids.has(String(item.student?._id)));
      const existingAbsentIds = new Set(nextAbsent.map(student => String(student._id)));
      ids.forEach(studentId => {
        const student = studentMap.get(studentId);
        if (student && !existingAbsentIds.has(studentId)) nextAbsent.push(student);
      });
    }

    nextPresent.sort((a, b) => String(a.student?.name || '').localeCompare(String(b.student?.name || '')));
    nextAbsent.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    setAttendance(nextPresent);
    setAbsent(nextAbsent);
    setStats(calculateStats(nextPresent, nextAbsent));
  };

  const syncOfflineAttendanceQueue = async () => {
    const queue = readOfflineQueue();
    const pending = queue.filter(item => item.state !== 'conflict');
    if (!pending.length || syncingOfflineQueue || !isOnline) return;

    setSyncingOfflineQueue(true);
    const nextQueue = [...queue];
    let synced = 0;
    let conflicts = 0;

    for (const item of pending) {
      const itemIndex = nextQueue.findIndex(entry => entry.id === item.id);
      if (itemIndex < 0) continue;
      try {
        const latest = await lectureAPI.getAttendance(item.lectureId);
        const latestPresent = latest.data.attendance || [];
        const latestAbsent = latest.data.absentStudents || [];
        const activeStudentIds = [];
        const conflictedStudentIds = [];
        item.studentIds.forEach(studentId => {
          const currentStatus = getStudentStatus(studentId, latestPresent, latestAbsent);
          const previousStatus = item.previousStatuses?.[studentId] || 'unknown';
          if (currentStatus === item.status) return;
          if (currentStatus !== previousStatus) {
            conflictedStudentIds.push(studentId);
            return;
          }
          activeStudentIds.push(studentId);
        });

        if (!activeStudentIds.length) {
          if (conflictedStudentIds.length) {
            nextQueue[itemIndex] = {
              ...item,
              studentIds: conflictedStudentIds,
              previousStatuses: conflictedStudentIds.reduce((map, studentId) => {
                map[studentId] = item.previousStatuses?.[studentId] || 'unknown';
                return map;
              }, {}),
              state: 'conflict',
              conflictAt: new Date().toISOString(),
              message: 'Server attendance changed before this offline update could sync.',
            };
            conflicts += 1;
          } else {
            nextQueue.splice(itemIndex, 1);
            synced += 1;
          }
          continue;
        }

        await attendanceAPI.updateLectureStatus(item.lectureId, { studentIds: activeStudentIds, status: item.status });
        synced += 1;
        if (conflictedStudentIds.length) {
          nextQueue[itemIndex] = {
            ...item,
            studentIds: conflictedStudentIds,
            previousStatuses: conflictedStudentIds.reduce((map, studentId) => {
              map[studentId] = item.previousStatuses?.[studentId] || 'unknown';
              return map;
            }, {}),
            state: 'conflict',
            conflictAt: new Date().toISOString(),
            message: 'Some students changed on the server before this offline update could sync.',
          };
          conflicts += 1;
        } else {
          nextQueue.splice(itemIndex, 1);
        }
      } catch (error) {
        if (!isNetworkFailure(error)) {
          nextQueue[itemIndex] = {
            ...item,
            state: 'conflict',
            conflictAt: new Date().toISOString(),
            message: error.response?.data?.message || 'Server rejected this offline update.',
          };
          conflicts += 1;
        }
      }
    }

    persistOfflineQueue(nextQueue);
    setSyncingOfflineQueue(false);
    if (synced) {
      toast.success(`Synced ${synced} offline attendance update${synced === 1 ? '' : 's'}`);
      fetchData();
    }
    if (conflicts) toast.error(`${conflicts} offline attendance update${conflicts === 1 ? ' needs' : 's need'} review`);
  };

  useEffect(() => {
    if (isOnline && offlineQueue.some(item => item.state !== 'conflict')) {
      syncOfflineAttendanceQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, offlineQueue.length]);

  useEffect(() => {
    if (!socket) return undefined;
    const refreshCurrentLecture = (data = {}) => {
      if (!data.lectureId || String(data.lectureId) === String(id)) fetchData();
    };
    socket.on('attendance_updated', refreshCurrentLecture);
    socket.on('attendance_marked', refreshCurrentLecture);
    socket.on('lectures_changed', refreshCurrentLecture);
    socket.on('student_profile_changed', refreshCurrentLecture);
    return () => {
      socket.off('attendance_updated', refreshCurrentLecture);
      socket.off('attendance_marked', refreshCurrentLecture);
      socket.off('lectures_changed', refreshCurrentLecture);
      socket.off('student_profile_changed', refreshCurrentLecture);
    };
  }, [socket, id]);

  const handleStart = async (durationMinutes = null) => {
    setActionLoading(true);
    try {
      const res = await lectureAPI.startAttendance(id, durationMinutes ? { durationMinutes } : {});
      setActiveCode(res.data.code);
      toast.success(`Attendance started! Code: ${res.data.code}`, { duration: 10000 });
      fetchData();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setActionLoading(false); }
  };

  const handleRestart = () => {
    const minutes = Number(restartMinutes);
    if (!minutes || minutes < 1) {
      toast.error('Enter a valid restart duration');
      return;
    }
    handleStart(minutes);
    setRestartPromptOpen(false);
  };

  const handleStop = async () => {
    setActionLoading(true);
    try {
      await lectureAPI.stopAttendance(id);
      setActiveCode(null);
      toast.success('Attendance closed');
      fetchData();
    } catch { toast.error('Failed'); }
    finally { setActionLoading(false); }
  };

  const copyCode = () => {
    if (activeCode || lecture?.attendanceCode) {
      navigator.clipboard.writeText(activeCode || lecture.attendanceCode);
      toast.success('Code copied!');
    }
  };

  const downloadLectureAttendance = async () => {
    setDownloading(true);
    try {
      const res = await attendanceAPI.downloadLectureExcel(id);
      const url = URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Lecture_Attendance_${lecture.subject?.code || 'lecture'}_${Date.now()}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Lecture attendance downloaded');
    } catch (e) {
      const data = e.response?.data;
      if (data instanceof Blob) {
        try {
          const text = await data.text();
          const parsed = JSON.parse(text);
          toast.error(parsed.message || 'Download failed');
        } catch {
          toast.error('Download failed');
        }
      } else {
        toast.error(data?.message || 'Download failed');
      }
    } finally {
      setDownloading(false);
    }
  };

  const handleDeleteLecture = async () => {
    try {
      const res = await lectureAPI.delete(id);
      handleDeleteScheduled({ response: res, label: 'Lecture' });
      setDeleteModalOpen(false);
      navigate('/admin/lectures');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not schedule lecture delete');
    }
  };

  const openCopyModal = async () => {
    if (!lecture?.subject?._id) return;
    setCopyDate(toDateInputValue(lecture.date));
    setCopyModalOpen(true);
  };

  const loadCopySources = async (dateValue = copyDate) => {
    if (!lecture?._id) return;
    setCopyLoading(true);
    try {
      const res = await lectureAPI.getCopySources(id, { date: dateValue });
      setCopySources(res.data.sources || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not load source lectures');
    } finally {
      setCopyLoading(false);
    }
  };

  useEffect(() => {
    if (copyModalOpen) loadCopySources(copyDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copyModalOpen, copyDate]);

  const copyAttendanceFrom = async (sourceLectureId) => {
    setCopyingId(sourceLectureId);
    try {
      const res = await lectureAPI.copyAttendance(id, sourceLectureId);
      toast.success(res.data.message || 'Attendance copied');
      setCopyModalOpen(false);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not copy attendance');
    } finally {
      setCopyingId('');
    }
  };

  const applyAttendanceStatus = async (studentId, status) => {
    if (!studentId || editingStudent) return;
    const targetStudent = attendance.find(item => String(item.student?._id) === String(studentId))?.student
      || absent.find(item => String(item._id) === String(studentId));
    if (isRestrictedProfile(targetStudent, lecture?.subject?._id)) {
      toast.error('This profile is restricted. Attendance cannot be marked for this profile.');
      setDragTarget(null);
      return;
    }
    setEditingStudent(studentId);
    const previousStatuses = { [String(studentId)]: getStudentStatus(studentId, attendance, absent) };
    try {
      const res = await attendanceAPI.updateLectureStatus(id, { studentId, status });
      setLecture(res.data.lecture);
      setAttendance(res.data.attendance || []);
      setAbsent(res.data.absentStudents || []);
      setStats(res.data.stats);
      toast.success(status === 'present' ? 'Marked present' : 'Moved to absent');
    } catch (err) {
      if (isNetworkFailure(err)) {
        applyLocalAttendanceStatus([studentId], status);
        queueOfflineAttendanceChange({ studentIds: [studentId], status, previousStatuses });
      } else {
        toast.error(err.response?.data?.message || 'Could not update attendance');
      }
    } finally {
      setEditingStudent(null);
      setDragTarget(null);
    }
  };

  const startSelection = (mode) => {
    setSelectionMode(mode);
    setSelectedStudentIds([]);
    setDragTarget(null);
  };

  const cancelSelection = () => {
    setSelectionMode(null);
    setSelectedStudentIds([]);
  };

  const toggleSelectedStudent = (studentId) => {
    if (!studentId) return;
    setSelectedStudentIds(current => (
      current.includes(String(studentId))
        ? current.filter(id => id !== String(studentId))
        : [...current, String(studentId)]
    ));
  };

  const applyBulkAttendanceStatus = async (status) => {
    if (!selectedStudentIds.length || editingStudent) return;
    setEditingStudent('bulk');
    const ids = [...selectedStudentIds];
    const previousStatuses = ids.reduce((map, studentId) => {
      map[String(studentId)] = getStudentStatus(studentId, attendance, absent);
      return map;
    }, {});
    try {
      const res = await attendanceAPI.updateLectureStatus(id, { studentIds: ids, status });
      setLecture(res.data.lecture);
      setAttendance(res.data.attendance || []);
      setAbsent(res.data.absentStudents || []);
      setStats(res.data.stats);
      toast.success(status === 'present'
        ? `Marked ${ids.length} student${ids.length === 1 ? '' : 's'} present`
        : `Marked ${ids.length} student${ids.length === 1 ? '' : 's'} absent`);
      cancelSelection();
    } catch (err) {
      if (isNetworkFailure(err)) {
        applyLocalAttendanceStatus(ids, status);
        queueOfflineAttendanceChange({ studentIds: ids, status, previousStatuses });
        cancelSelection();
      } else {
        toast.error(err.response?.data?.message || 'Could not update selected students');
      }
    } finally {
      setEditingStudent(null);
    }
  };

  const handleDragStart = (event, studentId, fromStatus) => {
    if (selectionMode) {
      event.preventDefault();
      return;
    }
    const targetStudent = attendance.find(item => String(item.student?._id) === String(studentId))?.student
      || absent.find(item => String(item._id) === String(studentId));
    if (isRestrictedProfile(targetStudent, lecture?.subject?._id)) {
      event.preventDefault();
      toast.error('This profile is restricted. Attendance cannot be marked for this profile.');
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/json', JSON.stringify({ studentId, fromStatus }));
  };

  const handleDrop = (event, status) => {
    event.preventDefault();
    if (selectionMode) return;
    setDragTarget(null);
    try {
      const payload = JSON.parse(event.dataTransfer.getData('application/json') || '{}');
      if (!payload.studentId || payload.fromStatus === status) return;
      applyAttendanceStatus(payload.studentId, status);
    } catch {
      toast.error('Could not move attendance record');
    }
  };

  const allowDrop = (event, status) => {
    if (selectionMode) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragTarget(status);
  };

  const filteredAttendance = useMemo(() => attendance.filter(item => {
    const restricted = isRestrictedProfile(item.student, lecture?.subject?._id);
    if (profileFilter === 'valid') return !restricted;
    if (profileFilter === 'restricted') return restricted;
    return true;
  }), [attendance, profileFilter]);
  const filteredAbsent = useMemo(() => absent.filter(item => {
    const restricted = isRestrictedProfile(item, lecture?.subject?._id);
    if (profileFilter === 'valid') return !restricted;
    if (profileFilter === 'restricted') return restricted;
    return true;
  }), [absent, profileFilter]);
  const restrictedCount = useMemo(() => (
    attendance.filter(item => isRestrictedProfile(item.student, lecture?.subject?._id)).length + absent.filter(item => isRestrictedProfile(item, lecture?.subject?._id)).length
  ), [attendance, absent, lecture?.subject?._id]);
  const lectureOfflineQueue = useMemo(() => offlineQueue.filter(item => String(item.lectureId) === String(id)), [offlineQueue, id]);
  const pendingOfflineCount = lectureOfflineQueue.filter(item => item.state !== 'conflict').reduce((sum, item) => sum + (item.studentIds?.length || 0), 0);
  const conflictOfflineCount = lectureOfflineQueue.filter(item => item.state === 'conflict').length;

  if (loading) return <PageSkeleton variant="detail" rows={6} />;
  if (!lecture) return <div className="text-center py-20 text-slate-400">Lecture not found</div>;

  return (
    <div className="space-y-6 max-w-5xl">
      <AppConfirmModal
        open={deleteModalOpen}
        title="Delete Lecture?"
        message={`This will hide "${lecture.title}" now. Its attendance records and captured images will be permanently deleted after 10 minutes unless you undo it from the dashboard tray.`}
        confirmLabel="Schedule Delete"
        onCancel={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteLecture}
      />
      {typeof document !== 'undefined' && createPortal(
      <AnimatePresence>
        {copyModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="app-modal-backdrop"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              className="glass-card max-h-[82vh] w-full max-w-2xl overflow-y-auto"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">Copy Attendance</h3>
                  <p className="mt-1 text-sm text-slate-400">Choose a date-wise lecture from your semester. Only students matching this subject branch and semester will be copied.</p>
                </div>
                <button type="button" onClick={() => setCopyModalOpen(false)} className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white">X</button>
              </div>
              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <label className="label flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Source Date</label>
                <input type="date" className="input-field mt-2 max-w-xs" value={copyDate} onChange={event => setCopyDate(event.target.value)} />
              </div>
              {copyLoading ? (
                <CardSkeleton rows={4} />
              ) : copySources.length === 0 ? (
                <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">No source lectures found for this semester on the selected date.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  {copySources.map(source => (
                    <button
                      key={source._id}
                      type="button"
                      onClick={() => copyAttendanceFrom(source._id)}
                      disabled={Boolean(copyingId)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition-colors hover:border-primary-400/40 disabled:opacity-60"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{source.title}</p>
                        <p className="mt-1 text-xs text-slate-500">{source.subject?.name} - {source.startTime} to {source.endTime}</p>
                        <p className="mt-1 text-xs text-emerald-300">{source.canCopyCount || 0} matching present record{source.canCopyCount === 1 ? '' : 's'}</p>
                      </div>
                      <span className="btn-secondary whitespace-nowrap px-3 py-2 text-xs">
                        {copyingId === source._id ? 'Copying...' : 'Copy'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
      )}
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to Lectures
      </button>

      <AdminBreadcrumb items={[
        { label: 'Lectures', onClick: () => navigate('/admin/lectures') },
        lecture.subject?.name && { label: lecture.subject.name },
        { label: lecture.title }
      ]} />

      {/* Header */}
      <div className="glass-card">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-white">{lecture.title}</h1>
            <p className="text-slate-400 mt-1">{lecture.subject?.name} ({lecture.subject?.code})</p>
            <p className="text-slate-500 text-sm mt-1">
              {toLocalDate(lecture.date).toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              {' · '}{lecture.startTime} - {lecture.endTime} ({lecture.duration} min)
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <button onClick={downloadLectureAttendance} disabled={downloading} className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" /> {downloading ? 'Downloading...' : 'Download Excel'}
            </button>
            <button onClick={openCopyModal} disabled={actionLoading} className="btn-secondary flex items-center gap-2">
              <Copy className="w-4 h-4" /> Copy Attendance
            </button>
            <button onClick={() => setDeleteModalOpen(true)} className="btn-danger flex items-center gap-2">
              <Trash2 className="w-4 h-4" /> Delete Lecture
            </button>
            {!lecture.attendanceOpen && lecture.status !== 'completed' && (
              <button onClick={() => handleStart()} disabled={actionLoading} className="btn-success flex items-center gap-2">
                <Play className="w-4 h-4" /> Start Attendance
              </button>
            )}
            {!lecture.attendanceOpen && lecture.status === 'completed' && (
              <button onClick={() => setRestartPromptOpen(true)} disabled={actionLoading} className="btn-success flex items-center gap-2">
                <Play className="w-4 h-4" /> Restart Attendance
              </button>
            )}
            {lecture.attendanceOpen && (
              <button onClick={handleStop} disabled={actionLoading} className="btn-danger flex items-center gap-2">
                <Square className="w-4 h-4" /> Stop Attendance
              </button>
            )}
          </div>
        </div>

        {/* Active code display */}
        {lecture.attendanceOpen && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
            <p className="text-emerald-400 text-sm font-medium mb-2 flex items-center gap-2">
              <Key className="w-4 h-4" /> Attendance Code (share with students)
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <span className="inline-flex max-w-full items-center justify-center rounded-xl bg-slate-950/30 px-3 py-2 font-mono text-2xl font-bold tracking-[0.18em] text-emerald-300 sm:text-4xl sm:tracking-[0.4em]">
                {activeCode || lecture.attendanceCode}
              </span>
              <button onClick={copyCode} className="btn-secondary flex items-center justify-center gap-2 py-2 px-4 text-sm sm:text-base">
                <Copy className="w-4 h-4" /> Copy
              </button>
            </div>
            <p className="text-emerald-500 text-xs mt-2">Expires: {lecture.codeExpiresAt ? new Date(lecture.codeExpiresAt).toLocaleTimeString() : '1 hour'}</p>
          </motion.div>
        )}
      </div>

      {typeof document !== 'undefined' && createPortal(
      <AnimatePresence>
        {restartPromptOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="app-modal-backdrop"
          >
            <motion.div
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              className="glass-card w-full max-w-sm"
            >
              <h3 className="text-white font-semibold text-lg">Restart Attendance</h3>
              <p className="text-slate-400 text-sm mt-1">Set how long attendance should stay open before auto-close.</p>
              <div className="mt-4">
                <label className="label">Auto-close after minutes *</label>
                <input
                  type="number"
                  min="1"
                  className="input-field"
                  value={restartMinutes}
                  onChange={e => setRestartMinutes(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex gap-3 mt-5">
                <button type="button" onClick={() => setRestartPromptOpen(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="button" onClick={handleRestart} disabled={actionLoading} className="btn-primary flex-1">
                  {actionLoading ? 'Opening...' : 'Restart'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
      )}

      {/* Stats */}
      {stats && (
        <div className="stats-strip sm:grid-cols-2 md:grid-cols-4">
          {[
            { label: 'Total', value: stats.total, color: 'text-white' },
            { label: 'Present', value: stats.present, color: 'text-emerald-400' },
            { label: 'Absent', value: stats.absent, color: 'text-red-400' },
            { label: 'Attendance %', value: `${stats.percentage}%`, color: 'text-primary-400' },
          ].map(s => (
            <div key={s.label} className="stat-tile min-h-[7rem] sm:min-h-[8rem]">
              <p className={`stat-tile-value ${s.color}`}>{s.value}</p>
              <p className="stat-tile-label">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {(pendingOfflineCount > 0 || conflictOfflineCount > 0 || !isOnline) && (
        <div className={`rounded-xl border px-4 py-3 ${
          conflictOfflineCount
            ? 'border-amber-400/30 bg-amber-500/10'
            : pendingOfflineCount
              ? 'border-primary-400/30 bg-primary-500/10'
              : 'border-slate-500/30 bg-white/[0.03]'
        }`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-white/10 bg-white/5 p-2">
                {conflictOfflineCount ? <AlertTriangle className="h-4 w-4 text-amber-300" /> : <WifiOff className="h-4 w-4 text-primary-300" />}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  {conflictOfflineCount ? 'Offline sync needs review' : isOnline ? 'Offline attendance queued' : 'Offline attendance mode'}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {pendingOfflineCount > 0 && `${pendingOfflineCount} pending student change${pendingOfflineCount === 1 ? '' : 's'}. `}
                  {conflictOfflineCount > 0 && `${conflictOfflineCount} conflict${conflictOfflineCount === 1 ? '' : 's'} detected. `}
                  {!isOnline ? 'Changes will sync when internet returns.' : 'Queued changes sync safely after checking server data.'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={syncOfflineAttendanceQueue}
              disabled={!isOnline || syncingOfflineQueue || !offlineQueue.some(item => item.state !== 'conflict')}
              className="btn-secondary flex items-center justify-center gap-2 px-3 py-2 text-xs disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncingOfflineQueue ? 'animate-spin' : ''}`} />
              {syncingOfflineQueue ? 'Syncing...' : 'Sync now'}
            </button>
          </div>
          {conflictOfflineCount > 0 && (
            <div className="mt-3 space-y-2">
              {lectureOfflineQueue.filter(item => item.state === 'conflict').map(item => (
                <div key={item.id} className="rounded-lg border border-amber-400/20 bg-slate-950/20 px-3 py-2 text-xs text-amber-100">
                  {item.studentIds?.length || 0} student change{item.studentIds?.length === 1 ? '' : 's'} to {item.status} could not auto-sync. {item.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-primary-500/20 bg-primary-500/5 px-4 py-3 text-sm text-slate-300">
        {selectionMode
          ? 'Selection mode is active. Choose students with checkboxes, then apply the bulk attendance action.'
          : 'Drag a valid student card between Present and Absent to edit this lecture attendance. Restricted profiles are visible but locked.'}
      </div>

      <div className="glass-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg border border-primary-400/20 bg-primary-500/10 p-2 text-primary-300">
            <Filter className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Profile Filter</p>
            <p className="text-xs text-slate-500">{restrictedCount} restricted profile{restrictedCount === 1 ? '' : 's'} in this lecture</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:flex">
          {profileFilterOptions.map(option => (
            <button
              key={option.value}
              type="button"
              onClick={() => setProfileFilter(option.value)}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                profileFilter === option.value
                  ? 'border-primary-400 bg-primary-500/20 text-white'
                  : 'border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Present students */}
        <div
          className={`glass-card transition-colors ${dragTarget === 'present' ? 'border-emerald-400/60 bg-emerald-500/10' : ''}`}
          onDragOver={event => allowDrop(event, 'present')}
          onDragLeave={() => setDragTarget(null)}
          onDrop={event => handleDrop(event, 'present')}
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-emerald-400" /> Present ({filteredAttendance.length})
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {selectionMode === 'present' && selectedStudentIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => applyBulkAttendanceStatus('absent')}
                  disabled={editingStudent === 'bulk'}
                  className="btn-danger px-3 py-2 text-xs"
                >
                  Mark {selectedStudentIds.length} Student{selectedStudentIds.length === 1 ? '' : 's'} Absent
                </button>
              )}
              {selectionMode === 'present' ? (
                <button type="button" onClick={cancelSelection} className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Cancel selection">
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <button type="button" onClick={() => startSelection('present')} disabled={Boolean(selectionMode)} className="btn-secondary px-3 py-2 text-xs disabled:opacity-50">
                  Select Student
                </button>
              )}
            </div>
          </div>
          <div className="card-strip lg:block lg:max-h-80 lg:space-y-2 lg:overflow-y-auto">
            {filteredAttendance.map(a => {
              const restricted = isRestrictedProfile(a.student, lecture?.subject?._id);
              return (
                <div
                  key={a._id}
                  draggable={!restricted && !selectionMode}
                  onDragStart={event => handleDragStart(event, a.student?._id, 'present')}
                  onClick={() => {
                    if (selectionMode === 'present' && !restricted) toggleSelectedStudent(a.student?._id);
                  }}
                  className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                    restricted
                      ? 'cursor-not-allowed border-red-400/20 bg-red-500/10'
                      : selectionMode === 'present'
                        ? 'cursor-pointer border-white/10 bg-white/[0.03] hover:bg-white/5'
                        : 'cursor-grab border-transparent bg-white/[0.03] hover:bg-white/5 active:cursor-grabbing'
                  } ${selectedStudentIds.includes(String(a.student?._id)) ? 'border-emerald-400/50 bg-emerald-500/10' : ''} ${editingStudent === a.student?._id || editingStudent === 'bulk' ? 'opacity-60' : ''}`}
                >
                  {selectionMode === 'present' ? (
                    <input
                      type="checkbox"
                      className="h-4 w-4 flex-shrink-0 accent-primary-500"
                      checked={selectedStudentIds.includes(String(a.student?._id))}
                      disabled={restricted}
                      onChange={() => toggleSelectedStudent(a.student?._id)}
                      onClick={event => event.stopPropagation()}
                    />
                  ) : restricted ? <Lock className="h-4 w-4 flex-shrink-0 text-red-300" /> : <GripVertical className="h-4 w-4 flex-shrink-0 text-slate-600" />}
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 flex-shrink-0">
                    {a.student?.profileImage
                      ? <img src={a.student.profileImage} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">{a.student?.name[0]}</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-medium text-white">{a.student?.name}</p>
                      {restricted && <span className="badge-danger shrink-0 text-[10px]">Restricted</span>}
                    </div>
                    <p className="text-xs text-slate-500">{a.student?.studentId}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-emerald-400">{Number.isFinite(a.faceConfidence) ? `${a.faceConfidence.toFixed(1)}%` : 'Manual'}</p>
                    <p className="text-xs text-slate-600">{new Date(a.markedAt || a.createdAt).toLocaleTimeString()}</p>
                    <button
                      type="button"
                      disabled={restricted || selectionMode || editingStudent === a.student?._id}
                      onClick={() => applyAttendanceStatus(a.student?._id, 'absent')}
                      className="mt-1 text-xs text-red-300 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {restricted ? 'Locked' : 'Move absent'}
                    </button>
                  </div>
                </div>
              );
            })}
            {filteredAttendance.length === 0 && <p className="text-slate-500 text-sm text-center py-8">No present students match this filter</p>}
          </div>
        </div>

        {/* Absent students */}
        <div
          className={`glass-card transition-colors ${dragTarget === 'absent' ? 'border-red-400/60 bg-red-500/10' : ''}`}
          onDragOver={event => allowDrop(event, 'absent')}
          onDragLeave={() => setDragTarget(null)}
          onDrop={event => handleDrop(event, 'absent')}
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <XCircle className="w-5 h-5 text-red-400" /> Absent ({filteredAbsent.length})
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {selectionMode === 'absent' && selectedStudentIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => applyBulkAttendanceStatus('present')}
                  disabled={editingStudent === 'bulk'}
                  className="btn-success px-3 py-2 text-xs"
                >
                  Mark {selectedStudentIds.length} Student{selectedStudentIds.length === 1 ? '' : 's'} Present
                </button>
              )}
              {selectionMode === 'absent' ? (
                <button type="button" onClick={cancelSelection} className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Cancel selection">
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <button type="button" onClick={() => startSelection('absent')} disabled={Boolean(selectionMode)} className="btn-secondary px-3 py-2 text-xs disabled:opacity-50">
                  Select Student
                </button>
              )}
            </div>
          </div>
          <div className="card-strip lg:block lg:max-h-80 lg:space-y-2 lg:overflow-y-auto">
            {filteredAbsent.map(s => {
              const restricted = isRestrictedProfile(s, lecture?.subject?._id);
              return (
                <div
                  key={s._id}
                  draggable={!restricted && !selectionMode}
                  onDragStart={event => handleDragStart(event, s._id, 'absent')}
                  onClick={() => {
                    if (selectionMode === 'absent' && !restricted) toggleSelectedStudent(s._id);
                  }}
                  className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                    restricted
                      ? 'cursor-not-allowed border-red-400/20 bg-red-500/10'
                      : selectionMode === 'absent'
                        ? 'cursor-pointer border-white/10 bg-white/[0.03] hover:bg-white/5'
                        : 'cursor-grab border-transparent bg-white/[0.03] hover:bg-white/5 active:cursor-grabbing'
                  } ${selectedStudentIds.includes(String(s._id)) ? 'border-primary-400/50 bg-primary-500/10' : ''} ${editingStudent === s._id || editingStudent === 'bulk' ? 'opacity-60' : ''}`}
                >
                  {selectionMode === 'absent' ? (
                    <input
                      type="checkbox"
                      className="h-4 w-4 flex-shrink-0 accent-primary-500"
                      checked={selectedStudentIds.includes(String(s._id))}
                      disabled={restricted}
                      onChange={() => toggleSelectedStudent(s._id)}
                      onClick={event => event.stopPropagation()}
                    />
                  ) : restricted ? <ShieldAlert className="h-4 w-4 flex-shrink-0 text-red-300" /> : <GripVertical className="h-4 w-4 flex-shrink-0 text-slate-600" />}
                  <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 flex-shrink-0">
                    {s.profileImage
                      ? <img src={s.profileImage} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">{s.name[0]}</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-medium text-white">{s.name}</p>
                      {restricted && <span className="badge-danger shrink-0 text-[10px]">Restricted</span>}
                    </div>
                    <p className="text-xs text-slate-500">{s.studentId}</p>
                  </div>
                  <button
                    type="button"
                    disabled={restricted || selectionMode || editingStudent === s._id}
                    onClick={() => applyAttendanceStatus(s._id, 'present')}
                    className="text-xs text-emerald-300 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {restricted ? 'Locked' : 'Mark present'}
                  </button>
                </div>
              );
            })}
            {filteredAbsent.length === 0 && <p className="text-slate-500 text-sm text-center py-8">No absent students match this filter</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
