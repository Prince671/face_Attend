const User = require('../models/User');
const Lecture = require('../models/Lecture');
const Attendance = require('../models/Attendance');
const Subject = require('../models/Subject');
const { enrollStudentInMatchingSubjects } = require('../utils/subjectEnrollment');

// @desc    Get student dashboard data
// @route   GET /api/student/dashboard
const getDashboard = async (req, res) => {
  try {
    const currentStudent = await User.findById(req.user._id).select('role department semester');
    if (!currentStudent) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    await enrollStudentInMatchingSubjects(currentStudent);

    const student = await User.findById(req.user._id)
      .populate({
        path: 'enrolledSubjects',
        match: {
          isActive: true,
          department: currentStudent.department,
          semester: Number(currentStudent.semester)
        },
        select: 'name code department semester'
      })
      .select('-password -faceEncoding');

    student.enrolledSubjects = (student.enrolledSubjects || []).filter(Boolean);
    const subjectIds = student.enrolledSubjects.map(s => s._id);

    // Recent attendance records (last 10)
    const recentAttendance = await Attendance.find({ student: req.user._id })
      .populate({ path: 'lecture', select: 'title date startTime' })
      .populate('subject', 'name code')
      .sort({ markedAt: -1 })
      .limit(10);

    const completedCounts = await Lecture.aggregate([
      { $match: { subject: { $in: subjectIds }, status: 'completed' } },
      { $group: { _id: '$subject', totalLectures: { $sum: 1 } } }
    ]);
    const attendedCounts = await Attendance.aggregate([
      {
        $match: {
          student: req.user._id,
          subject: { $in: subjectIds },
          status: 'present'
        }
      },
      {
        $lookup: {
          from: 'lectures',
          localField: 'lecture',
          foreignField: '_id',
          as: 'lectureDoc'
        }
      },
      { $unwind: '$lectureDoc' },
      { $match: { 'lectureDoc.status': 'completed' } },
      { $group: { _id: '$subject', attended: { $sum: 1 } } }
    ]);
    const completedCountMap = new Map(completedCounts.map(item => [item._id.toString(), item.totalLectures]));
    const attendedCountMap = new Map(attendedCounts.map(item => [item._id.toString(), item.attended]));

    const subjectStats = student.enrolledSubjects.map((sub) => {
      const key = sub._id.toString();
      const totalLectures = completedCountMap.get(key) || 0;
      const attended = attendedCountMap.get(key) || 0;
      return {
        subject: sub,
        totalLectures,
        attended,
        percentage: totalLectures > 0
          ? ((attended / totalLectures) * 100).toFixed(1)
          : '0.0'
      };
    });

    // ✅ FIX: ALL lectures for enrolled subjects — not just open ones
    // Sorted newest first so student sees the latest scheduled lectures on dashboard
    const allLectures = await Lecture.find({
      subject: { $in: subjectIds }
    })
      .populate('subject', 'name code')
      .sort({ date: 1, startTime: 1, createdAt: 1 })
      .limit(20);

    // Currently open attendance sessions must not depend on the limited recent lecture list.
    const openLectures = await Lecture.find({
      subject: { $in: subjectIds },
      attendanceOpen: true
    })
      .populate('subject', 'name code')
      .sort({ date: 1, startTime: 1, createdAt: 1 });

    // Upcoming (scheduled) lectures — date >= today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcomingLectures = await Lecture.find({
      subject: { $in: subjectIds },
      status: 'scheduled',
      date: { $gte: today }
    })
      .populate('subject', 'name code')
      .sort({ date: 1, startTime: 1, createdAt: 1 })
      .limit(20);

    res.json({
      success: true,
      student,
      recentAttendance,
      subjectStats,
      openLectures,
      upcomingLectures,   // ✅ NEW: sent to frontend
      allLectures          // ✅ NEW: full list for dashboard
    });
  } catch (err) {
    console.error('getDashboard error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// @desc    Get lectures for a specific subject (student view)
const getSubjectLectures = async (req, res) => {
  try {
    const { subjectId } = req.params;
    const student = await User.findById(req.user._id).select('department semester enrolledSubjects');
    const subject = await Subject.findById(subjectId).select('department semester isActive');
    if (!subject || !subject.isActive) return res.status(404).json({ success: false, message: 'Subject not found' });
    const allowed = subject.department === student.department &&
      Number(subject.semester) === Number(student.semester) &&
      student.enrolledSubjects.some(id => id.toString() === subjectId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Access denied: subject is not assigned to your semester' });
    }
    const lectures = await Lecture.find({ subject: subjectId })
      .populate('subject', 'name code semester')
      .sort({ date: 1, startTime: 1, createdAt: 1 });
    res.json({ success: true, lectures });
  } catch (err) {
    console.error('getSubjectLectures error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = { getDashboard, getSubjectLectures };
