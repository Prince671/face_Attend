export const getStudentIdSortKey = (studentId = '') => {
  const value = String(studentId).trim().toUpperCase();
  const dSeries = value.match(/D(\d+)$/);
  if (dSeries) return { series: 1, number: Number(dSeries[1]), raw: value };
  const numeric = value.match(/(\d+)$/);
  if (numeric) return { series: 0, number: Number(numeric[1].slice(-3)), raw: value };
  return { series: 2, number: Number.MAX_SAFE_INTEGER, raw: value };
};

export const compareStudentIds = (leftId, rightId) => {
  const left = getStudentIdSortKey(leftId);
  const right = getStudentIdSortKey(rightId);
  if (left.series !== right.series) return left.series - right.series;
  if (left.number !== right.number) return left.number - right.number;
  return left.raw.localeCompare(right.raw, undefined, { numeric: true });
};

export const sortByStudentIdTail = (items = [], getId = item => item?.studentId) => (
  [...items].sort((a, b) => compareStudentIds(getId(a), getId(b)))
);
