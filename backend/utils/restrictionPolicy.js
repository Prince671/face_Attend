const subjectRestrictionFor = (student, subjectId) => (
  (student?.subjectRestrictions || []).find(item => (
    item?.active !== false &&
    String(item.subject?._id || item.subject) === String(subjectId)
  ))
);

const isProfileRestricted = (student) => Boolean(
  student?.isRestricted ||
  student?.status === 'restricted'
);

const isRestrictedForSubject = (student, subjectId) => Boolean(
  isProfileRestricted(student) ||
  subjectRestrictionFor(student, subjectId)
);

const canReceiveSubjectUpdates = (student, subjectId) => {
  if (!student) return false;
  if (student.role && student.role !== 'student') return true;
  return Boolean(
    student.status === 'active' &&
    !student.isRestricted &&
    !isRestrictedForSubject(student, subjectId)
  );
};

const restrictedSubjectErrorMessage = (subjectName = 'this subject') => (
  `Your profile is restricted for ${subjectName}. You cannot receive updates or perform actions for this subject.`
);

module.exports = {
  subjectRestrictionFor,
  isProfileRestricted,
  isRestrictedForSubject,
  canReceiveSubjectUpdates,
  restrictedSubjectErrorMessage,
};
