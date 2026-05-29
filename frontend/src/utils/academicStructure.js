export const DEFAULT_ACADEMIC_STRUCTURE = [
  {
    course: 'B. Tech',
    branches: [
      { name: 'Computer Science', department: 'Computer Science', subjectBranch: 'Computer Science', semesters: [1, 2, 3, 4, 5, 6, 7, 8] },
      { name: 'Mechanical Engineering', department: 'Mechanical', subjectBranch: '', semesters: [1, 2, 3, 4, 5, 6, 7, 8] },
      { name: 'Electrical Engineering', department: 'Electrical', subjectBranch: '', semesters: [1, 2, 3, 4, 5, 6, 7, 8] },
      { name: 'AI/ML Engineering', department: 'Computer Science', subjectBranch: 'AI/ML Engineering', semesters: [1, 2, 3, 4, 5, 6, 7, 8] }
    ]
  },
  {
    course: 'Diploma',
    branches: [
      { name: 'Computer Science', department: 'Computer Science', subjectBranch: 'Diploma CS', semesters: [1, 2, 3, 4, 5, 6] },
      { name: 'Mechanical Engineering', department: 'Mechanical', subjectBranch: 'Diploma Mechanical', semesters: [1, 2, 3, 4, 5, 6] },
      { name: 'Electrical Engineering', department: 'Electrical', subjectBranch: 'Diploma Electrical', semesters: [1, 2, 3, 4, 5, 6] }
    ]
  },
  { course: 'BBA', branches: [{ name: 'BBA', department: 'BBA', subjectBranch: '', semesters: [1, 2, 3, 4, 5, 6] }] },
  { course: 'MBA', branches: [{ name: 'MBA', department: 'MBA', subjectBranch: '', semesters: [1, 2, 3, 4] }] }
];

const normalize = (value) => String(value || '').trim().toLowerCase();

export const getSubjectBranchValue = (subject = {}) => {
  const branch = String(subject.branch || '').trim();
  if (branch) return branch;
  return /computer|cse|cs/i.test(String(subject.department || '')) ? 'Computer Science' : '';
};

export const getBranchKey = (course, branch) => `${course}::${branch}`;

export const buildAcademicOptions = (structures = DEFAULT_ACADEMIC_STRUCTURE, subjects = []) => {
  const configured = (structures.length ? structures : DEFAULT_ACADEMIC_STRUCTURE)
    .filter(item => item?.isActive !== false)
    .map(item => ({
      ...item,
      branches: (item.branches || []).filter(branch => branch?.isActive !== false)
    }));

  const subjectMatchesBranch = (subject, branch) => (
    normalize(subject.department) === normalize(branch.department) &&
    normalize(getSubjectBranchValue(subject)) === normalize(branch.subjectBranch || '')
  );

  return configured.map(course => {
    const branches = (course.branches || []).map(branch => {
      const matchedSubjects = subjects.filter(subject => subjectMatchesBranch(subject, branch));
      const subjectSemesters = matchedSubjects.map(subject => Number(subject.semester)).filter(Boolean);
      return {
        ...branch,
        course: course.course,
        key: getBranchKey(course.course, branch.name),
        semesters: [...new Set([...(branch.semesters || []), ...subjectSemesters])].sort((a, b) => a - b),
        subjects: matchedSubjects.length
      };
    });
    return {
      ...course,
      branches,
      subjects: branches.reduce((sum, branch) => sum + branch.subjects, 0)
    };
  });
};

export const findAcademicBranch = (options, courseName, branchName) => (
  (options || []).find(course => course.course === courseName)?.branches?.find(branch => branch.name === branchName) || null
);

export const subjectMatchesAcademicBranch = (subject, branch) => {
  if (!branch) return true;
  return normalize(subject.department) === normalize(branch.department) &&
    normalize(getSubjectBranchValue(subject)) === normalize(branch.subjectBranch || '');
};
