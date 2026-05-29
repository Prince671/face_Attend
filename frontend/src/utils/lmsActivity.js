const activityEventName = 'lms-activity:changed';

const storageKeyForUser = (userId) => `studysphere_lms_activity_${userId || 'guest'}`;

export const lmsActivityEventName = activityEventName;

export const lmsActivityBucketForType = (type = '') => {
  const value = String(type || '').toLowerCase();
  if (value.includes('quiz')) return 'quizzes';
  if (value.includes('assignment') || value.includes('submission')) return 'assignments';
  if (value.includes('material') || value.includes('resource') || value.includes('folder')) return 'materials';
  return '';
};

export const readLmsActivity = (userId) => {
  try {
    return JSON.parse(localStorage.getItem(storageKeyForUser(userId)) || '{}');
  } catch {
    return {};
  }
};

export const writeLmsActivity = (userId, next) => {
  localStorage.setItem(storageKeyForUser(userId), JSON.stringify(next || {}));
  window.dispatchEvent(new CustomEvent(activityEventName, { detail: next || {} }));
};

export const markLmsActivity = (userId, subjectId, bucket) => {
  if (!subjectId || !bucket) return;
  const current = readLmsActivity(userId);
  writeLmsActivity(userId, {
    ...current,
    [subjectId]: {
      ...(current[subjectId] || {}),
      [bucket]: true,
    },
  });
};

export const clearLmsActivity = (userId, subjectId, bucket = '') => {
  if (!subjectId) return;
  const current = readLmsActivity(userId);
  if (!current[subjectId]) return;
  const subjectActivity = { ...current[subjectId] };
  if (bucket) delete subjectActivity[bucket];
  const next = { ...current };
  if (!bucket || Object.keys(subjectActivity).length === 0) delete next[subjectId];
  else next[subjectId] = subjectActivity;
  writeLmsActivity(userId, next);
};
