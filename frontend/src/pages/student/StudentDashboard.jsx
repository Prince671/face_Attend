import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BookOpen, CheckCircle, TrendingUp, ChevronRight,
  AlertCircle, Calendar, Clock, Video, CreditCard, Monitor
} from 'lucide-react';
import { studentAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageLoader } from '../../components/LoadingStates';
import toast from 'react-hot-toast';

const sortLecturesByDateAsc = (items = []) => [...items].sort((a, b) => {
  const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
  if (dateDiff !== 0) return dateDiff;
  return String(a.startTime || '').localeCompare(String(b.startTime || ''));
});

export default function StudentDashboard() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    try {
      const r = await studentAPI.getDashboard();
      setDashboard(r.data);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // ✅ Real-time socket updates — refresh dashboard on any lecture event
  useEffect(() => {
    if (!socket) return;

    const onNewLecture = (data) => {
      toast(`📚 New lecture added: ${data.lecture?.subject?.name || 'New Lecture'}`, { duration: 5000 });
      fetchDashboard();
    };
    const onAttendanceOpened = () => fetchDashboard();
    const onAttendanceClosed = () => fetchDashboard();

    socket.on('new_lecture', onNewLecture);
    socket.on('attendance_opened', onAttendanceOpened);
    socket.on('attendance_closed', onAttendanceClosed);

    return () => {
      socket.off('new_lecture', onNewLecture);
      socket.off('attendance_opened', onAttendanceOpened);
      socket.off('attendance_closed', onAttendanceClosed);
    };
  }, [socket, fetchDashboard]);

  if (loading) return (
    <PageLoader label="Loading student dashboard..." />
  );

  const {
    subjectStats = [],
    recentAttendance = [],
    openLectures: dashboardOpenLectures = [],
    upcomingLectures: dashboardUpcomingLectures = [],
    allLectures: dashboardAllLectures = []
  } = dashboard || {};

  const openLectures = sortLecturesByDateAsc(dashboardOpenLectures);
  const upcomingLectures = sortLecturesByDateAsc(dashboardUpcomingLectures);
  const allLectures = sortLecturesByDateAsc(dashboardAllLectures);

  const totalAttended = subjectStats.reduce((a, s) => a + (s.attended || 0), 0);
  const totalLectures = subjectStats.reduce((a, s) => a + (s.totalLectures || 0), 0);
  const overallPct = totalLectures > 0 ? ((totalAttended / totalLectures) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">
          Welcome, {user?.name?.split(' ')[0]}!
        </h1>
        <p className="text-slate-400 mt-1">{user?.department} · Semester {user?.semester}</p>
      </div>

      <AdminBreadcrumb items={[
        { label: user?.department || 'Department' },
        user?.semester && { label: `Semester ${user.semester}` },
        { label: 'Dashboard' }
      ]} />

      {/* ✅ Open attendance alert — shown prominently */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="mobile-card-row flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center flex-shrink-0">
            <CreditCard className="w-4 h-4 sm:w-5 sm:h-5 text-primary-400" />
          </div>
          <div>
            <p className="text-white font-semibold">Digital Student ID Card</p>
            <p className="text-slate-400 text-sm">View your generated institute identity card</p>
          </div>
        </div>
        <Link to="/student/id-card" className="btn-primary inline-flex items-center gap-2 justify-center">
          <span>Open ID Card</span><ChevronRight className="w-4 h-4" />
        </Link>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass-card flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="mobile-card-row flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
            <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-white font-semibold">Department Timetable</p>
            <p className="text-slate-400 text-sm">View your weekly lecture schedule</p>
          </div>
        </div>
        <Link to="/student/timetable" className="btn-secondary inline-flex items-center gap-2 justify-center">
          Open Timetable <ChevronRight className="w-4 h-4" />
        </Link>
      </motion.div>

      {openLectures.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
            <div>
              <p className="font-semibold text-emerald-300">Attendance is Open Now!</p>
              <p className="text-emerald-400/80 text-sm">
                {openLectures[0]?.subject?.name} — {openLectures[0]?.title}
              </p>
            </div>
          </div>
          <Link to="/student/mark-attendance"
            className="bg-emerald-600 hover:bg-emerald-500 text-white py-2 px-4 rounded-xl text-sm flex items-center justify-center gap-1 transition-colors">
            Mark Now <ChevronRight className="w-4 h-4" />
          </Link>
        </motion.div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {[
          { icon: BookOpen, label: 'Enrolled Subjects', value: subjectStats.length, color: 'bg-primary-500/20 text-primary-400' },
          { icon: CheckCircle, label: 'Classes Attended', value: totalAttended, color: 'bg-emerald-500/20 text-emerald-400' },
          {
            icon: TrendingUp, label: 'Overall Attendance', value: `${overallPct}%`,
            color: parseFloat(overallPct) >= 75 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
            className="glass-card mobile-card-row flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4"
          >
            <div className={`w-8 h-8 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${s.color}`}>
              <s.icon className="w-4 h-4 sm:w-6 sm:h-6" />
            </div>
            <div>
              <p className="text-slate-400 text-[10px] leading-tight sm:text-sm">{s.label}</p>
              <p className="text-base sm:text-2xl font-bold text-white font-display">{s.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">

        {/* ✅ ALL Lectures for enrolled subjects */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
          className="glass-card"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Video className="w-4 h-4 text-primary-400" /> Recent Lectures
            </h2>
            <span className="text-slate-500 text-xs">{allLectures.length} total</span>
          </div>

          {allLectures.length === 0 ? (
            <div className="text-center py-8">
              <Video className="w-10 h-10 mx-auto mb-2 text-slate-600" />
              <p className="text-slate-500 text-sm">No lectures scheduled yet</p>
              <p className="text-slate-600 text-xs mt-1">Admin will add lectures for your subjects</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {allLectures.map(lec => (
                <div key={lec._id}
                  className="flex items-start gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/8 transition-colors">
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                    lec.attendanceOpen ? 'bg-emerald-400 animate-pulse' :
                    lec.status === 'completed' ? 'bg-primary-400' :
                    lec.status === 'ongoing' ? 'bg-yellow-400' : 'bg-slate-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{lec.title}</p>
                    <p className="text-xs text-slate-400 flex items-center gap-1">
                      {lec.isLab && <Monitor className="w-3 h-3 text-primary-300" />}
                      {lec.subject?.name}{lec.isLab ? ` - ${lec.labNumber || 'LAB'}` : ''}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <Calendar className="w-3 h-3" />
                        {new Date(lec.date).toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <Clock className="w-3 h-3" />
                        {lec.startTime}
                      </span>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                    lec.attendanceOpen ? 'bg-emerald-500/20 text-emerald-300' :
                    lec.status === 'completed' ? 'bg-primary-500/20 text-primary-300' :
                    lec.status === 'ongoing' ? 'bg-yellow-500/20 text-yellow-300' :
                    'bg-slate-500/20 text-slate-300'
                  }`}>
                    {lec.attendanceOpen ? 'OPEN' : lec.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        {/* Subject-wise attendance */}
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          className="glass-card"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white">Subject Attendance</h2>
            <Link to="/student/subjects" className="text-primary-400 text-sm hover:text-primary-300 flex items-center gap-1">
              View all <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="space-y-2 sm:space-y-4">
            {subjectStats.map(s => (
              <Link key={s.subject._id} to={`/student/attendance/${s.subject._id}`}>
                <div className="hover:bg-white/5 rounded-xl p-2 transition-colors cursor-pointer">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium text-white">{s.subject.name}</span>
                    <span className={`text-sm font-semibold ${
                      parseFloat(s.percentage) >= 75 ? 'text-emerald-400' : 'text-red-400'
                    }`}>
                      {s.percentage}%
                    </span>
                  </div>
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, parseFloat(s.percentage))}%` }}
                      transition={{ duration: 0.8, delay: 0.2 }}
                      className={`h-full rounded-full ${
                        parseFloat(s.percentage) >= 75 ? 'bg-emerald-500' : 'bg-red-500'
                      }`}
                    />
                  </div>
                  <p className="text-slate-500 text-xs mt-1">
                    {s.attended}/{s.totalLectures} classes
                  </p>
                </div>
              </Link>
            ))}
            {subjectStats.length === 0 && (
              <p className="text-slate-500 text-center py-4 text-sm">
                No subjects enrolled yet. Contact admin to get enrolled.
              </p>
            )}
          </div>
        </motion.div>
      </div>

      {/* Recent attendance log */}
      {recentAttendance.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="glass-card"
        >
          <h2 className="font-semibold text-white mb-4">Recent Attendance</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {recentAttendance.slice(0, 6).map(a => (
              <div key={a._id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors">
                <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{a.lecture?.title}</p>
                  <p className="text-xs text-slate-500">
                    {a.subject?.name} · {new Date(a.markedAt).toLocaleDateString()}
                  </p>
                </div>
                <span className="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">Present</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Low attendance warning */}
      {subjectStats.some(s => parseFloat(s.percentage) < 75 && s.totalLectures > 0) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-300">Low Attendance Warning</p>
            <p className="text-amber-400/80 text-sm mt-1">
              You have low attendance in:{' '}
              <span className="font-medium">
                {subjectStats
                  .filter(s => parseFloat(s.percentage) < 75 && s.totalLectures > 0)
                  .map(s => s.subject.name)
                  .join(', ')}
              </span>
              . Minimum 75% required to appear in exams.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
