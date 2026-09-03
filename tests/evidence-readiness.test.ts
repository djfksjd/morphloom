import { describe, expect, it } from 'vitest';
import {
  buildSemiProfessionalEvidencePack,
  attachEvidenceReadinessToAssembly,
  evaluateSemiProfessionalReadiness,
  type CameraCalibrationObservation,
  type DimensionObservation,
  type SemiProfessionalEvidenceOptions,
} from '../src/engine/evidence-readiness';
import { auditAssemblyDetail, expandGenerationBrief } from '../src/engine/generation-policy';
import { GALAXY_Z_FOLD8_EXTERIOR_IR } from '../src/engine/galaxy-fold8-exterior';
import type { ReferenceCapability, ReferenceRole, ReferenceSourceType, ReferenceView } from '../src/engine/reference-set';

function source(
  id: string,
  role: ReferenceRole,
  options: {
    assetKind?: ReferenceView['assetKind'];
    capabilities?: ReferenceCapability[];
    coveredRoles?: ReferenceRole[];
    sourceType?: ReferenceSourceType;
    componentId?: string;
    fit?: number;
  } = {},
): ReferenceView {
  return {
    id,
    assetKind: options.assetKind ?? 'product',
    url: `blob:${id}`,
    fileName: `${id}.png`,
    fileSize: 4096,
    mimeType: 'image/png',
    lastModified: 1,
    role,
    coveredRoles: options.coveredRoles,
    capabilities: options.capabilities,
    sourceType: options.sourceType,
    componentId: options.componentId,
    evidence: {
      fileName: `${id}.png`,
      width: 2400,
      height: 1600,
      averageColor: '#777777',
      brightness: 0.5,
      portraitSuitability: options.fit ?? 94,
      notes: ['clear source'],
    },
  };
}

function dimension(id: string, property: string, valueMm: number, sourceViewId: string): DimensionObservation {
  return { id, property, valueMm, sourceViewId, status: 'measured', toleranceMm: 0.2 };
}

