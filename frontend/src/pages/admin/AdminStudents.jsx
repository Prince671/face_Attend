import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Search, Filter, CheckCircle, XCircle, UserX, UserCheck, Trash2, ChevronRight, Users, Folder, GraduationCap, ArrowLeft, Building2 } from 'lucide-react';
import { adminAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import AdminBreadcrumb from '../../components/AdminBreadcrumb';
import { PageLoader } from '../../components/LoadingStates';
import AppConfirmModal from '../../components/AppConfirmModal';
import { handleDeleteScheduled } from '../../utils/deleteUndo';

const STATUS_COLORS = {
  active: 'badge-success', pending: 'badge-warning',
  inactive: 'badge-danger', restricted: 'badge-danger'
};

export default function AdminStudents() {
  const { user } = useAuth();
  const [students, setStudents] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [actionLoading, setActionLoading] = useState(null);
  const [tab, setTab] = useState('pending');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedSemester, setSelectedSemester] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const isSuperAdmin = user?.role === 'admin' && (user?.email === 'admin@school.edu' || user?.department === 'Administration');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [allRes, pendRes] = await Promise.all([
        adminAPI.getAll({ search, status: filter === 'all' ? undefined : filter }),
        adminAPI.getPending()
      ]);
      setStudents(allRes.data.students);
      setPending(pendRes.data.students);
    } catch { toast.error('Failed to fetch students'); }
    finally { setLoading(false); }
  }, [search, filter]);

  useEffect(() => {
    fetchData();
    window.addEventListener('admin-scope:changed', fetchData);
    return () => window.removeEventListener('admin-scope:changed', fetchData);
  }, [fetchData]);

  useEffect(() => {
    setSelectedDepartment('');
    setSelectedSemester('');
  }, [tab]);

  const handleAction = async (action, id, msg) => {
    setActionLoading(id + action);
    try {
      if (action === 'approve') await adminAPI.approve(id);
      else if (action === 'reject') await adminAPI.reject(id);
      else if (action === 'activate') await adminAPI.activate(id);
      else if (action === 'deactivate') await adminAPI.deactivate(id);
      else if (action === 'delete') {
        const res = await adminAPI.delete(id);
        handleDeleteScheduled({ response: res, label: 'Student', refresh: fetchData });
        setDeleteTarget(null);
        return;
      }
      toast.success(msg);
      fetchData();
    } catch (e) { toast.error(e.response?.data?.message || 'Action failed'); }
    finally { setActionLoading(null); }
  };

  const sourceStudents = tab === 'pending' ? pending : students.filter(s => s.status !== 'pending');
  const displayStudents = sourceStudents.filter(student => (
    (!selectedDepartment || student.department === selectedDepartment) &&
    (!selectedSemester || Number(student.semester) === Number(selectedSemester))
  ));
  const departmentFolders = Array.from(new Set(sourceStudents.map(student => student.department).filter(Boolean))).sort()
    .map(department => {
      const departmentStudents = sourceStudents.filter(student => student.department === department);
      return {
        department,
        total: departmentStudents.length,
        pending: departmentStudents.filter(student => student.status === 'pending').length,
        active: departmentStudents.filter(student => student.status === 'active').length,
        restricted: departmentStudents.filter(student => student.isRestricted || student.status === 'restricted').length
      };
    });
  const semesterFolders = Array.from(new Set(
    sourceStudents
      .filter(student => student.department === selectedDepartment)
      .map(student => Number(student.semester))
      .filter(Boolean)
  )).sort((a, b) => a - b)
    .map(semester => {
      const semesterStudents = sourceStudents.filter(student => student.department === selectedDepartment && Number(student.semester) === semester);
      return {
        semester,
        total: semesterStudents.length,
        pending: semesterStudents.filter(student => student.status === 'pending').length,
        active: semesterStudents.filter(student => student.status === 'active').length,
        restricted: semesterStudents.filter(student => student.isRestricted || student.status === 'restricted').length
      };
    });

  const goBack = () => {
    if (selectedSemester) {
      setSelectedSemester('');
      return;
    }
    if (selectedDepartment) {
      setSelectedDepartment('');
    }
  };
  const breadcrumbItems = isSuperAdmin
    ? [
      { label: 'Departments', onClick: () => { setSelectedDepartment(''); setSelectedSemester(''); } },
      selectedDepartment && { label: selectedDepartment, onClick: () => setSelectedSemester('') },
      selectedSemester && { label: `Semester ${selectedSemester}` },
      selectedSemester && { label: tab === 'pending' ? 'Pending Students' : 'Students' }
    ]
    : [{ label: tab === 'pending' ? 'Pending Students' : 'Students' }];

  return (
    <div className="space-y-6">
      <AppConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete Student?"
        message={`This will hide ${deleteTarget?.name || 'this student'} now. Their profile image, captured attendance images, attendance records, and account will be permanently deleted after 10 minutes unless you undo it from the dashboard tray.`}
        confirmLabel="Schedule Delete"
        loading={Boolean(actionLoading?.endsWith('delete'))}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleAction('delete', deleteTarget._id, 'Student delete scheduled')}
      />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-white">Students</h1>
          <p className="text-slate-400 mt-1">Manage student registrations and accounts</p>
        </div>
        {isSuperAdmin && (selectedDepartment || selectedSemester) && (
          <button type="button" onClick={goBack} className="btn-secondary inline-flex items-center gap-2 justify-center">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        )}
      </div>

      <AdminBreadcrumb items={breadcrumbItems} />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 overflow-x-auto">
        {[
          { id: 'pending', label: 'Pending Approval', count: pending.length },
          { id: 'all', label: 'All Students' }
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`pb-3 px-4 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${tab === t.id ? 'border-primary-500 text-primary-400' : 'border-transparent text-slate-400 hover:text-white'}`}>
            {t.label}
            {t.count > 0 && <span className="ml-2 badge-warning">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* Filters (all tab) */}
      {tab === 'all' && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input className="input-field pl-9" placeholder="Search by name, ID, email..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="input-field sm:w-auto" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="restricted">Restricted</option>
          </select>
        </div>
      )}

      {loading ? (
        <PageLoader label="Loading students..." />
      ) : isSuperAdmin && !selectedDepartment ? (
        departmentFolders.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Folder className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">{tab === 'pending' ? 'No pending department folders' : 'No department folders found'}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {departmentFolders.map(folder => (
              <motion.button
                key={folder.department}
                onClick={() => setSelectedDepartment(folder.department)}
                whileHover={{ y: -3, scale: 1.01 }}
                whileTap={{ scale: 0.985 }}
                className="glass-card text-left border border-transparent transition-all hover:border-primary-500/40"
              >
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-primary-500/15 text-primary-300">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">{folder.department}</p>
                    <p className="text-slate-400 text-sm">{folder.total} students</p>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {folder.pending > 0 && <span className="badge badge-warning">{folder.pending} pending</span>}
                      {folder.active > 0 && <span className="badge badge-success">{folder.active} active</span>}
                      {folder.restricted > 0 && <span className="badge badge-danger">{folder.restricted} restricted</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-500 mt-1" />
                </div>
              </motion.button>
            ))}
          </div>
        )
      ) : isSuperAdmin && selectedDepartment && !selectedSemester ? (
        semesterFolders.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <GraduationCap className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg font-medium">No semester folders found</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="glass-card">
              <p className="text-xs uppercase tracking-wider text-primary-300">Selected Department</p>
              <h2 className="font-display text-xl font-semibold text-white mt-1">{selectedDepartment}</h2>
              <p className="text-slate-400 text-sm mt-1">Choose a semester to view student records.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {semesterFolders.map(folder => (
                <motion.button
                  key={folder.semester}
                  onClick={() => setSelectedSemester(String(folder.semester))}
                  whileHover={{ y: -3, scale: 1.01 }}
                  whileTap={{ scale: 0.985 }}
                  className="glass-card text-left border border-transparent transition-all hover:border-primary-500/40"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-emerald-500/15 text-emerald-300">
                      <GraduationCap className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white">Semester {folder.semester}</p>
                      <p className="text-slate-400 text-sm">{folder.total} students</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {folder.pending > 0 && <span className="badge badge-warning">{folder.pending} pending</span>}
                        {folder.active > 0 && <span className="badge badge-success">{folder.active} active</span>}
                        {folder.restricted > 0 && <span className="badge badge-danger">{folder.restricted} restricted</span>}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-500 mt-1" />
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        )
      ) : displayStudents.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">{tab === 'pending' ? 'No pending registrations' : 'No students found'}</p>
        </div>
      ) : (
        <div className="glass-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-4 px-6 text-slate-400 font-medium text-sm">Student</th>
                  <th className="text-left py-4 px-4 text-slate-400 font-medium text-sm">ID / Dept</th>
                  <th className="text-left py-4 px-4 text-slate-400 font-medium text-sm">Status</th>
                  <th className="text-left py-4 px-4 text-slate-400 font-medium text-sm">Registered</th>
                  <th className="text-right py-4 px-6 text-slate-400 font-medium text-sm">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayStudents.map((s, i) => (
                  <motion.tr key={s._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                    className="border-b border-white/5 hover:bg-white/3 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full overflow-hidden bg-white/10 flex-shrink-0">
                          {s.profileImage
                            ? <img src={s.profileImage} alt={s.name} className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-slate-400 font-semibold text-sm">{s.name[0]}</div>}
                        </div>
                        <div>
                          <p className="font-medium text-white">{s.name}</p>
                          <p className="text-slate-500 text-xs">{s.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <p className="text-slate-300 text-sm font-mono">{s.studentId}</p>
                      <p className="text-slate-500 text-xs">{s.department} · Sem {s.semester}</p>
                    </td>
                    <td className="py-4 px-4">
                      <span className={`badge ${STATUS_COLORS[s.status] || 'badge-neutral'}`}>
                        {s.isRestricted ? '🚫 Restricted' : s.status}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-slate-400 text-sm">{new Date(s.createdAt).toLocaleDateString()}</td>
                    <td className="py-4 px-6">
                      <div className="flex items-center justify-end gap-2">
                        {s.status === 'pending' && (
                          <>
                            <button onClick={() => handleAction('approve', s._id, 'Student approved!')}
                              disabled={actionLoading === s._id + 'approve'}
                              className="p-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg transition-colors" title="Approve">
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button onClick={() => handleAction('reject', s._id, 'Student rejected')}
                              disabled={actionLoading === s._id + 'reject'}
                              className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors" title="Reject">
                              <XCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {s.status === 'active' && (
                          <button onClick={() => handleAction('deactivate', s._id, 'Student deactivated')}
                            className="p-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 rounded-lg transition-colors" title="Deactivate">
                            <UserX className="w-4 h-4" />
                          </button>
                        )}
                        {s.status === 'inactive' && (
                          <button onClick={() => handleAction('activate', s._id, 'Student activated!')}
                            className="p-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg transition-colors" title="Activate">
                            <UserCheck className="w-4 h-4" />
                          </button>
                        )}
                        <Link to={`/admin/students/${s._id}`}
                          className="p-2 bg-primary-500/20 hover:bg-primary-500/30 text-primary-400 rounded-lg transition-colors" title="View">
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                        <button onClick={() => setDeleteTarget(s)}
                          className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
