import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BookOpen, CheckCircle, TrendingUp, ChevronRight,
  Calendar, Clock, Video, CreditCard, Monitor, ClipboardList, Trophy, FileText
} from 'lucide-react';
import { useGetStudentDashboardQuery, useGetStudentProgressQuery } from '../../services/dashboardApi';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { getAcademicLabel, getSemesterLabel } from '../../utils/academicLabels';
import toast from 'react-hot-toast';

const sortLecturesByDateAsc = (items = []) => [...items].sort((a, b) => {
  const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
  if (dateDiff !== 0) return dateDiff;
  return String(a.startTime || '').localeCompare(String(b.startTime || ''));
});

const sortLecturesByDateDesc = (items = []) => [...items].sort((a, b) => {
  const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
  if (dateDiff !== 0) return dateDiff;
  return String(b.startTime || '').localeCompare(String(a.startTime || ''));
});

const SkeletonLine = ({ className = '' }) => <div className={`skeleton-shimmer rounded-full ${className}`} />;

function StudentDashboardSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="space-y-2">
        <SkeletonLine className="h-8 w-48 sm:w-64" />
        <SkeletonLine className="h-4 w-56 sm:w-80" />
      </div>

      <div className="flex flex-wrap gap-2">
        <SkeletonLine className="h-8 w-28" />
        <SkeletonLine className="h-8 w-24" />
        <SkeletonLine className="h-8 w-24" />
      </div>

      {[0, 1].map(index => (
        <div key={index} className="glass-card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <SkeletonLine className="h-11 w-11 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonLine className="h-4 w-40" />
              <SkeletonLine className="h-3 w-56 max-w-full" />
            </div>
          </div>
          <SkeletonLine className="h-11 w-full rounded-xl sm:w-36" />
        </div>
      ))}

      <div className="stats-strip student-dashboard-stats sm:grid-cols-3">
        {[0, 1, 2].map(index => (
          <div key={index} className="stat-tile">
            <SkeletonLine className="h-12 w-12 rounded-2xl sm:h-16 sm:w-16" />
            <div className="w-full space-y-2">
              <SkeletonLine className="mx-auto h-3 w-24" />
              <SkeletonLine className="mx-auto h-7 w-16" />
            </div>
          </div>
        ))}
      </div>

      <div className="glass-card">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="space-y-2">
            <SkeletonLine className="h-5 w-36" />
            <SkeletonLine className="h-3 w-52" />
          </div>
          <SkeletonLine className="h-9 w-28 rounded-xl" />
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {[0, 1, 2, 3, 4].map(index => (
            <div key={index} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <SkeletonLine className="h-3 w-20" />
              <SkeletonLine className="mt-3 h-6 w-10" />
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {[0, 1].map(column => (
            <div key={column} className="space-y-2">
              <SkeletonLine className="h-4 w-36" />
              {[0, 1, 2].map(row => <SkeletonLine key={row} className="h-14 rounded-xl" />)}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-2">
        {[0, 1].map(section => (
          <div key={section} className="glass-card">
            <div className="mb-4 flex items-center justify-between">
              <SkeletonLine className="h-5 w-36" />
              <SkeletonLine className="h-4 w-16" />
            </div>
            <div className="featured-lecture-rail lg:block lg:max-h-72 lg:space-y-3 lg:overflow-hidden">
              {[0, 1, 2, 3].map(index => (
                <div key={index} className="featured-lecture-card">
                  <div className="flex items-start gap-3">
                    <SkeletonLine className="mt-2 h-2 w-2" />
                    <div className="flex-1 space-y-2">
                      <SkeletonLine className="h-4 w-4/5" />
                      <SkeletonLine className="h-3 w-2/3" />
                      <div className="grid grid-cols-3 gap-1">
                        <SkeletonLine className="h-8 rounded-lg" />
                        <SkeletonLine className="h-8 rounded-lg" />
                        <SkeletonLine className="h-8 rounded-lg" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StudentDashboard() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { data: dashboard, isLoading: dashboardLoading, error: dashboardError } = useGetStudentDashboardQuery(undefined, { refetchOnReconnect: true });
  const { data: lmsProgressData, isLoading: lmsLoading } = useGetStudentProgressQuery(undefined, { refetchOnReconnect: true });
  const lmsProgress = lmsProgressData?.progress || null;
  const lectureRailRef = useRef(null);
  const subjectRailRef = useRef(null);
  const [activeLectureIndex, setActiveLectureIndex] = useState(0);
  const [activeSubjectIndex, setActiveSubjectIndex] = useState(0);

  useEffect(() => {
    if (dashboardError) toast.error('Failed to load dashboard');
  }, [dashboardError]);

  // ✅ Real-time socket updates — refresh dashboard on any lecture event
  useEffect(() => {
    if (!socket) return;

    const onNewLecture = (data) => {
      toast(`📚 New lecture added: ${data.lecture?.subject?.name || 'New Lecture'}`, { duration: 5000 });
    };
    socket.on('new_lecture', onNewLecture);
    return () => {
      socket.off('new_lecture', onNewLecture);
    };
  }, [socket]);

  if (dashboardLoading || lmsLoading) return <StudentDashboardSkeleton />;

  const {
    subjectStats = [],
    recentAttendance = [],
    openLectures: dashboardOpenLectures = [],
    upcomingLectures: dashboardUpcomingLectures = [],
    allLectures: dashboardAllLectures = [],
    attendanceCriteria = {}
  } = dashboard || {};

  const openLectures = sortLecturesByDateAsc(dashboardOpenLectures);
  const upcomingLectures = sortLecturesByDateAsc(dashboardUpcomingLectures);
  const allLectures = sortLecturesByDateDesc(dashboardAllLectures);
  const updateActiveLecture = () => {
    const rail = lectureRailRef.current;
    if (!rail) return;
    const center = rail.scrollLeft + rail.clientWidth / 2;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    Array.from(rail.children).forEach((child, index) => {
      const childCenter = child.offsetLeft + child.clientWidth / 2;
      const distance = Math.abs(childCenter - center);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    setActiveLectureIndex(closestIndex);
  };

  const updateActiveSubject = () => {
    const rail = subjectRailRef.current;
    if (!rail) return;
    const center = rail.scrollLeft + rail.clientWidth / 2;
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;
    Array.from(rail.children).forEach((child, index) => {
      const childCenter = child.offsetLeft + child.clientWidth / 2;
      const distance = Math.abs(childCenter - center);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    setActiveSubjectIndex(closestIndex);
  };

  const totalAttended = subjectStats.reduce((a, s) => a + (s.attended || 0), 0);
  const totalLectures = subjectStats.reduce((a, s) => a + (s.totalLectures || 0), 0);
  const overallPct = totalLectures > 0 ? ((totalAttended / totalLectures) * 100).toFixed(1) : '0.0';
  const minimumAttendance = Number(attendanceCriteria.minimumPercentage || 75);
  const academicLabel = getAcademicLabel(user);
  const lmsSubjects = lmsProgress?.subjects || [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">
          Welcome, {user?.name?.split(' ')[0]}!
        </h1>
        <p className="text-slate-400 mt-1">{academicLabel} - {getSemesterLabel(user?.semester)}</p>
      </div>

      <AdminBreadcrumb items={[
        { label: academicLabel },
        user?.semester && { label: getSemesterLabel(user.semester) },
        { label: 'Dashboard' }
      ]} />

      {/* ✅ Open attendance alert — shown prominently */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="mobile-card-row flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center flex-shrink-0 sm:w-11 sm:h-11">
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
          <div className="w-9 h-9 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0 sm:w-11 sm:h-11">
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
      <div className="stats-strip student-dashboard-stats sm:grid-cols-3">
        {[
          { icon: BookOpen, label: 'Enrolled Subjects', value: subjectStats.length, color: 'bg-primary-500/20 text-primary-400' },
          { icon: CheckCircle, label: 'Classes Attended', value: totalAttended, color: 'bg-emerald-500/20 text-emerald-400' },
          {
            icon: TrendingUp, label: 'Overall Attendance', value: `${overallPct}%`,
            color: parseFloat(overallPct) >= minimumAttendance ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
          },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
            className="stat-tile"
          >
            <div className={`stat-tile-icon ${s.color}`}>
              <s.icon className="w-5 h-5 sm:w-7 sm:h-7" />
            </div>
            <div className="space-y-2">
              <p className="stat-tile-label">{s.label}</p>
              <p className="stat-tile-value">{s.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {lmsProgress && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass-card">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold text-white">
              <ClipboardList className="h-5 w-5 text-primary-300" /> LMS Progress
            </h2>
            <Link to="/student/subjects" className="text-primary-400 hover:text-primary-300 text-sm flex items-center gap-1">
              Classrooms <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Pending Assignments</p>
              <p className="mt-1 text-xl font-semibold text-amber-300">{lmsProgress.pendingAssignments || 0}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Pending Quizzes</p>
              <p className="mt-1 text-xl font-semibold text-primary-300">{lmsProgress.pendingQuizzes || 0}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Materials</p>
              <p className="mt-1 text-xl font-semibold text-white">{lmsProgress.materials || 0}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Quiz Attempts</p>
              <p className="mt-1 text-xl font-semibold text-emerald-300">{lmsProgress.attempts || 0}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Open Doubts</p>
              <p className="mt-1 text-xl font-semibold text-red-300">{lmsProgress.openDoubts || 0}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><FileText className="h-4 w-4 text-primary-300" /> Recent Materials</p>
              <div className="space-y-2">
                {(lmsProgress.recentMaterials || []).slice(0, 4).map(item => (
                  <Link key={item._id} to={`/student/subjects/${item.subject?._id || item.subject}/classroom`} className="block rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:bg-white/5">
                    <p className="truncate text-sm font-medium text-white">{item.title}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{item.subject?.code || item.subject?.name}</p>
                  </Link>
                ))}
                {!(lmsProgress.recentMaterials || []).length && <p className="rounded-xl border border-dashed border-white/10 py-6 text-center text-sm text-slate-500">No materials yet.</p>}
              </div>
            </div>
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white"><Trophy className="h-4 w-4 text-amber-300" /> Subject Tasks</p>
              <div className="space-y-2">
                {lmsSubjects.slice(0, 4).map(item => (
                  <Link key={item.subject._id} to={`/student/subjects/${item.subject._id}/classroom`} className="block rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:bg-white/5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{item.subject.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.subject.code}</p>
                      </div>
                      <div className="flex flex-shrink-0 gap-2 text-xs">
                        <span className="badge-warning">{item.pendingAssignments?.length || 0} assignments</span>
                        <span className="badge-info">{item.pendingQuizzes?.length || 0} quizzes</span>
                      </div>
                    </div>
                  </Link>
                ))}
                {!lmsSubjects.length && <p className="rounded-xl border border-dashed border-white/10 py-6 text-center text-sm text-slate-500">No LMS tasks yet.</p>}
              </div>
            </div>
          </div>
        </motion.div>
      )}

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
            <div ref={lectureRailRef} onScroll={updateActiveLecture} className="featured-lecture-rail lg:max-h-72 lg:overflow-y-auto lg:pr-1">
              {allLectures.map((lec, index) => (
                <div key={lec._id}
                  className={`featured-lecture-card ${index === activeLectureIndex ? 'is-active' : ''}`}>
                  <div className="flex items-start gap-2 sm:gap-3">
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                    lec.attendanceOpen ? 'bg-emerald-400 animate-pulse' :
                    lec.status === 'completed' ? 'bg-primary-400' :
                    lec.status === 'ongoing' ? 'bg-yellow-400' : 'bg-slate-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="line-clamp-2 text-[12px] font-semibold text-white sm:text-sm">{lec.title}</p>
                    <p className="line-clamp-1 text-[10px] text-slate-400 flex items-center gap-1 sm:text-xs">
                      {lec.isLab && <Monitor className="w-3 h-3 text-primary-300" />}
                      {lec.subject?.name}{lec.isLab ? ` - ${lec.labNumber || 'LAB'}` : ''}
                    </p>
                    <div className="mt-2 grid gap-1 text-[10px] text-slate-500 sm:flex sm:items-center sm:gap-2 sm:text-xs">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(lec.date).toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {lec.startTime}
                      </span>
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 sm:text-xs ${
                    lec.attendanceOpen ? 'bg-emerald-500/20 text-emerald-300' :
                    lec.status === 'completed' ? 'bg-primary-500/20 text-primary-300' :
                    lec.status === 'ongoing' ? 'bg-yellow-500/20 text-yellow-300' :
                    'bg-slate-500/20 text-slate-300'
                  }`}>
                    {lec.attendanceOpen ? 'OPEN' : lec.status}
                  </span>
                  </div>
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
            <h2 className="font-semibold text-white flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary-400" /> My Subjects
            </h2>
            <Link to="/student/subjects" className="text-primary-400 text-sm hover:text-primary-300 flex items-center gap-1">
              View all <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
            <div ref={subjectRailRef} onScroll={updateActiveSubject} className="subject-summary-list featured-lecture-rail lg:max-h-72 lg:overflow-y-auto lg:pr-1">
            {subjectStats.map(s => (
              <Link key={s.subject._id} to={`/student/attendance/${s.subject._id}`} className={`subject-summary-card featured-lecture-card group ${subjectStats[activeSubjectIndex]?.subject?._id === s.subject._id ? 'is-active' : ''}`}>
                <div className="flex items-start gap-2 sm:gap-3">
                  <div className={`mt-2 h-2 w-2 flex-shrink-0 rounded-full ${Number(s.percentage) >= minimumAttendance ? 'bg-emerald-400' : Number(s.percentage) > 0 ? 'bg-amber-400' : 'bg-slate-500'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="line-clamp-2 text-[12px] font-semibold text-white sm:text-sm">{s.subject.name}</span>
                      {s.subject.code && <span className="badge-info flex-shrink-0">{s.subject.code}</span>}
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[10px] text-slate-400">
                      <span className="rounded-lg bg-white/[0.04] px-1.5 py-1"><b className="block text-white">{s.totalLectures || 0}</b>Total</span>
                      <span className="rounded-lg bg-emerald-500/10 px-1.5 py-1"><b className="block text-emerald-300">{s.attended || 0}</b>Present</span>
                      <span className="rounded-lg bg-primary-500/10 px-1.5 py-1"><b className="block text-primary-300">{s.percentage}%</b>Rate</span>
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-slate-500 transition-colors group-hover:text-primary-300" />
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
          <div className="card-strip sm:grid-cols-2">
            {recentAttendance.slice(0, 6).map(a => (
              <div key={a._id} className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3 transition-colors hover:bg-white/5">
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

    </div>
  );
}
