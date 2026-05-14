const Subject = require('../models/Subject');
const User = require('../models/User');

const studentMatchForSubject = (subject) => ({
  role: 'student',
  department: subject.department,
  semester: Number(subject.semester)
});

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

  const removeResult = await User.updateMany(
    {
      role: 'student',
      enrolledSubjects: subject._id,
      $or: [
        { department: { $ne: subject.department } },
        { semester: { $ne: Number(subject.semester) } }
      ]
    },
    { $pull: { enrolledSubjects: subject._id } }
  );

  return {
    matchedStudents: addResult.modifiedCount || 0,
    removedStudents: removeResult.modifiedCount || 0
  };
};

const enrollStudentInMatchingSubjects = async (student) => {
  if (!student?._id || student.role !== 'student') return { enrolledCount: 0 };

  const subjects = await Subject.find({
    isActive: true,
    department: student.department,
    semester: Number(student.semester)
  }).select('_id');

  const matchingIds = subjects.map(subject => subject._id);
  const invalidSubjects = await Subject.find({
    _id: { $nin: matchingIds },
    $or: [
      { department: { $ne: student.department } },
      { semester: { $ne: Number(student.semester) } }
    ]
  }).select('_id');

  if (invalidSubjects.length > 0) {
    await User.findByIdAndUpdate(student._id, {
      $pull: {
        enrolledSubjects: { $in: invalidSubjects.map(subject => subject._id) }
      }
    });
  }

  if (subjects.length === 0) return { enrolledCount: 0, removedCount: invalidSubjects.length };

  await User.findByIdAndUpdate(student._id, {
    $addToSet: {
      enrolledSubjects: { $each: matchingIds }
    }
  });

  return { enrolledCount: subjects.length, removedCount: invalidSubjects.length };
};

module.exports = {
  syncSubjectEnrollment,
  enrollStudentInMatchingSubjects
};
