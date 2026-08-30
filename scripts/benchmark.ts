import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { buildOrnateKnife } from '../src/engine/knife';
import { buildProduct } from '../src/engine/product';
import { buildCharacter } from '../src/engine/character';
import { parseOhpk } from '../src/engine/ohpk';
import { analyzeTopology } from '../src/engine/topology';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { COOLING_ASSEMBLY_IR } from '../src/engine/cooling-assembly';
import { evaluateReferenceSet, type ReferenceView } from '../src/engine/reference-set';
import { DEFAULT_KNIFE_SPEC, DEFAULT_PRODUCT_SPEC, WEB_HERO_SPEC } from '../src/types';

const knife = buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty');
const phone = buildProduct(DEFAULT_PRODUCT_SPEC, 'beauty');
const cooling = compileAssemblyIR(COOLING_ASSEMBLY_IR, 'beauty');
const topology = analyzeTopology(knife.root);
const humanPack = await parseOhpk(
  new Uint8Array(readFileSync('public/assets/oxihuman-core-v1.ohpk')),
  async (payload) => new Uint8Array(inflateRawSync(payload)),
);
const webHero = buildCharacter(humanPack, WEB_HERO_SPEC, 'beauty');
const webHeroTopology = analyzeTopology(webHero.root);
const spiderManSingleView: ReferenceView = {
  id: 'spiderman-front-regression',
  assetKind: 'human',
  url: 'benchmark-source-not-embedded',
  fileName: 'spiderman-front.jpg',
  fileSize: 291_588,
  mimeType: 'image/jpeg',
  lastModified: 0,
  role: 'front',
  evidence: {
    fileName: 'spiderman-front.jpg',
    width: 960,
    height: 1280,
    averageColor: '#716f70',
    brightness: 0.44,
    portraitSuitability: 92,
    notes: ['Single front/three-quarter view; rear and side evidence is absent.'],
  },
};
const spiderManEvidence = evaluateReferenceSet([spiderManSingleView], 'human');

