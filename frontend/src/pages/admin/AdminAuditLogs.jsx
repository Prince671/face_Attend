import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, Filter, RefreshCw, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminAPI } from '../../services/api';
import { useRealtimeRefresh } from '../../context/SocketContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { CardSkeleton } from '../../components/LoadingStates';

const actionLabels = {
  'student.approved': 'Student approved',
  'student.rejected': 'Student rejected',
  'student.activated': 'Student activated',
  'student.deactivated': 'Student deactivated',
  'student.restricted': 'Student restricted',
  'student.registration_requested': 'Registration request',
  'student.deleted': 'Student deleted',
  'student.delete_scheduled': 'Student delete scheduled',
  'student.delete_undone': 'Student delete undone',
  'student.enrollments_updated': 'Student enrollments updated',
  'subject.created': 'Subject created',
  'subject.updated': 'Subject updated',
  'subject.deactivated': 'Subject deactivated',
  'subject.delete_scheduled': 'Subject delete scheduled',
  'subject.delete_undone': 'Subject delete undone',
  'lecture.created': 'Lecture created',
  'lecture.deleted': 'Lecture deleted',
  'lecture.delete_scheduled': 'Lecture delete scheduled',
  'lecture.delete_undone': 'Lecture delete undone',
  'attendance.opened': 'Attendance opened',
  'attendance.closed': 'Attendance closed',
  'attendance.edited': 'Attendance edited',
  'attendance.copied': 'Attendance copied',
  'report.exported': 'Report exported',
  'timetable.analyzed_and_generated': 'Timetable analyzed',
  'timetable.generated_lectures': 'Timetable lectures generated',
  'teacher.created': 'Teacher created',
  'teacher.imported': 'Teachers imported',
  'teacher.subjects_assigned': 'Teacher subjects assigned',
  'teacher.delete_scheduled': 'Teacher delete scheduled',
  'academic.course_created': 'Course created',
  'academic.branch_created': 'Branch created',
  'academic.course_deleted': 'Course deleted',
  'academic.branch_deleted': 'Branch deleted',
};

const entityTypes = ['student', 'subject', 'lecture', 'teacher', 'academic', 'timetable', 'report', 'session'];

const formatDateTime = (value) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
};

const detailLabels = {
  subjectCode: 'Subject code',
  subjectName: 'Subject',
  lectureDate: 'Lecture date',
  lectureStartTime: 'Lecture start',
  lectureEndTime: 'Lecture end',
  attendanceStartedAt: 'Attendance started',
  attendanceClosedAt: 'Attendance closed',
  attendanceCodeExpiresAt: 'Code expires',
  codeExpiresAt: 'Code expires',
  durationMinutes: 'Duration',
  undoExpiresAt: 'Undo expires',
  requestedAt: 'Requested at',
  startDate: 'Start date',
  endDate: 'End date',
  studentName: 'Student',
  reportType: 'Report type',
  subjectIds: 'Subjects',
  sourceLectureId: 'Source lecture',
  copiedRecords: 'Copied records',
  sameSubject: 'Same subject',
  imported: 'Imported',
  failed: 'Failed',
  uploadType: 'Upload type',
  slots: 'Slots',
};

const idLikeKeys = new Set([
  'subjectId',
  'studentId',
  'sourceLectureId',
  'deletionId',
  'lectureId',
  'teacherId',
  'userId',
  'adminId'
]);

const mongoIdPattern = /^[a-f\d]{24}$/i;

const labelize = (key) => detailLabels[key] || key
  .replace(/([A-Z])/g, ' $1')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, char => char.toUpperCase());

const looksLikeDate = (key, value) => {
  if (!value || typeof value !== 'string') return false;
  return /(date|at|expires)/i.test(key) && !Number.isNaN(new Date(value).getTime());
};

const formatDetailValue = (key, value) => {
  if (value === null || value === undefined || value === '') return 'Not provided';
  if (idLikeKeys.has(key)) return 'Linked record';
  if (typeof value === 'string' && mongoIdPattern.test(value)) return 'Linked record';
  if (looksLikeDate(key, value) || value instanceof Date) return formatDateTime(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    if (value.every(item => typeof item === 'string' && mongoIdPattern.test(item))) {
      return `${value.length} selected record${value.length === 1 ? '' : 's'}`;
    }
    return value.map(item => formatDetailValue(key, item)).join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, nestedValue]) => nestedValue !== undefined && nestedValue !== null && nestedValue !== '')
      .map(([nestedKey, nestedValue]) => `${labelize(nestedKey)}: ${formatDetailValue(nestedKey, nestedValue)}`)
      .join(' | ') || 'No extra details';
  }
  if (/minutes/i.test(key)) return `${value} min`;
  return String(value);
};

