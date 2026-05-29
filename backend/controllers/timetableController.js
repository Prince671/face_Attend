const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');
const { loadWorkbook, rowToValues } = require('../utils/excelWorkbook');
const Timetable = require('../models/Timetable');
const Subject = require('../models/Subject');
const Lecture = require('../models/Lecture');
const Attendance = require('../models/Attendance');
const { uploadImage } = require('../utils/cloudinary');
const { getAdminDepartment, assertDepartmentAccess, getAdminSemesterScope, adminDepartmentRoom } = require('../utils/adminScope');
const { logAudit } = require('../utils/auditLogger');
const { isLectureBlockedByHoliday } = require('./holidayController');

const dayIndex = {
  SUN: 0, SUNDAY: 0,
  MON: 1, MONDAY: 1,
  TUE: 2, TUESDAY: 2,
  WED: 3, WEDNESDAY: 3,
  THU: 4, THUR: 4, THURSDAY: 4,
  FRI: 5, FRIDAY: 5,
  SAT: 6, SATURDAY: 6,
};

const emitTimetableChanged = (req, timetable, extra = {}) => {
  const io = req.app.get('io');
  if (!io || !timetable) return;
  const payload = {
    timetableId: timetable._id,
    department: timetable.department,
    generatedFrom: timetable.generatedFrom,
    generatedThrough: timetable.generatedThrough,
    ...extra,
  };
  io.to('admin_room').emit('timetable_changed', payload);
  io.to(adminDepartmentRoom(timetable.department)).emit('timetable_changed', payload);
  io.emit('lectures_changed', payload);
};

const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THUR', 'FRI', 'SAT'];
const ignoredTitles = new Set(['', '-', 'OFF', 'RECESS', 'BREAK', 'LUNCH', 'LIBRARY', 'SPORTS', 'LIB/SELF STUDY', 'SELF STUDY']);
const isIgnoredTitle = (title) => {
  const normalized = String(title || '').toUpperCase().trim();
  return ignoredTitles.has(normalized) || normalized.includes('RECESS') || normalized.includes('LIBRARY') || normalized.includes('SPORTS');
};

