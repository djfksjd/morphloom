import { describe, expect, it } from 'vitest';
import {
  auditVisualPlan,
  auditVisualPlanRevision,
  lockVisualPlan,
  type VisualPlanningContract,
} from '../src/engine/visual-plan-audit';

const hash = (digit: string): string => digit.repeat(64);

function plan(): VisualPlanningContract {
  return {
    schema: 'morphloom.visual-plan/0.1',
    assetName: 'Industrial floor fan',
    sourceViews: [
      { id: 'front', kind: 'photo', fingerprint: hash('1') },
      { id: 'left', kind: 'photo', fingerprint: hash('2') },
      { id: 'rear', kind: 'photo', fingerprint: hash('3') },
      { id: 'right', kind: 'photo', fingerprint: hash('4') },
    ],
    features: [
      {
        id: 'guard-wires', label: '38 individually editable grille wires', kind: 'repeated-array', required: true,
        evidenceStatus: 'estimated', sourceViewIds: ['front', 'left', 'rear', 'right'], minimumCount: 38,
        observedCounts: [{ sourceViewId: 'front', count: 38 }],
        componentIds: Array.from({ length: 38 }, (_, index) => `guard-wire-${index + 1}`), separatelyEditable: true,
      },
      {
        id: 'fan-blades', label: 'three independently editable fan blades', kind: 'repeated-array', required: true,
        evidenceStatus: 'estimated', sourceViewIds: ['front', 'rear'], minimumCount: 3,
        observedCounts: [{ sourceViewId: 'front', count: 3 }],
        componentIds: ['blade-1', 'blade-2', 'blade-3'], separatelyEditable: true,
      },
    ],
    countDeclarations: [
      { id: 'guard-target', featureId: 'guard-wires', source: 'quality-target', count: 38 },
      { id: 'guard-repeat', featureId: 'guard-wires', source: 'repetition-system', count: 38 },
      { id: 'guard-inventory', featureId: 'guard-wires', source: 'component-inventory', count: 38 },
      { id: 'blade-target', featureId: 'fan-blades', source: 'quality-target', count: 3 },
      { id: 'blade-repeat', featureId: 'fan-blades', source: 'repetition-system', count: 3 },
      { id: 'blade-inventory', featureId: 'fan-blades', source: 'component-inventory', count: 3 },
    ],
    qualityFloors: {
      detailInventoryMinimum: 2, minimumVisualScore: 82,
      referencePbrRequiredWhenSourceImagePresent: true, renderedPreviewRequired: true, realExportRequired: true,
    },
    surfaceFidelityRequested: true,
    openUnknownIds: ['exact-scale'],
  };
}

describe('locked visual planning integrity', () => {
  it('accepts a four-view plan with explicit repeated edit units and locked delivery floors', () => {
    expect(auditVisualPlan(plan())).toMatchObject({ pass: true, sourceViewCoverage: 1, explicitEditUnitCoverage: 1 });
  });

  it('rejects the observed competitor failure: bundled wires, 3/4 blade disagreement, missing views, and disabled PBR', () => {
    const invalid = plan();
    invalid.sourceViews = invalid.sourceViews.slice(0, 1);
    invalid.features[0]!.sourceViewIds = ['front'];
    invalid.features[0]!.componentIds = ['wire-guards'];
    invalid.features[1]!.sourceViewIds = ['front'];
    invalid.features[1]!.componentIds.push('blade-4');
    invalid.qualityFloors.referencePbrRequiredWhenSourceImagePresent = false;
    const audit = auditVisualPlan(invalid);
    expect(audit.pass).toBe(false);
    expect(audit.blockers).toEqual(expect.arrayContaining([
      'visual feature bundles required edit units: guard-wires (1/38)',
      'visual count declaration disagrees with edit-unit inventory: guard-wires (38/1)',
      'visual count declaration disagrees with edit-unit inventory: fan-blades (3/4)',
      'reference PBR cannot be disabled for requested image-conditioned surface fidelity',
    ]));
  });

  it('rejects retries that lower detail, export, preview, PBR, count, editability, or unresolved-evidence floors', () => {
    const baseline = lockVisualPlan(plan());
    const weakened = structuredClone(baseline.plan) as VisualPlanningContract;
    weakened.features[0]!.minimumCount = 1;
    weakened.features[0]!.observedCounts[0]!.count = 1;
    weakened.features[0]!.componentIds = ['wire-guards'];
    weakened.features[0]!.separatelyEditable = false;
    weakened.qualityFloors = {
      detailInventoryMinimum: 1, minimumVisualScore: 70,
      referencePbrRequiredWhenSourceImagePresent: false, renderedPreviewRequired: false, realExportRequired: false,
    };
    weakened.openUnknownIds = [];
    const audit = auditVisualPlanRevision(baseline, weakened);
    expect(audit.blockers).toEqual(expect.arrayContaining([
      'visual-plan revision lowered feature count: guard-wires',
      'visual-plan revision removed editability: guard-wires',
      'visual-plan revision removed planned edit units: guard-wires',
      'visual-plan revision lowered locked quality floors',
      'visual-plan revision erased unresolved evidence without a receipt: exact-scale',
    ]));
  });

  it('requires all three independent count declarations for a repeated feature', () => {
    const incomplete = plan();
    incomplete.countDeclarations = incomplete.countDeclarations.filter((item) => item.source !== 'component-inventory');
    expect(auditVisualPlan(incomplete).blockers).toEqual(expect.arrayContaining([
      'visual repeated feature lacks component-inventory count: guard-wires',
      'visual repeated feature lacks component-inventory count: fan-blades',
    ]));
  });

  it('rejects repeated parts that a provider groups into a non-editable array', () => {
    const grouped = plan();
    grouped.features[0]!.separatelyEditable = false;
    const audit = auditVisualPlan(grouped);
    expect(audit.pass).toBe(false);
    expect(audit.blockers).toContain('visual repeated feature is not separately editable: guard-wires');
  });

  it('rejects duplicate declarations from one authority even when all three authority names exist', () => {
    const duplicated = plan();
    duplicated.countDeclarations.push({
      id: 'guard-target-copy', featureId: 'guard-wires', source: 'quality-target', count: 38,
    });
    const audit = auditVisualPlan(duplicated);
    expect(audit.pass).toBe(false);
    expect(audit.blockers).toContain('duplicate visual count declaration source: guard-wires:quality-target');
  });

  it('allows an unknown to close only when a new evidence receipt is attached', () => {
    const baseline = lockVisualPlan(plan());
    const resolved = structuredClone(baseline.plan) as VisualPlanningContract;
    resolved.openUnknownIds = [];
    resolved.resolutionReceipts = [{ unknownId: 'exact-scale', evidenceViewIds: ['front'], fingerprint: hash('a') }];
    expect(auditVisualPlanRevision(baseline, resolved).pass).toBe(true);
  });

  it('detects mutation of the supposedly locked baseline even if a caller forges a wrapper', () => {
    const baseline = lockVisualPlan(plan());
    const forged = {
      ...baseline,
      plan: structuredClone(baseline.plan),
    };
    (forged.plan as VisualPlanningContract).assetName = 'mutated';
    expect(auditVisualPlanRevision(forged, plan()).blockers).toContain('locked visual-plan fingerprint mismatch');
  });
});
