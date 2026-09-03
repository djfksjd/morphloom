import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { auditProductionDominance, type ProductionDominanceCase } from '../src/engine/production-dominance';

const args = process.argv.slice(2);
const inputIndex = args.indexOf('--input');
const outputIndex = args.indexOf('--output');
const exposureLedgerIndex = args.indexOf('--exposure-ledger');
const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : 'benchmarks/production-dominance-cases.json';
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : 'benchmarks/production-dominance-latest.json';
const exposureLedgerPath = exposureLedgerIndex >= 0
  ? args[exposureLedgerIndex + 1] : 'benchmarks/development-exposure-ledger.json';
if (!inputPath || !outputPath || !exposureLedgerPath) {
  throw new Error('Usage: --input <case-json> --output <report-json> [--exposure-ledger <ledger-json>] [--require-claim]');
}

const cases = existsSync(inputPath)
  ? JSON.parse(readFileSync(inputPath, 'utf8')) as ProductionDominanceCase[]
  : [];
const exposureLedgerBytes = readFileSync(exposureLedgerPath);
const exposureLedger = JSON.parse(exposureLedgerBytes.toString('utf8')) as {
  schema?: unknown;
  entries?: Array<{ corpusId?: unknown; corpusCaseId?: unknown; exposure?: unknown; reason?: unknown }>;
};
const ledgerId = /^[a-zA-Z0-9_.-]{1,96}$/;
if (exposureLedger.schema !== 'morphloom.development-exposure-ledger/0.1'
  || !Array.isArray(exposureLedger.entries) || exposureLedger.entries.length > 4_096
  || exposureLedger.entries.some((entry) => !ledgerId.test(String(entry.corpusId ?? ''))
    || !ledgerId.test(String(entry.corpusCaseId ?? ''))
    || !['development-and-debugging', 'development-and-tuning'].includes(String(entry.exposure ?? ''))
    || typeof entry.reason !== 'string' || entry.reason.length < 1 || entry.reason.length > 240)) {
  throw new Error('Development exposure ledger is invalid.');
}
const exposedCorpusCases = exposureLedger.entries.map((entry) => `${entry.corpusId}/${entry.corpusCaseId}`);
if (new Set(exposedCorpusCases).size !== exposedCorpusCases.length) {
  throw new Error('Development exposure ledger contains duplicate cases.');
}
const report = auditProductionDominance(cases, {
  developmentExposureLedgerSha256: createHash('sha256').update(exposureLedgerBytes).digest('hex'),
  exposedCorpusCases,
});
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, pass: report.pass, domains: report.domains.map((item) => ({
  domain: item.domain,
  pass: item.pass,
  cases: item.cases,
  visualWinRate: item.visualWinRate,
})) }, null, 2));
if (args.includes('--require-claim') && !report.claimAllowed) process.exitCode = 1;
