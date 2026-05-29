const Subject = require('../models/Subject');
const User = require('../models/User');

const isComputerScienceDepartment = (department) => /computer|cse|cs/i.test(String(department || ''));

const normalizeBranch = (value) => {
  const branch = String(value || '').trim();
  return /^(general|unassigned branch)$/i.test(branch) ? '' : branch;
};

const effectiveStudentBranch = (student) => {
  const explicit = normalizeBranch(student?.branch);
  if (explicit) return explicit;
  return isComputerScienceDepartment(student?.department) ? 'Computer Science' : '';
};

const effectiveSubjectBranch = (subject) => {
  const explicit = normalizeBranch(subject?.branch);
  if (explicit) return explicit;
  return isComputerScienceDepartment(subject?.department) ? 'Computer Science' : '';
};

const studentMatchForSubject = (subject) => {
  const query = {
    role: 'student',
    department: subject.department,
    semester: Number(subject.semester)
  };
  const subjectBranch = effectiveSubjectBranch(subject);
  if (isComputerScienceDepartment(subject.department)) {
    if (subjectBranch === 'Computer Science') {
      query.$or = [{ branch: 'Computer Science' }, { branch: '' }, { branch: { $exists: false } }];
    } else {
      query.branch = subjectBranch;
    }
  }
  return query;
};

const studentMatchesSubject = (student, subject) => {
  if (!student || !subject) return false;
  if (student.department !== subject.department) return false;
  if (Number(student.semester) !== Number(subject.semester)) return false;
  if (!isComputerScienceDepartment(subject.department)) return true;
  return effectiveStudentBranch(student) === effectiveSubjectBranch(subject);
};

const syncSubjectEnrollment = async (subject) => {
  if (!subject?._id) return { matchedStudents: 0, removedStudents: 0 };

  if (!subject.isActive) {
    const removed = await User.updateMany(
      { role: 'student', enrolledSubjects: subject._id },
      { $pull: { enrolledSubjects: subject._id } }
    );
    return { matchedStudents: 0, removedStudents: removed.modifiedCount || 0 };
  }

  const addResult = await User.updateMany(
    studentMatchForSubject(subject),
    { $addToSet: { enrolledSubjects: subject._id } }
  );

  const enrolledStudents = await User.find({ role: 'student', enrolledSubjects: subject._id })
    .select('department branch semester');
  const invalidIds = enrolledStudents
    .filter(student => !studentMatchesSubject(student, subject))
    .map(student => student._id);

  let removedCount = 0;
  if (invalidIds.length) {
    const removeResult = await User.updateMany(
      { _id: { $in: invalidIds } },
      { $pull: { enrolledSubjects: subject._id } }
    );
    removedCount = removeResult.modifiedCount || 0;
  }

  return {
    matchedStudents: addResult.modifiedCount || 0,
    removedStudents: removedCount
  };
};

const enrollStudentInMatchingSubjects = async (student) => {
  if (!student?._id || student.role !== 'student') return { enrolledCount: 0 };

  const studentBranch = effectiveStudentBranch(student);
  const subjectQuery = {
    isActive: true,
    pendingDeletion: { $ne: true },
    department: student.department,
    semester: Number(student.semester)
  };
  if (isComputerScienceDepartment(student.department)) {
    if (studentBranch === 'Computer Science') {
      subjectQuery.$or = [{ branch: 'Computer Science' }, { branch: '' }, { branch: { $exists: false } }];
    } else {
      subjectQuery.branch = studentBranch;
    }
  }

  const subjects = await Subject.find(subjectQuery).select('_id');
  const matchingIds = subjects.map(subject => subject._id);
  const current = await User.findById(student._id).select('enrolledSubjects');
  const matchingSet = new Set(matchingIds.map(id => id.toString()));
  const currentIds = (current?.enrolledSubjects || []).map(id => id.toString());
  const invalidIds = currentIds.filter(id => !matchingSet.has(id));

  // MongoDB does not allow $pull and $addToSet on the same array path in one update.
  // Keep this as two small updates so branch/semester cleanup and fresh enrollment can
  // happen during the same request without a conflicting update operator error.
  if (invalidIds.length) {
    await User.findByIdAndUpdate(student._id, {
      $pull: { enrolledSubjects: { $in: invalidIds } }
    });
  }
  if (matchingIds.length) {
    await User.findByIdAndUpdate(student._id, {
      $addToSet: { enrolledSubjects: { $each: matchingIds } }
    });
  }

  return { enrolledCount: subjects.length, removedCount: invalidIds.length };
};

module.exports = {
  syncSubjectEnrollment,
  enrollStudentInMatchingSubjects,
  effectiveStudentBranch,
  effectiveSubjectBranch,
  studentMatchForSubject,
  studentMatchesSubject
};
