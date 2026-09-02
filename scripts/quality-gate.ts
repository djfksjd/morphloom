import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { buildOrnateKnife } from '../src/engine/knife';
import { compileAssemblyIR, waitForReferenceProjections } from '../src/engine/assembly-compiler';
import { buildCharacter } from '../src/engine/character';
import { parseOhpk } from '../src/engine/ohpk';
import { COOLING_ASSEMBLY_IR } from '../src/engine/cooling-assembly';
import { LAUREL_HOMES_BUILDING_B_IR } from '../src/engine/laurel-homes-building-b';
import { MODERNCAT_CONCEPT_RESIDENCE_IR } from '../src/engine/moderncat-concept-residence';
import { ASPHALT_SURFACE_BENCHMARK_IR } from '../src/engine/asphalt-surface-benchmark';
import { DEFAULT_KNIFE_SPEC, DEFAULT_PRODUCT_SPEC, DEFAULT_SPEC, FIELD_HUMAN_SPEC, WEB_HERO_SPEC } from '../src/types';
import { DELIVERY_PIPELINE_REVISION, deliveryInputFingerprint, snapshotScene } from '../src/engine/delivery-validation';
import { auditAssemblyDetail } from '../src/engine/generation-policy';
import { benchmarkPassRates, evaluateBenchmarkCase } from '../src/engine/benchmark-policy';
import { analyzeTopology } from '../src/engine/topology';
import { auditDomainReadiness, DOMAIN_READINESS_REVISION } from '../src/engine/domain-readiness';
import { preparePortableGltfGeometry } from '../src/engine/gltf-export-preparation';
import {
  auditBrowserRoundTripProof,
  browserProofAssetPassed,
  type BrowserRoundTripProofExpectation,
} from '../src/engine/browser-roundtrip-proof';

const knifeA = buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty');
const knifeB = buildOrnateKnife(structuredClone(DEFAULT_KNIFE_SPEC), 'beauty');
const architectureA = compileAssemblyIR(LAUREL_HOMES_BUILDING_B_IR, 'beauty');
const architectureB = compileAssemblyIR(structuredClone(LAUREL_HOMES_BUILDING_B_IR), 'beauty');
const conceptArchitectureA = compileAssemblyIR(MODERNCAT_CONCEPT_RESIDENCE_IR, 'beauty');
const conceptArchitectureB = compileAssemblyIR(structuredClone(MODERNCAT_CONCEPT_RESIDENCE_IR), 'beauty');
const coolingA = compileAssemblyIR(COOLING_ASSEMBLY_IR, 'beauty');
const coolingB = compileAssemblyIR(structuredClone(COOLING_ASSEMBLY_IR), 'beauty');
const humanPack = await parseOhpk(
  new Uint8Array(readFileSync('public/assets/oxihuman-core-v1.ohpk')),
  async (payload) => new Uint8Array(inflateRawSync(payload)),
);
const characterA = buildCharacter(humanPack, WEB_HERO_SPEC, 'beauty');
const characterB = buildCharacter(humanPack, structuredClone(WEB_HERO_SPEC), 'beauty');
const baseCharacterA = buildCharacter(humanPack, FIELD_HUMAN_SPEC, 'beauty');
const baseCharacterB = buildCharacter(humanPack, structuredClone(FIELD_HUMAN_SPEC), 'beauty');
const asphaltA = compileAssemblyIR(ASPHALT_SURFACE_BENCHMARK_IR, 'beauty');
const asphaltB = compileAssemblyIR(structuredClone(ASPHALT_SURFACE_BENCHMARK_IR), 'beauty');

// Match the real browser export lifecycle. Reference projection can finish
// asynchronously, and a pre-projection snapshot is not the delivery build.
await Promise.all([
  knifeA.root, knifeB.root,
  architectureA.root, architectureB.root,
  conceptArchitectureA.root, conceptArchitectureB.root,
  coolingA.root, coolingB.root,
  characterA.root, characterB.root,
  baseCharacterA.root, baseCharacterB.root,
  asphaltA.root, asphaltB.root,
].map((root) => waitForReferenceProjections(root)));

