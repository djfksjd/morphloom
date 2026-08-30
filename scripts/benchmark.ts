import { buildOrnateKnife } from '../src/engine/knife';
import { buildProduct } from '../src/engine/product';
import { analyzeTopology } from '../src/engine/topology';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { COOLING_ASSEMBLY_IR } from '../src/engine/cooling-assembly';
import { DEFAULT_KNIFE_SPEC, DEFAULT_PRODUCT_SPEC } from '../src/types';

const knife = buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty');
const phone = buildProduct(DEFAULT_PRODUCT_SPEC, 'beauty');
const topology = analyzeTopology(knife.root);
const cooling = compileAssemblyIR(COOLING_ASSEMBLY_IR, 'beauty');

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
      surfaces: phone.metrics.surfaces,
      connectivity: phone.metrics.connectivity && {
        ports: `${phone.metrics.connectivity.connectedRequiredPorts}/${phone.metrics.connectivity.requiredPorts}`,
        wires: `${phone.metrics.connectivity.connectedWires}/${phone.metrics.connectivity.wires}`,
        danglingWires: phone.metrics.connectivity.danglingWires,
        openRequiredPorts: phone.metrics.connectivity.openRequiredPorts,
        portsOnComponents: `${phone.metrics.connectivity.ports - phone.metrics.connectivity.offComponentPorts}/${phone.metrics.connectivity.ports}`,
        portOutsideDistanceMaxMm: phone.metrics.connectivity.portOutsideDistanceMaxMm,
        endpointErrorMaxMm: phone.metrics.connectivity.endpointErrorMaxMm,
      },
    },
    imageDerivedCoolingAssembly: {
      sourceResolution: `${COOLING_ASSEMBLY_IR.metadata?.sourceWidth}×${COOLING_ASSEMBLY_IR.metadata?.sourceHeight}`,
      components: COOLING_ASSEMBLY_IR.components.length,
      renderedParts: cooling.metrics.parts,
      triangles: cooling.metrics.triangles,
      surfaces: cooling.metrics.surfaces,
      wires: `${cooling.metrics.connectivity?.connectedWires}/${cooling.metrics.connectivity?.wires}`,
      requiredPorts: `${cooling.metrics.connectivity?.connectedRequiredPorts}/${cooling.metrics.connectivity?.requiredPorts}`,
      danglingWires: cooling.metrics.connectivity?.danglingWires,
      portsOnComponents: `${(cooling.metrics.connectivity?.ports ?? 0) - (cooling.metrics.connectivity?.offComponentPorts ?? 0)}/${cooling.metrics.connectivity?.ports}`,
      portOutsideDistanceMaxMm: cooling.metrics.connectivity?.portOutsideDistanceMaxMm,
      endpointErrorMaxMm: cooling.metrics.connectivity?.endpointErrorMaxMm,
      inferredHiddenGeometry: true,
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