const cleanup = (file) => {
  try { if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch (_) {}
};

const scopedDepartment = (req, requested) => getAdminDepartment(req.user) || requested;
const scopeSlots = (slots, user) => {
  const semester = getAdminSemesterScope(user);
  return semester ? (slots || []).filter(slot => Number(slot.semester) === semester) : (slots || []);
};
const scopeTimetable = (timetable, user) => {
  if (!timetable) return timetable;
  const object = timetable.toObject ? timetable.toObject() : timetable;
  object.slots = scopeSlots(object.slots, user);
  return object;
};

const isSpreadsheet = (file) => {
  const ext = path.extname(file?.originalname || '').toLowerCase();
  return ['.xlsx', '.csv'].includes(ext) || /spreadsheetml\.sheet|csv/i.test(file?.mimetype || '');
};

const isImage = (file) => /^image\//i.test(file?.mimetype || '');

const normalizeDay = (value) => {
  const text = String(value || '').trim().toUpperCase();
  if (dayIndex[text] !== undefined) return dayNames[dayIndex[text]];
  const match = Object.keys(dayIndex).find(key => text.startsWith(key));
  return match ? dayNames[dayIndex[match]] : '';
};

const romanToNumber = (roman) => {
  const map = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
  return map[String(roman || '').toUpperCase()] || null;
};

const normalizeSemester = (value) => {
  if (typeof value === 'number') return value;
  const text = String(value || '').trim().toUpperCase();
  const number = text.match(/\b([1-8])\b/);
  if (number) return Number(number[1]);
  const roman = text.match(/\b(VIII|VII|VI|IV|III|II|I|V)\b/);
  return roman ? romanToNumber(roman[1]) : null;
};

const normalizeTime = (value) => {
  if (value instanceof Date) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
  if (typeof value === 'number') {
    const totalMinutes = Math.round(value * 24 * 60);
    return `${String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
  }

  const text = String(value || '').trim().toUpperCase().replace(/\./g, ':');
  const match = text.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/);
  if (!match) return '';
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const meridiem = match[3];
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const splitTimeRange = (value) => {
  const parts = String(value || '').split(/\s*[-–—]\s*/);
  if (parts.length < 2) return ['', ''];
  return [normalizeTime(parts[0]), normalizeTime(parts[1])];
};

const minutesBetween = (startTime, endTime) => {
  const [sh, sm] = String(startTime).split(':').map(Number);
  const [eh, em] = String(endTime).split(':').map(Number);
  const start = sh * 60 + sm;
  let end = eh * 60 + em;
  if (end <= start) end += 24 * 60;
  return Math.max(1, end - start);
};

const subjectCodeFromTitle = (title, department, semester) => {
  const candidate = String(title || '').match(/[A-Z]{2,}(?:[- ]?[A-Z0-9]{1,4})?/i)?.[0] || title;
  const cleaned = String(candidate || 'SUB').replace(/[^a-z0-9]+/gi, '').slice(0, 12).toUpperCase();
  const dept = String(department || 'DEPT').replace(/[^a-z0-9]+/gi, '').slice(0, 3).toUpperCase();
  return `${dept}${semester || ''}${cleaned || 'SUB'}`.slice(0, 18);
};

const inferBranch = (slot = {}, department = '') => {
  const explicit = slot.branch || slot.program || slot.course || slot.stream;
  if (explicit) return String(explicit).trim();
  const label = String(slot.semesterLabel || slot.class || slot.semester || '').toUpperCase();
  const dept = String(department || '').toLowerCase();
  if (/\bDIP\b|DIP\s*\(|DIPLOMA/.test(label)) return 'Diploma CS';
  if (/\bMCA\b/.test(label)) return 'MCA';
  if (dept.includes('computer') || /\bCS\b|CSE|COMPUTER/.test(label)) return 'Computer Science';
  return '';
};

const extractFaculty = (title) => {
  const match = String(title || '').match(/\(([A-Z]{2,5})\)\s*$/i);
  return match ? match[1].toUpperCase() : '';
};

const cleanSubjectName = (title) => String(title || '')
  .replace(/\([A-Z]{2,5}\)\s*$/i, '')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeLabNumber = (value) => {
  const text = String(value || '').toUpperCase();
  if (text.includes('LAB3') || text.includes('LAB-III') || text.includes('LAB III')) return 'LAB3';
  if (text.includes('LAB2') || text.includes('LAB-II') || text.includes('LAB II')) return 'LAB2';
  if (text.includes('LAB1') || text.includes('LAB-I') || text.includes('LAB I')) return 'LAB1';
  return '';
};

const labMetaFromTitle = (title) => {
  const originalTitle = cleanSubjectName(title);
  const isLab = /\bLAB\b|\bLAB-/i.test(originalTitle);
  if (!isLab) {
    return { isLab: false, labNumber: '', baseSubjectName: originalTitle, lectureTitle: originalTitle };
  }
  const labNumber = normalizeLabNumber(originalTitle) || 'LAB1';
  const baseSubjectName = originalTitle
    .replace(/\s*[- ]?LAB\s*[- ]?(I|II|III|1|2|3)?\b/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    isLab: true,
    labNumber,
    baseSubjectName: baseSubjectName || originalTitle,
    lectureTitle: originalTitle
  };
};

const normalizeAnalyzedSlots = (rawSlots, department) => {
  const parsed = Array.isArray(rawSlots) ? rawSlots : [];
  return parsed.map(slot => {
    const title = cleanSubjectName(slot.subjectName || slot.title || slot.subject || slot.subjectCode);
    const labMeta = labMetaFromTitle(title);
    const day = normalizeDay(slot.day);
    const semester = normalizeSemester(slot.semester || slot.semesterLabel || slot.sem);
    let startTime = normalizeTime(slot.startTime);
    let endTime = normalizeTime(slot.endTime);
    if ((!startTime || !endTime) && slot.time) {
      [startTime, endTime] = splitTimeRange(slot.time);
    }

    return {
      day,
      semester,
      title,
      subjectName: labMeta.baseSubjectName,
      subjectCode: labMeta.isLab ? '' : String(slot.subjectCode || '').trim().toUpperCase(),
      startTime,
      endTime,
      room: String(slot.room || '').trim(),
      faculty: String(slot.faculty || extractFaculty(slot.subjectName || slot.title || '')).trim().toUpperCase(),
      isLab: Boolean(slot.isLab || labMeta.isLab),
      labNumber: normalizeLabNumber(slot.labNumber || labMeta.labNumber),
      branch: inferBranch(slot, department),
      department
    };
  }).filter(slot => (
    slot.day &&
    slot.semester >= 1 &&
    slot.semester <= 8 &&
    slot.startTime &&
    slot.endTime &&
    slot.title &&
    !isIgnoredTitle(slot.title)
  ));
};

const analyzeImageWithMl = async (file, department) => {
  const form = new FormData();
  form.append('image', fs.createReadStream(file.path), file.originalname);
  form.append('department', department);

  const mlRes = await fetch(`${process.env.ML_SERVICE_URL || 'http://localhost:8000'}/analyze-timetable`, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
    timeout: 180000,
  });
  const data = await mlRes.json().catch(() => ({}));
  if (!mlRes.ok || data.success === false) {
    throw new Error(data.message || data.error || 'AI timetable analysis failed');
  }
  const slots = normalizeAnalyzedSlots(data.slots || data.analysis?.slots || [], department);
  if (!slots.length) {
    throw new Error('AI could not extract valid timetable slots. Upload a clearer image or use Excel/CSV.');
  }
  return slots;
};

const parseSpreadsheet = async (file, department) => {
  const { worksheets } = await loadWorkbook(file.path, path.extname(file.originalname || ''));
  const slots = [];
  const gridSlots = [];

  worksheets.forEach(sheet => {
    const sheetRows = [];
    sheet.eachRow({ includeEmpty: true }, row => {
      sheetRows.push(rowToValues(row));
    });
    const firstDataRow = sheetRows.findIndex(row => row.some(value => String(value || '').trim()));
    const headers = firstDataRow >= 0 ? sheetRows[firstDataRow].map(value => String(value || '').trim()) : [];
    const rows = firstDataRow >= 0
      ? sheetRows.slice(firstDataRow + 1).map(row => headers.reduce((acc, key, index) => {
        if (key) acc[key] = row[index] ?? '';
        return acc;
      }, {}))
      : [];
    rows.forEach(row => {
      const normalized = {};
      Object.entries(row).forEach(([key, value]) => {
        normalized[String(key).trim().toLowerCase()] = value;
      });

      const day = normalized.day || normalized.days;
      const semester = normalized.semester || normalized.sem || normalized.class;
      const branch = normalized.branch || normalized.program || normalized.course || normalized.stream;
      const title = normalized.subject || normalized['subject name'] || normalized.title || normalized.lecture;
      const start = normalized['start time'] || normalized.start || normalized.from;
      const end = normalized['end time'] || normalized.end || normalized.to;
      const time = normalized.time || normalized.slot;
      if (!day || !semester || !title || (!start && !end && !time)) return;

      slots.push({
        day,
        semester,
        subjectName: title,
        title,
        subjectCode: normalized['subject code'] || normalized.code || '',
        startTime: start,
        endTime: end,
        time,
        room: normalized.room || normalized['room no'] || normalized.classroom || '',
        faculty: normalized.faculty || normalized.teacher || '',
        branch,
      });
    });

    const gridRows = sheetRows;
    const headerIndex = gridRows.findIndex(row => (
      String(row?.[0] || '').trim().toUpperCase() === 'DAY' &&
      String(row?.[1] || '').trim().toUpperCase() === 'SEM'
    ));
    if (headerIndex >= 0) {
      const timeColumns = {
        2: ['09:30', '10:30'],
        3: ['10:30', '11:30'],
        4: ['11:30', '12:30'],
        5: ['12:30', '13:30'],
        7: ['14:00', '15:00'],
        8: ['15:00', '16:00'],
      };
      const isMergeFollower = (rowIndex, colIndex) => {
        const cell = sheet.getCell(rowIndex + 1, colIndex + 1);
        return cell.isMerged && cell.master && cell.master.address !== cell.address;
      };
      const mergedEndColumn = (rowIndex, colIndex) => {
        const cell = sheet.getCell(rowIndex + 1, colIndex + 1);
        const model = (sheet.model.merges || []).find(range => {
          const [start, end] = String(range).split(':');
          if (!start || !end) return false;
          const startCell = sheet.getCell(start);
          const endCell = sheet.getCell(end);
          return rowIndex + 1 >= startCell.row &&
            rowIndex + 1 <= endCell.row &&
            colIndex + 1 >= startCell.col &&
            colIndex + 1 <= endCell.col;
        });
        if (!model) return colIndex;
        const endAddress = String(model).split(':')[1];
        return Math.max(sheet.getCell(endAddress).col - 1, colIndex);
      };

      let currentDay = '';
      for (let rowIndex = headerIndex + 1; rowIndex < gridRows.length; rowIndex += 1) {
        const row = gridRows[rowIndex] || [];
        const firstCell = String(row[0] || '').trim();
        if (/^BRANCH$/i.test(firstCell) || /^ROOM\s*NO/i.test(firstCell)) break;
        if (firstCell) currentDay = normalizeDay(firstCell);

        const semesterLabel = String(row[1] || row[9] || '').trim();
        if (!currentDay || !semesterLabel || /^SEM$/i.test(semesterLabel)) continue;

        Object.entries(timeColumns).forEach(([columnText, range]) => {
          const column = Number(columnText);
          if (isMergeFollower(rowIndex, column)) return;
          const title = String(row[column] || '').trim();
          if (!title) return;
          const endColumn = Math.min(mergedEndColumn(rowIndex, column), 8);
          const endRange = timeColumns[endColumn] || range;
          gridSlots.push({
            day: currentDay,
            semester: semesterLabel,
            semesterLabel,
            branch: inferBranch({ semesterLabel, title, subjectName: title }, department),
            subjectName: title,
            title,
            subjectCode: '',
            startTime: range[0],
            endTime: endRange[1],
            room: '',
            faculty: '',
          });
        });
      }
    }
  });

  const normalizedSlots = normalizeAnalyzedSlots(slots.length ? slots : gridSlots, department);
  if (!normalizedSlots.length) {
    throw new Error('Could not read timetable slots from the spreadsheet. Use either flat columns: day, semester, subject, start time, end time, room, faculty, or the timetable grid format with DAY/SEM/time headers.');
  }
  return normalizedSlots;
};

const ensureSubject = async (slot, department, userId) => {
  const subjectName = slot.subjectName || slot.title;
  const baseCode = (slot.subjectCode || subjectCodeFromTitle(subjectName, department, slot.semester)).toUpperCase();
  const branch = slot.branch || inferBranch(slot, department);
  let subject = await Subject.findOne({ department, branch, semester: slot.semester, $or: [{ name: subjectName }, { code: baseCode }] });
  if (subject) return subject;
  if (!branch) {
    subject = await Subject.findOne({
      department,
      semester: slot.semester,
      $and: [
        { $or: [{ name: subjectName }, { code: baseCode }] },
        { $or: [{ branch: '' }, { branch: { $exists: false } }] }
      ]
    });
    if (subject) return subject;
  }

  let code = baseCode;
  const conflict = await Subject.findOne({ code });
  if (conflict && (conflict.department !== department || String(conflict.branch || '') !== String(branch || ''))) {
    const branchToken = String(branch || 'GEN').replace(/[^a-z0-9]+/gi, '').slice(0, 4).toUpperCase();
    const root = `${baseCode}${branchToken}`.slice(0, 14);
    for (let index = 1; index < 100; index += 1) {
      const nextCode = `${root}${index}`.slice(0, 18);
      const existing = await Subject.findOne({ code: nextCode });
      if (!existing) {
        code = nextCode;
        break;
      }
    }
  }

  subject = await Subject.findOne({ code });
  if (subject) {
    if (subject.department === department && String(subject.branch || '') === String(branch || '') && Number(subject.semester) === Number(slot.semester)) return subject;
    const root = code.slice(0, 14);
    for (let index = 2; index < 100; index += 1) {
      const nextCode = `${root}${index}`.slice(0, 18);
      const existing = await Subject.findOne({ code: nextCode });
      if (!existing) {
        code = nextCode;
        subject = null;
        break;
      }
      if (existing.department === department && String(existing.branch || '') === String(branch || '') && Number(existing.semester) === Number(slot.semester) && existing.name === subjectName) {
        return existing;
      }
    }
  }

  return Subject.create({
    name: subjectName,
    code,
    department,
    branch,
    semester: slot.semester,
    description: 'Created automatically from uploaded timetable',
    createdBy: userId,
    isActive: true,
  });
};

const mergeExistingLabSubjects = async (department, userId) => {
  const labSubjects = await Subject.find({
    department,
    isActive: true,
    name: /\bLAB\b/i
  });

  for (const labSubject of labSubjects) {
    const labMeta = labMetaFromTitle(labSubject.name);
    if (!labMeta.isLab || !labMeta.baseSubjectName) continue;
    const baseSubject = await ensureSubject({
      subjectName: labMeta.baseSubjectName,
      title: labMeta.baseSubjectName,
      semester: labSubject.semester,
      subjectCode: '',
      branch: labSubject.branch || ''
    }, department, userId);

    await Lecture.updateMany(
      { subject: labSubject._id },
      {
        $set: {
          subject: baseSubject._id,
          isLab: true,
          labNumber: labMeta.labNumber || 'LAB1'
        }
      }
    );
    await Attendance.updateMany(
      { subject: labSubject._id },
      { $set: { subject: baseSubject._id } }
    );
    await Timetable.updateMany(
      { 'slots.subject': labSubject._id },
      {
        $set: {
          'slots.$[slot].subject': baseSubject._id,
          'slots.$[slot].isLab': true,
          'slots.$[slot].labNumber': labMeta.labNumber || 'LAB1'
        }
      },
      { arrayFilters: [{ 'slot.subject': labSubject._id }] }
    );
    await Subject.findByIdAndUpdate(labSubject._id, { isActive: false });
  }
};

const buildTimetableSlots = async (slots, department, userId) => {
  const results = [];
  const seen = new Set();

  for (const slot of slots) {
    const subject = await ensureSubject(slot, department, userId);
    const key = `${slot.day}|${slot.semester}|${subject._id}|${slot.startTime}|${slot.endTime}|${slot.room}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      day: slot.day,
      semester: slot.semester,
      branch: slot.branch || inferBranch(slot, department),
      subject: subject._id,
      title: slot.title || subject.name,
      startTime: slot.startTime,
      endTime: slot.endTime,
      room: slot.room,
      faculty: slot.faculty,
      isLab: Boolean(slot.isLab),
      labNumber: slot.isLab ? (slot.labNumber || 'LAB1') : '',
    });
  }

  return results;
};

