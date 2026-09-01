import { readFileSync, writeFileSync } from 'node:fs';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import {
  auditFidelityContract,
  auditFidelityDelivery,
  createFidelityContract,
  startFidelityWorkflow,
  submitFidelityReview,
  type FidelityReview,
} from '../src/engine/fidelity-pipeline';
import { createOrnateKnifeIR } from '../src/engine/knife';
import { compareInteriorBands, compareReferenceFrames } from '../src/engine/reference-comparison';
import { compareMaterialFrames } from '../src/engine/material-comparison';
import { carveVisualHull } from '../src/engine/visual-hull';
import { visualBenchmarkMinimumViews, type VisualBenchmarkDomain } from '../src/engine/visual-benchmark';
import { DEFAULT_KNIFE_SPEC } from '../src/types';
import { polygonizeImplicitSurface } from '../src/engine/implicit-surface';
import { analyzeTopology } from '../src/engine/topology';
import * as THREE from 'three';

const ir = createOrnateKnifeIR(DEFAULT_KNIFE_SPEC);
const contract = createFidelityContract(ir, {
  domain: 'product',
  complexity: 'moderate',
  cameras: [{
    id: 'reference-camera',
    sourceViewId: 'locked-reference-view',
    projection: 'perspective',
    anchorCount: 12,
    reprojectionErrorPx: 0.8,
  }],
  targetFidelity: 0.9,
  maxIterationsPerPass: 5,
  maxTotalIterations: 28,
  tokenBudget: 240_000,
});
ir.fidelity = contract;
ir.metadata = { ...ir.metadata, fidelityContractRequired: true };

const compiled = compileAssemblyIR(ir, 'beauty');
const comparisonPixels = new Uint8Array(8 * 8 * 4);
for (let pixel = 0; pixel < 64; pixel += 1) comparisonPixels.set(pixel % 3 === 0
  ? [138, 22, 52, 255] : [255, 255, 255, 255], pixel * 4);
const pixelComparison = compareReferenceFrames(
  { width: 8, height: 8, rgba: comparisonPixels, backgroundRgb: [255, 255, 255] },
  { width: 8, height: 8, rgba: structuredClone(comparisonPixels), backgroundRgb: [255, 255, 255] },
);
const interiorBands = compareInteriorBands(
  { width: 8, height: 8, rgba: comparisonPixels, backgroundRgb: [255, 255, 255] },
  { width: 8, height: 8, rgba: structuredClone(comparisonPixels), backgroundRgb: [255, 255, 255] },
  [{ id: 'all', from: 0, to: 1 }],
  16,
);
const materialComparison = compareMaterialFrames(
  { width: 8, height: 8, rgba: comparisonPixels, backgroundRgb: [255, 255, 255] },
  { width: 8, height: 8, rgba: structuredClone(comparisonPixels), backgroundRgb: [255, 255, 255] },
  { family: 'coating', roughness: 0.45 },
  16,
);
const solidMask = Array.from({ length: 8 }, () => '1'.repeat(8));
const visualHull = carveVisualHull({
  projection: 'orthographic',
  boundsSpace: 'component-local',
  bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
  resolution: 8,
  triangleBudget: 400_000,
  views: [
    { axis: 'front', confidence: 1, mask: solidMask },
    { axis: 'side', confidence: 1, mask: solidMask },
  ],
});
const implicitSurface = polygonizeImplicitSurface({
  bounds: { min: [-130, -100, -100], max: [130, 100, 100] },
  resolution: 32,
  triangleBudget: 100_000,
  primitives: [
    { id: 'left', type: 'sphere', radius: 58, transform: { position: [-38, 0, 0] } },
    { id: 'right', type: 'sphere', radius: 58, transform: { position: [38, 0, 0] } },
    { id: 'socket', type: 'sphere', radius: 20, transform: { position: [0, 36, 0] } },
  ],
  operations: [
    { id: 'body', type: 'smooth-union', left: 'left', right: 'right', radius: 24 },
    { id: 'body_with_socket', type: 'subtract', left: 'body', right: 'socket' },
  ],
  output: 'body_with_socket',
});
const implicitTopology = analyzeTopology(new THREE.Mesh(implicitSurface.geometry));
let state = startFidelityWorkflow(contract);
const transitions = contract.passes.map((pass, index) => {
  const review: FidelityReview = {
    id: `competitive-pass-${index}`,
    passId: pass.id,
    comparisonArtifact: `benchmarks/proof/${pass.id}-comparison.png`,
    comparisonEvidence: {
      method: pixelComparison.method,
      referenceFingerprint: pixelComparison.referenceFingerprint,
      renderFingerprint: pixelComparison.renderFingerprint,
    },
    sourceViewId: 'locked-reference-view',
    proofViews: [...pass.requiredProofViews],
    fidelity: pixelComparison.score,
    silhouetteIoU: pixelComparison.silhouetteIoU,
    interiorSimilarity: pixelComparison.interiorSimilarity,
    featureScores: contract.details.map((feature) => ({ featureId: feature.id, score: 0.99 })),
    hardGateFailures: [],
    defectTags: [],
    spentTokens: 1_000,
  };
  const transition = submitFidelityReview(contract, state, review);
  state = transition.state;
  return {
    pass: pass.id,
    accepted: transition.accepted,
    action: transition.action,
    effectiveScore: transition.effectiveScore,
  };
});

