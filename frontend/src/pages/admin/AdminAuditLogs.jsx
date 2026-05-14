import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, Filter, RefreshCw, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminAPI } from '../../services/api';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { InlineLoader } from '../../components/LoadingStates';

const actionLabels = {
  'student.approved': 'Student approved',
  'student.rejected': 'Student rejected',
  'student.activated': 'Student activated',
  'student.deactivated': 'Student deactivated',
  'student.restricted': 'Student restricted',
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
  'attendance.viewed': 'Attendance viewed',
  'attendance.copied_viewed': 'Copied attendance viewed',
  'report.exported': 'Report exported',
  'analytics.viewed': 'Analytics viewed',
};

const entityTypes = ['student', 'subject', 'lecture', 'analytics', 'session'];

const formatDateTime = (value) => {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
};

export default function AdminAuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ action: '', entityType: '', dateFrom: '', dateTo: '' });

  const actionOptions = useMemo(() => Object.keys(actionLabels), []);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary-400" /> Audit Logs
          </h1>
          <p className="text-slate-400 mt-1">Track sensitive admin activity across the system</p>
        </div>
        <button onClick={fetchLogs} className="btn-secondary flex items-center gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <AdminBreadcrumb items={[{ label: 'Administration' }, { label: 'Audit Logs' }]} />

      <div className="glass-card">
        <div className="flex items-center gap-2 text-white font-semibold mb-4">
          <Filter className="w-4 h-4 text-primary-400" /> Filters
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
      </div>

      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="py-12 text-center"><InlineLoader label="Loading audit trail..." /></div>
        ) : logs.length === 0 ? (
          <div className="py-12 text-center">
            <Activity className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No audit logs found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-white/10">
                  <th className="py-3 px-4 font-medium">Time</th>
                  <th className="py-3 px-4 font-medium">Action</th>
                  <th className="py-3 px-4 font-medium">Actor</th>
                  <th className="py-3 px-4 font-medium">Entity</th>
                  <th className="py-3 px-4 font-medium">Department</th>
                  <th className="py-3 px-4 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, index) => (
                  <motion.tr
                    key={log._id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.015 }}
                    className="border-b border-white/5 hover:bg-white/[0.03]"
                  >
                    <td className="py-3 px-4 text-slate-300 whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                    <td className="py-3 px-4">
                      <span className="badge-info">{actionLabels[log.action] || log.action}</span>
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-white">{log.actorName}</p>
                      <p className="text-xs text-slate-500">{log.actorEmail}</p>
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-slate-200">{log.entityName || '-'}</p>
                      <p className="text-xs text-slate-500">{log.entityType}</p>
                    </td>
                    <td className="py-3 px-4 text-slate-300">{log.targetDepartment || '-'}</td>
                    <td className="py-3 px-4 text-slate-400 max-w-xs truncate" title={JSON.stringify(log.details || {})}>
                      {Object.keys(log.details || {}).length ? JSON.stringify(log.details) : '-'}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
