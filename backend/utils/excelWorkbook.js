const ExcelJS = require('exceljs');

const cellValue = (value) => {
  if (value == null) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if (value.text) return value.text;
    if (value.result != null) return value.result;
    if (value.richText) return value.richText.map(part => part.text || '').join('');
    if (value.hyperlink && value.text) return value.text;
  }
  return value;
};

const rowToValues = (row) => {
  const values = [];
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    values[colNumber - 1] = cellValue(cell.value);
  });
  return values.map(value => value ?? '');
};

const loadWorkbook = async (filePath, ext = '') => {
  const workbook = new ExcelJS.Workbook();
  if (String(ext).toLowerCase() === '.csv') {
    const worksheet = await workbook.csv.readFile(filePath);
    return { workbook, worksheets: [worksheet] };
  }
  await workbook.xlsx.readFile(filePath);
  return { workbook, worksheets: workbook.worksheets };
};

const addJsonSheet = (workbook, rows, name, cols = []) => {
  const worksheet = workbook.addWorksheet(name.slice(0, 31));
  const safeRows = rows.length ? rows : [{ Message: 'No records found' }];
  const headers = Object.keys(safeRows[0]);
  worksheet.columns = headers.map((header, index) => ({
    header,
    key: header,
    width: cols[index] || Math.min(Math.max(String(header).length + 4, 14), 32)
  }));
  safeRows.forEach(row => worksheet.addRow(row));
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).alignment = { vertical: 'middle' };
};

const addArraySheet = (workbook, rows, name, cols = []) => {
  const worksheet = workbook.addWorksheet(name.slice(0, 31));
  rows.forEach(row => worksheet.addRow(row));
  if (cols.length) {
    worksheet.columns = cols.map(width => ({ width }));
  }
  worksheet.getRow(1).font = { bold: true };
};

module.exports = {
  ExcelJS,
  addArraySheet,
  addJsonSheet,
  cellValue,
  loadWorkbook,
  rowToValues
};
