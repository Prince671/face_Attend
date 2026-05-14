require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Subject = require('../models/Subject');
const User = require('../models/User');
const { syncSubjectEnrollment } = require('../utils/subjectEnrollment');

const run = async () => {
  await connectDB();

  const activeSubjects = await Subject.find({ isActive: true });
  let matchedStudents = 0;
  let removedStudents = 0;

  for (const subject of activeSubjects) {
    const result = await syncSubjectEnrollment(subject);
    matchedStudents += result.matchedStudents;
    removedStudents += result.removedStudents;
  }

  const inactiveSubjects = await Subject.find({ isActive: false }).select('_id');
  const inactiveIds = inactiveSubjects.map(subject => subject._id);

  if (inactiveIds.length > 0) {
    const cleanup = await User.updateMany(
      { role: 'student', enrolledSubjects: { $in: inactiveIds } },
      { $pull: { enrolledSubjects: { $in: inactiveIds } } }
    );
    removedStudents += cleanup.modifiedCount || 0;
  }

  console.log(`Synced ${activeSubjects.length} active subjects.`);
  console.log(`Updated enrollments for ${matchedStudents} matching student records.`);
  console.log(`Removed stale enrollments from ${removedStudents} student records.`);
};

run()
  .catch((err) => {
    console.error('Subject enrollment sync failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
  });
