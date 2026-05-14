import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ArrowLeft, Download, CheckCircle, XCircle, Calendar, TrendingUp } from 'lucide-react';
import { attendanceAPI, subjectAPI } from '../../services/api';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageLoader } from '../../components/LoadingStates';

export default function StudentAttendance() {
  const { subjectId } = useParams();
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [stats, setStats] = useState(null);
  const [subject, setSubject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    Promise.all([
      attendanceAPI.getStudentSubject(subjectId),
      subjectAPI.getById(subjectId)
    ]).then(([att, sub]) => {
      setRecords(att.data.records);
      setStats(att.data.stats);
      setSubject(sub.data.subject);
    }).catch(console.error).finally(() => setLoading(false));
  }, [subjectId]);

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
    }
    finally { setDownloading(false); }
  };

  if (loading) return <PageLoader label="Loading attendance records..." />;

  const pct = stats ? parseFloat(stats.percentage) : 0;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-3xl">
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <AdminBreadcrumb items={[
        { label: 'Subjects', onClick: () => navigate('/student/subjects') },
        subject?.semester && { label: `Semester ${subject.semester}` },
        subject?.name && { label: subject.name },
        { label: 'Attendance' }
      ]} />

      <div className="glass-card">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-white">{subject?.name}</h1>
            <p className="text-slate-400 font-mono">{subject?.code} · {subject?.department}</p>
          </div>
          <button onClick={handleDownload} disabled={downloading} className="btn-secondary flex w-full items-center gap-2 sm:w-auto">
            <Download className="w-4 h-4" />
            {downloading ? 'Downloading...' : 'Download Excel'}
          </button>
        </div>

        {stats && (
          <div className="grid grid-cols-3 gap-2 sm:gap-4 mt-4 sm:mt-6">
            {[
              { label: 'Total Lectures', value: stats.total, color: 'text-white' },
              { label: 'Attended', value: stats.present, color: 'text-emerald-400' },
              { label: 'Absent', value: stats.total - stats.present, color: 'text-red-400' },
            ].map(s => (
              <div key={s.label} className="text-center p-2 sm:p-3 rounded-xl bg-white/5">
                <p className={`text-lg sm:text-2xl font-bold font-display ${s.color}`}>{s.value}</p>
                <p className="text-slate-500 text-xs mt-1">{s.label}</p>
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
            <div className="h-3 bg-white/10 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, pct)}%` }}
                transition={{ duration: 1 }}
                className={`h-full rounded-full ${pct >= 75 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
              />
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

      {/* Attendance Records */}
      <div className="glass-card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="font-semibold text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary-400" /> Lecture-wise Record
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left py-3 px-6 text-slate-400 font-medium text-sm">#</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Date</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Lecture</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Time</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Status</th>
                <th className="text-left py-3 px-4 text-slate-400 font-medium text-sm">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <motion.tr key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                  className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  <td className="py-3 px-6 text-slate-500 text-sm">{i + 1}</td>
                  <td className="py-3 px-4 text-slate-300 text-sm">{new Date(r.lecture.date).toLocaleDateString('en-IN')}</td>
                  <td className="py-3 px-4">
                    <p className="text-sm text-white">{r.lecture.title}</p>
                  </td>
                  <td className="py-3 px-4 text-slate-400 text-sm">{r.lecture.startTime}</td>
                  <td className="py-3 px-4">
                    {r.status === 'present' ? (
                      <span className="badge-success flex items-center gap-1 w-fit">
                        <CheckCircle className="w-3 h-3" /> Present
                      </span>
                    ) : (
                      <span className="badge-danger flex items-center gap-1 w-fit">
                        <XCircle className="w-3 h-3" /> Absent
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {r.attendance?.faceConfidence ? (
                      <span className="text-emerald-400 text-sm font-mono">{r.attendance.faceConfidence.toFixed(1)}%</span>
                    ) : <span className="text-slate-600 text-sm">—</span>}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
