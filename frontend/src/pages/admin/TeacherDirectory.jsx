import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { ArrowLeft, BookOpen, CalendarDays, CheckCircle, Copy, Mail, Video } from 'lucide-react';
import { adminAPI, lectureAPI } from '../../services/api';
import { useRealtimeRefresh } from '../../context/SocketContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageSkeleton } from '../../components/LoadingStates';
import { toDateInputValue } from '../../utils/dateInput';

const initialsFor = (name = '') => {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'T';
  return [parts[0], parts[Math.floor(parts.length / 2)], parts[parts.length - 1]]
    .filter(Boolean)
    .filter((part, index, arr) => arr.indexOf(part) === index)
    .map(part => part[0]?.toUpperCase())
    .join('')
    .slice(0, 3);
};

const Avatar = ({ teacher, size = 'h-12 w-12', className = '' }) => (
  <div className={`${size} ${className} flex-shrink-0 overflow-hidden rounded-2xl bg-primary-500/15 text-primary-200 ring-1 ring-primary-400/20`}>
    {teacher?.profileImage ? (
      <img src={teacher.profileImage} alt={teacher.name} className="h-full w-full object-cover" />
    ) : (
      <div className="flex h-full w-full items-center justify-center text-sm font-bold">{initialsFor(teacher?.name)}</div>
    )}
  </div>
);

