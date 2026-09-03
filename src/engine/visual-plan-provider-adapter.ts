import { auditVisualPlan, type VisualEvidenceKind, type VisualPlanningContract } from './visual-plan-audit';

export interface BoundVisualSource {
  id: string;
  kind: VisualEvidenceKind;
  fingerprint: string;
}

export interface VisualPlanProviderReceipt {
  schema: 'morphloom.visual-plan-provider-receipt/0.1';
  pass: boolean;
  plan?: VisualPlanningContract;
  corrections: string[];
  blockers: string[];
  warnings: string[];
}

const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeSources(sources: BoundVisualSource[]): boolean {
  return Array.isArray(sources) && sources.length >= 1 && sources.length <= 24
    && new Set(sources.map((source) => source.id)).size === sources.length
    && new Set(sources.map((source) => source.fingerprint.toLowerCase())).size === sources.length
    && sources.every((source) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/.test(source.id)
      && ['photo', 'drawing', 'scan', 'datasheet'].includes(source.kind)
      && SHA256.test(source.fingerprint));
}

/**
 * Parses provider JSON and repairs only source metadata proven by an immutable
 * fingerprint binding. Semantic geometry, counts, evidence status and
 * editability are never guessed or silently upgraded.
 */
export function adaptVisualPlanProviderResponse(
  response: string,
  boundSources: BoundVisualSource[],
): VisualPlanProviderReceipt {
  const blockers: string[] = [];
  const corrections: string[] = [];
  if (!safeSources(boundSources)) return {
    schema: 'morphloom.visual-plan-provider-receipt/0.1', pass: false,
    corrections, blockers: ['visual-plan source bindings are invalid'], warnings: [],
  };
  if (typeof response !== 'string' || response.length < 2
    || new TextEncoder().encode(response).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
    return {
      schema: 'morphloom.visual-plan-provider-receipt/0.1', pass: false,
      corrections, blockers: ['visual-plan provider response is empty or oversized'], warnings: [],
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response);
  } catch {
    return {
      schema: 'morphloom.visual-plan-provider-receipt/0.1', pass: false,
      corrections, blockers: ['visual-plan provider response is not strict JSON'], warnings: [],
    };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.sourceViews)) return {
    schema: 'morphloom.visual-plan-provider-receipt/0.1', pass: false,
    corrections, blockers: ['visual-plan provider response has no source-view array'], warnings: [],
  };

  const byFingerprint = new Map(boundSources.map((source) => [source.fingerprint.toLowerCase(), source]));
  const seenFingerprints = new Set<string>();
  for (const sourceView of parsed.sourceViews) {
    if (!isRecord(sourceView) || typeof sourceView.fingerprint !== 'string') {
      blockers.push('visual-plan provider returned an invalid source view');
      continue;
    }
    const fingerprint = sourceView.fingerprint.toLowerCase();
    const binding = byFingerprint.get(fingerprint);
    if (!binding) {
      blockers.push(`visual-plan provider returned an unbound source fingerprint: ${fingerprint.slice(0, 12) || 'missing'}`);
      continue;
    }
    if (seenFingerprints.has(fingerprint)) blockers.push(`visual-plan provider duplicated source fingerprint: ${fingerprint.slice(0, 12)}`);
    seenFingerprints.add(fingerprint);
    if (sourceView.kind !== binding.kind) {
      corrections.push(`source ${String(sourceView.id ?? binding.id)} kind ${String(sourceView.kind)} -> ${binding.kind}`);
      sourceView.kind = binding.kind;
    }
  }
  for (const source of boundSources) {
    if (!seenFingerprints.has(source.fingerprint.toLowerCase())) blockers.push(`visual-plan provider omitted bound source: ${source.id}`);
  }
  if (blockers.length > 0) return {
    schema: 'morphloom.visual-plan-provider-receipt/0.1', pass: false,
    corrections, blockers: [...new Set(blockers)], warnings: [],
  };

  const plan = parsed as unknown as VisualPlanningContract;
  const audit = auditVisualPlan(plan);
  return {
    schema: 'morphloom.visual-plan-provider-receipt/0.1',
    pass: audit.pass,
    plan,
    corrections,
    blockers: audit.blockers,
    warnings: audit.warnings,
  };
}

export function buildVisualPlanProviderPrompt(assetDescription: string, sources: BoundVisualSource[]): string {
  if (typeof assetDescription !== 'string' || !assetDescription.trim() || assetDescription.length > 1_000 || !safeSources(sources)) {
    throw new Error('Visual-plan provider prompt inputs are invalid.');
  }
  const sourceLines = sources.map((source) => `${source.id} kind=${source.kind} sha256=${source.fingerprint}`).join('\n');
  return [
    'You are the evidence-first visual-planning stage of Morphloom.',
    `Asset: ${assetDescription.trim()}`,
    'Return ONLY strict JSON for schema morphloom.visual-plan/0.1. No Markdown and no prose.',
    'Use every immutable source below exactly once. The view id may describe a direction, but kind MUST be one of photo, drawing, scan, datasheet and MUST equal the supplied kind.',
    sourceLines,
    'Required fields: schema, assetName, sourceViews, features, countDeclarations, qualityFloors, surfaceFidelityRequested, openUnknownIds.',
    'Allowed feature kinds: primary-mass, thin-feature, opening, repeated-array, articulation, routed-element, layered-stack, surface-relief, optical-stack, fastener, interface.',
    'Every required visible repeated item must have its own stable ASCII component id and separatelyEditable=true.',
    'Every repeated-array must contain exactly one equal count declaration from each source: quality-target, repetition-system, component-inventory.',
    'Never invent hidden geometry, dimensions or material constants. Mark unsupported facts estimated or inferred and list unresolved facts in openUnknownIds.',
    'Set qualityFloors: detailInventoryMinimum=10, minimumVisualScore=85, referencePbrRequiredWhenSourceImagePresent=true, renderedPreviewRequired=true, realExportRequired=true.',
    'Set surfaceFidelityRequested=true.',
  ].join('\n');
}