const surfaceCoverage = (build: { metrics: { surfaces: { authoredMaterials: number; microNormalMaterials: number } } }) => build.metrics.surfaces.authoredMaterials > 0
  ? build.metrics.surfaces.microNormalMaterials / build.metrics.surfaces.authoredMaterials
  : 0;

const fingerprints = {
  knife: [snapshotScene(knifeA.root).fingerprint, snapshotScene(knifeB.root).fingerprint] as const,
  architecture: [snapshotScene(architectureA.root).fingerprint, snapshotScene(architectureB.root).fingerprint] as const,
  conceptArchitecture: [snapshotScene(conceptArchitectureA.root).fingerprint, snapshotScene(conceptArchitectureB.root).fingerprint] as const,
  cooling: [snapshotScene(coolingA.root).fingerprint, snapshotScene(coolingB.root).fingerprint] as const,
  character: [snapshotScene(characterA.root).fingerprint, snapshotScene(characterB.root).fingerprint] as const,
  baseCharacter: [snapshotScene(baseCharacterA.root).fingerprint, snapshotScene(baseCharacterB.root).fingerprint] as const,
  asphalt: [snapshotScene(asphaltA.root).fingerprint, snapshotScene(asphaltB.root).fingerprint] as const,
};

const inputFingerprints = {
  knife: deliveryInputFingerprint({ assetKind: 'product', assemblyIR: undefined, productSpec: DEFAULT_KNIFE_SPEC, spec: DEFAULT_SPEC, pack: humanPack }),
  architecture: deliveryInputFingerprint({ assetKind: 'product', assemblyIR: LAUREL_HOMES_BUILDING_B_IR, productSpec: DEFAULT_PRODUCT_SPEC, spec: DEFAULT_SPEC, pack: humanPack }),
  conceptArchitecture: deliveryInputFingerprint({ assetKind: 'product', assemblyIR: MODERNCAT_CONCEPT_RESIDENCE_IR, productSpec: DEFAULT_PRODUCT_SPEC, spec: DEFAULT_SPEC, pack: humanPack }),
  cooling: deliveryInputFingerprint({ assetKind: 'product', assemblyIR: COOLING_ASSEMBLY_IR, productSpec: DEFAULT_PRODUCT_SPEC, spec: DEFAULT_SPEC, pack: humanPack }),
  character: deliveryInputFingerprint({ assetKind: 'human', assemblyIR: undefined, productSpec: DEFAULT_PRODUCT_SPEC, spec: WEB_HERO_SPEC, pack: humanPack }),
  baseCharacter: deliveryInputFingerprint({ assetKind: 'human', assemblyIR: undefined, productSpec: DEFAULT_PRODUCT_SPEC, spec: FIELD_HUMAN_SPEC, pack: humanPack }),
  asphalt: deliveryInputFingerprint({ assetKind: 'product', assemblyIR: ASPHALT_SURFACE_BENCHMARK_IR, productSpec: DEFAULT_PRODUCT_SPEC, spec: DEFAULT_SPEC, pack: humanPack }),
};