const nextDateForDay = (start, targetIndex) => {
  const date = new Date(start);
  date.setHours(0, 0, 0, 0);
  const diff = (targetIndex - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + diff);
  return date;
};

const defaultWeekRange = () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const diffToMonday = (day + 6) % 7;
  start.setDate(start.getDate() - diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 5);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const resolveGenerationRange = (body = {}) => {
  const range = defaultWeekRange();
  const startDate = body.startDate ? new Date(body.startDate) : range.start;
  const endDate = body.endDate ? new Date(body.endDate) : range.end;
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw new Error('Select a valid lecture generation date range');
  }
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);
  if (endDate < startDate) {
    throw new Error('Week end date must be after week start date');
  }
  return { startDate, endDate };
};

const generateLecturesForTimetable = async (timetable, userId, startDate, endDate, replaceWeek = true) => {
  const subjectIds = [...new Set(timetable.slots.map(slot => String(slot.subject?._id || slot.subject || '')).filter(Boolean))];
  const stoppedSubjectIds = new Set(
    (await Subject.find({ _id: { $in: subjectIds }, classesStopped: true }).select('_id').lean())
      .map(subject => subject._id.toString())
  );
  if (replaceWeek && subjectIds.length) {
    await Lecture.deleteMany({
      source: 'timetable',
      subject: { $in: subjectIds },
      date: { $gte: startDate, $lte: endDate },
    });
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;
  let cancelled = 0;
  const lectureDocs = [];
  let existingKeys = new Set();

  if (!replaceWeek && subjectIds.length) {
    const existingLectures = await Lecture.find({
      source: 'timetable',
      subject: { $in: subjectIds },
      date: { $gte: startDate, $lte: endDate },
    }).select('subject date startTime endTime').lean();

    existingKeys = new Set(existingLectures.map(lecture => {
      const date = new Date(lecture.date);
      date.setHours(0, 0, 0, 0);
      return `${lecture.subject}|${date.toISOString()}|${lecture.startTime}|${lecture.endTime}`;
    }));
  }

  for (const slot of timetable.slots) {
    const targetIndex = dayIndex[String(slot.day).toUpperCase()];
    if (targetIndex === undefined) continue;
    if (targetIndex === 0) continue;
    for (let date = nextDateForDay(startDate, targetIndex); date <= endDate; date.setDate(date.getDate() + 7)) {
      const subjectId = slot.subject?._id || slot.subject;
      if (stoppedSubjectIds.has(String(subjectId))) {
        skipped += 1;
        continue;
      }
      if (!subjectId || !slot.startTime || !slot.endTime) {
        failed += 1;
        continue;
      }
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const key = `${subjectId}|${dayStart.toISOString()}|${slot.startTime}|${slot.endTime}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      existingKeys.add(key);
      const duration = minutesBetween(slot.startTime, slot.endTime);
      if (!Number.isFinite(duration) || duration <= 0) {
        failed += 1;
        continue;
      }

      const blockingHoliday = await isLectureBlockedByHoliday({
        subject: slot.subject,
        date: dayStart,
        startTime: slot.startTime,
        endTime: slot.endTime
      });
      const lectureDoc = {
        subject: subjectId,
        title: slot.title || slot.subject?.name || 'Timetable Lecture',
        description: `Auto scheduled from ${timetable.title}${slot.room ? ` | Room: ${slot.room}` : ''}${slot.faculty ? ` | Faculty: ${slot.faculty}` : ''}`,
        date: dayStart,
        startTime: slot.startTime,
        endTime: slot.endTime,
        duration,
        createdBy: userId,
        status: blockingHoliday ? 'cancelled' : 'scheduled',
        source: 'timetable',
        timetable: timetable._id,
        timetableSlot: slot._id,
        isLab: Boolean(slot.isLab),
        labNumber: slot.isLab ? (slot.labNumber || 'LAB1') : '',
      };
      if (blockingHoliday) {
        lectureDoc.cancelledByHoliday = blockingHoliday._id;
        lectureDoc.cancellationReason = `${blockingHoliday.type}: ${blockingHoliday.title}`;
        cancelled += 1;
      }

      const validationError = new Lecture(lectureDoc).validateSync();
      if (validationError) {
        failed += 1;
        console.warn('Skipping invalid generated lecture:', validationError.message, lectureDoc);
        continue;
      }

      lectureDocs.push(lectureDoc);
    }
  }

  if (lectureDocs.length) {
    try {
      const inserted = await Lecture.insertMany(lectureDocs, { ordered: false });
      created = inserted.length;
    } catch (err) {
      const insertedDocs = err.insertedDocs || err.result?.insertedIds || [];
      created = Array.isArray(insertedDocs) ? insertedDocs.length : Object.keys(insertedDocs || {}).length;
      failed += Math.max(lectureDocs.length - created, 0);
      if (!created) {
        console.error('generateLectures insertMany failed:', err);
        throw err;
      }
      console.warn(`generateLectures partially inserted ${created}/${lectureDocs.length} lectures:`, err.message);
    }
  }

  return { created, skipped, failed, cancelled };
};

const getTimetables = async (req, res) => {
  try {
    const department = getAdminDepartment(req.user);
    const query = department ? { department } : {};
    const timetables = await Timetable.find(query)
      .populate('slots.subject', 'name code branch semester department')
      .populate('uploadedBy', 'name email')
      .sort({ department: 1 });
    res.json({ success: true, timetables: timetables.map(timetable => scopeTimetable(timetable, req.user)) });
  } catch (err) {
    console.error('getTimetables error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getMyTimetable = async (req, res) => {
  try {
    const timetable = await Timetable.findOne({ department: req.user.department })
      .populate('slots.subject', 'name code branch semester department');
    if (!timetable) return res.json({ success: true, timetable: null });
    const scoped = timetable.toObject();
    const normalizeBranchForStudent = (value) => {
      const text = String(value || '').trim().toLowerCase();
      if (!text) return '';
      if (/diploma|dip/.test(text) && /cs|computer/.test(text)) return 'diploma cs';
      if (/ai\s*\/?\s*ml|artificial/.test(text)) return 'ai/ml engineering';
      if (/computer|cse|^cs$/.test(text)) return 'computer science';
      return text;
    };
    let studentBranch = normalizeBranchForStudent(req.user.branch);
    if (!studentBranch) {
      const departmentText = String(req.user.department || req.user.course || '').toLowerCase();
      if (/computer|cse|^cs$/.test(departmentText)) studentBranch = 'computer science';
    }
    scoped.slots = (scoped.slots || []).filter(slot => {
      const subjectBranch = normalizeBranchForStudent(slot.subject?.branch || slot.branch);
      const semesterMatches = Number(slot.semester) === Number(req.user.semester);
      const branchMatches = studentBranch ? subjectBranch === studentBranch : !subjectBranch;
      return semesterMatches && branchMatches;
    });
    scoped.imageUrl = '';
    res.json({ success: true, timetable: scoped });
  } catch (err) {
    console.error('getMyTimetable error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const upsertTimetable = async (req, res) => {
  const file = req.file;
  try {
    const department = scopedDepartment(req, req.body.department);
    if (!department) throw new Error('Department is required');
    if (!file) throw new Error('Upload a timetable image or Excel/CSV file');

    let analyzedSlots;
    let image = null;
    let uploadType = 'spreadsheet';

    if (isImage(file)) {
      uploadType = 'image';
      analyzedSlots = await analyzeImageWithMl(file, department);
      image = await uploadImage(file.path, {
        folder: `${process.env.CLOUDINARY_FOLDER || 'studysphere'}/timetables`,
        publicId: `timetable_${department.replace(/[^a-z0-9]+/gi, '_')}_${Date.now()}`
      });
    } else if (isSpreadsheet(file)) {
      analyzedSlots = await parseSpreadsheet(file, department);
    } else {
      throw new Error('Unsupported timetable file type');
    }

    if (!analyzedSlots.length) {
      throw new Error('No valid lecture slots were found in the timetable');
    }

    await mergeExistingLabSubjects(department, req.user._id);
    const slots = await buildTimetableSlots(analyzedSlots, department, req.user._id);
    const { startDate, endDate } = resolveGenerationRange(req.body);

    const update = {
      department,
      title: req.body.title || `${department} Timetable`,
      slots,
      uploadedBy: req.user._id,
      analyzedAt: new Date(),
      uploadType,
      originalFileName: file.originalname,
      generatedFrom: startDate,
      generatedThrough: endDate,
    };
    if (image) {
      update.imageUrl = image.url;
      update.imagePublicId = image.publicId;
    }
    if (!image && req.body.clearImage === 'true') {
      update.imageUrl = '';
      update.imagePublicId = '';
    }

    let timetable = await Timetable.findOneAndUpdate(
      { department },
      update,
      { new: true, upsert: true, runValidators: true }
    ).populate('slots.subject', 'name code branch semester department');

    const stats = await generateLecturesForTimetable(timetable, req.user._id, startDate, endDate, true);
    timetable.generatedFrom = startDate;
    timetable.generatedThrough = endDate;
    await timetable.save();
    timetable = await Timetable.findById(timetable._id).populate('slots.subject', 'name code branch semester department');

    cleanup(file);
    await logAudit(req, {
      action: 'timetable.analyzed_and_generated',
      entityType: 'timetable',
      entityId: timetable._id,
      entityName: timetable.title,
      targetDepartment: department,
      details: { slots: slots.length, uploadType, startDate, endDate, ...stats }
    });
    emitTimetableChanged(req, timetable, { action: 'analyzed_and_generated', ...stats });

    res.json({
      success: true,
      timetable: scopeTimetable(timetable, req.user),
      totalSlots: slots.length,
      generated: stats
    });
  } catch (err) {
    cleanup(file);
    console.error('upsertTimetable error:', err);
    const clientErrors = [
      'Upload a timetable',
      'Unsupported timetable',
      'Only timetable images, .xlsx, or .csv files are allowed',
      'No valid lecture slots',
      'Could not read timetable',
      'AI timetable analysis is unavailable',
      'AI could not extract valid timetable slots',
      'AI timetable analysis failed',
      'AI rate limit reached',
      'AI could not return valid timetable JSON',
      'Select a valid lecture generation date range',
      'Week end date must be after week start date',
      'Department is required'
    ];
    const status = clientErrors.some(message => String(err.message || '').includes(message)) ? 400 : 500;
    res.status(status).json({ success: false, message: err.message || 'Server error' });
  }
};

const generateLectures = async (req, res) => {
  try {
    const timetable = await Timetable.findById(req.params.id).populate('slots.subject');
    if (!timetable) return res.status(404).json({ success: false, message: 'Timetable not found' });
    if (!assertDepartmentAccess(timetable, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied: timetable belongs to another department' });
    }
    const scopedTimetable = timetable.toObject();

    const { startDate, endDate } = resolveGenerationRange(req.body);

    const stats = await generateLecturesForTimetable(scopedTimetable, req.user._id, startDate, endDate, req.body.replaceWeek !== false);
    timetable.generatedFrom = startDate;
    timetable.generatedThrough = endDate;
    await timetable.save();
    await logAudit(req, {
      action: 'timetable.generated_lectures',
      entityType: 'timetable',
      entityId: timetable._id,
      entityName: timetable.title,
      targetDepartment: timetable.department,
      details: { startDate, endDate, ...stats }
    });
    emitTimetableChanged(req, timetable, { action: 'generated_lectures', ...stats });

    res.json({ success: true, ...stats });
  } catch (err) {
    console.error('generateLectures error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = { getTimetables, getMyTimetable, upsertTimetable, generateLectures };