const AuditDetails = ({ details }) => {
  const entries = details && typeof details === 'object'
    ? Object.entries(details).filter(([key, value]) => {
      if (value === undefined || value === null || value === '') return false;
      if (idLikeKeys.has(key) && (details[`${key.replace(/Id$/, '')}Name`] || details.entityName)) return false;
      if (idLikeKeys.has(key) && typeof value === 'string' && mongoIdPattern.test(value)) return false;
      return true;
    })
    : [];

  if (entries.length === 0) {
    return <span className="text-slate-500">No extra details</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {entries.slice(0, 6).map(([key, value]) => (
        <div key={key} className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">{labelize(key)}</p>
          <p className="mt-0.5 max-w-[220px] break-words text-xs font-medium text-slate-200">{formatDetailValue(key, value)}</p>
        </div>
      ))}
      {entries.length > 6 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-slate-400">
          +{entries.length - 6} more detail{entries.length - 6 === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
};

export default function AdminAuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ action: '', entityType: '', dateFrom: '', dateTo: '' });

  const actionOptions = useMemo(() => Object.keys(actionLabels), []);
  const activeFilterCount = useMemo(() => Object.values(filters).filter(Boolean).length, [filters]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
      const res = await adminAPI.getAuditLogs({ ...params, limit: 200 });
      setLogs(res.data.logs || []);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);

  useRealtimeRefresh(fetchLogs, ['audit']);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary-400" /> Audit Logs
          </h1>
          <p className="text-slate-400 mt-1">Track sensitive admin activity across the system</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(value => !value)}
            className="btn-secondary flex items-center gap-2"
            aria-expanded={showFilters}
            title="Show filters"
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary-500 px-2 py-0.5 text-xs text-white">{activeFilterCount}</span>
            )}
          </button>
          <button onClick={fetchLogs} className="btn-secondary flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <AdminBreadcrumb items={[{ label: 'Administration' }, { label: 'Audit Logs' }]} />

      {showFilters && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card"
        >
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 text-white font-semibold">
              <Filter className="w-4 h-4 text-primary-400" /> Refine Audit Trail
            </div>
            {activeFilterCount > 0 && (
              <button
                onClick={() => setFilters({ action: '', entityType: '', dateFrom: '', dateTo: '' })}
                className="text-sm text-slate-400 hover:text-white"
              >
                Clear filters
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <select className="input-field" value={filters.action} onChange={e => setFilters({ ...filters, action: e.target.value })}>
              <option value="">All actions</option>
              {actionOptions.map(action => <option key={action} value={action}>{actionLabels[action]}</option>)}
            </select>
            <select className="input-field" value={filters.entityType} onChange={e => setFilters({ ...filters, entityType: e.target.value })}>
              <option value="">All entities</option>
              {entityTypes.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
            <input className="input-field" type="date" value={filters.dateFrom} onChange={e => setFilters({ ...filters, dateFrom: e.target.value })} />
            <input className="input-field" type="date" value={filters.dateTo} onChange={e => setFilters({ ...filters, dateTo: e.target.value })} />
          </div>
          <button onClick={fetchLogs} className="btn-primary mt-4">Apply Filters</button>
        </motion.div>
      )}

      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-4"><CardSkeleton rows={6} /></div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center">
            <Activity className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No audit logs found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((log, index) => (
              <motion.article
                key={log._id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.015 }}
                className="rounded-2xl border border-white/10 bg-slate-950/30 p-4 transition hover:border-primary-400/30 hover:bg-white/[0.035]"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge-info whitespace-normal break-words">{actionLabels[log.action] || log.action}</span>
                      <span className="text-xs text-slate-500">{formatDateTime(log.createdAt)}</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Actor</p>
                        <p className="truncate text-sm font-semibold text-white">{log.actorName || 'System user'}</p>
                        <p className="truncate text-xs text-slate-500">{log.actorEmail || '-'}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Entity</p>
                        <p className="break-words text-sm font-semibold text-slate-100">{log.entityName || 'System record'}</p>
                        <p className="text-xs capitalize text-slate-500">{log.entityType || '-'}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide text-slate-500">Department</p>
                        <p className="break-words text-sm font-medium text-slate-200">{log.targetDepartment || '-'}</p>
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0 lg:max-w-[48%]">
                    <p className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">Details</p>
                    <AuditDetails details={log.details} />
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
