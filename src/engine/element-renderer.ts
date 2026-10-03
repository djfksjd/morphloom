import {createSurfaceMaterial} from './surface-system';
import {deterministicEulerXYZ} from './deterministic-rotation';
import * as THREE from 'three';
import {compileGearChamfer} from './gear-chamfer';
import {applyPartUvScale} from './part-uv';
import { uvAttributeSignature } from './uv-quality';
import { resolveElements, validateProject, type ElementProject, type ResolvedElement, type Part } from './element-project.js';

import { compileAssemblyGeometry,compileDerivedGearGeometry } from './assembly-compiler';
import { creasePartNormals } from './part-geometry';
import { toothIds } from './spur-gear';
export const ELEMENT_RENDERER_REVISION = 'morphloom.element-renderer/0.12';

const MAX_TRIANGLES = 2_000_000;
const MAX_BATCHES = 128;
const MM = 0.001;
type Lod = 'low' | 'detail';
type Options = { onlyIds?: string[]; explodeMm?: number; isolateIds?: string[] };
type Stats = { elements: number; visibleElements: number; triangles: number; drawCallsEstimate: number; geometryBytes: number; generationMs: number };
const sphereSegments = (lod: Lod): [number, number] => lod === 'low' ? [16, 12] : [48, 32];
function declareNativeUvMapping(mesh:THREE.Mesh,p:Part):void{
 mesh.userData.uvMapping={revision:'morphloom.native-uv/0.1',kind:p.geometry?.op==='spur-gear'||p.geometry?.op==='extrude'?'planar-projection':p.geometry?.op==='lathe'?'cylindrical-strip':p.shape==='beak'?'unverified':'spherical',uvSignature:uvAttributeSignature(mesh.geometry)};
}
function rawPartGeometry(part: Part, lod: Lod): THREE.BufferGeometry {
  if (part.geometry) {
    const g = structuredClone(part.geometry);
    if (lod === 'low') {
      if (g.op === 'sphere') { g.widthSegments = Math.min(g.widthSegments ?? 48,16); g.heightSegments = Math.min(g.heightSegments ?? 32,12); }
      if (g.op === 'lathe') g.segments = Math.min(g.segments ?? 64,32);
    }
    const raw = g.op==='spur-gear'&&part.axialChamferMm!==undefined?compileGearChamfer(g,part.axialChamferMm):g.op==='spur-gear'?compileDerivedGearGeometry(g):compileAssemblyGeometry(g);
    if (g.op !== 'sphere') {
      try { const result = creasePartNormals(raw,part.creaseAngle ?? Math.PI/6,part.normalWeighting); if (result !== raw) raw.dispose(); return result; }
      catch (error) { raw.dispose(); throw error; }
    }
    return raw;
  }
  return part.shape === 'beak' ? new THREE.ConeGeometry(0.5, 1, 16, 1) :
    new THREE.SphereGeometry(0.5, ...sphereSegments(lod));
}

function partGeometry(part:Part,lod:Lod):THREE.BufferGeometry {
 const g=rawPartGeometry(part,lod);try{return applyPartUvScale(g,part.uvScale);}catch(error){g.dispose();throw error;}
}

function disposeOwnedMaterial(m:THREE.Material):void{
 const unique=new Set<THREE.Texture>();for(const value of Object.values(m))if(value instanceof THREE.Texture&&!value.userData.morphloomShared)unique.add(value);for(const t of unique)t.dispose();m.dispose();
}

type Plan = { key: string; members: ResolvedElement[]; triangles: number };

