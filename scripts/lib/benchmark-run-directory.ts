import { mkdtempSync, realpathSync, statSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Retain each run independently; an aggregate report must never replace an input. */
function assertReportDestination(report: string, protectedInputs: readonly string[]): string {
  const reportCanonical = join(realpathSync(dirname(report)), basename(report));
  let reportStat: ReturnType<typeof statSync> | undefined;
  try { reportStat = statSync(report); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  for (const input of protectedInputs) {
    const canonical = realpathSync(input);
    const inputStat = statSync(input);
    if (canonical === reportCanonical || (reportStat && reportStat.dev === inputStat.dev && reportStat.ino === inputStat.ino)) {
      throw new Error('Benchmark report aliases a protected input; choose a different report path.');
    }
  }
  return reportCanonical;
}

export function createBenchmarkRunDirectory(directory: string, report: string, protectedInputs: readonly string[]): string {
  assertReportDestination(report, protectedInputs);
  return mkdtempSync(join(realpathSync(directory), 'blender-run-'));
}

/** Replace the report entry atomically, never write through a late symlink/hardlink. */
export function writeBenchmarkReport(report: string, text: string, protectedInputs: readonly string[]): void {
  const canonical = assertReportDestination(report, protectedInputs);
  const staging = mkdtempSync(join(dirname(canonical), '.benchmark-report-'));
  try {
    const temporary = join(staging, 'report.json');
    writeFileSync(temporary, text, { flag: 'wx' });
    assertReportDestination(report, protectedInputs);
    renameSync(temporary, canonical);
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
