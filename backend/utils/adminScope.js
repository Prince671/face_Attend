const SYSTEM_ADMIN_DEPARTMENT = 'Administration';

const isSystemAdmin = (user) => {
  return user?.role === 'admin' && (
    user?.department === SYSTEM_ADMIN_DEPARTMENT ||
    String(user?.email || '').toLowerCase() === 'admin@school.edu'
  );
};

const getAdminDepartment = (user) => {
  if (!user || user.role !== 'admin' || isSystemAdmin(user)) return null;
  return user.department || null;
};

const getAdminSemesterScope = (user) => {
  return null;
};

const getTeacherDepartments = (user) => {
  if (!user || user.role !== 'teacher') return [];
  const values = Array.isArray(user.departments) && user.departments.length
    ? user.departments
    : [user.department];
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
};

const getTeacherSemesterScope = (user) => {
  if (!user || user.role !== 'teacher') return null;
  const semester = Number(user.adminSemesterScope);
  return semester >= 1 && semester <= 8 ? semester : null;
};

const applyDepartmentScope = (query = {}, user, field = 'department') => {
  const department = getAdminDepartment(user);
  if (!department) return query;
  return { ...query, [field]: department };
};

const applyAcademicScope = (query = {}, user, departmentField = 'department', semesterField = 'semester') => {
  const scoped = applyDepartmentScope(query, user, departmentField);
  const semester = getAdminSemesterScope(user);
  if (!semester) return scoped;
  return { ...scoped, [semesterField]: semester };
};

const adminDepartmentRoom = (department) => {
  return `admin_department_${String(department || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
};

const assertDepartmentAccess = (resource, user, field = 'department') => {
  const department = getAdminDepartment(user);
  if (!department) return true;
  return resource?.[field] === department;
};

module.exports = {
  SYSTEM_ADMIN_DEPARTMENT,
  isSystemAdmin,
  getAdminDepartment,
  getAdminSemesterScope,
  getTeacherDepartments,
  getTeacherSemesterScope,
  applyDepartmentScope,
  applyAcademicScope,
  assertDepartmentAccess,
  adminDepartmentRoom
};