function TeacherList() {
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadTeachers = () => {
    return adminAPI.getTeacherPeers()
      .then(res => setTeachers(res.data.teachers || []))
      .catch(err => toast.error(err.response?.data?.message || 'Could not load teachers'));
  };

  useEffect(() => {
    loadTeachers().finally(() => setLoading(false));
  }, []);

  useRealtimeRefresh(loadTeachers, ['teachers', 'subjects']);

  if (loading) return <PageSkeleton variant="grid" cards={6} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Teacher Directory</h1>
        <p className="mt-1 text-sm text-slate-400">Same-semester teacher profiles. Only public profile details are visible.</p>
      </div>
      <AdminBreadcrumb items={[{ label: 'Teacher Directory' }]} />
      {teachers.length === 0 ? (
        <div className="glass-card py-12 text-center text-sm text-slate-500">No other teachers found in your current semester workspace.</div>
      ) : (
        <div className="teacher-grid">
          {teachers.map((teacher, index) => (
            <motion.div key={teacher._id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}>
              <Link to={`/admin/teacher-directory/${teacher._id}`} className="teacher-card glass-card compact-card block border border-transparent transition-all hover:border-primary-500/40">
                <div className="teacher-card-content flex items-start gap-3">
                  <Avatar teacher={teacher} className="teacher-card-avatar" />
                  <div className="min-w-0 flex-1">
                    <p className="teacher-card-name line-clamp-2 font-semibold text-white">{teacher.name}</p>
                    <p className="teacher-card-email mt-1 flex items-center gap-1 break-all text-xs text-primary-300"><Mail className="h-3.5 w-3.5 flex-shrink-0" /> {teacher.email}</p>
                    {!!teacher.sharedSubjects?.length && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {teacher.sharedSubjects.slice(0, 5).map(subject => <span key={subject._id} className="badge-neutral">{subject.code}</span>)}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function TeacherDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(() => toDateInputValue());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copySource, setCopySource] = useState(null);
  const [copyingTarget, setCopyingTarget] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('all');

  const load = () => {
    setLoading(true);
    adminAPI.getTeacherPeerProfile(id, { date: selectedDate })
      .then(res => setData(res.data))
      .catch(err => {
        toast.error(err.response?.data?.message || 'Could not load teacher profile');
        navigate('/admin/teacher-directory');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [id, selectedDate]);

  useRealtimeRefresh(load, ['teachers', 'subjects', 'lectures', 'attendance'], [id, selectedDate]);

  const copyToLecture = async (targetLectureId) => {
    if (!copySource?._id || !targetLectureId) return;
    setCopyingTarget(targetLectureId);
    try {
      const res = await lectureAPI.copyAttendance(targetLectureId, copySource._id);
      toast.success(res.data.message || 'Attendance copied');
      setCopySource(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not copy attendance');
    } finally {
      setCopyingTarget('');
    }
  };

  const teacher = data?.teacher;
  const subjects = data?.subjects || [];
  const lectures = useMemo(() => {
    const allLectures = data?.lectures || [];
    if (!selectedSubjectId || selectedSubjectId === 'all') return allLectures;
    return allLectures.filter(lecture => String(lecture.subject?._id || lecture.subject) === String(selectedSubjectId));
  }, [data, selectedSubjectId]);
  const myTodayLectures = useMemo(() => data?.myTodayLectures || [], [data]);

  useEffect(() => {
    if (selectedSubjectId === 'all') return;
    const stillExists = subjects.some(subject => String(subject._id) === String(selectedSubjectId));
    if (!stillExists) setSelectedSubjectId('all');
  }, [subjects, selectedSubjectId]);

  if (loading) return <PageSkeleton variant="detail" rows={4} />;
  if (!teacher) return null;

  return (
    <div className="space-y-5">
      {typeof document !== 'undefined' && createPortal(
      <AnimatePresence>
        {copySource && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="app-modal-backdrop">
            <motion.div initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.96 }}
              className="glass-card max-h-[82vh] w-full max-w-2xl overflow-y-auto">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-white">Paste Attendance Into Your Lecture</h3>
              <p className="mt-1 text-sm text-slate-400">Choose one of your own lectures from the selected date. If you teach multiple subjects, select the exact lecture to paste into.</p>
                </div>
                <button type="button" onClick={() => setCopySource(null)} className="rounded-xl p-2 text-slate-400 hover:bg-white/10 hover:text-white">X</button>
              </div>
              {myTodayLectures.length === 0 ? (
                <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-500">You do not have any lecture on this date to paste into.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  {myTodayLectures.map(lecture => (
                    <button
                      key={lecture._id}
                      type="button"
                      disabled={Boolean(copyingTarget)}
                      onClick={() => copyToLecture(lecture._id)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition-colors hover:border-primary-400/40 disabled:opacity-60"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{lecture.title}</p>
                        <p className="mt-1 text-xs text-slate-500">{lecture.subject?.name} - {lecture.startTime} to {lecture.endTime}</p>
                      </div>
                      <span className="btn-secondary whitespace-nowrap px-3 py-2 text-xs">
                        {copyingTarget === lecture._id ? 'Copying...' : 'Paste Here'}
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

      <button type="button" onClick={() => navigate('/admin/teacher-directory')} className="flex items-center gap-2 text-slate-400 transition-colors hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Back to teachers
      </button>
      <AdminBreadcrumb items={[
        { label: 'Teacher Directory', onClick: () => navigate('/admin/teacher-directory') },
        { label: teacher.name }
      ]} />

      <section className="glass-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Avatar teacher={teacher} size="h-20 w-20" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-bold text-white">{teacher.name}</h1>
            <p className="mt-1 flex items-center gap-2 text-primary-300"><Mail className="h-4 w-4" /> {teacher.email}</p>
            <p className="mt-2 text-sm text-slate-500">Public teacher profile. Contact, address, password, and biometric details are private.</p>
          </div>
        </div>
      </section>

      <section className="glass-card">
        <h2 className="flex items-center gap-2 font-semibold text-white"><BookOpen className="h-5 w-5 text-primary-300" /> Same Semester Subjects</h2>
        <div className="mt-4 card-strip sm:grid-cols-2 xl:grid-cols-3">
          {subjects.length > 1 && (
            <button
              type="button"
              onClick={() => setSelectedSubjectId('all')}
              className={`rounded-xl border p-3 text-left transition-all ${
                selectedSubjectId === 'all'
                  ? 'border-primary-400/70 bg-primary-500/15 shadow-lg shadow-primary-950/20'
                  : 'border-white/10 bg-white/[0.03] hover:border-primary-400/40'
              }`}
            >
              <p className="truncate text-sm font-semibold text-white">All subjects</p>
              <p className="mt-1 text-xs text-primary-300">{subjects.length} allocated subjects</p>
              <p className="mt-1 text-xs text-slate-500">Show every lecture on selected date</p>
            </button>
          )}
          {subjects.map(subject => (
            <button
              key={subject._id}
              type="button"
              onClick={() => setSelectedSubjectId(subject._id)}
              className={`rounded-xl border p-3 text-left transition-all ${
                selectedSubjectId === subject._id
                  ? 'border-primary-400/70 bg-primary-500/15 shadow-lg shadow-primary-950/20'
                  : 'border-white/10 bg-white/[0.03] hover:border-primary-400/40'
              }`}
            >
              <p className="truncate text-sm font-semibold text-white">{subject.name}</p>
              <p className="mt-1 text-xs text-primary-300">{subject.code}</p>
              <p className="mt-1 text-xs text-slate-500">Semester {subject.semester}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-white"><Video className="h-5 w-5 text-emerald-300" /> Lecture Attendance</h2>
          <p className="mt-1 text-sm text-slate-400">
            Read-only date-wise attendance
            {selectedSubjectId !== 'all' ? ` for ${subjects.find(subject => subject._id === selectedSubjectId)?.name || 'the selected subject'}` : ''}.
            {' '}Copy it into any of your lectures on the selected date.
          </p>
        </div>
        <div className="glass-card compact-card">
          <label className="label flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Select Date</label>
          <input type="date" className="input-field mt-2 max-w-xs" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} />
        </div>
        {lectures.length === 0 ? (
          <div className="glass-card py-10 text-center text-sm text-slate-500">
            No lectures found for {selectedSubjectId === 'all' ? 'this teacher' : 'the selected subject'} on the selected date.
          </div>
        ) : (
          <div className="space-y-3">
            {lectures.map(lecture => (
              <div key={lecture._id} className="glass-card compact-card">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-white">{lecture.title}</h3>
                      <span className="badge-info">{lecture.subject?.code}</span>
                      <span className="badge-neutral">{lecture.startTime} - {lecture.endTime}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{lecture.subject?.name}</p>
                  </div>
                  <button type="button" onClick={() => setCopySource(lecture)} className="btn-secondary flex items-center justify-center gap-2">
                    <Copy className="h-4 w-4" /> Copy Attendance
                  </button>
                </div>
                <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02]">
                  <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-sm font-semibold text-white">
                    <CheckCircle className="h-4 w-4 text-emerald-300" /> Present ({lecture.attendance?.length || 0})
                  </div>
                  {(lecture.attendance || []).length === 0 ? (
                    <p className="p-3 text-sm text-slate-500">No attendance marked yet.</p>
                  ) : (
                    <div className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
                      {lecture.attendance.map(record => (
                        <div key={record._id} className="flex items-center gap-2 rounded-lg bg-white/[0.03] p-2">
                          <div className="h-8 w-8 overflow-hidden rounded-lg bg-primary-500/15 text-primary-200">
                            {record.student?.profileImage
                              ? <img src={record.student.profileImage} alt="" className="h-full w-full object-cover" />
                              : <div className="flex h-full w-full items-center justify-center text-xs font-bold">{record.student?.name?.[0] || 'S'}</div>}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-white">{record.student?.name}</p>
                            <p className="text-[11px] text-slate-500">{record.student?.studentId}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function TeacherDirectory() {
  const { id } = useParams();
  return id ? <TeacherDetail /> : <TeacherList />;
}
