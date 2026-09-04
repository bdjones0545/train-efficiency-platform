/**
 * Ratchet for the server typecheck.
 *
 * The build has only ever typechecked the client (tsconfig.client.json
 * excludes server/), so server type errors have always shipped. There are too
 * many standing errors to gate on zero, so this gates on *not getting worse*:
 * a baseline records how many errors of each code each file currently has, and
 * the check fails when a file gains an error or a clean file acquires one.
 *
 * Counts are keyed by file and error code rather than by line or message, so
 * the baseline survives reformatting and TypeScript wording changes while still
 * catching a genuinely new error — including one that swaps a fixed TS2339 for
 * a fresh TS2322 in the same file.
 */

export interface TscError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

/** file → error code → count */
export type ErrorCounts = Record<string, Record<string, number>>;

export interface Baseline {
  description: string;
  command: string;
  totalErrors: number;
  counts: ErrorCounts;
}

const ERROR_LINE = /^(\S.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

/** Parses `tsc` output. Continuation lines of multi-line messages are ignored. */
export function parseTscOutput(output: string): TscError[] {
  const errors: TscError[] = [];
  for (const line of output.split("\n")) {
    const match = ERROR_LINE.exec(line);
    if (!match) continue;
    errors.push({
      file: match[1],
      line: Number(match[2]),
      column: Number(match[3]),
      code: match[4],
      message: match[5],
    });
  }
  return errors;
}

export function countErrors(errors: TscError[]): ErrorCounts {
  const counts: ErrorCounts = {};
  for (const error of errors) {
    const byCode = (counts[error.file] ??= {});
    byCode[error.code] = (byCode[error.code] ?? 0) + 1;
  }
  return counts;
}

export interface Regression {
  file: string;
  code: string;
  baseline: number;
  current: number;
}

export interface Improvement {
  file: string;
  code: string;
  baseline: number;
  current: number;
}

export interface ComparisonResult {
  regressions: Regression[];
  improvements: Improvement[];
  /** True when nothing got worse. Improvements never fail the gate. */
  passed: boolean;
}

/**
 * Compares current error counts against the baseline.
 *
 * A file or code absent from the baseline is treated as zero, so a newly
 * introduced error in a previously clean file is a regression.
 */
export function compareToBaseline(baseline: ErrorCounts, current: ErrorCounts): ComparisonResult {
  const regressions: Regression[] = [];
  const improvements: Improvement[] = [];

  const files = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  for (const file of [...files].sort()) {
    const baseCodes = baseline[file] ?? {};
    const currentCodes = current[file] ?? {};
    const codes = new Set([...Object.keys(baseCodes), ...Object.keys(currentCodes)]);

    for (const code of [...codes].sort()) {
      const before = baseCodes[code] ?? 0;
      const after = currentCodes[code] ?? 0;
      if (after > before) regressions.push({ file, code, baseline: before, current: after });
      else if (after < before) improvements.push({ file, code, baseline: before, current: after });
    }
  }

  return { regressions, improvements, passed: regressions.length === 0 };
}

export function totalOf(counts: ErrorCounts): number {
  let total = 0;
  for (const byCode of Object.values(counts)) {
    for (const count of Object.values(byCode)) total += count;
  }
  return total;
}
