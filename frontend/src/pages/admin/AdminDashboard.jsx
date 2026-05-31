import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Users, BookOpen, Video, CheckCircle, Clock, TrendingUp, ChevronRight,
  Folder, FolderOpen, GraduationCap, ArrowLeft, Building2, Monitor, BarChart3,
  AlertTriangle, Send, MessageSquare, Calendar, ClipboardList, Trophy, FileText
} from 'lucide-react';
import toast from 'react-hot-toast';
import { adminAPI, attendanceAPI, lmsAPI, subjectAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../context/SocketContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { LoadingOverlay } from '../../components/LoadingStates';
import PendingDeletionPanel from '../../components/PendingDeletionPanel';
import { toDateInputValue } from '../../utils/dateInput';
import { sortByStudentIdTail } from '../../utils/studentSort';

const StatCard = ({ icon: Icon, label, value, color, delay, to }) => {
  const content = (
    <>
      <div className={`stat-tile-icon ${color}`}>
        <Icon className="w-7 h-7" />
      </div>
      <div className="space-y-2">
        <p className="stat-tile-label">{label}</p>
        <p className="stat-tile-value">{value ?? '...'}</p>
      </div>
    </>
  );
  const className = `stat-tile ${to ? 'border border-transparent hover:border-primary-500/40 cursor-pointer' : ''}`;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      {to ? <Link to={to} className={className}>{content}</Link> : <div className={className}>{content}</div>}
    </motion.div>
  );
};

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

const SkeletonLine = ({ className = '' }) => <div className={`skeleton-shimmer rounded-full ${className}`} />;

const SkeletonMetric = () => (
  <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
    <SkeletonLine className="h-3 w-16" />
    <SkeletonLine className="mt-2 h-5 w-10" />
  </div>
);

const DashboardHeaderSkeleton = ({ superAdmin = false }) => (
  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
    <div className="space-y-2">
      <SkeletonLine className={`h-8 ${superAdmin ? 'w-72' : 'w-56'} max-w-full`} />
      <SkeletonLine className="h-4 w-80 max-w-full" />
    </div>
    {superAdmin && <SkeletonLine className="h-11 w-28 rounded-xl" />}
  </div>
);

function SuperAdminDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <DashboardHeaderSkeleton superAdmin />
      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3].map(index => <SkeletonLine key={index} className="h-8 w-28" />)}
      </div>
      <section className="space-y-3">
        <SkeletonLine className="h-6 w-44" />
        <div className="card-strip sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map(index => (
            <div key={index} className="glass-card compact-card">
              <div className="flex items-start gap-3">
                <SkeletonLine className="h-11 w-11 rounded-xl" />
                <div className="min-w-0 flex-1 space-y-2">
                  <SkeletonLine className="h-5 w-40" />
                  <SkeletonLine className="h-4 w-56 max-w-full" />
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <SkeletonMetric />
                    <SkeletonMetric />
                    <SkeletonMetric />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map(index => (
          <div key={index} className="glass-card space-y-3">
            <SkeletonLine className="h-5 w-40" />
            {[0, 1, 2].map(row => <SkeletonLine key={row} className="h-14 rounded-xl" />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminDashboardSkeleton({ isTeacher = false }) {
  const statCount = isTeacher ? 4 : 4;
  return (
    <div className="space-y-6">
      <DashboardHeaderSkeleton />
      <div className="flex flex-wrap gap-2">
        <SkeletonLine className="h-8 w-36" />
        <SkeletonLine className="h-8 w-24" />
      </div>
      <div className="glass-card space-y-3">
        <SkeletonLine className="h-5 w-40" />
        <SkeletonLine className="h-12 rounded-xl" />
      </div>
      <div className="stats-strip sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: statCount }).map((_, index) => (
          <div key={index} className="stat-tile">
            <SkeletonLine className="h-14 w-14 rounded-2xl sm:h-16 sm:w-16" />
            <div className="w-full space-y-2">
              <SkeletonLine className="mx-auto h-3 w-24" />
              <SkeletonLine className="mx-auto h-7 w-16" />
            </div>
          </div>
        ))}
      </div>

      <div className="glass-card">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <SkeletonLine className="h-5 w-36" />
            <SkeletonLine className="h-4 w-72 max-w-full" />
          </div>
          <SkeletonLine className="h-11 w-full rounded-xl sm:w-40" />
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          {Array.from({ length: 8 }).map((_, index) => <SkeletonMetric key={index} />)}
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

      <div className="glass-card">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <SkeletonLine className="h-5 w-44" />
            <SkeletonLine className="h-4 w-80 max-w-full" />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <SkeletonLine className="h-11 w-full rounded-xl sm:w-36" />
            <SkeletonLine className="h-11 w-full rounded-xl sm:w-36" />
            <SkeletonLine className="h-11 w-full rounded-xl sm:w-36" />
          </div>
        </div>
        <div className="card-strip lg:block lg:max-h-80 lg:space-y-3 lg:overflow-hidden">
          {[0, 1, 2, 3].map(index => (
            <div key={index} className="flex min-w-64 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <SkeletonLine className="h-10 w-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <SkeletonLine className="h-4 w-40 max-w-full" />
                <SkeletonLine className="h-3 w-56 max-w-full" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <SkeletonLine className="h-9 w-10 rounded-lg" />
                <SkeletonLine className="h-9 w-10 rounded-lg" />
                <SkeletonLine className="h-9 w-10 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const updateQuery = (setSearchParams, updates = {}) => {
  setSearchParams(previous => {
    const params = new URLSearchParams(previous);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') params.delete(key);
      else params.set(key, String(value));
    });
    return params;
  });
};

const scopedPath = (path, scope = {}) => {
  const [pathname, existingQuery = ''] = path.split('?');
  const params = new URLSearchParams(existingQuery);
  if (scope.department) params.set('department', scope.department);
  if (scope.semester) params.set('semester', scope.semester);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
};

function SuperAdminDashboard({ user }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const selectedCourse = searchParams.get('course') || '';
  const selectedBranch = searchParams.get('branch') || '';
  const selectedDepartment = searchParams.get('department') || '';
  const selectedSemester = searchParams.get('semester') || '';
  const selectedSubjectId = searchParams.get('subjectId') || '';

  const fetchOverview = async () => {
    setLoading(true);
    try {
      const params = {};
      if (selectedCourse) params.course = selectedCourse;
      if (selectedBranch) params.branch = selectedBranch;
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
  }, [selectedCourse, selectedBranch, selectedDepartment, selectedSemester, selectedSubjectId]);

  const courses = overview?.courses || [];
  const branches = overview?.branches || [];
  const departments = overview?.departments || [];
  const semesters = overview?.semesters || [];
  const subjects = overview?.subjects || [];
  const lectures = overview?.lectures || [];
  const selectedCourseStats = courses.find(item => item.name === selectedCourse);
  const selectedBranchStats = branches.find(item => item.name === selectedBranch);
  const selectedDepartmentStats = departments.find(item => item.name === selectedDepartment);
  const selectedSemesterStats = semesters.find(item => Number(item.semester) === Number(selectedSemester));
  const selectedSubject = overview?.selectedSubject || subjects.find(item => item._id === selectedSubjectId);
  const breadcrumbItems = [
    { label: 'Courses', onClick: () => updateQuery(setSearchParams, { course: '', branch: '', department: '', semester: '', subjectId: '' }) },
    selectedCourse && { label: selectedCourse, onClick: () => updateQuery(setSearchParams, { branch: '', semester: '', subjectId: '' }) },
    selectedBranch && { label: selectedBranch, onClick: () => updateQuery(setSearchParams, { semester: '', subjectId: '' }) },
    selectedDepartment && { label: selectedDepartment, onClick: () => updateQuery(setSearchParams, { semester: '', subjectId: '' }) },
    selectedSemester && { label: `Semester ${selectedSemester}`, onClick: selectedSubjectId ? () => updateQuery(setSearchParams, { subjectId: '' }) : undefined },
    selectedSubject && { label: selectedSubject.name },
    selectedSubject && { label: 'Lectures & Attendance' }
  ];

  const selectDepartment = (department) => {
    updateQuery(setSearchParams, { department, semester: '', subjectId: '' });
  };

  const selectCourse = (course) => {
    updateQuery(setSearchParams, { course, branch: '', department: '', semester: '', subjectId: '' });
  };

  const selectBranch = (branch) => {
    updateQuery(setSearchParams, { branch, semester: '', subjectId: '' });
  };

  const selectSemester = (semester) => {
    updateQuery(setSearchParams, { semester: String(semester), subjectId: '' });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary-400" /> Super Admin Dashboard
          </h1>
          <p className="text-slate-400 mt-1">
            {user?.email} can monitor every course, branch, semester, subject, lecture, and attendance record.
          </p>
        </div>
        {(selectedCourse || selectedBranch || selectedDepartment || selectedSemester || selectedSubjectId) && (
          <button
            type="button"
            onClick={() => {
              if (selectedSubjectId) updateQuery(setSearchParams, { subjectId: '' });
              else if (selectedSemester) updateQuery(setSearchParams, { semester: '' });
              else if (selectedBranch) updateQuery(setSearchParams, { branch: '' });
              else if (selectedCourse) updateQuery(setSearchParams, { course: '' });
              else updateQuery(setSearchParams, { department: '' });
            }}
            className="btn-secondary inline-flex items-center gap-2 justify-center"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        )}
      </div>

      {loading && !overview ? (
        <SuperAdminDashboardSkeleton />
      ) : (
        <div className="relative space-y-6">
          <LoadingOverlay show={loading && Boolean(overview)} label="Loading selected folder data..." />
          <AdminBreadcrumb items={breadcrumbItems} />
          <PendingDeletionPanel />

          {!selectedCourse && !selectedDepartment && (
            <section className="space-y-3">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Folder className="w-5 h-5 text-primary-400" /> Course Folders
              </h2>
              <div className="card-strip sm:grid-cols-2 xl:grid-cols-3">
                {courses.map((course, index) => (
                  <motion.button
                    key={course.name}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    onClick={() => selectCourse(course.name)}
                    className="glass-card compact-card text-left border border-transparent hover:border-primary-500/40 transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-11 h-11 rounded-xl bg-primary-500/15 text-primary-300 flex items-center justify-center flex-shrink-0">
                        <Folder className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white truncate">{course.name}</p>
                        <p className="text-slate-500 text-sm">{course.branches} branches - {course.subjects} subjects</p>
                        <div className="grid grid-cols-3 gap-2 mt-3">
                          <Metric label="Students" value={course.students} />
                          <Metric label="Pending" value={course.pendingStudents} />
                          <Metric label="Subjects" value={course.subjects} />
                        </div>
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </section>
          )}

          {selectedCourse && !selectedBranch && (
            <section className="space-y-4">
              <div className="glass-card">
                <div className="flex items-center gap-3">
                  <FolderOpen className="w-6 h-6 text-primary-300" />
                  <div>
                    <h2 className="font-semibold text-white">{selectedCourse}</h2>
                    <p className="text-sm text-slate-400">Select a branch folder to view semesters.</p>
                  </div>
                </div>
                {selectedCourseStats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                    <Metric label="Students" value={selectedCourseStats.students} />
                    <Metric label="Pending" value={selectedCourseStats.pendingStudents} />
                    <Metric label="Branches" value={selectedCourseStats.branches} />
                    <Metric label="Subjects" value={selectedCourseStats.subjects} />
                  </div>
                )}
              </div>
              <div className="card-strip sm:grid-cols-2 xl:grid-cols-4">
                {branches.map((branch) => (
                  <button
                    key={branch.name}
                    onClick={() => selectBranch(branch.name)}
                    className="glass-card compact-card text-left border border-transparent hover:border-cyan-500/40 transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center flex-shrink-0">
                        <Folder className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-white line-clamp-2">{branch.name}</p>
                        <p className="text-slate-500 text-sm">{branch.subjects} subjects - {branch.students} students</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {((selectedCourse && selectedBranch) || selectedDepartment) && !selectedSemester && (
            <section className="space-y-4">
              <div className="glass-card">
                <div className="flex items-center gap-3">
                  <FolderOpen className="w-6 h-6 text-primary-300" />
                  <div>
                    <h2 className="font-semibold text-white">{selectedBranch || selectedDepartment}</h2>
                    <p className="text-sm text-slate-400">Select a semester folder to view subjects.</p>
                  </div>
                </div>
                {(selectedBranchStats || selectedDepartmentStats) && (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
                    <Metric label="Students" value={(selectedBranchStats || selectedDepartmentStats).students} />
                    <Metric label="Pending" value={(selectedBranchStats || selectedDepartmentStats).pendingStudents} />
                    <Metric label="Subjects" value={(selectedBranchStats || selectedDepartmentStats).subjects} />
                    <Metric label="Lectures" value={selectedDepartmentStats?.lectures || 0} />
                    <Metric label="Attendance" value={selectedDepartmentStats?.attendanceRecords || 0} />
                  </div>
                )}
              </div>
              <div className="card-strip sm:grid-cols-2 xl:grid-cols-4">
                {semesters.map((semester) => (
                  <button
                    key={semester.semester}
                    onClick={() => selectSemester(semester.semester)}
                    className="glass-card compact-card text-left border border-transparent hover:border-emerald-500/40 transition-all"
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

          {((selectedCourse && selectedBranch) || selectedDepartment) && selectedSemester && !selectedSubjectId && (
            <section className="space-y-4">
              <div className="glass-card">
                <h2 className="font-semibold text-white">Semester {selectedSemester} Subjects</h2>
                <p className="text-sm text-slate-400 mt-1">{selectedBranch || selectedDepartment} · choose a subject to view lectures and attendance.</p>
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
                <div className="card-strip sm:grid-cols-2 xl:grid-cols-3">
                  {subjects.map((subject) => (
                    <button
                      key={subject._id}
                      onClick={() => updateQuery(setSearchParams, { subjectId: subject._id })}
                      className="glass-card compact-card text-left border border-transparent hover:border-violet-500/40 transition-all"
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
                      {selectedSubject?.code} · {selectedBranch || selectedDepartment} · Semester {selectedSemester}
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
                <div className="card-strip lg:block lg:space-y-3">
                  {lectures.map((lecture, index) => (
                    <motion.div
                      key={lecture._id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className="glass-card compact-card border border-transparent hover:border-white/10"
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
  const { socket } = useSocket();
  const [analytics, setAnalytics] = useState(null);
  const [teacherDashboard, setTeacherDashboard] = useState(null);
  const [lmsSummary, setLmsSummary] = useState(null);
  const [teacherDisputes, setTeacherDisputes] = useState([]);
  const [notifyingSubject, setNotifyingSubject] = useState('');
  const [resolvingDispute, setResolvingDispute] = useState('');
  const [pending, setPending] = useState([]);
  const [recentLectures, setRecentLectures] = useState([]);
  const [selectedTopSubject, setSelectedTopSubject] = useState('');
  const [lectureSemester, setLectureSemester] = useState('');
  const [lectureSubjectId, setLectureSubjectId] = useState('');
  const [lectureSubjects, setLectureSubjects] = useState([]);
  const [analyticsDate, setAnalyticsDate] = useState(() => toDateInputValue());
  const [loading, setLoading] = useState(true);
  const isTeacher = user?.role === 'teacher';

  const lectureSemesterOptions = useMemo(() => {
    const semesters = new Set();
    lectureSubjects.forEach(subject => semesters.add(Number(subject.semester)));
    return [...semesters].filter(Boolean).sort((a, b) => a - b);
  }, [lectureSubjects]);

  const lectureSubjectOptions = useMemo(() => lectureSubjects
    .filter(subject => !lectureSemester || Number(subject.semester) === Number(lectureSemester))
    .slice()
    .sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name))), [lectureSubjects, lectureSemester]);

  const fetchDashboard = () => {
    setLoading(true);
    const pendingRequest = user?.role === 'teacher'
      ? Promise.resolve({ data: { students: [] } })
      : adminAPI.getPending();
    Promise.all([
      adminAPI.getAnalytics({
        date: analyticsDate,
        semester: lectureSemester || undefined,
        subjectId: lectureSubjectId || undefined
      }),
      pendingRequest,
      user?.role === 'teacher' ? Promise.resolve({ data: { subjects: [] } }) : subjectAPI.getAll({ allSemesters: true }),
      user?.role === 'teacher' ? adminAPI.getTeacherDashboard() : Promise.resolve({ data: { dashboard: null } }),
      user?.role === 'teacher' ? attendanceAPI.getDisputes({ status: 'pending' }) : Promise.resolve({ data: { disputes: [] } }),
      lmsAPI.getTeacherSummary().catch(() => ({ data: { summary: null } }))
    ]).then(([ana, pend, subjectRes, teacherRes, disputeRes, lmsRes]) => {
      setAnalytics(ana.data.analytics);
      setLectureSubjects(subjectRes.data.subjects || []);
      setTeacherDashboard(teacherRes.data.dashboard);
      setTeacherDisputes(disputeRes.data.disputes || []);
      setLmsSummary(lmsRes.data.summary);
      setPending(pend.data.students);
      setRecentLectures(ana.data.analytics?.recentLectures || []);
      const subjectTop = ana.data.analytics?.subjectTopStudents || [];
      setSelectedTopSubject(current => (
        current && subjectTop.some(item => String(item.subject?._id) === String(current))
          ? current
          : String(subjectTop[0]?.subject?._id || '')
      ));
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchDashboard();
    window.addEventListener('admin-scope:changed', fetchDashboard);
    return () => window.removeEventListener('admin-scope:changed', fetchDashboard);
  }, [analyticsDate, lectureSemester, lectureSubjectId]);

  useEffect(() => {
    if (!socket) return undefined;
    socket.on('new_registration', fetchDashboard);
    socket.on('student_profile_changed', fetchDashboard);
    socket.on('student_profile_update_requested', fetchDashboard);
    socket.on('teacher_changed', fetchDashboard);
    socket.on('subject_updated', fetchDashboard);
    socket.on('new_lecture', fetchDashboard);
    socket.on('lecture_updated', fetchDashboard);
    socket.on('lectures_changed', fetchDashboard);
    socket.on('attendance_opened', fetchDashboard);
    socket.on('attendance_closed', fetchDashboard);
    socket.on('attendance_updated', fetchDashboard);
    socket.on('attendance_marked', fetchDashboard);
    socket.on('timetable_changed', fetchDashboard);
    socket.on('holiday_changed', fetchDashboard);
    socket.on('lms_changed', fetchDashboard);
    return () => {
      socket.off('new_registration', fetchDashboard);
      socket.off('student_profile_changed', fetchDashboard);
      socket.off('student_profile_update_requested', fetchDashboard);
      socket.off('teacher_changed', fetchDashboard);
      socket.off('subject_updated', fetchDashboard);
      socket.off('new_lecture', fetchDashboard);
      socket.off('lecture_updated', fetchDashboard);
      socket.off('lectures_changed', fetchDashboard);
      socket.off('attendance_opened', fetchDashboard);
      socket.off('attendance_closed', fetchDashboard);
      socket.off('attendance_updated', fetchDashboard);
      socket.off('attendance_marked', fetchDashboard);
      socket.off('timetable_changed', fetchDashboard);
      socket.off('holiday_changed', fetchDashboard);
      socket.off('lms_changed', fetchDashboard);
    };
  }, [socket, user?.role, analyticsDate, lectureSemester, lectureSubjectId]);

  if (isSuperAdminUser(user)) return <SuperAdminDashboard user={user} />;

  if (loading) {
    return <AdminDashboardSkeleton isTeacher={isTeacher} />;
  }

  const subjectTopStudents = analytics?.subjectTopStudents || [];
  const selectedTopGroup = subjectTopStudents.find(item => String(item.subject?._id) === String(selectedTopSubject)) || subjectTopStudents[0];
  const notifyLowAttendance = async (subjectId) => {
    setNotifyingSubject(subjectId);
    try {
      const res = await adminAPI.notifyLowAttendance(subjectId);
      toast.success(res.data.message || 'Notification sent');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not send notification');
    } finally {
      setNotifyingSubject('');
    }
  };
  const resolveDispute = async (id, status) => {
    setResolvingDispute(id);
    try {
      await attendanceAPI.resolveDispute(id, { status });
      toast.success(`Request ${status}`);
      fetchDashboard();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Could not resolve request');
    } finally {
      setResolvingDispute('');
    }
  };
  const scope = { department: isTeacher ? '' : user?.department };
  const stats = analytics ? [
    { icon: Users, label: isTeacher ? 'Students Today' : 'Active Students', value: isTeacher ? (teacherDashboard?.todayPresentStudents || teacherDashboard?.todayPresent || 0) : analytics.totalStudents, color: 'bg-primary-500/20 text-primary-400', to: isTeacher ? null : scopedPath('/admin/students', scope) },
    !isTeacher && { icon: Clock, label: 'Pending Approval', value: analytics.pendingStudents, color: 'bg-amber-500/20 text-amber-400', to: scopedPath('/admin/students?tab=pending', scope) },
    { icon: BookOpen, label: isTeacher ? 'Assigned Subjects' : 'Active Subjects', value: analytics.totalSubjects, color: 'bg-violet-500/20 text-violet-400', to: scopedPath('/admin/subjects', scope) },
    { icon: Video, label: isTeacher ? 'Today Lectures' : 'Completed Lectures', value: isTeacher ? (teacherDashboard?.todayLectures || 0) : analytics.totalLectures, color: 'bg-emerald-500/20 text-emerald-400', to: scopedPath('/admin/lectures', scope) },
    isTeacher && { icon: CheckCircle, label: 'Completed Lectures', value: teacherDashboard?.completedLectures || 0, color: 'bg-cyan-500/20 text-cyan-300', to: scopedPath('/admin/lectures', scope) },
  ].filter(Boolean) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Welcome back, {user?.name?.split(' ')[0]}!</h1>
        <p className="text-slate-400 mt-1">
          {isTeacher
            ? (user?.adminSemesterScope ? `Teacher workspace - Semester ${user.adminSemesterScope}` : 'Teacher workspace for assigned subjects and lectures.')
            : (user?.adminSemesterScope ? `${user.department} - Semester ${user.adminSemesterScope} workspace` : "Here's what's happening in your institution today.")}
        </p>
      </div>

      <AdminBreadcrumb items={[
        { label: isTeacher ? 'Teacher Workspace' : (user?.department || 'Administration') },
        { label: 'Dashboard' }
      ]} />

      <PendingDeletionPanel />

      {/* Stats */}
      <div className="stats-strip sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => <StatCard key={s.label} {...s} delay={i * 0.08} />)}
      </div>

      {lmsSummary && (
        <div className="glass-card">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-white">
                <ClipboardList className="h-5 w-5 text-primary-300" /> LMS Control
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {isTeacher ? 'Assigned classroom activity, pending grading, quizzes, and open doubts.' : 'Department classroom activity, completion, and resource monitoring.'}
              </p>
            </div>
            <Link to="/admin/subjects" className="btn-secondary inline-flex items-center justify-center gap-2">
              Open Classrooms <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            <Metric label="Subjects" value={lmsSummary.subjects || analytics?.totalSubjects || 0} />
            <Metric label="Materials" value={lmsSummary.materials || 0} />
            <Metric label="Assignments" value={lmsSummary.assignments || 0} />
            <Metric label="Ungraded" value={lmsSummary.ungraded || 0} />
            <Metric label="Quizzes" value={lmsSummary.quizzes || 0} />
            <Metric label="Attempts" value={lmsSummary.attempts || 0} />
            <Metric label="Open Doubts" value={lmsSummary.openDoubts || 0} />
            <Metric label="Posts" value={lmsSummary.announcements || 0} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                <MessageSquare className="h-4 w-4 text-amber-300" /> Open Doubts
              </p>
              <div className="space-y-2">
                {(lmsSummary.recentDiscussions || []).slice(0, 4).map(item => (
                  <Link key={item._id} to={`/admin/subjects/${item.subject?._id || item.subject}/classroom`} className="block rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:bg-white/5">
                    <p className="truncate text-sm font-medium text-white">{item.title}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{item.student?.name} - {item.subject?.code || item.subject?.name}</p>
                  </Link>
                ))}
                {!(lmsSummary.recentDiscussions || []).length && <p className="rounded-xl border border-dashed border-white/10 py-6 text-center text-sm text-slate-500">No open doubts.</p>}
              </div>
            </div>
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
                <FileText className="h-4 w-4 text-primary-300" /> Recent Materials
              </p>
              <div className="space-y-2">
                {(lmsSummary.recentMaterials || []).slice(0, 4).map(item => (
                  <Link key={item._id} to={`/admin/subjects/${item.subject?._id || item.subject}/classroom`} className="block rounded-xl border border-white/10 bg-white/[0.03] p-3 hover:bg-white/5">
                    <p className="truncate text-sm font-medium text-white">{item.title}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{item.subject?.code || item.subject?.name}</p>
                  </Link>
                ))}
                {!(lmsSummary.recentMaterials || []).length && <p className="rounded-xl border border-dashed border-white/10 py-6 text-center text-sm text-slate-500">No materials uploaded yet.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {!isTeacher && (
        <div className="glass-card">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-white">
                <BarChart3 className="h-5 w-5 text-primary-300" /> Lecture-wise Analytics
              </h2>
              <p className="mt-1 text-sm text-slate-400">Completed lectures only. Imported attendance sheets are kept out of dashboard activity.</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select
                className="input-field"
                value={lectureSemester}
                onChange={event => {
                  setLectureSemester(event.target.value);
                  setLectureSubjectId('');
                }}
                aria-label="Select semester for lecture analytics"
              >
                <option value="">All Semesters</option>
                {lectureSemesterOptions.map(semester => (
                  <option key={semester} value={semester}>Semester {semester}</option>
                ))}
              </select>
              <select
                className="input-field"
                value={lectureSubjectId}
                onChange={event => setLectureSubjectId(event.target.value)}
                aria-label="Select subject for lecture analytics"
              >
                <option value="">All Subjects</option>
                {lectureSubjectOptions.map(subject => (
                  <option key={subject._id} value={subject._id}>
                    {subject.code || subject.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                <Calendar className="h-4 w-4 text-primary-300" />
                <input
                  type="date"
                  value={analyticsDate}
                  onChange={event => setAnalyticsDate(event.target.value)}
                  className="bg-transparent text-white outline-none"
                />
              </label>
            </div>
          </div>
          {(analytics?.dailyLectureAnalytics || []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-slate-500">
              No completed lectures found for this date.
            </div>
          ) : (
            <div className="card-strip lg:block lg:max-h-80 lg:space-y-3 lg:overflow-y-auto lg:pr-1">
              {analytics.dailyLectureAnalytics.map(item => (
                <Link key={item._id} to={`/admin/lectures/${item._id}`} className="flex min-w-64 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:bg-white/5">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
                    <Video className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{item.subject?.code || item.subject?.name}</p>
                    <p className="truncate text-xs text-slate-400">{item.title}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-right">
                    <div>
                      <p className="text-base font-bold text-emerald-300">{item.present || 0}</p>
                      <p className="text-[10px] text-slate-500">present</p>
                    </div>
                    <div>
                      <p className="text-base font-bold text-red-300">{item.absent || 0}</p>
                      <p className="text-[10px] text-slate-500">absent</p>
                    </div>
                    <div>
                      <p className="text-base font-bold text-primary-300">{item.percentage || '0.0'}%</p>
                      <p className="text-[10px] text-slate-500">rate</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {isTeacher && teacherDashboard && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="glass-card lg:col-span-2">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-emerald-300" /> Today's Lecture Activity
            </h2>
            <p className="mt-1 text-sm text-slate-400">This section counts only today and naturally resets with the next day.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              <Metric label="Lectures" value={teacherDashboard.todayLectures} />
              <Metric label="Open" value={teacherDashboard.openToday} />
              <Metric label="Completed" value={teacherDashboard.completedToday} />
              <Metric label="Students" value={teacherDashboard.todayPresentStudents || 0} />
              <Metric label="Present Marks" value={teacherDashboard.todayPresent} />
            </div>
          </div>
          <div className="glass-card">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-primary-300" /> Semester Teachers
            </h2>
            <div className="mt-3 space-y-2">
              {(teacherDashboard.peerTeachers || []).slice(0, 4).map(teacher => (
                <Link key={teacher._id} to={`/admin/teacher-directory/${teacher._id}`} className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-2 hover:bg-white/5">
                  <div className="h-9 w-9 overflow-hidden rounded-lg bg-primary-500/15 text-primary-200">
                    {teacher.profileImage ? <img src={teacher.profileImage} alt={teacher.name} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-xs font-bold">{teacher.name?.[0]}</div>}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{teacher.name}</p>
                    <p className="truncate text-xs text-primary-300">{teacher.email}</p>
                  </div>
                </Link>
              ))}
              {(!teacherDashboard.peerTeachers || teacherDashboard.peerTeachers.length === 0) && <p className="text-sm text-slate-500">No other teachers found in your current semester workspace.</p>}
            </div>
          </div>
        </div>
      )}

      {isTeacher && teacherDashboard?.lowAttendance?.length > 0 && (
        <div className="glass-card">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-semibold text-white">
                <AlertTriangle className="h-5 w-5 text-amber-300" /> Students Below 60%
              </h2>
              <p className="mt-1 text-sm text-slate-400">Grouped from your assigned subjects using completed lectures only.</p>
            </div>
          </div>
          <div className="space-y-4">
            {[...new Map((teacherDashboard.lowAttendance || []).map(item => [item.subject._id, item.subject])).values()].map(subject => {
              const rows = sortByStudentIdTail(
                teacherDashboard.lowAttendance.filter(item => item.subject._id === subject._id),
                item => item.student?.studentId
              );
              return (
                <div key={subject._id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-white">{subject.name}</p>
                      <p className="font-mono text-xs text-primary-300">{subject.code} - Semester {subject.semester}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => notifyLowAttendance(subject._id)}
                      disabled={notifyingSubject === subject._id}
                      className="btn-secondary flex items-center gap-2 px-3 py-2 text-xs"
                      title="Notify all listed students"
                    >
                      <Send className="h-4 w-4" /> <span className="hidden sm:inline">{notifyingSubject === subject._id ? 'Sending...' : 'Notify'}</span>
                    </button>
                  </div>
                  <div className="low-attendance-scroll-grid">
                    {rows.map(item => (
                      <div key={`${subject._id}-${item.student._id}`} className="low-attendance-student-card">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{item.student.name}</p>
                          <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{item.student.studentId}</p>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-red-300">{item.percentage}% <span className="text-xs font-normal text-slate-500">({item.present}/{item.total})</span></p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isTeacher && teacherDisputes.length > 0 && (
        <div className="glass-card">
          <h2 className="mb-4 flex items-center gap-2 font-semibold text-white">
            <MessageSquare className="h-5 w-5 text-primary-300" /> Pending Attendance Requests
          </h2>
          <div className="space-y-3">
            {teacherDisputes.slice(0, 8).map(dispute => (
              <div key={dispute._id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-white">{dispute.student?.name} <span className="font-mono text-xs text-slate-500">{dispute.student?.studentId}</span></p>
                    <p className="text-sm text-slate-400">{dispute.subject?.name} - {dispute.lecture?.title}</p>
                    <p className="mt-1 text-sm text-slate-300">{dispute.reason}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn-secondary px-3 py-2 text-xs" disabled={resolvingDispute === dispute._id} onClick={() => resolveDispute(dispute._id, 'rejected')}>Reject</button>
                    <button className="btn-primary px-3 py-2 text-xs" disabled={resolvingDispute === dispute._id} onClick={() => resolveDispute(dispute._id, 'approved')}>Approve</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Student Approval */}
        {!isTeacher && <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-400" />
              Student Approval
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
            <div className="card-strip lg:block lg:space-y-3">
              {pending.slice(0, 4).map(student => {
                const hasProfileRequest = student.pendingProfileUpdate?.status === 'pending';
                return (
                <Link key={student._id} to={`/admin/students/${student._id}`}
                  className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3 transition-colors hover:bg-white/5 group">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10 flex-shrink-0">
                    {student.profileImage
                      ? <img src={student.profileImage} alt={student.name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-slate-400 font-semibold">{student.name[0]}</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className="font-medium text-white text-sm truncate">{student.name}</p>
                      {hasProfileRequest && <span className="badge badge-warning">profile changes</span>}
                    </div>
                    <p className="text-slate-500 text-xs">{student.studentId} · {student.department}</p>
                    {hasProfileRequest && (
                      <p className="mt-1 text-xs text-amber-200">
                        Student wants to modify their details. This stays pending until approved or rejected.
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" />
                </Link>
                );
              })}
            </div>
          )}
        </motion.div>}

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
            <div className="card-strip lg:block lg:space-y-3">
              {recentLectures.map(lec => (
                <Link key={lec._id} to={`/admin/lectures/${lec._id}`}
                  className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3 transition-colors hover:bg-white/5 group">
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
        {subjectTopStudents.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="glass-card lg:col-span-2">
            <h2 className="font-semibold text-white flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              Top Attendance Students
            </h2>
            <div className="mb-4 card-strip sm:grid-cols-2 md:grid-cols-4">
              {subjectTopStudents.map(item => (
                <button
                  key={item.subject._id}
                  type="button"
                  onClick={() => setSelectedTopSubject(item.subject._id)}
                  className={`rounded-xl border p-3 text-left transition-all ${
                    String(selectedTopGroup?.subject?._id) === String(item.subject._id)
                      ? 'border-primary-400/70 bg-primary-500/15 shadow-lg shadow-primary-950/20'
                      : 'border-white/10 bg-white/[0.03] hover:border-primary-400/40'
                  }`}
                >
                  <p className="truncate text-sm font-semibold text-white">{item.subject.code || item.subject.name}</p>
                  <p className="mt-1 truncate text-xs text-slate-400">{item.subject.name}</p>
                  <p className="mt-2 text-xs text-primary-300">Semester {item.subject.semester}</p>
                </button>
              ))}
            </div>
            <div className="card-strip sm:grid-cols-2 md:grid-cols-5">
              {(selectedTopGroup?.students || []).slice(0, 5).map((s, i) => (
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