describe('semi-professional evidence readiness', () => {
  it('accepts one sufficiently resolved technical drawing instead of six photos', () => {
    const drawing = source('dimensioned-product-drawing', 'measurement', {
      sourceType: 'technical-drawing',
      capabilities: ['shape', 'depth', 'scale', 'surface', 'interfaces'],
    });
    const report = evaluateSemiProfessionalReadiness([drawing], {
      profile: 'product-visualization',
      dimensions: [dimension('d-width', 'overall_width', 76.7, drawing.id)],
    });
    expect(report).toMatchObject({
      buildReady: true,
      deliveryReady: true,
      unresolvedCapabilities: [],
      calibratedViews: [drawing.id],
    });
    expect(report.missingRecommendedRoles.length).toBeGreaterThan(0);
    const brief = expandGenerationBrief('치수 설계도로 제품 외관 에셋 만들어줘', report);
    expect(brief).toMatchObject({
      evidenceProfile: 'product-visualization',
      evidenceStatus: 'delivery-ready',
      targetQuality: 'semi-professional-editable',
    });
    expect(brief.agentPrompt).toContain('Evidence Pack is delivery-ready');
    const taggedAssembly = attachEvidenceReadinessToAssembly(GALAXY_Z_FOLD8_EXTERIOR_IR, report);
    expect(taggedAssembly.metadata).toMatchObject({
      evidencePackSchema: 'morphloom.evidence-pack/0.2',
      evidenceDeliveryReady: true,
    });
    const compiledReadiness = auditAssemblyDetail(taggedAssembly);
    expect(compiledReadiness.pass).toBe(false);
    expect(compiledReadiness.blockers).toEqual(expect.arrayContaining([
      'locked fidelity contract is required',
      'evidence-first part decomposition contract is required',
    ]));
  });

  it('accepts a combined architectural drawing sheet when it resolves the required properties', () => {
    const sheet = source('architectural-sheet-a1', 'plan', {
      sourceType: 'technical-drawing',
      coveredRoles: ['elevation', 'section', 'measurement', 'material'],
      capabilities: ['layout', 'scale', 'verticals', 'openings', 'surface', 'circulation'],
    });
    const report = evaluateSemiProfessionalReadiness([sheet], {
      profile: 'architectural-review',
      dimensions: [dimension('d-grid-a', 'grid_a', 7200, sheet.id)],
      sourceAudits: [{
        viewId: sheet.id,
        provenance: 'professional-drawing',
        geometryConsistency: 'verified',
        dimensionLegibility: 'verified',
      }],
    });
    expect(report).toMatchObject({ buildReady: true, deliveryReady: true, sourceAuditReady: true });
    expect(report.score).toBeGreaterThanOrEqual(95);
  });

  it('allows an AI concept sheet draft but blocks semi-professional architectural delivery', () => {
    const sheet = source('pinterest-moderncat-concept', 'plan', {
      sourceType: 'technical-drawing',
      coveredRoles: ['elevation', 'measurement', 'material'],
      capabilities: ['layout', 'scale', 'verticals', 'openings', 'surface', 'circulation'],
      fit: 82,
    });
    const report = evaluateSemiProfessionalReadiness([sheet], {
      profile: 'architectural-review',
      dimensions: [dimension('overall-width', 'overall_width', 12_440, sheet.id)],
      sourceAudits: [{
        viewId: sheet.id,
        provenance: 'synthetic-concept',
        geometryConsistency: 'partial',
        dimensionLegibility: 'partial',
        notes: ['Composite Pinterest panel; no verifiable authoring or field-survey record.'],
      }],
    });
    expect(report).toMatchObject({
      buildReady: true,
      deliveryReady: false,
      sourceAuditReady: false,
    });
    expect(report.score).toBeLessThanOrEqual(84);
    expect(report.sourceAuditIssues.join(' ')).toContain('AI 콘셉트 패널');
    expect(report.nextActions.join(' ')).toContain('현장 실측');
  });

  it('blocks a photo that does not resolve depth or scale without demanding a fixed file count', () => {
    const photo = source('hero-photo', 'front');
    const report = evaluateSemiProfessionalReadiness([photo], { profile: 'product-visualization' });
    expect(report.buildReady).toBe(false);
    expect(report.unresolvedCapabilities).toEqual(expect.arrayContaining(['depth', 'scale', 'surface', 'interfaces']));
    expect(report.blockers.join(' ')).toContain('depth, scale');
  });

  it('blocks contradictory measured dimensions before geometry', () => {
    const drawing = source('drawing', 'measurement', {
      sourceType: 'technical-drawing',
      capabilities: ['shape', 'depth', 'scale', 'surface', 'interfaces'],
    });
    const report = evaluateSemiProfessionalReadiness([drawing], {
      profile: 'product-visualization',
      dimensions: [
        dimension('width-a', 'overall_width', 100, drawing.id),
        dimension('width-b', 'overall_width', 104, drawing.id),
      ],
    });
    expect(report).toMatchObject({ buildReady: false, deliveryReady: false });
    expect(report.conflicts).toHaveLength(1);
    expect(report.blockers.join(' ')).toContain('상충하는 강한 치수 근거');
  });

  it('uses a BOM/part drawing instead of requiring an exploded image for service assemblies', () => {
    const assemblyDrawing = source('assembly-drawing', 'component', {
      sourceType: 'technical-drawing',
      componentId: 'camera_module',
      capabilities: ['shape', 'depth', 'scale', 'surface', 'interfaces', 'internals', 'assembly-order'],
    });
    const options: SemiProfessionalEvidenceOptions = {
      profile: 'service-assembly',
      dimensions: [dimension('module-width', 'module_width', 18.2, assemblyDrawing.id)],
      expectedComponentIds: ['camera_module'],
    };
    const report = evaluateSemiProfessionalReadiness([assemblyDrawing], options);
    expect(report).toMatchObject({ buildReady: true, deliveryReady: true });
    expect(report.missingRecommendedRoles).toContain('exploded');
    const pack = buildSemiProfessionalEvidencePack([assemblyDrawing], options);
    expect(pack.schema).toBe('morphloom.evidence-pack/0.2');
    expect(pack.dimensions[0].sourceViewId).toBe(pack.baseManifest.views[0].id);
    expect(pack.readiness.calibratedViews).toEqual([pack.baseManifest.views[0].id]);
    expect(JSON.stringify(pack)).not.toContain('blob:');
  });

  it('requires calibrated photographic geometry but accepts a valid calibration', () => {
    const views = [
      source('front', 'front', { capabilities: ['shape', 'scale', 'surface', 'interfaces'] }),
      source('side', 'left', { capabilities: ['depth'] }),
    ];
    const dimensions = [dimension('overall-height', 'overall_height', 160, 'front')];
    const uncalibrated = evaluateSemiProfessionalReadiness(views, { profile: 'product-visualization', dimensions });
    expect(uncalibrated).toMatchObject({ buildReady: true, deliveryReady: false });
    const blockedAssembly = attachEvidenceReadinessToAssembly(GALAXY_Z_FOLD8_EXTERIOR_IR, uncalibrated);
    expect(auditAssemblyDetail(blockedAssembly).blockers).toContain('evidence pack not delivery-ready');
    const calibration: CameraCalibrationObservation = {
      viewId: 'front', projection: 'perspective', anchorCount: 6, reprojectionErrorPx: 2.1,
    };
    const calibrated = evaluateSemiProfessionalReadiness(views, {
      profile: 'product-visualization', dimensions, cameraCalibrations: [calibration],
      sourceAudits: [{
        viewId: 'front', provenance: 'client-measured', geometryConsistency: 'verified', dimensionLegibility: 'verified',
      }],
    });
    expect(calibrated).toMatchObject({ buildReady: true, deliveryReady: true });
  });
});
