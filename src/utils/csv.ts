/** Comma-separated text for a spreadsheet: every field quoted when it needs to be, rows ended with CRLF, BOM first so Excel reads UTF-8. */
export function toCsv<T>(rows: T[], columns: [header: string, value: (row: T) => string | number | boolean | undefined | null][]): string {
  const cell = (v: string | number | boolean | undefined | null) => {
    const s = v == null ? '' : String(v);
    // A leading = + - @ would run as a formula in a spreadsheet: keep it text.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [columns.map(([h]) => cell(h)).join(','), ...rows.map((r) => columns.map(([, f]) => cell(f(r))).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Hands the browser a file to save. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "2026-10-25": for file names. */
export const fileDate = () => new Date().toISOString().slice(0, 10);
