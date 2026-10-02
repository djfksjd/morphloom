import { describe, expect, it } from 'vitest';
import type { AssemblyIR } from '../src/engine/assembly-ir';
import { auditAssemblyEvidenceClaims, recomputeEvidencePackReadiness } from '../src/engine/evidence-claim-audit';
import {
  buildSemiProfessionalEvidencePack,
  evaluateSemiProfessionalReadiness,
  type DimensionObservation,
  type SourceAuditObservation,
} from '../src/engine/evidence-readiness';
import type { ReferenceView } from '../src/engine/reference-set';

function view(options: Partial<ReferenceView> = {}): ReferenceView {
  return {
    id: 'drawing',
    assetKind: 'product',
    url: 'blob:drawing',
    fileName: 'dimensioned-drawing.png',
    fileSize: 4_096,
    mimeType: 'image/png',
    lastModified: 1,
    role: 'measurement',
    coveredRoles: ['front', 'rear', 'left', 'right', 'material'],
    capabilities: ['shape', 'depth', 'scale', 'surface', 'interfaces'],
    sourceType: 'technical-drawing',
    evidence: {
      fileName: 'dimensioned-drawing.png',
      width: 2_400,
      height: 1_600,
      averageColor: '#777777',
      brightness: 0.5,
      portraitSuitability: 96,
      notes: ['legible scale drawing'],
    },
    ...options,
  };
}

function dimension(status: DimensionObservation['status'] = 'measured'): DimensionObservation {
  return {
    id: 'overall-width',
    property: 'overall_width',
    valueMm: 76.7,
    toleranceMm: 0.2,
    status,
    sourceViewId: 'drawing',
  };
}

function audit(overrides: Partial<SourceAuditObservation> = {}): SourceAuditObservation {
  return {
    viewId: 'drawing',
    provenance: 'professional-drawing',
    geometryConsistency: 'verified',
    dimensionLegibility: 'verified',
    ...overrides,
  };
}

function assembly(sourceViewId = 'view_01', status: 'measured' | 'datasheet' = 'measured'): AssemblyIR {
  return {
    schema: 'morphloom.assembly/0.1',
    name: 'evidence-audit-fixture',
    units: 'mm',
    components: [{
      id: 'body',
      name: 'Body',
      category: 'enclosure',
      materialName: 'coated polymer',
      detail: 'editable outer body',
      geometry: { op: 'roundedBox', size: [76.7, 40, 8], radius: 2 },
      material: { color: '#777777', surface: 'molded-polymer' },
      evidence: { status: 'estimated', source: 'visible drawing outline' },
    }],
    dimensionContracts: [{
      id: 'overall-width',
      label: 'Overall width',
      target: { kind: 'assembly' },
      axis: 'x',
      measurement: 'size',
      expectedMm: 76.7,
      toleranceMm: 0.2,
      evidence: { status, sourceViewId, source: 'locked evidence pack' },
    }],
  };
}

describe('evidence claim audit', () => {
  it('does not count a datasheet label attached to a photograph as strong evidence', () => {
    const photo = view({ sourceType: 'photo', role: 'front', coveredRoles: ['rear', 'left', 'right', 'material'] });
    const report = evaluateSemiProfessionalReadiness([photo], {
      profile: 'product-visualization',
      dimensions: [dimension('datasheet')],
      cameraCalibrations: [{ viewId: 'drawing', projection: 'perspective', anchorCount: 6, reprojectionErrorPx: 1 }],
    });
    expect(report.buildReady).toBe(true);
    expect(report.deliveryReady).toBe(false);
    expect(report.strongDimensionProperties).toEqual([]);
    expect(report.warnings.join(' ')).toContain('datasheet claim is backed by photo');
  });

  it('accepts a photographed ruler only when a verified client measurement audit is present', () => {
    const photo = view({ sourceType: 'photo' });
    const withoutAudit = evaluateSemiProfessionalReadiness([photo], {
      profile: 'product-visualization', dimensions: [dimension()],
      cameraCalibrations: [{ viewId: 'drawing', projection: 'perspective', anchorCount: 6, reprojectionErrorPx: 1 }],
    });
    const withAudit = evaluateSemiProfessionalReadiness([photo], {
      profile: 'product-visualization', dimensions: [dimension()],
      cameraCalibrations: [{ viewId: 'drawing', projection: 'perspective', anchorCount: 6, reprojectionErrorPx: 1 }],
      sourceAudits: [audit({ provenance: 'client-measured' })],
    });
    expect(withoutAudit.strongDimensionProperties).toEqual([]);
    expect(withAudit.strongDimensionProperties).toEqual(['overall_width']);
    expect(withAudit.deliveryReady).toBe(true);
  });

  it('recomputes the locked pack and accepts an exact source-bound dimension contract', () => {
    const pack = buildSemiProfessionalEvidencePack([view()], {
      profile: 'product-visualization', dimensions: [dimension()], sourceAudits: [audit()],
    });
    expect(recomputeEvidencePackReadiness(pack)).toEqual(pack.readiness);
    const result = auditAssemblyEvidenceClaims(assembly(), pack);
    expect(result).toMatchObject({ pass: true, blockers: [], checkedComponents: 1, checkedDimensions: 2 });
  });

  it('blocks a model-authored datasheet claim that has no matching datasheet observation', () => {
    const pack = buildSemiProfessionalEvidencePack([view()], {
      profile: 'product-visualization', dimensions: [dimension()], sourceAudits: [audit()],
    });
    const result = auditAssemblyEvidenceClaims(assembly('view_01', 'datasheet'), pack);
    expect(result.pass).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'dimension contract overall-width claims datasheet evidence from technical-drawing',
      'dimension contract overall-width has no exact evidence-pack observation',
    ]));
  });
});

describe('candidate evidence cannot become strong source evidence', () => {
  it.each(['synthetic','unknown'] as const)('rejects %s CAD claims and camera credit after JSON pack roundtrip', kind => {
    const candidate=view({sourceType:'cad', provenance:{schema:'morphloom.reference-provenance/0.1',kind}});
    const pack=buildSemiProfessionalEvidencePack([candidate],{
      profile:'product-visualization', dimensions:[dimension()],
      cameraCalibrations:[{viewId:'drawing',projection:'orthographic',anchorCount:6,reprojectionErrorPx:0}],
      sourceAudits:[audit({provenance:'official-record'})],
    });
    expect(pack.baseManifest.schema).toBe('morphloom.evidence/0.2');
    expect(pack.baseManifest.views).toHaveLength(1);
    const roundtrip=JSON.parse(JSON.stringify(pack));
    const result=recomputeEvidencePackReadiness(roundtrip);
    expect(result.deliveryReady).toBe(false);
    expect(result.strongDimensionProperties).toEqual([]);
    expect(result.calibratedViews).toEqual([]);
    expect(auditAssemblyEvidenceClaims(assembly(),roundtrip).pass).toBe(false);
  });
  it('rejects forged old schema and missing provenance source on imported evidence packs', () => {
    const pack=buildSemiProfessionalEvidencePack([view({provenance:{schema:'morphloom.reference-provenance/0.1',kind:'synthetic'}})],{profile:'product-visualization'});
    const forged=structuredClone(pack);forged.baseManifest.schema='morphloom.evidence/0.1';
    expect(()=>recomputeEvidencePackReadiness(forged)).toThrow();
    pack.baseManifest.views[0].provenance!.sourceViewIds=['missing'];
    expect(()=>recomputeEvidencePackReadiness(pack)).toThrow();
  });
});
