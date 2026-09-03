import { describe, expect, it } from 'vitest';
import {
  adaptVisualPlanProviderResponse,
  buildVisualPlanProviderPrompt,
  type BoundVisualSource,
} from '../src/engine/visual-plan-provider-adapter';
import type { VisualPlanningContract } from '../src/engine/visual-plan-audit';

const sources: BoundVisualSource[] = [
  { id: 'front', kind: 'photo', fingerprint: 'a'.repeat(64) },
  { id: 'rear', kind: 'photo', fingerprint: 'b'.repeat(64) },
];

function plan(): VisualPlanningContract {
  return {
    schema: 'morphloom.visual-plan/0.1', assetName: 'fan',
    sourceViews: [
      { id: 'front', kind: 'photo', fingerprint: 'a'.repeat(64) },
      { id: 'rear', kind: 'photo', fingerprint: 'b'.repeat(64) },
    ],
    features: [{
      id: 'blades', label: 'three fan blades', kind: 'repeated-array', required: true,
      evidenceStatus: 'estimated', sourceViewIds: ['front', 'rear'], minimumCount: 3,
      observedCounts: [{ sourceViewId: 'front', count: 3 }],
      componentIds: ['blade-1', 'blade-2', 'blade-3'], separatelyEditable: true,
    }],
    countDeclarations: [
      { id: 'blade-quality', featureId: 'blades', source: 'quality-target', count: 3 },
      { id: 'blade-repeat', featureId: 'blades', source: 'repetition-system', count: 3 },
      { id: 'blade-inventory', featureId: 'blades', source: 'component-inventory', count: 3 },
    ],
    qualityFloors: {
      detailInventoryMinimum: 1, minimumVisualScore: 85,
      referencePbrRequiredWhenSourceImagePresent: true, renderedPreviewRequired: true, realExportRequired: true,
    },
    surfaceFidelityRequested: true, openUnknownIds: ['scale'],
  };
}

describe('visual-plan provider boundary', () => {
  it('repairs only a source kind proven by the immutable source hash', () => {
    const candidate = plan() as unknown as Record<string, unknown>;
    (candidate.sourceViews as Array<Record<string, unknown>>)[0]!.kind = 'front';
    (candidate.sourceViews as Array<Record<string, unknown>>)[1]!.kind = 'rear';
    const receipt = adaptVisualPlanProviderResponse(JSON.stringify(candidate), sources);
    expect(receipt).toMatchObject({ pass: true, corrections: ['source front kind front -> photo', 'source rear kind rear -> photo'] });
    expect(receipt.plan?.sourceViews.map((source) => source.kind)).toEqual(['photo', 'photo']);
  });

  it('never turns grouped repeated geometry into fictional edit units', () => {
    const candidate = plan();
    candidate.features[0]!.separatelyEditable = false;
    const receipt = adaptVisualPlanProviderResponse(JSON.stringify(candidate), sources);
    expect(receipt.pass).toBe(false);
    expect(receipt.blockers).toContain('visual repeated feature is not separately editable: blades');
  });

  it('rejects prose, unknown hashes, duplicate hashes and missing bound sources', () => {
    expect(adaptVisualPlanProviderResponse('```json\n{}\n```', sources).blockers)
      .toContain('visual-plan provider response is not strict JSON');
    const unknown = plan();
    unknown.sourceViews[0]!.fingerprint = 'c'.repeat(64);
    expect(adaptVisualPlanProviderResponse(JSON.stringify(unknown), sources).pass).toBe(false);
    const duplicate = plan();
    duplicate.sourceViews[1]!.fingerprint = 'a'.repeat(64);
    expect(adaptVisualPlanProviderResponse(JSON.stringify(duplicate), sources).pass).toBe(false);
  });

  it('builds a deterministic prompt that makes source kinds and editability explicit', () => {
    const prompt = buildVisualPlanProviderPrompt('four-view industrial floor fan', sources);
    expect(prompt).toContain(`front kind=photo sha256=${'a'.repeat(64)}`);
    expect(prompt).toContain('kind MUST be one of photo, drawing, scan, datasheet');
    expect(prompt).toContain('separatelyEditable=true');
    expect(buildVisualPlanProviderPrompt('four-view industrial floor fan', sources)).toBe(prompt);
  });
});
