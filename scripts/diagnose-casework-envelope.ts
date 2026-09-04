import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { createCaseworkFurnitureIR } from '../src/engine/casework-furniture';
import { compareSurfaceGeometry, sampleTriangleSurface } from '../src/engine/surface-geometry-fidelity';
import { collectGltfTriangles, collectThreeTriangles } from './lib/semantic-product-pilot';

const referencePath = process.argv[2];
if (!referencePath) throw new Error('Usage: vite-node scripts/diagnose-casework-envelope.ts <reference.glb>');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const referenceTriangles = collectGltfTriangles(await io.read(referencePath));
const reference = sampleTriangleSurface(referenceTriangles, 512);
const highResolutionReference = sampleTriangleSurface(referenceTriangles, 4_096);

const widths = [610];
const depths = [420, 430, 440];
const bodyHeights = [455];
const legHeights = [140, 150, 160, 170, 180];
const results: Array<Record<string, unknown>> = [];
for (const widthMm of widths) for (const depthMm of depths) {
  for (const bodyHeightMm of bodyHeights) for (const legHeightMm of legHeights) {
    const ir = createCaseworkFurnitureIR({
      name: 'post-reveal envelope diagnostic', widthMm, depthMm, bodyHeightMm, legHeightMm,
      overallHeightMm: 610, drawerCount: 2, source: 'post-seal-ground-truth-diagnostic',
    });
    const build = compileAssemblyIR(ir, 'clay');
    const candidate = sampleTriangleSurface(collectThreeTriangles(build.root), 512);
    const audit = compareSurfaceGeometry(reference.points, candidate.points, { yawStepDegrees: 10 });
    const objective = audit.symmetricRmsChamfer
      + audit.maximumDimensionRelativeError * 0.2
      + (1 - audit.minimumCoverage) * 0.1;
    results.push({
      widthMm, depthMm, bodyHeightMm, legHeightMm, objective,
      maximumDimensionRelativeError: audit.maximumDimensionRelativeError,
      symmetricRmsChamfer: audit.symmetricRmsChamfer,
      minimumCoverage: audit.minimumCoverage,
      bounds: audit.candidateBounds.size,
      worstBand: audit.spatialCoverage.worstBand.id,
      worstCell: audit.spatialCoverage.worstCell.id,
    });
  }
}
results.sort((left, right) => Number(left.objective) - Number(right.objective));
const finalists = results.slice(0, 12).map((entry) => {
  const { widthMm, depthMm, bodyHeightMm, legHeightMm } = entry as unknown as {
    widthMm: number; depthMm: number; bodyHeightMm: number; legHeightMm: number;
  };
  const build = compileAssemblyIR(createCaseworkFurnitureIR({
    name: 'post-reveal envelope diagnostic finalist', widthMm, depthMm, bodyHeightMm, legHeightMm,
    overallHeightMm: 610, drawerCount: 2, source: 'post-seal-ground-truth-diagnostic',
  }), 'clay');
  const candidate = sampleTriangleSurface(collectThreeTriangles(build.root), 4_096);
  const audit = compareSurfaceGeometry(
    highResolutionReference.points,
    candidate.points,
  );
  return { ...entry, highResolution: {
    maximumDimensionRelativeError: audit.maximumDimensionRelativeError,
    symmetricRmsChamfer: audit.symmetricRmsChamfer,
    minimumCoverage: audit.minimumCoverage,
    pass: audit.pass,
  } };
}).sort((left, right) => {
  const leftAudit = left.highResolution;
  const rightAudit = right.highResolution;
  const leftObjective = leftAudit.symmetricRmsChamfer + leftAudit.maximumDimensionRelativeError * 0.2
    + (1 - leftAudit.minimumCoverage) * 0.1;
  const rightObjective = rightAudit.symmetricRmsChamfer + rightAudit.maximumDimensionRelativeError * 0.2
    + (1 - rightAudit.minimumCoverage) * 0.1;
  return leftObjective - rightObjective;
});
console.log(JSON.stringify({
  schema: 'morphloom.casework-envelope-diagnostic/0.1',
  warning: 'Post-seal, post-ground-truth diagnostic. Never report this result as blind holdout evidence.',
  evaluated: results.length,
  best: finalists,
}, null, 2));