/** Closed tapered sections with single pole vertices and a cylindrical UV seam. */
function sectionGeometry(kind: 'feather' | 'strand', curvature: number, twist: number, lod: Lod): THREE.BufferGeometry {
  const rings = lod === 'low' ? 6 : 16;
  const sides = lod === 'low' ? 8 : 16;
  const stride = sides + 1;
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [];
  // Interior rings only: microscopic duplicate end rings created tiny cap faces.
  for (let r = 1; r < rings; r++) {
    const t = r / rings;
    const envelope = Math.sin(Math.PI * t) * (kind === 'feather' ? 0.65 + 0.35 * t : 1 - 0.55 * t);
    const angle = twist * t;
    for (let side = 0; side <= sides; side++) {
      const a = (side % sides) * 2 * Math.PI / sides;
      const x = Math.cos(a) * envelope * 0.5;
      const ridge = Math.pow(1 - Math.abs(Math.cos(a)), 6);
      const z = Math.sin(a) * envelope * (kind === 'feather' && Math.sin(a) > 0 ? 0.12 + 0.38 * ridge : kind === 'feather' ? 0.12 : 0.5);
      positions.push(x * Math.cos(angle) - z * Math.sin(angle) + curvature * t * t * 0.3, t,
        x * Math.sin(angle) + z * Math.cos(angle));
      uvs.push(side / sides, t);
    }
  }
  for (let r = 0; r < rings - 2; r++) for (let side = 0; side < sides; side++) {
    const a = r * stride + side, b = a + 1, c = a + stride, d = c + 1;
    indices.push(a, c, b, b, c, d); // outward winding
  }
  const base = positions.length / 3;
  positions.push(0, 0, 0, curvature * 0.3, 1, 0);
  uvs.push(0.5, 0, 0.5, 1);
  const last = (rings - 2) * stride;
  for (let side = 0; side < sides; side++) {
    indices.push(base, side, side + 1);
    indices.push(base + 1, last + side + 1, last + side);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // UV seam duplicates positions, but shading remains continuous across the seam.
  const normals = geometry.getAttribute('normal');
  const n = new THREE.Vector3(), other = new THREE.Vector3();
  for (let r = 0; r < rings - 1; r++) {
    const first = r * stride, end = first + sides;
    n.fromBufferAttribute(normals, first).add(other.fromBufferAttribute(normals, end)).normalize();
    normals.setXYZ(first, n.x, n.y, n.z); normals.setXYZ(end, n.x, n.y, n.z);
  }
  return geometry;
}

function byteSize(g: THREE.BufferGeometry): number {
  let bytes = g.index?.array.byteLength ?? 0;
  for (const a of Object.values(g.attributes)) bytes += a.array.byteLength;
  return bytes;
}
function triangles(g: THREE.BufferGeometry): number { return (g.index?.count ?? g.getAttribute('position').count) / 3; }
function place(object: THREE.Object3D, position: readonly number[], rotation: readonly number[], scale: readonly number[], extra = 0): void {
  object.position.set(position[0] * MM + extra, position[1] * MM, position[2] * MM);
  object.quaternion.copy(deterministicEulerXYZ(rotation));
  object.scale.set(scale[0] * MM, scale[1] * MM, scale[2] * MM);
}


function placePart(mesh: THREE.Mesh, p: Part, extra = 0): void {
  place(mesh,p.position,p.rotation,p.scale,extra);
  if (p.geometry) mesh.scale.set(...p.scale); // declared geometry is already in meters
}
function partMaterial(p: Part): THREE.MeshStandardMaterial {
  if(p.material?.surface){const surface=p.material.surface;return createSurfaceMaterial({color:p.color,roughness:p.material.roughness,metalness:p.material.metalness,surface:surface.finish,textureScale:surface.repeat,microNormalStrength:0,anisotropy:0,clearcoat:0,transmission:0,iridescence:0,sheen:0},{mode:'beauty',category:'mechanical',materialName:p.id,surfaceChannels:surface.channels,periodicDirectional:true});}
  return new THREE.MeshStandardMaterial({color:p.color,roughness:p.material?.roughness ?? 0.8,metalness:p.material?.metalness ?? 0});
}
function partTriangleBudget(p: Part,lod:Lod): number {
  const g=p.geometry;
  if (!g) { const [w,h]=sphereSegments(lod); return p.shape==='beak' ? 32 : 2*w*(h-1); }
  if (g.op==='sphere') { const w=lod==='low' ? Math.min(g.widthSegments??48,16) : g.widthSegments??48;
    const h=lod==='low' ? Math.min(g.heightSegments??32,12) : g.heightSegments??32; return 2*w*(h-1); }
  if (g.op==='lathe') return 2*(g.profile.length-1)*(lod==='low' ? Math.min(g.segments??64,32) : g.segments??64);
  if (g.op==='spur-gear') return 4*(g.toothCount*82+512+2);
  const vertices=g.points.length+(g.holes??[]).reduce((n,h)=>n+h.length,0);
  // Conservative cap + wall bound, including bevel layers, before allocation.
  return 4*(vertices+2*(g.holes?.length??0)) + 4*vertices*(g.bevelSegments??3);
}
function assemblyParents(root:THREE.Group,project:ElementProject):Map<string,THREE.Group> {
  const parents=new Map<string,THREE.Group>();
  for(const a of project.assemblies??[]) { const group=new THREE.Group();group.name=a.id;group.userData={assemblyId:a.id,axis:a.axis,datum:'identity frame; mm source, meters GLB'};root.add(group);parents.set(a.id,group); }
  return parents;
}

export function buildElementScene(project: ElementProject, lod: Lod, options: Options = {}): {
  root: THREE.Group; stats: Stats; pickId(hit: THREE.Intersection): string | undefined; dispose(): void
} {
  const start = performance.now();
  if (lod !== 'low' && lod !== 'detail') throw new Error('Unsupported LOD');
  if (options.explodeMm !== undefined && (!Number.isFinite(options.explodeMm) || Math.abs(options.explodeMm) > 100_000)) throw new Error('Invalid explode offset');
  validateProject(project);
  const selected = options.onlyIds && new Set(options.onlyIds);
  const isolated = options.isolateIds && new Set(options.isolateIds);
  const all = resolveElements(project);
  const active = all.filter(e => e.visible && (!selected || selected.has(e.id)) && (!isolated || isolated.has(e.id)));
  const parts = project.parts.filter(p => p.visible && (!selected || selected.has(p.id)) && (!isolated || isolated.has(p.id)));
  const plans = new Map<string, Plan>();
  for (const e of active) {
    // Exact effective values determine sharing; never silently quantize an override.
    const key = JSON.stringify([e.kind, e.params.curvature, e.params.twist, e.params.roughness, e.params.color]);
    let plan = plans.get(key);
    if (!plan) {
      plan = { key, members: [], triangles: 0 };
      plans.set(key, plan);
    }
    plan.members.push(e);
  }
  const batches = plans.size + parts.length;
  if (batches > MAX_BATCHES) throw new Error('Render budget: more than 128 material/geometry batches');
  const protoTriangles = (lod === 'low' ? 6 : 16) * (lod === 'low' ? 8 : 16) * 2 + (lod === 'low' ? 8 : 16) * 2;
  const partTriangles = parts.reduce((sum,p)=>sum+partTriangleBudget(p,lod),0);
  const estimate = active.length * protoTriangles + partTriangles;
  if (estimate > MAX_TRIANGLES) throw new Error('Render budget: more than 2,000,000 triangles');
  const root = new THREE.Group();
  root.name = 'Morphloom elements — representation B';
  root.userData = { rendererRevision:ELEMENT_RENDERER_REVISION, units: 'meters', sourceUnits: 'mm', coordinates: 'right-handed-y-up', representation: 'B: closed vane with ridge or tapered strand', sourceSpec: structuredClone(project) };
  const parents=assemblyParents(root,project);
  const ownedGeometry = new Set<THREE.BufferGeometry>(), ownedMaterial = new Set<THREE.Material>();
  const ids = new Map<THREE.Object3D, string[]>();
  const getGeometry = new Map<string, THREE.BufferGeometry>();
  const offset = options.explodeMm ?? 0;
  const extra = (partId: string): number => offset * MM * (1 + Math.max(0, project.parts.findIndex(p => p.id === partId)));
  const dispose = (): void => { for (const g of ownedGeometry) g.dispose(); for (const m of ownedMaterial) disposeOwnedMaterial(m); root.clear(); ids.clear(); };
  try {
    for (const p of parts) {
      const geometry = partGeometry(p, lod);
      const material = partMaterial(p);
      ownedGeometry.add(geometry); ownedMaterial.add(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = p.id; mesh.userData = { elementIds: [p.id], sourceId: p.id, ...(p.geometry?.op==='spur-gear'?{connectedFeatures:toothIds(p.geometry).map(id=>({id:`${p.id}/${id}`,kind:'connected-tooth',detachable:false}))}: {}) };
      declareNativeUvMapping(mesh,p);
      placePart(mesh,p,extra(p.id));
      (p.assemblyId ? parents.get(p.assemblyId)! : root).add(mesh); ids.set(mesh, [p.id]);
    }
    for (const plan of plans.values()) {
      const first = plan.members[0];
      const geometryKey = JSON.stringify([first.kind, first.params.curvature, first.params.twist]);
      let geometry = getGeometry.get(geometryKey);
      if (!geometry) {
        geometry = sectionGeometry(first.kind, first.params.curvature, first.params.twist, lod);
        getGeometry.set(geometryKey, geometry); ownedGeometry.add(geometry);
      }
      const material = new THREE.MeshStandardMaterial({ color: first.params.color, roughness: first.params.roughness, side: THREE.DoubleSide });
      ownedMaterial.add(material);
      const mesh = new THREE.InstancedMesh(geometry, material, plan.members.length);
      const names = plan.members.map(e => e.id);
      mesh.name = `batch_${root.children.length}`;
      mesh.userData = { elementIds: names };
      mesh.frustumCulled = false;
      const transform = new THREE.Object3D();
      plan.members.forEach((e, i) => {
        place(transform, e.position, e.rotation, [e.params.width, e.params.length, e.params.thickness], extra(e.partId));
        transform.updateMatrix(); mesh.setMatrixAt(i, transform.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      root.add(mesh); ids.set(mesh, names);
    }
    let geometryBytes = 0;
    for (const g of ownedGeometry) geometryBytes += byteSize(g);
    geometryBytes += active.length * 64;
    let actualTriangles=0; root.traverse(o=>{if(o instanceof THREE.Mesh) actualTriangles+=triangles(o.geometry)*(o instanceof THREE.InstancedMesh ? o.count : 1);});
    if (actualTriangles>MAX_TRIANGLES) throw new Error('Render triangle budget exceeded');
    const stats: Stats = { elements: all.length, visibleElements: active.length, triangles: actualTriangles,
      drawCallsEstimate: batches, geometryBytes, generationMs: performance.now() - start };
    return { root, stats, pickId: hit => ids.get(hit.object)?.[hit.instanceId ?? 0], dispose };
  } catch (error) { dispose(); throw error; }
}

/** Baked, separately named meshes for DCC. Selection includes hidden elements; no explode offset. */
export function exportSelectedScene(project: ElementProject, selectedIds: string[]): ReturnType<typeof buildElementScene> {
  validateProject(project);
  const unique = [...new Set(selectedIds)];
  if (unique.length > 128) throw new Error('Export limit: 128 selected objects');
  const elements = new Map(resolveElements(project).map(e => [e.id, e]));
  const parts = new Map(project.parts.map(p => [p.id, p]));
  for (const id of unique) if (!elements.has(id) && !parts.has(id)) throw new Error(`Unknown selection: ${id}`);
  const root = new THREE.Group();
  root.name = 'Morphloom selected baked geometry';
  root.userData = { rendererRevision:ELEMENT_RENDERER_REVISION, units: 'meters', sourceUnits: 'mm', coordinates: 'right-handed-y-up',
    representation: 'B; baked mesh, no native procedural groom', sourceSpec: structuredClone(project), selectedIds: unique };
  const parents=assemblyParents(root,project);
  const estimated=unique.reduce((sum,id)=>sum+(parts.has(id) ? partTriangleBudget(parts.get(id)!,'detail') : 544),0);
  if (estimated>MAX_TRIANGLES) throw new Error('Export triangle budget exceeded');
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const start = performance.now();
  let count = 0, tri = 0, bytes = 0;
  try {
    for (const id of unique) {
      const e = elements.get(id), p = parts.get(id);
      const geometry = e ? sectionGeometry(e.kind, e.params.curvature, e.params.twist, 'detail') :
        partGeometry(p!, 'detail');
      const material = e ? new THREE.MeshStandardMaterial({color:e.params.color,roughness:e.params.roughness,side:THREE.DoubleSide}) : partMaterial(p!);
      geometries.push(geometry); materials.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = id; mesh.userData = { sourceId: id, elementIds: [id], ...(p?.geometry?.op==='spur-gear'?{connectedFeatures:toothIds(p.geometry).map(feature=>({id:`${p.id}/${feature}`,kind:'connected-tooth',detachable:false}))}: {}) };
      if (e) place(mesh, e.position, e.rotation, [e.params.width, e.params.length, e.params.thickness]);
      else {placePart(mesh,p!);declareNativeUvMapping(mesh,p!);}
      (p?.assemblyId ? parents.get(p.assemblyId)! : root).add(mesh); tri += triangles(geometry); bytes += byteSize(geometry); count++;
      if (tri > MAX_TRIANGLES) throw new Error('Export triangle budget exceeded');
    }
    return { root, stats: { elements: count, visibleElements: count, triangles: tri, drawCallsEstimate: count, geometryBytes: bytes, generationMs: performance.now() - start },
      pickId: hit => hit.object.userData.sourceId as string | undefined,
      dispose: () => { for (const g of geometries) g.dispose(); for (const m of materials) disposeOwnedMaterial(m); root.clear(); } };
  } catch (error) { for (const g of geometries) g.dispose(); for (const m of materials) disposeOwnedMaterial(m); throw error; }
}