// Browser receipts record both the pristine build and the exact scene after
// deterministic normal/tangent preparation. Use the repeated builds for this
// second fingerprint so the audited delivery builds remain untouched.
const preparedFingerprint = (root: import('three').Object3D): string => {
  preparePortableGltfGeometry(root);
  return snapshotScene(root).fingerprint;
};
const preparedFingerprints = {
  knife: preparedFingerprint(knifeB.root),
  architecture: preparedFingerprint(architectureB.root),
  conceptArchitecture: preparedFingerprint(conceptArchitectureB.root),
  cooling: preparedFingerprint(coolingB.root),
  character: preparedFingerprint(characterB.root),
  baseCharacter: preparedFingerprint(baseCharacterB.root),
  asphalt: preparedFingerprint(asphaltB.root),
};
const browserReport = JSON.parse(readFileSync('benchmarks/browser-roundtrip-latest.json', 'utf8')) as unknown;
const browserExpectations: BrowserRoundTripProofExpectation[] = [
  { id: 'ornate-knife-product-visualization', inputFingerprint: inputFingerprints.knife, buildFingerprint: fingerprints.knife[0], preparedSceneFingerprint: preparedFingerprints.knife, qualityReleaseReady: true },
  { id: 'pinterest-concept-architectural-review', inputFingerprint: inputFingerprints.conceptArchitecture, buildFingerprint: fingerprints.conceptArchitecture[0], preparedSceneFingerprint: preparedFingerprints.conceptArchitecture, qualityReleaseReady: false },
  { id: 'laurel-homes-architectural-review', inputFingerprint: inputFingerprints.architecture, buildFingerprint: fingerprints.architecture[0], preparedSceneFingerprint: preparedFingerprints.architecture, qualityReleaseReady: true },
  { id: 'cooling-service-assembly', inputFingerprint: inputFingerprints.cooling, buildFingerprint: fingerprints.cooling[0], preparedSceneFingerprint: preparedFingerprints.cooling, qualityReleaseReady: false },
  { id: 'single-view-character-previs', inputFingerprint: inputFingerprints.character, buildFingerprint: fingerprints.character[0], preparedSceneFingerprint: preparedFingerprints.character, qualityReleaseReady: false },
  { id: 'field-human-runtime-base', inputFingerprint: inputFingerprints.baseCharacter, buildFingerprint: fingerprints.baseCharacter[0], preparedSceneFingerprint: preparedFingerprints.baseCharacter, qualityReleaseReady: true },
  { id: 'asphalt-print-surface', inputFingerprint: inputFingerprints.asphalt, buildFingerprint: fingerprints.asphalt[0], preparedSceneFingerprint: preparedFingerprints.asphalt, qualityReleaseReady: true },
];
const browserProofAudit = auditBrowserRoundTripProof(
  browserReport,
  DELIVERY_PIPELINE_REVISION,
  browserExpectations,
);
const releaseBrowserProofAudit = auditBrowserRoundTripProof(
  browserReport,
  DELIVERY_PIPELINE_REVISION,
  browserExpectations.filter((expectation) => expectation.qualityReleaseReady),
);
const hasMatchingBrowserProof = (id: string): boolean => browserProofAssetPassed(browserProofAudit, id);
const baseBrowserProof = hasMatchingBrowserProof('field-human-runtime-base');
const asphaltBrowserProof = hasMatchingBrowserProof('asphalt-print-surface');
const domainReports = {
  industrialDesign: auditDomainReadiness({
    domain: 'industrial-design', root: knifeA.root, topology: knifeA.metrics.topology,
    evidenceScore: 90, deterministic: fingerprints.knife[0] === fingerprints.knife[1],
    browserGlbRoundTrip: hasMatchingBrowserProof('ornate-knife-product-visualization'),
  }),
  architecture: auditDomainReadiness({
    domain: 'architecture', root: architectureA.root, topology: architectureA.metrics.topology,
    evidenceScore: architectureA.metrics.engineering?.evidenceScore ?? 0,
    deterministic: fingerprints.architecture[0] === fingerprints.architecture[1],
    browserGlbRoundTrip: hasMatchingBrowserProof('laurel-homes-architectural-review'),
  }),
  animation: auditDomainReadiness({
    domain: 'animation', root: baseCharacterA.root, evidenceScore: 90,
    deterministic: fingerprints.baseCharacter[0] === fingerprints.baseCharacter[1], browserGlbRoundTrip: baseBrowserProof,
  }),
  game: auditDomainReadiness({
    domain: 'game', root: baseCharacterA.root, evidenceScore: 90,
    deterministic: fingerprints.baseCharacter[0] === fingerprints.baseCharacter[1], browserGlbRoundTrip: baseBrowserProof,
  }),
  print3d: auditDomainReadiness({
    domain: '3d-print', root: asphaltA.root, topology: asphaltA.metrics.topology,
    evidenceScore: 84, deterministic: fingerprints.asphalt[0] === fingerprints.asphalt[1],
    browserGlbRoundTrip: asphaltBrowserProof, sourceUnitMm: 1,
  }),
};

