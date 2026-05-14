import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Users, BookOpen, Video, CheckCircle, Clock, TrendingUp, ChevronRight,
  Folder, FolderOpen, GraduationCap, ArrowLeft, Building2, Monitor, BarChart3
} from 'lucide-react';
import { adminAPI, lectureAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { LoadingOverlay, PageLoader } from '../../components/LoadingStates';
import PendingDeletionPanel from '../../components/PendingDeletionPanel';

const StatCard = ({ icon: Icon, label, value, color, delay }) => (
  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
    className="glass-card flex items-center gap-4">
    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
      <Icon className="w-6 h-6" />
    </div>
    <div>
      <p className="text-slate-400 text-sm">{label}</p>
      <p className="text-2xl font-bold text-white font-display">{value ?? '...'}</p>
    </div>
  </motion.div>
);

const sortLecturesByDateAsc = (items = []) => [...items].sort((a, b) => {
  const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
  if (dateDiff !== 0) return dateDiff;
  return String(a.startTime || '').localeCompare(String(b.startTime || ''));
});

const isSuperAdminUser = (user) => user?.role === 'admin' && (
  user?.email === 'admin@school.edu' ||
  user?.department === 'Administration'
);

const Metric = ({ label, value }) => (
  <div className="rounded-lg bg-white/5 border border-white/10 px-3 py-2">
    <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
    <p className="text-white font-semibold mt-0.5">{value ?? 0}</p>
  </div>
);

function SuperAdminDashboard({ user }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedSemester, setSelectedSemester] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');

  const fetchOverview = async () => {
    setLoading(true);
    try {
      const params = {};
      if (selectedDepartment) params.department = selectedDepartment;
      if (selectedSemester) params.semester = selectedSemester;
      if (selectedSubjectId) params.subjectId = selectedSubjectId;
      const res = await adminAPI.getSuperOverview(params);
      setOverview(res.data);
    } catch (err) {
      console.error('Super overview error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, [selectedDepartment, selectedSemester, selectedSubjectId]);

  const departments = overview?.departments || [];
  const semesters = overview?.semesters || [];
  const subjects = overview?.subjects || [];
  const lectures = overview?.lectures || [];
  const selectedDepartmentStats = departments.find(item => item.name === selectedDepartment);
  const selectedSemesterStats = semesters.find(item => Number(item.semester) === Number(selectedSemester));
  const selectedSubject = overview?.selectedSubject || subjects.find(item => item._id === selectedSubjectId);
  const breadcrumbItems = [
    { label: 'Departments', onClick: () => { setSelectedDepartment(''); setSelectedSemester(''); setSelectedSubjectId(''); } },
    selectedDepartment && { label: selectedDepartment, onClick: () => { setSelectedSemester(''); setSelectedSubjectId(''); } },
    selectedSemester && { label: `Semester ${selectedSemester}`, onClick: selectedSubjectId ? () => setSelectedSubjectId('') : undefined },
    selectedSubject && { label: selectedSubject.name },
    selectedSubject && { label: 'Lectures & Attendance' }
  ];

  const selectDepartment = (department) => {
    setSelectedDepartment(department);
    setSelectedSemester('');
    setSelectedSubjectId('');
  };

  const selectSemester = (semester) => {
    setSelectedSemester(String(semester));
    setSelectedSubjectId('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary-400" /> Super Admin Dashboard
          </h1>
          <p className="text-slate-400 mt-1">
            {user?.email} can monitor all departments, semesters, subjects, lectures, and attendance.
          </p>
        </div>
        {(selectedDepartment || selectedSemester || selectedSubjectId) && (
          <button
            type="button"
            onClick={() => {
              if (selectedSubjectId) setSelectedSubjectId('');
              else if (selectedSemester) setSelectedSemester('');
              else setSelectedDepartment('');
            }}
            className="btn-secondary inline-flex items-center gap-2 justify-center"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        )}
      </div>

      {loading && !overview ? (
        <PageLoader label="Loading Super Admin dashboard..." />
      ) : (
        <div className="relative space-y-6">
          <LoadingOverlay show={loading && Boolean(overview)} label="Loading selected folder data..." />
          <AdminBreadcrumb items={breadcrumbItems} />
          <PendingDeletionPanel />

          {!selectedDepartment && (
            <section className="space-y-3">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Folder className="w-5 h-5 text-primary-400" /> Department Folders
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {departments.map((department, index) => (
                  <motion.button
                    key={department.name}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    onClick={() => selectDepartment(department.name)}
                    className="glass-card text-left border border-transparent hover:border-primary-500/40 transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-11 h-11 rounded-xl bg-primary-500/15 text-primary-300 flex items-center justify-center flex-shrink-0">
                        <Folder className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white truncate">{department.name}</p>
                        <p className="text-slate-500 text-sm">{department.subjects} subjects · {department.lectures} lectures</p>
                        <div className="grid grid-cols-3 gap-2 mt-3">
                          <Metric label="Students" value={department.students} />
                          <Metric label="Done" value={department.completedLectures} />
                          <Metric label="Present" value={department.attendanceRecords} />
                        </div>
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </section>
          )}

          {selectedDepartment && !selectedSemester && (
            <section className="space-y-4">
              <div className="glass-card">
                <div className="flex items-center gap-3">
                  <FolderOpen className="w-6 h-6 text-primary-300" />
                  <div>
                    <h2 className="font-semibold text-white">{selectedDepartment}</h2>
                    <p className="text-sm text-slate-400">Select a semester folder to view subjects.</p>
                  </div>
                </div>
                {selectedDepartmentStats && (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
                    <Metric label="Students" value={selectedDepartmentStats.students} />
                    <Metric label="Pending" value={selectedDepartmentStats.pendingStudents} />
                    <Metric label="Subjects" value={selectedDepartmentStats.subjects} />
                    <Metric label="Lectures" value={selectedDepartmentStats.lectures} />
                    <Metric label="Attendance" value={selectedDepartmentStats.attendanceRecords} />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {semesters.map((semester) => (
                  <button
                    key={semester.semester}
                    onClick={() => selectSemester(semester.semester)}
                    className="glass-card text-left border border-transparent hover:border-emerald-500/40 transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center flex-shrink-0">
                        <GraduationCap className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-white">Semester {semester.semester}</p>
                        <p className="text-slate-500 text-sm">{semester.subjects} subjects · {semester.students} students</p>
                        <div className="grid grid-cols-2 gap-2 mt-3">
                          <Metric label="Lectures" value={semester.lectures} />
                          <Metric label="Done" value={semester.completedLectures} />
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {selectedDepartment && selectedSemester && !selectedSubjectId && (
            <section className="space-y-4">
              <div className="glass-card">
                <h2 className="font-semibold text-white">Semester {selectedSemester} Subjects</h2>
                <p className="text-sm text-slate-400 mt-1">{selectedDepartment} · choose a subject to view lectures and attendance.</p>
                {selectedSemesterStats && (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
                    <Metric label="Students" value={selectedSemesterStats.students} />
                    <Metric label="Pending" value={selectedSemesterStats.pendingStudents} />
                    <Metric label="Subjects" value={selectedSemesterStats.subjects} />
                    <Metric label="Lectures" value={selectedSemesterStats.lectures} />
                    <Metric label="Attendance" value={selectedSemesterStats.attendanceRecords} />
                  </div>
                )}
              </div>
              {subjects.length === 0 ? (
                <div className="text-center py-16 text-slate-500 glass-card">No subjects found in this semester.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {subjects.map((subject) => (
                    <button
                      key={subject._id}
                      onClick={() => setSelectedSubjectId(subject._id)}
                      className="glass-card text-left border border-transparent hover:border-violet-500/40 transition-all"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-violet-500/15 text-violet-300 flex items-center justify-center flex-shrink-0">
                          <BookOpen className="w-5 h-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-white truncate">{subject.name}</p>
                          <p className="text-primary-300 text-sm font-mono">{subject.code}</p>
                          <div className="grid grid-cols-2 gap-2 mt-3">
                            <Metric label="Lectures" value={subject.lectureCount} />
                            <Metric label="Students" value={subject.enrolledStudents} />
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {selectedSubjectId && (
            <section className="space-y-4">
              <div className="glass-card">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-white flex items-center gap-2">
                      <BookOpen className="w-5 h-5 text-violet-300" /> {selectedSubject?.name}
                    </h2>
                    <p className="text-sm text-slate-400 mt-1">
                      {selectedSubject?.code} · {selectedDepartment} · Semester {selectedSemester}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 min-w-[min(100%,360px)]">
                    <Metric label="Lectures" value={lectures.length} />
                    <Metric label="Completed" value={lectures.filter(lecture => lecture.status === 'completed').length} />
                    <Metric label="Open" value={lectures.filter(lecture => lecture.attendanceOpen).length} />
                  </div>
                </div>
              </div>
              {lectures.length === 0 ? (
                <div className="text-center py-16 text-slate-500 glass-card">No lectures created for this subject.</div>
              ) : (
                <div className="space-y-3">
                  {lectures.map((lecture, index) => (
                    <motion.div
                      key={lecture._id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className="glass-card border border-transparent hover:border-white/10"
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                        <div className={`h-2 w-full lg:w-2 lg:h-16 rounded-full flex-shrink-0 ${lecture.attendanceOpen ? 'bg-emerald-500' : lecture.status === 'completed' ? 'bg-primary-500' : 'bg-slate-600'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-white">{lecture.title}</h3>
                            {lecture.isLab && <span className="badge badge-info flex items-center gap-1"><Monitor className="w-3 h-3" /> {lecture.labNumber || 'LAB'}</span>}
                            <span className={`badge ${lecture.attendanceOpen ? 'badge-success' : lecture.status === 'completed' ? 'badge-info' : 'badge-neutral'}`}>
                              {lecture.attendanceOpen ? 'Open' : lecture.status}
                            </span>
                          </div>
                          <p className="text-slate-500 text-xs mt-1">
                            {new Date(lecture.date).toLocaleDateString()} · {lecture.startTime} - {lecture.endTime}
                          </p>
                        </div>
                        <div className="grid grid-cols-3 gap-2 w-full lg:w-[360px]">
                          <Metric label="Present" value={lecture.attendanceStats?.present} />
                          <Metric label="Absent" value={lecture.attendanceStats?.absent} />
                          <Metric label="%" value={`${lecture.attendanceStats?.percentage || '0.0'}%`} />
                        </div>
                        <Link to={`/admin/lectures/${lecture._id}`} className="btn-secondary inline-flex items-center justify-center gap-2">
                          <BarChart3 className="w-4 h-4" /> Details
                        </Link>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState(null);
  const [pending, setPending] = useState([]);
  const [recentLectures, setRecentLectures] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = () => {
    setLoading(true);
    Promise.all([
      adminAPI.getAnalytics(),
      adminAPI.getPending(),
      lectureAPI.getAll({ limit: 5 })
    ]).then(([ana, pend, lec]) => {
      setAnalytics(ana.data.analytics);
      setPending(pend.data.students);
      setRecentLectures(sortLecturesByDateAsc(lec.data.lectures).slice(0, 5));
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDashboard();
    window.addEventListener('admin-scope:changed', fetchDashboard);
    return () => window.removeEventListener('admin-scope:changed', fetchDashboard);
  }, []);

  if (isSuperAdminUser(user)) return <SuperAdminDashboard user={user} />;

  if (loading) {
    return <PageLoader label="Loading dashboard..." />;
  }

  const stats = analytics ? [
    { icon: Users, label: 'Active Students', value: analytics.totalStudents, color: 'bg-primary-500/20 text-primary-400' },
    { icon: Clock, label: 'Pending Approval', value: analytics.pendingStudents, color: 'bg-amber-500/20 text-amber-400' },
    { icon: BookOpen, label: 'Active Subjects', value: analytics.totalSubjects, color: 'bg-violet-500/20 text-violet-400' },
    { icon: Video, label: 'Total Lectures', value: analytics.totalLectures, color: 'bg-emerald-500/20 text-emerald-400' },
  ] : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Welcome back, {user?.name?.split(' ')[0]}!</h1>
        <p className="text-slate-400 mt-1">
          {user?.adminSemesterScope ? `${user.department} - Semester ${user.adminSemesterScope} workspace` : "Here's what's happening in your institution today."}
        </p>
      </div>

      <AdminBreadcrumb items={[
        { label: user?.department || 'Administration' },
        user?.adminSemesterScope && { label: `Semester ${user.adminSemesterScope}` },
        { label: 'Dashboard' }
      ]} />

      <PendingDeletionPanel />

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => <StatCard key={s.label} {...s} delay={i * 0.08} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Registrations */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-400" />
              Pending Registrations
              {pending.length > 0 && (
                <span className="badge-warning">{pending.length}</span>
              )}
            </h2>
            <Link to="/admin/students" className="text-primary-400 hover:text-primary-300 text-sm flex items-center gap-1">
              View all <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          {pending.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <CheckCircle className="w-10 h-10 mx-auto mb-2 text-emerald-500/40" />
              <p>No pending requests</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.slice(0, 4).map(student => (
                <Link key={student._id} to={`/admin/students/${student._id}`}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors group">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10 flex-shrink-0">
                    {student.profileImage
                      ? <img src={student.profileImage} alt={student.name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-slate-400 font-semibold">{student.name[0]}</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white text-sm truncate">{student.name}</p>
                    <p className="text-slate-500 text-xs">{student.studentId} · {student.department}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
                </Link>
              ))}
            </div>
          )}
        </motion.div>

        {/* Recent Lectures */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="glass-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Video className="w-5 h-5 text-primary-400" />
              Recent Lectures
            </h2>
            <Link to="/admin/lectures" className="text-primary-400 hover:text-primary-300 text-sm flex items-center gap-1">
              View all <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          {recentLectures.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <Video className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p>No lectures yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentLectures.map(lec => (
                <Link key={lec._id} to={`/admin/lectures/${lec._id}`}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors group">
                  <div className={`w-2 h-10 rounded-full flex-shrink-0 ${lec.attendanceOpen ? 'bg-emerald-500' : lec.status === 'completed' ? 'bg-primary-500' : 'bg-slate-600'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white text-sm truncate">{lec.title}</p>
                    <p className="text-slate-500 text-xs">{lec.subject?.name} · {new Date(lec.date).toLocaleDateString()}</p>
                  </div>
                  <span className={`badge ${lec.attendanceOpen ? 'badge-success' : lec.status === 'completed' ? 'badge-info' : 'badge-neutral'}`}>
                    {lec.attendanceOpen ? 'Open' : lec.status}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </motion.div>

        {/* Top Students */}
        {analytics?.topStudents?.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="glass-card lg:col-span-2">
            <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              Top Attendance Students
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {analytics.topStudents.slice(0, 5).map((s, i) => (
                <div key={s._id} className="text-center p-3 rounded-xl bg-white/5">
                  <div className="w-10 h-10 rounded-full bg-primary-600/20 flex items-center justify-center mx-auto mb-2 text-primary-400 font-bold">
                    #{i + 1}
                  </div>
                  <p className="text-sm font-medium text-white truncate">{s.name}</p>
                  <p className="text-xs text-slate-500">{s.studentId}</p>
                  <p className="text-emerald-400 text-sm font-semibold mt-1">{s.count} classes</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
