import { describe, expect, it } from 'vitest';
import type { AssemblyIR } from '../src/engine/assembly-ir';
import { auditPartDecomposition, type PartDecompositionContract } from '../src/engine/part-decomposition';

function assembly(): AssemblyIR {
  return {
    schema: 'morphloom.assembly/0.1',
    name: 'Evidence-backed tripod fixture',
    units: 'mm',
    components: [
      {
        id: 'head', name: 'lamp head', category: 'enclosure', materialName: 'metal', detail: 'separate spotlight enclosure',
        geometry: { op: 'cylinder', radiusTop: 72, radiusBottom: 72, depth: 170 },
        rotation: [Math.PI / 2, 0, 0], material: { color: '#222222', surface: 'coated-metal' },
        evidence: { status: 'datasheet', source: 'abo:front' },
      },
      ...[0, 1, 2].map((index) => ({
        id: `leg-${index + 1}`, name: `tripod leg ${index + 1}`, category: 'mechanical' as const,
        materialName: 'metal', detail: 'independent slender support leg',
        geometry: { op: 'tube' as const, points: [[0, 0, 0], [index * 20 - 20, -620, 180]] as Array<[number, number, number]>, radius: 9 },
        material: { color: '#333333', surface: 'coated-metal' as const },
        evidence: { status: 'estimated' as const, source: `abo:view-${index}` },
      })),
      {
        id: 'yoke', name: 'tilt yoke', category: 'mechanical', materialName: 'metal', detail: 'articulated head yoke',
        geometry: { op: 'torus', radius: 80, tube: 8 }, material: { color: '#222222', surface: 'coated-metal' },
        evidence: { status: 'datasheet', source: 'abo:side' },
      },
    ],
  };
}

function contract(): PartDecompositionContract {
  return {
    schema: 'morphloom.part-decomposition/0.1',
    assetName: 'Evidence-backed tripod fixture',
    sourceViewIds: ['front', 'left', 'rear', 'right'],
    features: [
      {
        id: 'lamp-head', label: 'spotlight head', kind: 'primary-mass', required: true,
        evidenceRef: 'abo:front', evidenceStatus: 'datasheet', sourceViewIds: ['front', 'rear'],
        componentIds: ['head'], minimumCount: 1, geometryRequirement: 'separate-part',
      },
      {
        id: 'tripod-legs', label: 'three independent thin legs', kind: 'thin-feature', required: true,
        evidenceRef: 'abo:spin', evidenceStatus: 'estimated', sourceViewIds: ['front', 'left', 'rear', 'right'],
        componentIds: ['leg-1', 'leg-2', 'leg-3'], minimumCount: 3, geometryRequirement: 'slender',
      },
      {
        id: 'tilt-joint', label: 'head tilt joint', kind: 'articulation', required: true,
        evidenceRef: 'abo:side', evidenceStatus: 'datasheet', sourceViewIds: ['left', 'right'],
        componentIds: ['head', 'yoke'], minimumCount: 2, geometryRequirement: 'articulated-parts',
      },
    ],
    relationships: [{
      id: 'head-yoke-hinge', fromFeatureId: 'lamp-head', toFeatureId: 'tilt-joint',
      kind: 'hinges-to', evidenceRef: 'abo:side', required: true,
    }],
  };
}

describe('evidence-first part decomposition', () => {
  it('accepts independently modeled thin members and articulated parts', () => {
    expect(auditPartDecomposition(contract(), assembly())).toMatchObject({
      pass: true,
      requiredFeatureCoverage: 1,
      sourceViewCoverage: 1,
      thinFeatureCount: 3,
    });
  });

  it('rejects a watertight whole-object blockout when required thin parts are missing', () => {
    const ir = assembly();
    ir.components = [ir.components[0]!];
    const audit = auditPartDecomposition(contract(), ir);
    expect(audit.pass).toBe(false);
    expect(audit.blockers.join(' ')).toContain('part feature maps missing components: tripod-legs');
    expect(audit.blockers.join(' ')).toContain('required part feature is not realized: tripod-legs');
  });

  it('rejects a fake opening represented by a solid component', () => {
    const ir = assembly();
    const opening = structuredClone(contract());
    opening.features.push({
      id: 'vent-opening', label: 'real vent aperture', kind: 'opening', required: true,
      evidenceRef: 'abo:rear', evidenceStatus: 'estimated', sourceViewIds: ['rear'],
      componentIds: ['head'], minimumCount: 1, geometryRequirement: 'true-opening',
    });
    expect(auditPartDecomposition(opening, ir).blockers).toContain('required part feature is not realized: vent-opening');
  });

  it('rejects source views that were silently omitted from the expected-part inventory', () => {
    const incomplete = contract();
    incomplete.features.forEach((feature) => { feature.sourceViewIds = feature.sourceViewIds.filter((id) => id !== 'right'); });
    const audit = auditPartDecomposition(incomplete, assembly());
    expect(audit.blockers).toContain('part inventory covers 3/4 source views');
  });

  it('rejects an LLM inventory that counts fewer thin parts than the independent silhouette receipt', () => {
    const undercounted = contract();
    const legs = undercounted.features.find((feature) => feature.id === 'tripod-legs')!;
    legs.observedCounts = [{ sourceViewId: 'front', count: 4, method: 'silhouette-skeleton' }];
    const audit = auditPartDecomposition(undercounted, assembly());
    expect(audit.blockers).toContain('part feature inventory undercounts observed evidence: tripod-legs (3/4)');
  });

  it('rejects duplicate observed-count receipts and unsafe notes', () => {
    const unsafe = contract();
    unsafe.features[0]!.notes = [''];
    unsafe.features[1]!.observedCounts = [
      { sourceViewId: 'front', count: 3, method: 'silhouette-skeleton' },
      { sourceViewId: 'front', count: 3, method: 'external-vision' },
    ];
    const audit = auditPartDecomposition(unsafe, assembly());
    expect(audit.blockers).toEqual(expect.arrayContaining([
      'part feature notes are invalid: lamp-head',
      'part feature repeats observed-count views: tripod-legs',
    ]));
  });
});