const checkPassed = (report: { checks: Array<{ id: string; pass: boolean }> }, id: string): boolean => report.checks.some((check) => check.id === id && check.pass);

const cases = [
  evaluateBenchmarkCase({
    id: 'ornate-knife-product-visualization', domain: 'industrial-design', topologyPass: knifeA.metrics.topology.pass,
    evidenceScore: 90, surfaceCoverage: surfaceCoverage(knifeA), domainChecksPass: domainReports.industrialDesign.pass,
    firstFingerprint: fingerprints.knife[0], repeatedFingerprint: fingerprints.knife[1],
    inputFingerprint: inputFingerprints.knife,
    browserGlbRoundTrip: hasMatchingBrowserProof('ornate-knife-product-visualization'),
    expectedDecision: 'release',
  }),
  evaluateBenchmarkCase({
    id: 'pinterest-concept-architectural-review', domain: 'architecture',
    topologyPass: conceptArchitectureA.metrics.topology.pass,
    evidenceScore: conceptArchitectureA.metrics.engineering?.evidenceScore ?? 0,
    surfaceCoverage: surfaceCoverage(conceptArchitectureA),
    domainChecksPass: MODERNCAT_CONCEPT_RESIDENCE_IR.metadata?.planFootprintVerified === true
      && Boolean(conceptArchitectureA.root.getObjectByName('garage_door'))
      && Boolean(conceptArchitectureA.root.getObjectByName('front_balcony_glass')),
    firstFingerprint: fingerprints.conceptArchitecture[0],
    repeatedFingerprint: fingerprints.conceptArchitecture[1],
    inputFingerprint: inputFingerprints.conceptArchitecture,
    browserGlbRoundTrip: hasMatchingBrowserProof('pinterest-concept-architectural-review'),
    expectedDecision: 'block', expectedBlockerPrefix: 'evidence',
  }),
  evaluateBenchmarkCase({
    id: 'laurel-homes-architectural-review', domain: 'architecture', topologyPass: architectureA.metrics.topology.pass,
    evidenceScore: architectureA.metrics.engineering?.evidenceScore ?? 0, surfaceCoverage: surfaceCoverage(architectureA),
    domainChecksPass: auditAssemblyDetail(LAUREL_HOMES_BUILDING_B_IR).pass,
    firstFingerprint: fingerprints.architecture[0], repeatedFingerprint: fingerprints.architecture[1],
    inputFingerprint: inputFingerprints.architecture,
    browserGlbRoundTrip: hasMatchingBrowserProof('laurel-homes-architectural-review'),
    expectedDecision: 'release',
  }),
  evaluateBenchmarkCase({
    id: 'cooling-service-assembly', domain: 'service-assembly', topologyPass: coolingA.metrics.topology.pass,
    evidenceScore: coolingA.metrics.engineering?.evidenceScore ?? 0, surfaceCoverage: surfaceCoverage(coolingA),
    domainChecksPass: Boolean(coolingA.metrics.engineering?.digitalReady),
    firstFingerprint: fingerprints.cooling[0], repeatedFingerprint: fingerprints.cooling[1],
    inputFingerprint: inputFingerprints.cooling,
    browserGlbRoundTrip: hasMatchingBrowserProof('cooling-service-assembly'),
    expectedDecision: 'block', expectedBlockerPrefix: 'evidence',
  }),
  evaluateBenchmarkCase({
    id: 'single-view-character-previs', domain: 'character', topologyPass: analyzeTopology(characterA.root).pass,
    evidenceScore: 35, surfaceCoverage: surfaceCoverage(characterA), domainChecksPass: characterA.metrics.poseLandmarkRmsMeters < 0.04,
    firstFingerprint: fingerprints.character[0], repeatedFingerprint: fingerprints.character[1],
    inputFingerprint: inputFingerprints.character,
    browserGlbRoundTrip: hasMatchingBrowserProof('single-view-character-previs'),
    expectedDecision: 'block', expectedBlockerPrefix: 'evidence',
  }),
  evaluateBenchmarkCase({
    id: 'field-human-animation-base', domain: 'animation',
    topologyPass: checkPassed(domainReports.animation, 'animation-topology'), evidenceScore: 90,
    surfaceCoverage: surfaceCoverage(baseCharacterA), domainChecksPass: domainReports.animation.pass,
    firstFingerprint: fingerprints.baseCharacter[0], repeatedFingerprint: fingerprints.baseCharacter[1],
    inputFingerprint: inputFingerprints.baseCharacter, browserGlbRoundTrip: baseBrowserProof,
    expectedDecision: 'release',
  }),
  evaluateBenchmarkCase({
    id: 'field-human-game-base', domain: 'game',
    topologyPass: checkPassed(domainReports.game, 'game-topology'), evidenceScore: 90,
    surfaceCoverage: surfaceCoverage(baseCharacterA), domainChecksPass: domainReports.game.pass,
    firstFingerprint: fingerprints.baseCharacter[0], repeatedFingerprint: fingerprints.baseCharacter[1],
    inputFingerprint: inputFingerprints.baseCharacter, browserGlbRoundTrip: baseBrowserProof,
    expectedDecision: 'release',
  }),
  evaluateBenchmarkCase({
    id: 'asphalt-3d-print-surface', domain: '3d-print', topologyPass: asphaltA.metrics.topology.pass,
    evidenceScore: 84, surfaceCoverage: surfaceCoverage(asphaltA), domainChecksPass: domainReports.print3d.pass,
    firstFingerprint: fingerprints.asphalt[0], repeatedFingerprint: fingerprints.asphalt[1],
    inputFingerprint: inputFingerprints.asphalt, browserGlbRoundTrip: asphaltBrowserProof,
    expectedDecision: 'release',
  }),
];

