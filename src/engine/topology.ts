import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export interface MeshTopologyReport {
  meshes: number;
  watertightMeshes: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  degenerateTriangles: number;
  triangles: number;
  pass: boolean;
  details: Array<{
    name: string;
    boundaryEdges: number;
    nonManifoldEdges: number;
    degenerateTriangles: number;
    watertight: boolean;
  }>;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function analyzeTopology(root: THREE.Object3D): MeshTopologyReport {
  let meshes = 0;
  let watertightMeshes = 0;
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let degenerateTriangles = 0;
  let triangles = 0;
  const details: MeshTopologyReport['details'] = [];

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes += 1;
    const expanded = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    const positionsOnly = new THREE.BufferGeometry();
    positionsOnly.setAttribute('position', expanded.getAttribute('position').clone());
    expanded.dispose();
    const geometry = mergeVertices(positionsOnly, 1e-6);
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    if (!index || !position) {
      geometry.dispose();
      return;
    }
    const edges = new Map<string, number>();
    let meshDegenerate = 0;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let offset = 0; offset < index.count; offset += 3) {
      const ia = index.getX(offset);
      const ib = index.getX(offset + 1);
      const ic = index.getX(offset + 2);
      triangles += 1;
      a.fromBufferAttribute(position, ia);
      b.fromBufferAttribute(position, ib);
      c.fromBufferAttribute(position, ic);
      if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-18) meshDegenerate += 1;
      for (const [from, to] of [[ia, ib], [ib, ic], [ic, ia]]) {
        const key = edgeKey(from, to);
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    const meshBoundary = [...edges.values()].filter((count) => count === 1).length;
    const meshNonManifold = [...edges.values()].filter((count) => count > 2).length;
    boundaryEdges += meshBoundary;
    nonManifoldEdges += meshNonManifold;
    degenerateTriangles += meshDegenerate;
    const watertight = meshBoundary === 0 && meshNonManifold === 0 && meshDegenerate === 0;
    if (watertight) watertightMeshes += 1;
    details.push({ name: object.name, boundaryEdges: meshBoundary, nonManifoldEdges: meshNonManifold, degenerateTriangles: meshDegenerate, watertight });
    geometry.dispose();
  });

  return {
    meshes,
    watertightMeshes,
    boundaryEdges,
    nonManifoldEdges,
    degenerateTriangles,
    triangles,
    pass: meshes > 0 && watertightMeshes === meshes,
    details,
  };
}
