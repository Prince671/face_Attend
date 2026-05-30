import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart3, BookOpen, ChevronRight, GraduationCap } from 'lucide-react';
import { useGetMySubjectsQuery } from '../../services/apiSlice';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageSkeleton } from '../../components/LoadingStates';
import { getAcademicLabel, getSemesterLabel } from '../../utils/academicLabels';
import { hydrateLmsActivity, lmsActivityBucketForType, lmsActivityEventName, markLmsActivity, readLmsActivity } from '../../utils/lmsActivity';

export default function StudentSubjects() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const { data, isLoading: loading, error } = useGetMySubjectsQuery(undefined, { refetchOnReconnect: true });
  const subjects = data?.subjects || [];
  const [activity, setActivity] = useState(() => readLmsActivity(user?._id));
  if (error) console.error(error);

  useEffect(() => {
    setActivity(readLmsActivity(user?._id));
    hydrateLmsActivity(user?._id).then(setActivity);
  }, [user?._id]);

  useEffect(() => {
    const syncActivity = () => setActivity(readLmsActivity(user?._id));
    window.addEventListener(lmsActivityEventName, syncActivity);
    return () => window.removeEventListener(lmsActivityEventName, syncActivity);
  }, [user?._id]);

  useEffect(() => {
    if (!socket) return undefined;
    const handleLmsChange = (payload = {}) => {
      const bucket = lmsActivityBucketForType(payload.type);
      if (!payload.subjectId || !bucket) return;
      markLmsActivity(user?._id, String(payload.subjectId), bucket);
    };
    socket.on('lms_changed', handleLmsChange);
    return () => socket.off('lms_changed', handleLmsChange);
  }, [socket, user?._id]);

  if (loading) return <PageSkeleton variant="grid" cards={6} />;
  const academicLabel = getAcademicLabel(user);
  const activityLabels = { materials: 'Material', assignments: 'Assignment', quizzes: 'Quiz' };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">My Subjects</h1>
        <p className="text-slate-400 mt-1">{getSemesterLabel(user?.semester)} - {academicLabel}</p>
      </div>

      <AdminBreadcrumb items={[
        { label: academicLabel },
        user?.semester && { label: getSemesterLabel(user.semester) },
        { label: 'Subjects' }
      ]} />

      {subjects.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No subjects enrolled yet. Contact admin.</p>
        </div>
      ) : (
        <div className="three-card-grid student-subject-grid">
          {subjects.map((sub, i) => (
            <motion.div key={sub._id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
              <div className="subject-card relative flex h-full flex-col glass-card compact-card hover:border-primary-500/20 border border-transparent transition-all group">
                {Object.values(activity[String(sub._id)] || {}).some(Boolean) && (
                  <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_0_4px_rgba(239,68,68,0.14)]" aria-label="New classroom activity" />
                )}
                <div className="flex items-start justify-between mb-2 sm:mb-3">
                  <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-xl bg-primary-500/20 flex items-center justify-center">
                    <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-primary-400" />
                  </div>
                  <Link className="hidden sm:block" to={`/student/subjects/${sub._id}/classroom`} aria-label={`Open ${sub.name} classroom`}>
                    <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600 group-hover:text-slate-400 transition-colors" />
                  </Link>
                </div>
                <h3 className="line-clamp-2 text-[11px] font-semibold leading-snug text-white sm:text-base">{sub.name}</h3>
                <p className="hidden truncate font-mono text-[10px] text-primary-400 sm:block sm:text-sm">{sub.code}</p>
                <p className="mt-1 hidden text-xs text-slate-500 sm:block">{sub.branch || sub.department} - {sub.credits} Credits</p>
                <p className="mt-3 hidden text-[11px] text-slate-400 sm:block sm:text-xs">Open classroom for materials, assignments, quizzes, and announcements.</p>
                {!!activity[String(sub._id)] && (
                  <div className="mt-2 hidden flex-wrap gap-1.5 sm:flex">
                    {Object.entries(activityLabels).map(([key, label]) => activity[String(sub._id)]?.[key] ? (
                      <span key={key} className="inline-flex items-center gap-1 rounded-full border border-red-400/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" /> {label}
                      </span>
                    ) : null)}
                  </div>
                )}
                <div className="mt-auto grid grid-cols-2 gap-2 pt-3 sm:mt-3 sm:pt-0">
                  <Link
                    to={`/student/subjects/${sub._id}/classroom`}
                    className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-primary-500/10 px-2 py-1 text-[11px] text-primary-200 transition-colors hover:bg-primary-500/15"
                    title="Classroom"
                    aria-label={`Open ${sub.name} classroom`}
                  >
                    <GraduationCap className="h-4 w-4 sm:h-3 sm:w-3" />
                    <span className="hidden sm:inline">Classroom</span>
                  </Link>
                  <Link
                    to={`/student/attendance/${sub._id}`}
                    className="inline-flex min-h-9 items-center justify-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/10"
                    title="Attendance"
                    aria-label={`Open ${sub.name} attendance`}
                  >
                    <BarChart3 className="h-4 w-4 sm:h-3 sm:w-3" />
                    <span className="hidden sm:inline">Attendance</span>
                  </Link>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
