// The block that public/check.py prints on the learner's computer, read back
// from pasted text. Pure functions: used by the page and by check-content.
export const REPORT_START = '----- ZEROPY CHECK -----';
export const REPORT_END = '----- END -----';
/** Must match SALT in public/check.py. Not a secret: it only catches edits. */
export const SEAL_SALT = 'zeropy-local-v1';

export interface LocalReport {
  /** "task", "check" and the facts of the task, all as texts. */
  fields: Record<string, string>;
  /** The lines that the seal covers, as check.py printed them. */
  body: string[];
  seal: string;
}

export type ParseResult =
  | { ok: true; report: LocalReport }
  | { ok: false; reason: 'missing' | 'incomplete' | 'no-seal' };

/**
 * Finds the block in any pasted text: the terminal prompt, the summary and
 * spaces around the lines may come with it.
 */
export function parseReport(text: string): ParseResult {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim());
  const start = lines.findIndex((line) => line === REPORT_START);
  if (start === -1) return { ok: false, reason: 'missing' };
  const end = lines.findIndex((line, i) => i > start && line === REPORT_END);
  if (end === -1) return { ok: false, reason: 'incomplete' };
  const inner = lines.slice(start + 1, end).filter((line) => line !== '');
  const sealLine = inner.find((line) => line.startsWith('seal:'));
  if (!sealLine) return { ok: false, reason: 'no-seal' };
  const body = inner.filter((line) => line !== sealLine);
  const fields: Record<string, string> = {};
  for (const line of body) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { ok: true, report: { fields, body, seal: sealLine.slice(5).trim() } };
}

/**
 * Python that runs before the checks: `report` holds the facts, and
 * `sealed` is True when the block is unchanged.
 */
export function reportSetup(report: LocalReport): string {
  return [
    'import hashlib as _hashlib',
    `report = ${JSON.stringify(report.fields)}`,
    `_body = ${JSON.stringify(report.body.join('\n'))}`,
    `_text = ${JSON.stringify(SEAL_SALT)} + "\\n" + _body`,
    `sealed = _hashlib.sha256(_text.encode("utf-8")).hexdigest()[:10] == ${JSON.stringify(report.seal)}`,
  ].join('\n');
}
