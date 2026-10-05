import ExcelJS from 'exceljs';
import { AppError } from '../errors.js';

/** Upload limits for organizer imports. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 2000;

/** RFC 4180 CSV parser (quotes, escaped quotes, CRLF, BOM). Never evaluates anything. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
    if (rows.length > MAX_ROWS + 1) throw new AppError('IMPORT_INVALID', `Too many rows (max ${MAX_ROWS}).`);
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Reads the first worksheet of an .xlsx as text cells (formulas use their cached result, never re-evaluated). */
export async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new AppError('IMPORT_INVALID', 'The file is not a readable .xlsx workbook.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new AppError('IMPORT_INVALID', 'The workbook has no worksheet.');
  if (ws.rowCount > MAX_ROWS + 1) throw new AppError('IMPORT_INVALID', `Too many rows (max ${MAX_ROWS}).`);
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const out: string[] = [];
    for (let c = 1; c <= Math.min(r.cellCount, 60); c++) {
      const cell = r.getCell(c);
      const v = cell.value as unknown;
      let t: string;
      if (v === null || v === undefined) t = '';
      else if (typeof v === 'object' && v && 'result' in (v as object)) t = String((v as { result: unknown }).result ?? '');
      else if (typeof v === 'object' && v && 'text' in (v as object)) t = String((v as { text: unknown }).text ?? '');
      else if (typeof v === 'object' && v && 'richText' in (v as object)) t = ((v as { richText: { text: string }[] }).richText ?? []).map((x) => x.text).join('');
      else if (v instanceof Date) t = v.toISOString();
      else t = String(v);
      out.push(t);
    }
    rows.push(out);
  });
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Decodes a base64 upload, enforces size and type (by extension + magic bytes). */
export async function readUpload(fileName: string, base64: string): Promise<string[][]> {
  if (typeof base64 !== 'string' || !base64) throw new AppError('IMPORT_INVALID', 'Empty upload.');
  const buf = Buffer.from(base64, 'base64');
  if (buf.length > MAX_UPLOAD_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`);
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx')) {
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new AppError('IMPORT_INVALID', 'The .xlsx file is not a valid workbook.');
    return parseXlsx(buf);
  }
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    if (buf.includes(0)) throw new AppError('IMPORT_INVALID', 'The CSV contains binary data.');
    return parseCsv(buf.toString('utf8'));
  }
  throw new AppError('IMPORT_INVALID', 'Upload a .csv or .xlsx file.');
}

export function normHeader(h: string) {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function toXlsx(sheetName: string, header: string[], rows: (string | number | boolean | null)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(header);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) ws.addRow(r.map((v) => (v === null ? '' : v)));
  ws.columns.forEach((c) => (c.width = 22));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
