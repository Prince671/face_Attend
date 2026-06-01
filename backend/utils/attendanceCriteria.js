const AttendanceCriteria = require('../models/AttendanceCriteria');

const normalizeBranch = (value) => String(value || '').trim();

const defaultCriteria = ({ course = '', department = '', branch = '', semester = 0 } = {}) => ({
  course: String(course || '').trim(),
  department: String(department || '').trim(),
  branch: normalizeBranch(branch),
  semester: Number(semester || 0),
  minimumPercentage: 75,
});

const criteriaFilter = ({ department, branch, semester }) => ({
  department: String(department || '').trim(),
  branch: normalizeBranch(branch),
  semester: Number(semester || 0),
});

const getAttendanceCriteria = async (scope = {}) => {
  const fallback = defaultCriteria(scope);
  if (!fallback.department || !fallback.semester) return fallback;
  const exactFilter = criteriaFilter(fallback);
  const criteria = await AttendanceCriteria.findOne(exactFilter).lean()
    || (exactFilter.branch ? await AttendanceCriteria.findOne({ ...exactFilter, branch: '' }).lean() : null);
  return criteria || fallback;
};

module.exports = {
  defaultCriteria,
  criteriaFilter,
  getAttendanceCriteria,
};
