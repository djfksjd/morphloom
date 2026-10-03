import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, linkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { createBenchmarkRunDirectory, writeBenchmarkReport } from '../scripts/lib/benchmark-run-directory';

describe('Blender benchmark run ownership', () => {
  it('updates the aggregate while retaining inputs and rejects a late report alias', () => {
    const root = mkdtempSync(join(tmpdir(), 'morphloom-benchmark-report-'));
    try {
      const input = join(root, 'source.glb'); writeFileSync(input, 'source');
      const report = join(root, 'report.json'); writeFileSync(report, 'old aggregate');
      writeBenchmarkReport(report, 'new aggregate', [input]);
      expect(readFileSync(report, 'utf8')).toBe('new aggregate');
      rmSync(report); symlinkSync(input, report);
      expect(() => writeBenchmarkReport(report, 'must not write', [input])).toThrow(/protected input/);
      expect(readFileSync(input, 'utf8')).toBe('source');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('creates distinct retained runs without touching prior artifacts or inputs', () => {
    const root = mkdtempSync(join(tmpdir(), 'morphloom-benchmark-run-'));
    try {
      const input = join(root, 'source.glb'); writeFileSync(input, 'source');
      const old = join(root, 'prior.glb'); writeFileSync(old, 'prior');
      const a = createBenchmarkRunDirectory(root, join(root, 'report.json'), [input]);
      writeFileSync(join(a, 'output.glb'), 'run A');
      const b = createBenchmarkRunDirectory(root, join(root, 'report.json'), [input]);
      expect(a).not.toBe(b); expect(existsSync(b)).toBe(true);
      expect(readFileSync(join(a, 'output.glb'), 'utf8')).toBe('run A');
      expect(readFileSync(old, 'utf8')).toBe('prior'); expect(readFileSync(input, 'utf8')).toBe('source');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it.each(['direct', 'symlink', 'hardlink'])('rejects %s report alias onto a protected source', (kind) => {
    const root = mkdtempSync(join(tmpdir(), 'morphloom-benchmark-alias-'));
    try {
      const input = join(root, 'manifest.json'); writeFileSync(input, 'protected manifest');
      let report = input;
      if (kind !== 'direct') { report = join(root, 'report.json'); if (kind === 'symlink') symlinkSync(input, report); else linkSync(input, report); }
      expect(() => createBenchmarkRunDirectory(root, report, [input])).toThrow(/protected input/);
      expect(readFileSync(input, 'utf8')).toBe('protected manifest');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
