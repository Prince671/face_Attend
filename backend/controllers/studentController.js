const User = require('../models/User');
const Lecture = require('../models/Lecture');
const Attendance = require('../models/Attendance');
const Subject = require('../models/Subject');
const { enrollStudentInMatchingSubjects, studentMatchesSubject } = require('../utils/subjectEnrollment');
const { isProfileRestricted, isRestrictedForSubject, restrictedSubjectErrorMessage } = require('../utils/restrictionPolicy');
const { studentIdentityFilter } = require('../utils/studentIdentity');
const { getAttendanceCriteria } = require('../utils/attendanceCriteria');

const visibleLectureFilter = {
  source: { $ne: 'imported' },
  title: { $not: /^Imported Attendance/i }
};

// @desc    Get student dashboard data
// @route   GET /api/student/dashboard
const getDashboard = async (req, res) => {
  try {
    const currentStudent = await User.findById(req.user._id).select('role course department branch semester status isRestricted subjectRestrictions');
    if (!currentStudent) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }
    if (isProfileRestricted(currentStudent)) {
      return res.json({
        success: true,
        student: currentStudent,
        recentAttendance: [],
        subjectStats: [],
        openLectures: [],
        upcomingLectures: [],
        allLectures: []
      });
    }
    await enrollStudentInMatchingSubjects(currentStudent);

    const subjectMatch = {
      isActive: true,
      department: currentStudent.department,
      semester: Number(currentStudent.semester)
    };
    if (/computer|cse|cs/i.test(String(currentStudent.department || ''))) {
      const branch = currentStudent.branch || 'Computer Science';
      if (branch === 'Computer Science') {
        subjectMatch.$or = [{ branch: 'Computer Science' }, { branch: '' }, { branch: { $exists: false } }];
      } else {
        subjectMatch.branch = branch;
      }
    }

    const student = await User.findById(req.user._id)
      .populate({
        path: 'enrolledSubjects',
        match: subjectMatch,
        select: 'name code department branch semester'
      })
      .select('-password -faceEncoding');

    student.enrolledSubjects = (student.enrolledSubjects || [])
      .filter(Boolean)
      .filter(subject => !isRestrictedForSubject(student, subject._id));
    const subjectIds = student.enrolledSubjects.map(s => s._id);
    const attendanceCriteria = await getAttendanceCriteria({
      course: student.course,
      department: student.department,
      branch: student.branch,
      semester: student.semester,
    });
    const studentRecordFilter = studentIdentityFilter(student);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      recentAttendance,
      completedCounts,
      attendedCounts,
      allLectures,
      openLectures,
      upcomingLectures
    ] = await Promise.all([
      Attendance.find({ ...studentRecordFilter, status: 'present' })
        .populate({ path: 'lecture', select: 'title date startTime source' })
        .populate('subject', 'name code branch')
        .sort({ markedAt: -1 })
        .limit(30)
        .lean(),
      Lecture.aggregate([
        { $match: { subject: { $in: subjectIds }, status: 'completed', pendingDeletion: { $ne: true } } },
        { $group: { _id: '$subject', totalLectures: { $sum: 1 } } }
      ]),
      Attendance.aggregate([
        {
          $match: {
            ...studentRecordFilter,
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
        {
          $match: {
            'lectureDoc.status': 'completed',
            'lectureDoc.pendingDeletion': { $ne: true }
          }
        },
        { $group: { _id: '$subject', attended: { $sum: 1 } } }
      ]),
      Lecture.find({
        subject: { $in: subjectIds },
        status: { $in: ['completed', 'ongoing', 'scheduled'] },
        pendingDeletion: { $ne: true },
        ...visibleLectureFilter
      })
        .populate('subject', 'name code branch')
        .sort({ date: -1, startTime: -1, createdAt: -1 })
        .limit(20)
        .lean(),
      Lecture.find({
        subject: { $in: subjectIds },
        attendanceOpen: true,
        pendingDeletion: { $ne: true },
        ...visibleLectureFilter
      })
        .populate('subject', 'name code')
        .sort({ date: 1, startTime: 1, createdAt: 1 })
        .lean(),
      Lecture.find({
        subject: { $in: subjectIds },
        status: 'scheduled',
        date: { $gte: today },
        pendingDeletion: { $ne: true },
        ...visibleLectureFilter
      })
        .populate('subject', 'name code')
        .sort({ date: 1, startTime: 1, createdAt: 1 })
        .limit(20)
        .lean()
    ]);

    const visibleRecentAttendance = recentAttendance
      .filter(item => item.lecture && item.lecture.source !== 'imported' && !/^Imported Attendance/i.test(String(item.lecture.title || '')))
      .slice(0, 10);
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

    res.json({
      success: true,
      student,
      recentAttendance: visibleRecentAttendance,
      subjectStats,
      openLectures,
      upcomingLectures,
      allLectures,
      attendanceCriteria
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
    const student = await User.findById(req.user._id).select('department branch semester enrolledSubjects status isRestricted subjectRestrictions');
    const subject = await Subject.findById(subjectId).select('department branch semester isActive');
    if (!subject || !subject.isActive) return res.status(404).json({ success: false, message: 'Subject not found' });
    if (isProfileRestricted(student) || isRestrictedForSubject(student, subjectId)) {
      return res.status(403).json({ success: false, message: restrictedSubjectErrorMessage('this subject') });
    }
    const allowed = studentMatchesSubject(student, subject) &&
      student.enrolledSubjects.some(id => id.toString() === subjectId);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Access denied: subject is not assigned to your semester' });
    }
    const lectures = await Lecture.find({ subject: subjectId })
      .populate('subject', 'name code branch semester')
      .sort({ date: 1, startTime: 1, createdAt: 1 })
      .lean();
    res.json({ success: true, lectures });
  } catch (err) {
    console.error('getSubjectLectures error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = { getDashboard, getSubjectLectures };
