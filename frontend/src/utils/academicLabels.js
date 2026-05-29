export const getAcademicBranchLabel = (user = {}) => {
  if (user.course === 'BBA' || user.course === 'MBA') return user.course;
  if (user.branch) {
    if (/^Diploma CS$/i.test(user.branch)) return 'Computer Science';
    return user.branch;
  }
  return user.department || 'Department';
};

export const getAcademicLabel = (user = {}) => {
  const course = user.course || 'Course';
  const branch = getAcademicBranchLabel(user);
  return course === branch ? course : `${course} - ${branch}`;
};

export const getSemesterLabel = (semester) => (
  semester ? `Semester ${semester}` : 'Semester'
);

export const getStudentClassLabel = (user = {}) => {
  const course = user.course || 'B. Tech';
  const branch = getAcademicBranchLabel(user);
  if (course === 'BBA' || course === 'MBA') return course;
  const compact = branch
    .replace(/Computer Science/i, 'CSE')
    .replace(/AI\/ML Engineering/i, 'AI/ML')
    .replace(/Mechanical Engineering/i, 'ME')
    .replace(/Electrical Engineering/i, 'EE')
    .toUpperCase();
  return `${course} - ${compact}`;
};