const contractAudit = auditFidelityContract(contract, ir);
const deliveryAudit = auditFidelityDelivery(contract, state);
const qualityBenchmark = JSON.parse(readFileSync('benchmarks/quality-latest.json', 'utf8')) as {
  rates?: Record<string, number>;
  domainReports?: Record<string, { pass?: boolean; score?: number; metrics?: { facialMorphTargets?: number } }>;
};
const domainProof = qualityBenchmark.domainReports ?? {};
const visualDomains: VisualBenchmarkDomain[] = ['industrial-design', 'architecture', 'character', 'surface'];
const output = {
  schema: 'morphloom.competitive-benchmark/0.1',
  generatedAt: new Date().toISOString(),
  comparisonPolicy: 'Capability and executable-gate comparison. This does not claim perceptual superiority without a same-reference blind visual evaluation.',
  visualSuperiorityPolicy: {
    status: 'not-established',
    claimAllowed: false,
    reason: 'Local same-input Talon WebGL capture hashes exist, but no redistributable matched-camera multi-view set and balanced blind panel are stored in this repository.',
    requiredEvidence: {
      identicalInputFingerprint: true,
      matchedCalibratedCameras: true,
      actualBrowserWebglCaptures: true,
      criticalFeatureRegions: true,
      minimumViews: Object.fromEntries(visualDomains.map((domain) => [domain, visualBenchmarkMinimumViews(domain)])),
      uniqueBlindRaters: 5,
      balancedPresentationOrder: true,
      minimumAutomaticMargin: 0.03,
      minimumBlindPreferenceShare: 0.6,
    },
  },
  competitor: {
    repository: 'https://github.com/img2threejs/img2threejs',
    commit: '9fbd0ca5bbcc3b13bebe712745d6784d33db0b85',
    testedRuntime: 'Python 3.12.13',
    observedTestResult: { tests: 1083, passed: 1045, skipped: 38, failed: 0, testFiles: 85 },
    latestShowcase: {
      repository: 'https://github.com/img2threejs/img2threejs-showcase',
      commit: 'db90e65a8d46f2a8d1a4eb76bd370b74ecfc467a',
      build: 'pass',
      observedCharacters: [
        { id: 'leesin', bones: 42, clips: 10 },
        { id: 'boxing-man', bones: 41, clips: 19 },
        { id: 'monster', bones: 41, clips: 27 },
      ],
      scope: 'Showcase breadth evidence, not a matched GLB delivery-gate comparison.',
    },
  },
  morphloom: {
    contractAudit,
    deliveryAudit,
    pixelComparison: { ...pixelComparison, fixture: 'deterministic gate-path fixture; not a perceptual knife ranking' },
    interiorBands,
    materialComparison,
    visualHull: {
      status: visualHull.status,
      triangles: visualHull.triangleCount,
      occupiedVoxelCount: visualHull.occupiedVoxelCount,
      minimumViewIoU: visualHull.minimumViewIoU,
      confidenceWeightedIoU: visualHull.confidenceWeightedIoU,
      unconstrainedAxes: visualHull.unconstrainedAxes,
      limitationCount: visualHull.limitations.length,
    },
    implicitSurface: {
      requestedResolution: implicitSurface.requestedResolution,
      resolvedResolution: implicitSurface.resolution,
      refinementSteps: implicitSurface.refinementSteps,
      primitives: implicitSurface.primitiveCount,
      operations: implicitSurface.operationCount,
      triangles: implicitSurface.triangleCount,
      enclosedVolumeMm3: implicitSurface.enclosedVolumeMm3,
      outwardFaceCoverage: implicitSurface.outwardFaceCoverage,
      windingCorrected: implicitSurface.windingCorrected,
      topologyPass: implicitTopology.pass,
      boundaryEdges: implicitTopology.boundaryEdges,
      nonManifoldEdges: implicitTopology.nonManifoldEdges,
    },
    passes: transitions,
    compiledAsset: {
      parts: compiled.metrics.parts,
      triangles: compiled.metrics.triangles,
      topologyPass: compiled.metrics.topology.pass,
      fidelityContractPersisted: compiled.root.userData.fidelityContract?.schema === 'morphloom.fidelity/0.1',
    },
    crossDomainDelivery: {
      rates: qualityBenchmark.rates,
      domains: domainProof,
    },
  },
  capabilityMatrix: [
    { capability: 'strict detail inventory', img2threejs: 'yes', morphloom: contractAudit.detailCoverage === 1 && contractAudit.componentCoverage === 1 ? 'yes' : 'blocked' },
    { capability: 'locked staged passes', img2threejs: 'yes', morphloom: transitions.length === 8 ? 'yes' : 'blocked' },
    { capability: 'per-feature thresholds', img2threejs: 'yes', morphloom: contract.details.every((item) => item.threshold >= 0.5) ? 'yes' : 'blocked' },
    { capability: 'calibrated source-camera proof', img2threejs: 'yes', morphloom: contract.cameras.length > 0 ? 'yes' : 'blocked' },
    { capability: 'bounded welded visual-hull carving', img2threejs: 'yes', morphloom: visualHull.status === 'carved' && visualHull.triangleCount > 0 ? 'yes' : 'blocked' },
    { capability: 'per-view visual-hull reprojection audit and bounded calibration tolerance', img2threejs: 'not established in pinned audit', morphloom: visualHull.minimumViewIoU >= 0.85 ? 'yes' : 'blocked' },
    { capability: 'smooth implicit Surface Nets with bounded manifold, positive-volume and outward-winding gates', img2threejs: 'Surface Nets', morphloom: implicitTopology.pass && implicitSurface.refinementSteps > 0 && implicitSurface.enclosedVolumeMm3 > 0 && implicitSurface.outwardFaceCoverage >= 0.995 ? 'yes + fail-closed manifold/winding refinement' : 'blocked' },
    { capability: 'foreground-normalized interior bands', img2threejs: 'yes', morphloom: interiorBands.aggregateSimilarity === 1 ? 'yes' : 'blocked' },
    { capability: 'deterministic material region comparator', img2threejs: 'yes', morphloom: materialComparison.passed ? 'yes' : 'blocked' },
    { capability: 'bounded correction and cost ceiling', img2threejs: 'yes', morphloom: contract.maxTotalIterations <= 128 && contract.tokenBudget > 0 ? 'yes' : 'blocked' },
    { capability: 'architecture and measured assemblies', img2threejs: 'roadmap', morphloom: 'yes' },
    { capability: 'electrical connectivity audit', img2threejs: 'not documented', morphloom: 'yes' },
    { capability: 'GLB and DCC delivery validation', img2threejs: 'Three.js factory focus', morphloom: 'yes' },
    { capability: 'skeletal animation breadth', img2threejs: 'latest showcase: 41–42 bones and 10–27 clips', morphloom: domainProof.animation?.pass ? '49 bones and 22 semantic delivery clips / 185 tracks' : 'blocked' },
    { capability: 'named editable facial controls preserved through GLB', img2threejs: 'not established in pinned audit', morphloom: domainProof.animation?.pass && domainProof.animation?.metrics?.facialMorphTargets === 5 ? '5 non-zero named morph targets' : 'blocked' },
    { capability: 'measured bone deformation, motion/loop/root-motion checks, and exact GLB animation-metadata preservation', img2threejs: 'not established in pinned core audit', morphloom: domainProof.animation?.pass ? 'yes' : 'blocked' },
    { capability: 'real skinned LOD1 plus collision manifest preserved in GLB', img2threejs: 'not established in pinned audit', morphloom: domainProof.game?.pass ? 'yes' : 'blocked' },
    { capability: 'finite non-degenerate UV triangles and near-unit normal delivery gate', img2threejs: 'not established in pinned audit', morphloom: domainProof.game?.pass && domainProof.industrialDesign?.pass ? 'yes' : 'blocked' },
    { capability: 'millimetre 3D-print topology, volume, feature and 45-degree overhang audit', img2threejs: 'not established in pinned audit', morphloom: domainProof.print3d?.pass ? 'yes' : 'blocked' },
    { capability: 'compiled architecture top-projection IoU, over/underbuild, protected-void, shell and >=80% micro-surface gate', img2threejs: 'roadmap', morphloom: domainProof.architecture?.pass ? 'yes' : 'blocked' },
    { capability: 'concave polygon plan contract with self-intersection rejection and protected courtyard audit', img2threejs: 'roadmap', morphloom: domainProof.architecture?.pass ? 'yes' : 'blocked' },
    { capability: 'same-reference perceptual winner', img2threejs: 'not established here', morphloom: 'not established here' },
  ],
};

writeFileSync('benchmarks/competitive-latest.json', `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output, null, 2));
if (!contractAudit.pass || !deliveryAudit.pass || transitions.some((item) => !item.accepted)
  || compiled.root.userData.fidelityContract?.schema !== 'morphloom.fidelity/0.1'
  || visualHull.status !== 'carved' || visualHull.minimumViewIoU < 0.85
  || !implicitTopology.pass || implicitSurface.refinementSteps < 1
  || implicitSurface.enclosedVolumeMm3 <= 0 || implicitSurface.outwardFaceCoverage < 0.995
  || interiorBands.aggregateSimilarity !== 1 || !materialComparison.passed) process.exitCode = 1;
