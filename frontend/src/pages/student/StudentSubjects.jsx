import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BookOpen, ChevronRight, TrendingUp } from 'lucide-react';
import { subjectAPI, attendanceAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageLoader } from '../../components/LoadingStates';

export default function StudentSubjects() {
  const { user } = useAuth();
  const [subjects, setSubjects] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    subjectAPI.getMine().then(async r => {
      const subs = r.data.subjects;
      setSubjects(subs);
      // Fetch stats for each
      const statsMap = {};
      await Promise.all(subs.map(async s => {
        try {
          const res = await attendanceAPI.getStudentSubject(s._id);
          statsMap[s._id] = res.data.stats;
        } catch {}
      }));
      setStats(statsMap);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader label="Loading your subjects..." />;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">My Subjects</h1>
        <p className="text-slate-400 mt-1">Semester {user?.semester} · {user?.department}</p>
      </div>

      <AdminBreadcrumb items={[
        { label: user?.department || 'Department' },
        user?.semester && { label: `Semester ${user.semester}` },
        { label: 'Subjects' }
      ]} />

      {subjects.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No subjects enrolled yet. Contact admin.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4">
          {subjects.map((sub, i) => {
            const s = stats[sub._id];
            const pct = s ? parseFloat(s.percentage) : 0;
            return (
              <motion.div key={sub._id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
                <Link to={`/student/attendance/${sub._id}`} className="block h-full glass-card hover:border-primary-500/20 border border-transparent transition-all group">
                  <div className="flex items-start justify-between mb-2 sm:mb-3">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-primary-500/20 flex items-center justify-center">
                      <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-primary-400" />
                    </div>
                    <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600 group-hover:text-slate-400 transition-colors" />
                  </div>
                  <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white sm:text-base">{sub.name}</h3>
                  <p className="font-mono text-primary-400 text-xs sm:text-sm">{sub.code}</p>
                  <p className="text-slate-500 text-xs mt-1">{sub.department} · {sub.credits} Credits</p>

                  {s && (
                    <div className="mt-3 sm:mt-4">
                      <div className="flex justify-between text-[11px] mb-1 sm:text-sm">
                        <span className="text-slate-400">{s.attended}/{s.total}</span>
                        <span className={`font-semibold ${pct >= 75 ? 'text-emerald-400' : pct >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                          {s.percentage}%
                        </span>
                      </div>
                      <div className="h-1 sm:h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, pct)}%` }}
                          transition={{ duration: 0.8, delay: i * 0.1 + 0.2 }}
                          className={`h-full rounded-full ${pct >= 75 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                        />
                      </div>
                      {pct < 75 && s.total > 0 && (
                        <p className="text-red-400 text-xs mt-1">⚠ Below 75% minimum</p>
                      )}
                    </div>
                  )}
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
