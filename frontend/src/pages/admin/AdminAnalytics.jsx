import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';
import { TrendingUp, Users, Video, BookOpen } from 'lucide-react';
import { adminAPI } from '../../services/api';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageLoader } from '../../components/LoadingStates';

const COLORS = ['#5c7cfa', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

export default function AdminAnalytics() {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    adminAPI.getAnalytics()
      .then(r => {
        setAnalytics(r.data.analytics);
        setError('');
      })
      .catch(err => {
        console.error(err);
        setError('Could not load analytics. Please refresh and try again.');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader label="Loading analytics..." />;
  if (error) return <div className="glass-card text-center py-12 text-slate-400">{error}</div>;
  if (!analytics) return <div className="glass-card text-center py-12 text-slate-400">No analytics available yet.</div>;

  const subjectData = analytics.subjectAnalytics?.map(s => ({
    name: s.subjectCode,
    fullName: s.subjectName,
    percentage: parseFloat(s.percentage?.toFixed(1) || 0),
    present: s.presentCount,
    total: s.totalCount
  })) || [];

  const recentData = analytics.recentAttendance?.map(d => ({
    date: d._id,
    count: d.count
  })) || [];

  const pieData = [
    { name: 'Active', value: analytics.totalStudents },
    { name: 'Pending', value: analytics.pendingStudents },
  ].filter(d => d.value > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Analytics</h1>
        <p className="text-slate-400 mt-1">Attendance insights across your institution</p>
      </div>

      <AdminBreadcrumb items={[{ label: 'Administration' }, { label: 'Analytics' }]} />

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Users, label: 'Active Students', value: analytics.totalStudents, color: 'bg-primary-500/20 text-primary-400' },
          { icon: BookOpen, label: 'Subjects', value: analytics.totalSubjects, color: 'bg-violet-500/20 text-violet-400' },
          { icon: Video, label: 'Lectures Completed', value: analytics.completedLectures, color: 'bg-emerald-500/20 text-emerald-400' },
          { icon: TrendingUp, label: 'Total Records', value: analytics.totalAttendanceRecords, color: 'bg-amber-500/20 text-amber-400' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
            className="glass-card flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}>
              <s.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-slate-400 text-xs">{s.label}</p>
              <p className="text-xl font-bold text-white font-display">{s.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Subject-wise attendance bar chart */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-card">
          <h2 className="font-semibold text-white mb-4">Subject-wise Attendance %</h2>
          {subjectData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={subjectData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 12 }} unit="%" />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#f1f5f9' }}
                  formatter={(v, n, p) => [`${v}%`, p.payload.fullName]}
                />
                <Bar dataKey="percentage" fill="#5c7cfa" radius={[6, 6, 0, 0]}>
                  {subjectData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-slate-500 text-center py-10">No data yet</p>}
        </motion.div>

        {/* Recent 7 days line chart */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="glass-card">
          <h2 className="font-semibold text-white mb-4">Attendance (Last 7 Days)</h2>
          {recentData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={recentData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#f1f5f9' }} />
                <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', strokeWidth: 2 }} name="Attendance Count" />
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="text-slate-500 text-center py-10">No recent data</p>}
        </motion.div>

        {/* Student distribution pie */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="glass-card">
          <h2 className="font-semibold text-white mb-4">Student Distribution</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Legend />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', color: '#f1f5f9' }} />
            </PieChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Top students */}
        {analytics.topStudents?.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }} className="glass-card">
            <h2 className="font-semibold text-white mb-4">Top Performers</h2>
            <div className="space-y-3">
              {analytics.topStudents.slice(0, 6).map((s, i) => (
                <div key={s._id} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary-600/20 text-primary-400 text-xs flex items-center justify-center font-bold">#{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.studentId}</p>
                  </div>
                  <span className="text-emerald-400 text-sm font-semibold">{s.count} classes</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