const rates = benchmarkPassRates(cases);
const requiredRates = {
  overall: 1,
  technical: 1,
  decision: 1,
  modelRelease: 1,
  deliveryRelease: 1,
  rejectionSafety: 1,
} as const;

const output = {
  schema: 'morphloom.quality-benchmark/0.2',
  readinessRevision: DOMAIN_READINESS_REVISION,
  generatedAt: new Date().toISOString(),
  note: 'Overall pass requires technical integrity plus the correct release/block decision. Release rates remain separate and are never inflated by an expected rejection.',
  counts: {
    lockedCases: cases.length,
    releaseIntended: cases.filter((item) => item.expectedDecision === 'release').length,
    expectedRejections: cases.filter((item) => item.expectedDecision === 'block').length,
  },
  requiredRates,
  rates,
  browserProofAudit,
  releaseBrowserProofAudit,
  domainReports,
  cases,
};
writeFileSync('benchmarks/quality-latest.json', `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output, null, 2));
const failedRates = Object.entries(requiredRates)
  .filter(([key, required]) => rates[key as keyof typeof rates] < required)
  .map(([key, required]) => `${key} ${Math.round(rates[key as keyof typeof rates] * 100)}%/${required * 100}%`);
if (failedRates.length > 0 || !releaseBrowserProofAudit.pass) {
  const receiptFailure = releaseBrowserProofAudit.pass ? '' : ` · release browser proof ${releaseBrowserProofAudit.verifiedAssets}/${releaseBrowserProofAudit.expectedAssets}`;
  console.error(`Quality gate failed: ${failedRates.join(' · ')}${receiptFailure}`);
  process.exitCode = 1;
}
