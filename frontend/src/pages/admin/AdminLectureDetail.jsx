import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ArrowLeft, Play, Square, Copy, Users, CheckCircle, XCircle, Key, Download, Trash2 } from 'lucide-react';
import { lectureAPI, attendanceAPI } from '../../services/api';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageLoader } from '../../components/LoadingStates';
import AppConfirmModal from '../../components/AppConfirmModal';
import { handleDeleteScheduled } from '../../utils/deleteUndo';

export default function AdminLectureDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
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

  if (loading) return <PageLoader label="Loading lecture attendance..." />;
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
              {new Date(lecture.date).toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              {' · '}{lecture.startTime} – {lecture.endTime} ({lecture.duration} min)
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <button onClick={downloadLectureAttendance} disabled={downloading} className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" /> {downloading ? 'Downloading...' : 'Download Excel'}
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
            <div className="flex items-center gap-4">
              <span className="font-mono text-4xl font-bold text-emerald-300 tracking-[0.4em]">
                {activeCode || lecture.attendanceCode}
              </span>
              <button onClick={copyCode} className="btn-secondary flex items-center gap-2 py-2 px-4">
                <Copy className="w-4 h-4" /> Copy
              </button>
            </div>
            <p className="text-emerald-500 text-xs mt-2">Expires: {lecture.codeExpiresAt ? new Date(lecture.codeExpiresAt).toLocaleTimeString() : '1 hour'}</p>
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {restartPromptOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
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
      </AnimatePresence>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total', value: stats.total, color: 'text-white' },
            { label: 'Present', value: stats.present, color: 'text-emerald-400' },
            { label: 'Absent', value: stats.absent, color: 'text-red-400' },
            { label: 'Attendance %', value: `${stats.percentage}%`, color: 'text-primary-400' },
          ].map(s => (
            <div key={s.label} className="glass-card text-center py-4">
              <p className={`text-2xl font-bold font-display ${s.color}`}>{s.value}</p>
              <p className="text-slate-400 text-sm mt-1">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Present students */}
        <div className="glass-card">
          <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
            <CheckCircle className="w-5 h-5 text-emerald-400" /> Present ({attendance.length})
          </h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {attendance.map(a => (
              <div key={a._id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5">
                <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 flex-shrink-0">
                  {a.student?.profileImage
                    ? <img src={a.student.profileImage} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">{a.student?.name[0]}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{a.student?.name}</p>
                  <p className="text-xs text-slate-500">{a.student?.studentId}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-emerald-400">{a.faceConfidence?.toFixed(1)}%</p>
                  <p className="text-xs text-slate-600">{new Date(a.markedAt).toLocaleTimeString()}</p>
                </div>
              </div>
            ))}
            {attendance.length === 0 && <p className="text-slate-500 text-sm text-center py-4">No attendance marked yet</p>}
          </div>
        </div>

        {/* Absent students */}
        <div className="glass-card">
          <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
            <XCircle className="w-5 h-5 text-red-400" /> Absent ({absent.length})
          </h2>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {absent.map(s => (
              <div key={s._id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5">
                <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10 flex-shrink-0">
                  {s.profileImage
                    ? <img src={s.profileImage} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">{s.name[0]}</div>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{s.name}</p>
                  <p className="text-xs text-slate-500">{s.studentId}</p>
                </div>
              </div>
            ))}
            {absent.length === 0 && <p className="text-slate-500 text-sm text-center py-4">All students present!</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
