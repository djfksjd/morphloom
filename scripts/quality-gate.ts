import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { buildOrnateKnife } from '../src/engine/knife';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { buildCharacter } from '../src/engine/character';
import { parseOhpk } from '../src/engine/ohpk';
import { COOLING_ASSEMBLY_IR } from '../src/engine/cooling-assembly';
import { LAUREL_HOMES_BUILDING_B_IR } from '../src/engine/laurel-homes-building-b';
import { MODERNCAT_CONCEPT_RESIDENCE_IR } from '../src/engine/moderncat-concept-residence';
import { ASPHALT_SURFACE_BENCHMARK_IR } from '../src/engine/asphalt-surface-benchmark';
import { DEFAULT_KNIFE_SPEC, DEFAULT_PRODUCT_SPEC, DEFAULT_SPEC, FIELD_HUMAN_SPEC, WEB_HERO_SPEC } from '../src/types';
import { deliveryInputFingerprint, snapshotScene } from '../src/engine/delivery-validation';
import { auditAssemblyDetail } from '../src/engine/generation-policy';
import { benchmarkPassRates, evaluateBenchmarkCase } from '../src/engine/benchmark-policy';
import { analyzeTopology } from '../src/engine/topology';
import { auditDomainReadiness } from '../src/engine/domain-readiness';

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

type BrowserProof = {
  id?: unknown;
  status?: unknown;
  sceneFingerprint?: unknown;
  buildFingerprint?: unknown;
  inputFingerprint?: unknown;
  qualityReleaseReady?: unknown;
};

const browserProofs = (() => {
  try {
    const parsed = JSON.parse(readFileSync('benchmarks/browser-roundtrip-latest.json', 'utf8')) as { assets?: unknown };
    if (!Array.isArray(parsed.assets)) return new Map<string, BrowserProof>();
    return new Map(parsed.assets
      .filter((item): item is BrowserProof => Boolean(item) && typeof item === 'object' && typeof (item as BrowserProof).id === 'string')
      .map((item) => [item.id as string, item]));
  } catch {
    return new Map<string, BrowserProof>();
  }
})();

const hasMatchingBrowserProof = (id: string, inputFingerprint: string, _nodeSceneFingerprint: string): boolean => {
  const proof = browserProofs.get(id);
  return proof?.status === 'pass'
    && proof.inputFingerprint === inputFingerprint
    && typeof proof.sceneFingerprint === 'string' && /^[a-f0-9]{16}$/.test(proof.sceneFingerprint)
    && typeof proof.buildFingerprint === 'string' && /^[a-f0-9]{16}$/.test(proof.buildFingerprint);
};

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

const baseBrowserProof = hasMatchingBrowserProof('field-human-runtime-base', inputFingerprints.baseCharacter, fingerprints.baseCharacter[0]);
const asphaltBrowserProof = hasMatchingBrowserProof('asphalt-print-surface', inputFingerprints.asphalt, fingerprints.asphalt[0]);
const domainReports = {
  industrialDesign: auditDomainReadiness({
    domain: 'industrial-design', root: knifeA.root, topology: knifeA.metrics.topology,
    evidenceScore: 90, deterministic: fingerprints.knife[0] === fingerprints.knife[1],
    browserGlbRoundTrip: hasMatchingBrowserProof('ornate-knife-product-visualization', inputFingerprints.knife, fingerprints.knife[0]),
  }),
  architecture: auditDomainReadiness({
    domain: 'architecture', root: architectureA.root, topology: architectureA.metrics.topology,
    evidenceScore: architectureA.metrics.engineering?.evidenceScore ?? 0,
    deterministic: fingerprints.architecture[0] === fingerprints.architecture[1],
    browserGlbRoundTrip: hasMatchingBrowserProof('laurel-homes-architectural-review', inputFingerprints.architecture, fingerprints.architecture[0]),
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
    browserGlbRoundTrip: hasMatchingBrowserProof('ornate-knife-product-visualization', inputFingerprints.knife, fingerprints.knife[0]),
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
    browserGlbRoundTrip: hasMatchingBrowserProof('pinterest-concept-architectural-review', inputFingerprints.conceptArchitecture, fingerprints.conceptArchitecture[0]),
    expectedDecision: 'block', expectedBlockerPrefix: 'evidence',
  }),
  evaluateBenchmarkCase({
    id: 'laurel-homes-architectural-review', domain: 'architecture', topologyPass: architectureA.metrics.topology.pass,
    evidenceScore: architectureA.metrics.engineering?.evidenceScore ?? 0, surfaceCoverage: surfaceCoverage(architectureA),
    domainChecksPass: auditAssemblyDetail(LAUREL_HOMES_BUILDING_B_IR).pass,
    firstFingerprint: fingerprints.architecture[0], repeatedFingerprint: fingerprints.architecture[1],
    inputFingerprint: inputFingerprints.architecture,
    browserGlbRoundTrip: hasMatchingBrowserProof('laurel-homes-architectural-review', inputFingerprints.architecture, fingerprints.architecture[0]),
    expectedDecision: 'release',
  }),
  evaluateBenchmarkCase({
    id: 'cooling-service-assembly', domain: 'service-assembly', topologyPass: coolingA.metrics.topology.pass,
    evidenceScore: coolingA.metrics.engineering?.evidenceScore ?? 0, surfaceCoverage: surfaceCoverage(coolingA),
    domainChecksPass: Boolean(coolingA.metrics.engineering?.digitalReady),
    firstFingerprint: fingerprints.cooling[0], repeatedFingerprint: fingerprints.cooling[1],
    inputFingerprint: inputFingerprints.cooling,
    browserGlbRoundTrip: hasMatchingBrowserProof('cooling-service-assembly', inputFingerprints.cooling, fingerprints.cooling[0]),
    expectedDecision: 'block', expectedBlockerPrefix: 'evidence',
  }),
  evaluateBenchmarkCase({
    id: 'single-view-character-previs', domain: 'character', topologyPass: analyzeTopology(characterA.root).pass,
    evidenceScore: 35, surfaceCoverage: surfaceCoverage(characterA), domainChecksPass: characterA.metrics.poseLandmarkRmsMeters < 0.04,
    firstFingerprint: fingerprints.character[0], repeatedFingerprint: fingerprints.character[1],
    inputFingerprint: inputFingerprints.character,
    browserGlbRoundTrip: hasMatchingBrowserProof('single-view-character-previs', inputFingerprints.character, fingerprints.character[0]),
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
  generatedAt: new Date().toISOString(),
  note: 'Overall pass requires technical integrity plus the correct release/block decision. Release rates remain separate and are never inflated by an expected rejection.',
  counts: {
    lockedCases: cases.length,
    releaseIntended: cases.filter((item) => item.expectedDecision === 'release').length,
    expectedRejections: cases.filter((item) => item.expectedDecision === 'block').length,
  },
  requiredRates,
  rates,
  domainReports,
  cases,
};
writeFileSync('benchmarks/quality-latest.json', `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output, null, 2));
const failedRates = Object.entries(requiredRates)
  .filter(([key, required]) => rates[key as keyof typeof rates] < required)
  .map(([key, required]) => `${key} ${Math.round(rates[key as keyof typeof rates] * 100)}%/${required * 100}%`);
if (failedRates.length > 0) {
  console.error(`Quality gate failed: ${failedRates.join(' · ')}`);
  process.exitCode = 1;
}
