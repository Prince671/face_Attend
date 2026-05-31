const normalizeStudentId = (value = '') => String(value || '').trim().toUpperCase();

const studentCodeOf = (student = {}) => normalizeStudentId(student.studentId || student.studentCode || student.student_id);

const studentIdentity = (student = {}) => ({
  student: student._id,
  studentId: studentCodeOf(student)
});

const studentIdentityFilter = (student = {}, objectField = 'student', codeField = 'studentId') => {
  const clauses = [];
  if (student?._id) clauses.push({ [objectField]: student._id });
  const code = studentCodeOf(student);
  if (code) clauses.push({ [codeField]: code });
  return clauses.length > 1 ? { $or: clauses } : clauses[0] || {};
};

const userIdentityFilter = (user = {}, objectField = 'user', codeField = 'userStudentId') => {
  const clauses = [];
  if (user?._id) clauses.push({ [objectField]: user._id });
  const code = studentCodeOf(user);
  if (code) clauses.push({ [codeField]: code });
  return clauses.length > 1 ? { $or: clauses } : clauses[0] || {};
};

module.exports = {
  normalizeStudentId,
  studentCodeOf,
  studentIdentity,
  studentIdentityFilter,
  userIdentityFilter
};
