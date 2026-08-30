import { buildOrnateKnife } from '../src/engine/knife';
import { buildProduct } from '../src/engine/product';
import { analyzeTopology } from '../src/engine/topology';
import { DEFAULT_KNIFE_SPEC, DEFAULT_PRODUCT_SPEC } from '../src/types';

const knife = buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty');
const phone = buildProduct(DEFAULT_PRODUCT_SPEC, 'beauty');
const topology = analyzeTopology(knife.root);

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
      variableThicknessBlade: true,
      editableSharedIR: true,
    },
    smartphone: {
      triangles: phone.metrics.triangles,
      vertices: phone.metrics.vertices,
      parts: phone.metrics.parts,
      cameraParts: phone.parts.filter((part) => part.category === 'camera').length,
      logicParts: phone.parts.filter((part) => part.category === 'logic').length,
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
