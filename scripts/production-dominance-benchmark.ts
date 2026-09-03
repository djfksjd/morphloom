import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { auditProductionDominance, type ProductionDominanceCase } from '../src/engine/production-dominance';

const args = process.argv.slice(2);
const inputIndex = args.indexOf('--input');
const outputIndex = args.indexOf('--output');
const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : 'benchmarks/production-dominance-cases.json';
const outputPath = outputIndex >= 0 ? args[outputIndex + 1] : 'benchmarks/production-dominance-latest.json';
if (!inputPath || !outputPath) throw new Error('Usage: --input <case-json> --output <report-json> [--require-claim]');

const cases = existsSync(inputPath)
  ? JSON.parse(readFileSync(inputPath, 'utf8')) as ProductionDominanceCase[]
  : [];
const report = auditProductionDominance(cases);
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, pass: report.pass, domains: report.domains.map((item) => ({
  domain: item.domain,
  pass: item.pass,
  cases: item.cases,
  visualWinRate: item.visualWinRate,
})) }, null, 2));
if (args.includes('--require-claim') && !report.claimAllowed) process.exitCode = 1;
