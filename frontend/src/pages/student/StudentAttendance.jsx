import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, CheckCircle, XCircle, Calendar, MessageSquare, Send } from 'lucide-react';
import { attendanceAPI, subjectAPI } from '../../services/api';
import { useRealtimeRefresh } from '../../context/SocketContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { LoadingOverlay, PageSkeleton } from '../../components/LoadingStates';
import { getSemesterLabel } from '../../utils/academicLabels';

export default function StudentAttendance() {
  const { subjectId } = useParams();
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [stats, setStats] = useState(null);
  const [subject, setSubject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [disputeLectureIds, setDisputeLectureIds] = useState([]);
  const [selectedLectureIds, setSelectedLectureIds] = useState([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [submittingDispute, setSubmittingDispute] = useState(false);
  const longPressTimer = useRef(null);
  const ignoreNextClick = useRef(false);

  const refreshRecords = async () => {
    setRefreshing(true);
    try {
      const att = await attendanceAPI.getStudentSubject(subjectId);
      setRecords(att.data.records || []);
      setStats(att.data.stats);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    Promise.all([
      attendanceAPI.getStudentSubject(subjectId),
      subjectAPI.getById(subjectId)
    ]).then(([att, sub]) => {
      setRecords(att.data.records || []);
      setStats(att.data.stats);
      setSubject(sub.data.subject);
    }).catch(console.error).finally(() => setLoading(false));
  }, [subjectId]);

  useRealtimeRefresh(() => {
    refreshRecords();
    subjectAPI.getById(subjectId).then(sub => setSubject(sub.data.subject)).catch(() => {});
  }, ['attendance', 'lectures', 'subjects'], [subjectId]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await attendanceAPI.downloadExcel(subjectId);
      const contentType = res.headers['content-type'] || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const disposition = res.headers['content-disposition'] || '';
      const match = disposition.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `Attendance_${subject?.code || 'Subject'}_${Date.now()}.xlsx`;
      const url = URL.createObjectURL(new Blob([res.data], { type: contentType }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Downloaded successfully!');
    } catch (error) {
      const data = error.response?.data;
      if (data instanceof Blob) {
        try {
          const parsed = JSON.parse(await data.text());
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

  const submitDispute = async () => {
    if (!disputeLectureIds.length || !disputeReason.trim()) return toast.error('Please select attendance and write a short reason.');
    setSubmittingDispute(true);
    try {
      await attendanceAPI.createDispute({ lectureIds: disputeLectureIds, reason: disputeReason.trim() });
      toast.success(disputeLectureIds.length > 1 ? 'Combined correction request sent' : 'Correction request sent');
      setDisputeLectureIds([]);
      setSelectedLectureIds([]);
      setSelectionMode(false);
      setDisputeReason('');
      await refreshRecords();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not send request');
    } finally {
      setSubmittingDispute(false);
    }
  };

  const toggleSelected = (lectureId) => {
    setSelectedLectureIds(current => current.includes(lectureId)
      ? current.filter(id => id !== lectureId)
      : [...current, lectureId]);
  };
  const startLongPress = (record) => {
    if (record.status !== 'absent' || record.dispute) return;
    window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      ignoreNextClick.current = true;
      setSelectionMode(true);
      toggleSelected(record.lecture._id);
    }, 450);
  };
  const clearLongPress = () => window.clearTimeout(longPressTimer.current);

  if (loading) return <PageSkeleton variant="detail" rows={6} />;

  const pct = stats ? parseFloat(stats.percentage) : 0;

  return (
    <div className="relative max-w-4xl space-y-4 sm:space-y-6">
      <LoadingOverlay show={refreshing} label="Fetching attendance records..." />
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <AdminBreadcrumb items={[
        { label: 'Subjects', onClick: () => navigate('/student/subjects') },
        subject?.semester && { label: getSemesterLabel(subject.semester) },
        subject?.name && { label: subject.name },
        { label: 'Attendance' }
      ]} />

      <div className="glass-card">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-white">{subject?.name}</h1>
            <p className="text-slate-400 font-mono">{subject?.code} - {subject?.branch || subject?.department}</p>
          </div>
          <button onClick={handleDownload} disabled={downloading} className="btn-secondary flex w-full items-center gap-2 sm:w-auto">
            <Download className="w-4 h-4" />
            {downloading ? 'Downloading...' : 'Download Excel'}
          </button>
        </div>

        {stats && (
          <div className="stats-strip sm:grid-cols-3 mt-4 sm:mt-6">
            {[
              { label: 'Total Lectures', value: stats.total, color: 'text-white' },
              { label: 'Attended', value: stats.present, color: 'text-emerald-400' },
              { label: 'Absent', value: stats.total - stats.present, color: 'text-red-400' },
            ].map(s => (
              <div key={s.label} className="stat-tile min-h-[7rem] sm:min-h-[8rem]">
                <p className={`stat-tile-value ${s.color}`}>{s.value}</p>
                <p className="stat-tile-label">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {stats && (
          <div className="mt-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-slate-400">Overall Attendance</span>
              <span className={`font-bold ${pct >= 75 ? 'text-emerald-400' : 'text-red-400'}`}>{stats.percentage}%</span>
            </div>
            <div className="relative h-5 overflow-hidden rounded-full bg-white/10">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, pct)}%` }}
                transition={{ duration: 1 }}
                className={`h-full rounded-full ${pct >= 75 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
              />
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium text-white drop-shadow">
                {stats.percentage}%
              </span>
            </div>
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>0%</span>
              <span className={`font-medium ${pct >= 75 ? 'text-emerald-500' : 'text-red-500'}`}>
                {stats.total === 0
                  ? 'No completed classes yet'
                  : pct >= 75
                    ? 'Eligible for exam'
                    : `Need ${Math.ceil((0.75 * stats.total - stats.present) / 0.25)} more classes for 75%`}
              </span>
              <span>100%</span>
            </div>
          </div>
        )}
      </div>

      <div className="glass-card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary-400" /> Lecture-wise Record
              </h2>
              <p className="mt-1 text-xs text-slate-500">Long press an absent row to start selection, then tap more absent rows to add them to one combined dispute.</p>
            </div>
            {selectionMode && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={() => { setSelectionMode(false); setSelectedLectureIds([]); }}>Cancel</button>
                <button
                  type="button"
                  className="btn-primary px-3 py-2 text-xs"
                  disabled={!selectedLectureIds.length}
                  onClick={() => setDisputeLectureIds(selectedLectureIds)}
                >
                  Create dispute ({selectedLectureIds.length})
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="table-scroll max-h-[19rem] overflow-y-auto">
          <table className="data-table">
            <colgroup>
              <col className="w-[7%]" />
              {selectionMode && <col className="w-[7%]" />}
              <col className="w-[14%]" />
              <col className={selectionMode ? 'w-[24%]' : 'w-[28%]'} />
              <col className="w-[13%]" />
              <col className="w-[14%]" />
              <col className="w-[12%]" />
              <col className="w-[11%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left py-3 px-6 text-slate-400 font-medium text-sm">#</th>
                {selectionMode && <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Pick</th>}
                <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Date</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Lecture</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Time</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Status</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Confidence</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Request</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <motion.tr
                  key={r.lecture?._id || i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  onPointerDown={() => startLongPress(r)}
                  onPointerUp={clearLongPress}
                  onPointerLeave={clearLongPress}
                  onClick={() => {
                    if (ignoreNextClick.current) {
                      ignoreNextClick.current = false;
                      return;
                    }
                    if (selectionMode && r.status === 'absent' && !r.dispute) toggleSelected(r.lecture._id);
                  }}
                  className={`border-b border-white/5 transition-colors hover:bg-white/3 ${selectedLectureIds.includes(r.lecture?._id) ? 'bg-primary-500/10' : ''} ${selectionMode && r.status === 'absent' && !r.dispute ? 'cursor-pointer' : ''}`}
                >
                  <td className="py-3 px-6 text-slate-500 text-sm">{i + 1}</td>
                  {selectionMode && (
                    <td className="py-3 px-4">
                      {r.status === 'absent' && !r.dispute ? (
                        <input
                          type="checkbox"
                          checked={selectedLectureIds.includes(r.lecture._id)}
                          onChange={() => toggleSelected(r.lecture._id)}
                          onClick={event => event.stopPropagation()}
                          className="h-4 w-4 accent-primary-500"
                        />
                      ) : <span className="text-slate-700">-</span>}
                    </td>
                  )}
                  <td className="py-3 px-4 text-slate-300 text-sm">{new Date(r.lecture.date).toLocaleDateString('en-IN')}</td>
                  <td className="py-3 px-4"><p className="cell-clip text-sm text-white">{r.lecture.title}</p></td>
                  <td className="py-3 px-4 text-slate-400 text-sm">{r.lecture.startTime}</td>
                  <td className="py-3 px-4">
                    {r.status === 'present' ? (
                      <span className="badge-success flex items-center gap-1 w-fit"><CheckCircle className="w-3 h-3" /> Present</span>
                    ) : (
                      <span className="badge-danger flex items-center gap-1 w-fit"><XCircle className="w-3 h-3" /> Absent</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {r.attendance?.faceConfidence ? (
                      <span className="text-emerald-400 text-sm font-mono">{r.attendance.faceConfidence.toFixed(1)}%</span>
                    ) : <span className="text-slate-600 text-sm">-</span>}
                  </td>
                  <td className="py-3 px-4">
                    {r.status === 'absent' ? (
                      r.dispute ? (
                        <span className={`badge ${r.dispute.status === 'approved' ? 'badge-success' : r.dispute.status === 'rejected' ? 'badge-danger' : 'badge-warning'}`}>
                          {r.dispute.status}
                        </span>
                      ) : (
                        <button type="button" onClick={() => setDisputeLectureIds([r.lecture._id])} className="rounded-lg border border-primary-500/30 px-2 py-1 text-xs text-primary-200 hover:bg-primary-500/10">
                          Dispute
                        </button>
                      )
                    ) : <span className="text-slate-600 text-sm">-</span>}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {disputeLectureIds.length > 0 && createPortal(
        <div className="app-modal-backdrop">
          <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="glass-card w-full max-w-lg">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <MessageSquare className="h-5 w-5 text-primary-300" /> Attendance Correction Request
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Send one explanation for {disputeLectureIds.length} selected attendance {disputeLectureIds.length === 1 ? 'date' : 'dates'}.
            </p>
            <textarea
              className="input-field mt-4 min-h-28"
              value={disputeReason}
              onChange={event => setDisputeReason(event.target.value)}
              maxLength={500}
              placeholder="Example: I was present in class, but my attendance did not get marked."
            />
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button className="btn-secondary" onClick={() => { setDisputeLectureIds([]); setDisputeReason(''); }}>Cancel</button>
              <button className="btn-primary flex items-center justify-center gap-2" onClick={submitDispute} disabled={submittingDispute}>
                <Send className="h-4 w-4" /> {submittingDispute ? 'Sending...' : 'Send Request'}
              </button>
            </div>
          </motion.div>
        </div>,
        document.body
      )}
    </div>
  );
}
