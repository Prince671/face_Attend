import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Calendar, Maximize2, X } from 'lucide-react';
import { adminAPI, subjectAPI } from '../../services/api';
import { useRealtimeRefresh } from '../../context/SocketContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageSkeleton } from '../../components/LoadingStates';
import { toDateInputValue } from '../../utils/dateInput';

const todayValue = () => toDateInputValue();

const isComputerScienceDepartment = (department) => /computer|cse|cs/i.test(String(department || ''));
const normalizeBranch = (subject) => {
  const branch = String(subject?.branch || '').trim();
  if (branch) return branch;
  return isComputerScienceDepartment(subject?.department) ? 'Computer Science' : 'General';
};

function SubjectAttendanceChart({ data, height = 320 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 16, right: 20, left: 0, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
        <XAxis
          dataKey="subjectCode"
          interval={0}
          angle={data.length > 6 ? -18 : 0}
          textAnchor={data.length > 6 ? 'end' : 'middle'}
          height={data.length > 6 ? 52 : 32}
          tick={{ fill: '#94a3b8', fontSize: 11 }}
        />
        <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '12px', color: '#f8fafc' }}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.subjectName || ''}
          formatter={(value) => [value, 'Present Students']}
        />
        <Line type="monotone" dataKey="present" name="present" stroke="#10b981" strokeWidth={3} dot={{ r: 4, fill: '#10b981' }} activeDot={{ r: 6 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function StudentStatusPie({ counts }) {
  const active = counts?.active || 0;
  const inactive = counts?.inactive || 0;
  const data = [
    { name: 'Active', value: active, color: '#10b981' },
    { name: 'Inactive', value: inactive, color: '#ef4444' }
  ];
  return (
    <div className="glass-card">
      <div className="mb-4">
        <h2 className="font-semibold text-white">Student Status</h2>
        <p className="mt-1 text-sm text-slate-400">Active and inactive students for the selected branch and semester.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={4}>
                {data.map(item => <Cell key={item.name} fill={item.color} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '12px', color: '#f8fafc' }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="grid gap-3">
          {data.map(item => (
            <div key={item.name} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <span className="flex items-center gap-2 text-sm text-slate-300">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
                {item.name}
              </span>
              <span className="text-lg font-bold text-white">{item.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AdminAnalytics() {
  const [analytics, setAnalytics] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [filters, setFilters] = useState({ branch: 'Computer Science', semester: '6', subjectId: '', date: todayValue() });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  const fetchAnalytics = () => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      subjectAPI.getAll({ allSemesters: true }),
      adminAPI.getAnalytics({
        date: filters.date,
        branch: filters.branch || undefined,
        semester: filters.semester || undefined,
        subjectId: filters.subjectId || undefined
      })
    ])
      .then(([subjectRes, analyticsRes]) => {
        if (cancelled) return;
        setSubjects(subjectRes.data.subjects || []);
        setAnalytics(analyticsRes.data.analytics);
        setError('');
      })
      .catch(err => {
        if (cancelled) return;
        console.error(err);
        setError('Could not load analytics. Please refresh and try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  };

  useEffect(() => {
    return fetchAnalytics();
  }, [filters.branch, filters.semester, filters.subjectId, filters.date]);

  useRealtimeRefresh(fetchAnalytics, ['analytics', 'attendance', 'students', 'subjects'], [filters.branch, filters.semester, filters.subjectId, filters.date]);

  const branchOptions = useMemo(() => {
    const branches = new Set();
    subjects.forEach(subject => {
      const branch = normalizeBranch(subject);
      if (branch) branches.add(branch);
    });
    return [...branches].sort((a, b) => {
      if (a === 'Computer Science') return -1;
      if (b === 'Computer Science') return 1;
      return a.localeCompare(b);
    });
  }, [subjects]);

  const semesterOptions = useMemo(() => {
    const semesters = new Set();
    subjects
      .filter(subject => !filters.branch || normalizeBranch(subject) === filters.branch)
      .forEach(subject => semesters.add(Number(subject.semester)));
    return [...semesters].filter(Boolean).sort((a, b) => a - b);
  }, [subjects, filters.branch]);

  const subjectOptions = useMemo(() => subjects
    .filter(subject => !filters.branch || normalizeBranch(subject) === filters.branch)
    .filter(subject => !filters.semester || Number(subject.semester) === Number(filters.semester))
    .sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name))), [subjects, filters.branch, filters.semester]);

  const graphData = analytics?.dailySubjectAttendance || [];
  const studentStatusCounts = analytics?.studentStatusCounts || { active: 0, inactive: 0 };
  const selectedDateLabel = analytics?.analyticsDate || filters.date;

  useEffect(() => {
    if (!branchOptions.length) return;
    if (!branchOptions.includes(filters.branch)) {
      setFilters(current => ({ ...current, branch: branchOptions[0], subjectId: '' }));
    }
  }, [branchOptions, filters.branch]);

  useEffect(() => {
    if (!semesterOptions.length) return;
    if (filters.semester && !semesterOptions.some(semester => Number(semester) === Number(filters.semester))) {
      setFilters(current => ({ ...current, semester: String(semesterOptions[0]), subjectId: '' }));
    }
  }, [semesterOptions, filters.semester]);

  const updateFilter = (key, value) => {
    setFilters(current => {
      const next = { ...current, [key]: value };
      if (key === 'branch') {
        next.semester = '';
        next.subjectId = '';
      }
      if (key === 'semester') next.subjectId = '';
      return next;
    });
  };

  if (loading && !analytics) return <PageSkeleton variant="analytics" rows={5} />;
  if (error) return <div className="glass-card text-center py-12 text-slate-400">{error}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Analytics</h1>
        <p className="text-slate-400 mt-1">Subject-wise attendance for a selected branch, semester, subject, and date.</p>
      </div>

      <AdminBreadcrumb items={[{ label: 'Administration' }, { label: 'Analytics' }]} />

      <div className="glass-card">
        <div className="grid gap-3 md:grid-cols-4">
          <select className="input-field" value={filters.branch} onChange={event => updateFilter('branch', event.target.value)}>
            <option value="">All Branches</option>
            {branchOptions.map(branch => <option key={branch} value={branch}>{branch}</option>)}
          </select>
          <select className="input-field" value={filters.semester} onChange={event => updateFilter('semester', event.target.value)}>
            <option value="">All Semesters</option>
            {semesterOptions.map(semester => <option key={semester} value={semester}>Semester {semester}</option>)}
          </select>
          <select className="input-field" value={filters.subjectId} onChange={event => updateFilter('subjectId', event.target.value)}>
            <option value="">All Subjects</option>
            {subjectOptions.map(subject => (
              <option key={subject._id} value={subject._id}>{subject.code} - {subject.name}</option>
            ))}
          </select>
          <div className="relative">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input className="input-field pl-9" type="date" value={filters.date} onChange={event => updateFilter('date', event.target.value)} />
          </div>
        </div>
      </div>

      <motion.button
        type="button"
        onClick={() => graphData.length && setExpanded(true)}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card w-full text-left transition-colors hover:border-primary-400/50"
      >
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-white">Subject-wise Attendance Count</h2>
            <p className="mt-1 text-sm text-slate-400">Present students per subject on {selectedDateLabel}</p>
          </div>
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-slate-200">
            <Maximize2 className="h-4 w-4" />
          </span>
        </div>
        {loading ? (
          <div className="py-16 text-center text-slate-500">Updating graph...</div>
        ) : graphData.length ? (
          <SubjectAttendanceChart data={graphData} />
        ) : (
          <div className="py-16 text-center text-slate-500">No completed attendance found for this selection.</div>
        )}
      </motion.button>

      <StudentStatusPie counts={studentStatusCounts} />

      {expanded && typeof document !== 'undefined' && createPortal(
        <div className="app-modal-backdrop">
          <div className="glass-card w-full max-w-6xl border border-primary-500/25">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-white">Subject-wise Attendance Count</h2>
                <p className="mt-1 text-sm text-slate-400">Expanded view for {selectedDateLabel}</p>
              </div>
              <button type="button" onClick={() => setExpanded(false)} className="icon-action bg-white/10 text-slate-200 hover:bg-white/15" aria-label="Close graph">
                <X className="h-4 w-4" />
              </button>
            </div>
            <SubjectAttendanceChart data={graphData} height={520} />
          </div>
        </div>
      , document.body)}
    </div>
  );
}