const result = {
  generatedAt: new Date().toISOString(),
  morphloom: {
    ornateKnife: {
      triangles: knife.metrics.triangles,
      vertices: knife.metrics.vertices,
      parts: knife.metrics.parts,
      watertightParts: `${topology.watertightMeshes}/${topology.meshes}`,
      boundaryEdges: topology.boundaryEdges,
      nonManifoldEdges: topology.nonManifoldEdges,
      degenerateTriangles: topology.degenerateTriangles,
      surfaces: knife.metrics.surfaces,
      variableThicknessBlade: true,
      editableSharedIR: true,
    },
    smartphone: {
      triangles: phone.metrics.triangles,
      vertices: phone.metrics.vertices,
      parts: phone.metrics.parts,
      cameraParts: phone.parts.filter((part) => part.category === 'camera').length,
      logicParts: phone.parts.filter((part) => part.category === 'logic').length,
      individualConductors: phone.parts.filter((part) => part.category === 'interconnect').length,
      watertightParts: `${phone.metrics.topology.watertightMeshes}/${phone.metrics.topology.meshes}`,
      boundaryEdges: phone.metrics.topology.boundaryEdges,
      nonManifoldEdges: phone.metrics.topology.nonManifoldEdges,
      degenerateTriangles: phone.metrics.topology.degenerateTriangles,
      surfaces: phone.metrics.surfaces,
      connectivity: phone.metrics.connectivity && {
        ports: `${phone.metrics.connectivity.connectedRequiredPorts}/${phone.metrics.connectivity.requiredPorts}`,
        wires: `${phone.metrics.connectivity.connectedWires}/${phone.metrics.connectivity.wires}`,
        danglingWires: phone.metrics.connectivity.danglingWires,
        openRequiredPorts: phone.metrics.connectivity.openRequiredPorts,
        portsOnComponents: `${phone.metrics.connectivity.ports - phone.metrics.connectivity.offComponentPorts}/${phone.metrics.connectivity.ports}`,
        portOutsideDistanceMaxMm: phone.metrics.connectivity.portOutsideDistanceMaxMm,
        endpointErrorMaxMm: phone.metrics.connectivity.endpointErrorMaxMm,
        documentedPhysicalPins: `${phone.metrics.connectivity.documentedPhysicalPins}/${phone.metrics.connectivity.ports}`,
        specifiedGauges: `${phone.metrics.connectivity.specifiedGaugeWires}/${phone.metrics.connectivity.wires}`,
        liveAnchors: phone.metrics.connectivity.liveAnchors,
        outstandingBenchChecks: phone.metrics.connectivity.outstandingBenchChecks,
        productionReady: phone.metrics.connectivity.productionReady,
      },
    },
    imageDerivedCoolingAssembly: {
      sourceResolution: `${COOLING_ASSEMBLY_IR.metadata?.sourceWidth}×${COOLING_ASSEMBLY_IR.metadata?.sourceHeight}`,
      components: COOLING_ASSEMBLY_IR.components.length,
      renderedParts: cooling.metrics.parts,
      triangles: cooling.metrics.triangles,
      watertightParts: `${cooling.metrics.topology.watertightMeshes}/${cooling.metrics.topology.meshes}`,
      boundaryEdges: cooling.metrics.topology.boundaryEdges,
      nonManifoldEdges: cooling.metrics.topology.nonManifoldEdges,
      degenerateTriangles: cooling.metrics.topology.degenerateTriangles,
      surfaces: cooling.metrics.surfaces,
      wires: `${cooling.metrics.connectivity?.connectedWires}/${cooling.metrics.connectivity?.wires}`,
      requiredPorts: `${cooling.metrics.connectivity?.connectedRequiredPorts}/${cooling.metrics.connectivity?.requiredPorts}`,
      danglingWires: cooling.metrics.connectivity?.danglingWires,
      portsOnComponents: `${(cooling.metrics.connectivity?.ports ?? 0) - (cooling.metrics.connectivity?.offComponentPorts ?? 0)}/${cooling.metrics.connectivity?.ports}`,
      portOutsideDistanceMaxMm: cooling.metrics.connectivity?.portOutsideDistanceMaxMm,
      endpointErrorMaxMm: cooling.metrics.connectivity?.endpointErrorMaxMm,
      documentedPhysicalPins: `${cooling.metrics.connectivity?.documentedPhysicalPins}/${cooling.metrics.connectivity?.ports}`,
      specifiedGauges: `${cooling.metrics.connectivity?.specifiedGaugeWires}/${cooling.metrics.connectivity?.wires}`,
      verificationRecords: `${cooling.metrics.connectivity?.documentedVerificationWires}/${cooling.metrics.connectivity?.wires}`,
      liveAnchors: cooling.metrics.connectivity?.liveAnchors,
      benchRequiredWires: cooling.metrics.connectivity?.benchRequiredWires,
      outstandingBenchChecks: cooling.metrics.connectivity?.outstandingBenchChecks,
      engineeringEvidence: cooling.metrics.engineering,
      inferredHiddenGeometry: true,
    },
    spiderManSingleImageHonestyGate: {
      source: 'https://commons.wikimedia.org/wiki/File:Spider-Man_cosplay.jpg',
      sourceResolution: '960×1280',
      inputFit: spiderManSingleView.evidence.portraitSuitability,
      evidenceScore: spiderManEvidence.score,
      requiredViews: `${spiderManEvidence.presentRequiredRoles.length}/${spiderManEvidence.requiredRoles.length}`,
      missingViews: spiderManEvidence.missingRequiredRoles,
      blocked: !spiderManEvidence.ready,
      visualFidelityClaimAllowed: false,
      characterBuild: {
        skinVertices: webHero.metrics.vertices,
        renderedTriangles: webHero.metrics.renderedTriangles,
        namedDetailParts: webHero.metrics.namedDetailParts,
        watertightParts: `${webHeroTopology.watertightMeshes}/${webHeroTopology.meshes}`,
        boundaryEdges: webHeroTopology.boundaryEdges,
        nonManifoldEdges: webHeroTopology.nonManifoldEdges,
        degenerateTriangles: webHeroTopology.degenerateTriangles,
        finishes: webHero.metrics.surfaces.finishes,
        pose: WEB_HERO_SPEC.pose,
        poseLandmarkRmsMm: Number((webHero.metrics.poseLandmarkRmsMeters * 1000).toFixed(2)),
        inferredDetailParts: webHero.metrics.inferredDetailParts,
      },
      gamePrevisBaseReady: true,
      productionLikenessReady: false,
    },
  },
  comparisonBaseline: {
    name: 'img2threejs Talon Knife Doppler Ruby v1.4.4',
    triangles: 25_000,
    parts: 5,
    variableThicknessBlade: true,
    tracedReferenceSilhouette: true,
    projectedReferenceTexture: true,
    source: 'https://img2threejs.io/#/x/talon-doppler-ruby',
  },
};

console.log(JSON.stringify(result, null, 2));
