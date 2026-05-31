require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Attendance = require('../models/Attendance');
const AttendanceDispute = require('../models/AttendanceDispute');
const LmsSubmission = require('../models/LmsSubmission');
const LmsQuizAttempt = require('../models/LmsQuizAttempt');
const LmsDiscussion = require('../models/LmsDiscussion');
const LmsMaterialView = require('../models/LmsMaterialView');
const ChatGroupMember = require('../models/ChatGroupMember');
const ChatMessage = require('../models/ChatMessage');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { studentCodeOf } = require('../utils/studentIdentity');

const backfillStudentField = async (Model, { objectField = 'student', codeField = 'studentId', label }) => {
  let updated = 0;
  const rows = await Model.find({
    [objectField]: { $exists: true, $ne: null },
    $or: [{ [codeField]: { $exists: false } }, { [codeField]: '' }, { [codeField]: null }]
  }).select(`${objectField} ${codeField}`).lean();

  for (const row of rows) {
    const user = await User.findById(row[objectField]).select('studentId role').lean();
    const code = user?.role === 'student' ? studentCodeOf(user) : '';
    if (!code) continue;
    await Model.updateOne({ _id: row._id }, { $set: { [codeField]: code } });
    updated += 1;
  }
  console.log(`${label}: ${updated}/${rows.length} updated`);
};

const run = async () => {
  await connectDB();
  await backfillStudentField(Attendance, { label: 'Attendance' });
  await backfillStudentField(AttendanceDispute, { label: 'AttendanceDispute' });
  await backfillStudentField(LmsSubmission, { label: 'LmsSubmission' });
  await backfillStudentField(LmsQuizAttempt, { label: 'LmsQuizAttempt' });
  await backfillStudentField(LmsDiscussion, { label: 'LmsDiscussion' });
  await backfillStudentField(LmsMaterialView, { label: 'LmsMaterialView' });
  await backfillStudentField(ChatGroupMember, { objectField: 'user', codeField: 'userStudentId', label: 'ChatGroupMember' });
  await backfillStudentField(ChatMessage, { objectField: 'sender', codeField: 'senderStudentId', label: 'ChatMessage' });
  await backfillStudentField(Notification, { objectField: 'recipient', codeField: 'recipientStudentId', label: 'Notification' });
  await mongoose.connection.close();
};

if (require.main === module) {
  run().catch(async (error) => {
    console.error(error);
    try { await mongoose.connection.close(); } catch (_) {}
    process.exit(1);
  });
}

module.exports = { run };
