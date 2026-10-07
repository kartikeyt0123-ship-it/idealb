/** Output/answer normalization rules. These are the published comparison rules. */

/** Program output: CRLF -> LF, strip trailing whitespace on each line, strip trailing blank lines. */
export function normalizeOutput(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
    .replace(/^\n+/, '');
}

/** Typed text answers: trim; optionally collapse internal whitespace and fold case. */
export function normalizeTextAnswer(s: string, opts: { caseSensitive: boolean; collapseWhitespace: boolean; flag?: boolean }): string {
  let out = s.normalize('NFKC').replace(/\r\n?/g, '\n').trim();
  if (opts.flag) {
    // CTF flags: "FLAG: X", "flag = X", "FLAG{X}", "`X`", "'X'" are all accepted as X.
    out = out.replace(/^[`'"]+|[`'"]+$/g, '').trim();
    out = out.replace(/^flag\s*[:=]\s*/i, '').trim();
    const braced = /^(?:flag|idealab)?\{([\s\S]*)\}$/i.exec(out);
    if (braced) out = braced[1].trim();
  }
  if (opts.collapseWhitespace) out = out.replace(/\s+/g, ' ');
  if (!opts.caseSensitive) out = out.toLowerCase();
  return out;
}

/** Numeric answers: accepts "42", "42.0", "1,234.5", " -3.14 ". Returns null when not a finite number. */
export function parseNumericAnswer(s: string): number | null {
  const cleaned = s.trim().replace(/,/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
