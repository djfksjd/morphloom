import { adaptVisualPlanProviderResponse, type BoundVisualSource } from '../src/engine/visual-plan-provider-adapter';
import { readFile } from 'node:fs/promises';

interface InputEnvelope {
  sources: BoundVisualSource[];
  responses: Record<string, string>;
}

async function readStdin(maxBytes = 8 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const newline = buffer.indexOf(10);
    const accepted = newline >= 0 ? buffer.subarray(0, newline) : buffer;
    bytes += accepted.byteLength;
    if (bytes > maxBytes) throw new Error('Provider audit input exceeds the 8 MiB limit.');
    chunks.push(accepted);
    if (newline >= 0) break;
  }
  return Buffer.concat(chunks).toString('utf8');
}

const sourcePath = process.argv[2];
const serialized = sourcePath ? await readFile(sourcePath, 'utf8') : await readStdin();
const envelope = JSON.parse(serialized) as InputEnvelope;
if (!envelope || !Array.isArray(envelope.sources) || typeof envelope.responses !== 'object' || !envelope.responses) {
  throw new Error('Provider audit envelope is invalid.');
}

const results = Object.fromEntries(Object.entries(envelope.responses).map(([provider, response]) => {
  const receipt = adaptVisualPlanProviderResponse(response, envelope.sources);
  return [provider, {
    pass: receipt.pass,
    corrections: receipt.corrections,
    blockers: receipt.blockers,
    warnings: receipt.warnings,
    featureCount: receipt.plan?.features.length ?? 0,
    repeatedArrayCount: receipt.plan?.features.filter((feature) => feature.kind === 'repeated-array').length ?? 0,
    separatelyEditableRepeatedArrayCount: receipt.plan?.features
      .filter((feature) => feature.kind === 'repeated-array' && feature.separatelyEditable).length ?? 0,
  }];
}));

process.stdout.write(`${JSON.stringify({
  schema: 'morphloom.visual-plan-provider-audit/0.1',
  results,
}, null, 2)}\n`);
