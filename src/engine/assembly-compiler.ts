import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ViewMode } from '../types';
import type { ProductBuild, ProductPartInfo } from './product';
import type { AssemblyComponentIR, AssemblyGeometryIR, AssemblyIR } from './assembly-ir';
import { compileElectricalHarness, validateElectricalHarness } from './connectivity';

const mm = (value: number) => value / 1000;

export function validateAssemblyIR(value: unknown): asserts value is AssemblyIR {
  if (!value || typeof value !== 'object') throw new Error('AssemblyIR must be an object.');
  const candidate = value as Partial<AssemblyIR>;
  if (candidate.schema !== 'morphloom.assembly/0.1' || candidate.units !== 'mm') {
    throw new Error('Unsupported AssemblyIR schema or units.');
  }
  if (!Array.isArray(candidate.components) || candidate.components.length < 1 || candidate.components.length > 500) {
    throw new Error('AssemblyIR must contain 1–500 components.');
  }
  const ids = new Set<string>();
  const allowedOps = new Set(['roundedBox', 'cylinder', 'sphere', 'torus', 'extrude', 'lathe', 'tube', 'bladeLoft']);
  const inspect = (node: unknown, key = ''): void => {
    if (typeof node === 'number') {
      if (!Number.isFinite(node) || Math.abs(node) > 1_000_000) throw new Error(`Unsafe numeric value at ${key}.`);
      const minSegments = key === 'bevelSegments' ? 1 : 3;
      if (/segments/i.test(key) && (node < minSegments || node > 512)) throw new Error(`Unsafe segment count at ${key}.`);
      return;
    }
    if (Array.isArray(node)) {
      if (node.length > 4096) throw new Error(`Array is too large at ${key}.`);
      node.forEach((item, index) => inspect(item, `${key}[${index}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [childKey, child] of Object.entries(node)) inspect(child, childKey);
    }
  };
  for (const component of candidate.components as AssemblyComponentIR[]) {
    if (!component || typeof component !== 'object') throw new Error('AssemblyIR component is invalid.');
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(component.id) || ids.has(component.id)) throw new Error(`Invalid or duplicate component id: ${component.id}`);
    ids.add(component.id);
    if (!component.geometry || !allowedOps.has(component.geometry.op)) throw new Error(`Unsupported geometry op in ${component.id}.`);
    inspect(component.geometry, `${component.id}.geometry`);
    inspect(component.position, `${component.id}.position`);
    inspect(component.rotation, `${component.id}.rotation`);
    inspect(component.scale, `${component.id}.scale`);
  }
  if (candidate.electrical) validateElectricalHarness(candidate.electrical, ids);
}

function compileGeometry(geometry: AssemblyGeometryIR): THREE.BufferGeometry {
  switch (geometry.op) {
    case 'roundedBox':
      return new RoundedBoxGeometry(
        mm(geometry.size[0]), mm(geometry.size[1]), mm(geometry.size[2]),
        geometry.segments ?? 4, mm(geometry.radius),
      );
    case 'cylinder':
      return new THREE.CylinderGeometry(
        mm(geometry.radiusTop), mm(geometry.radiusBottom), mm(geometry.depth),
        geometry.radialSegments ?? 48, 2,
      );
    case 'sphere':
      return new THREE.SphereGeometry(mm(geometry.radius), geometry.widthSegments ?? 48, geometry.heightSegments ?? 28);
    case 'torus':
      return new THREE.TorusGeometry(
        mm(geometry.radius), mm(geometry.tube), geometry.radialSegments ?? 14, geometry.tubularSegments ?? 64,
      );
    case 'extrude': {
      const shape = new THREE.Shape();
      const [first, ...rest] = geometry.points;
      shape.moveTo(mm(first[0]), mm(first[1]));
      for (const point of rest) shape.lineTo(mm(point[0]), mm(point[1]));
      shape.closePath();
      const depth = mm(geometry.depth);
      const result = new THREE.ExtrudeGeometry(shape, {
        depth,
        steps: 1,
        curveSegments: 24,
        bevelEnabled: Boolean(geometry.bevelSize || geometry.bevelThickness),
        bevelSize: mm(geometry.bevelSize ?? 0),
        bevelThickness: mm(geometry.bevelThickness ?? 0),
        bevelSegments: geometry.bevelSegments ?? 3,
      });
      result.translate(0, 0, -depth * 0.5);
      return result;
    }
    case 'lathe': {
      const segments = geometry.segments ?? 64;
      const positions: number[] = [];
      const rows: number[][] = [];
      for (const [radiusMm, yMm] of geometry.profile) {
        const row: number[] = [];
        if (Math.abs(radiusMm) < 1e-6) {
          row.push(positions.length / 3);
          positions.push(0, mm(yMm), 0);
        } else {
          for (let segment = 0; segment < segments; segment += 1) {
            const angle = (segment / segments) * Math.PI * 2;
            row.push(positions.length / 3);
            positions.push(Math.cos(angle) * mm(radiusMm), mm(yMm), Math.sin(angle) * mm(radiusMm));
          }
        }
        rows.push(row);
      }
      const indices: number[] = [];
      for (let row = 0; row < rows.length - 1; row += 1) {
        const a = rows[row];
        const b = rows[row + 1];
        for (let segment = 0; segment < segments; segment += 1) {
          const next = (segment + 1) % segments;
          if (a.length === 1 && b.length > 1) indices.push(a[0], b[next], b[segment]);
          else if (a.length > 1 && b.length === 1) indices.push(a[segment], a[next], b[0]);
          else if (a.length > 1 && b.length > 1) {
            indices.push(a[segment], a[next], b[next], a[segment], b[next], b[segment]);
          }
        }
      }
      const result = new THREE.BufferGeometry();
      result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      result.setIndex(indices);
      result.computeVertexNormals();
      return result;
    }
    case 'tube': {
      const curve = new THREE.CatmullRomCurve3(
        geometry.points.map((point) => new THREE.Vector3(mm(point[0]), mm(point[1]), mm(point[2]))),
        Boolean(geometry.closed),
        'centripetal',
      );
      const tubularSegments = geometry.tubularSegments ?? Math.max(48, geometry.points.length * 8);
      const radialSegments = geometry.radialSegments ?? 10;
      const tube = new THREE.TubeGeometry(
        curve, tubularSegments, mm(geometry.radius), radialSegments, Boolean(geometry.closed),
      );
      if (geometry.closed) return tube;
      const sourcePosition = tube.getAttribute('position');
      const sourceNormal = tube.getAttribute('normal');
      const sourceUv = tube.getAttribute('uv');
      const position = new Float32Array((sourcePosition.count + 2) * 3);
      const normal = new Float32Array((sourceNormal.count + 2) * 3);
      const uv = new Float32Array((sourceUv.count + 2) * 2);
      position.set(sourcePosition.array as Float32Array);
      normal.set(sourceNormal.array as Float32Array);
      uv.set(sourceUv.array as Float32Array);
      const start = curve.getPointAt(0);
      const end = curve.getPointAt(1);
      const startTangent = curve.getTangentAt(0).normalize().multiplyScalar(-1);
      const endTangent = curve.getTangentAt(1).normalize();
      const startCenter = sourcePosition.count;
      const endCenter = sourcePosition.count + 1;
      position.set(start.toArray(), startCenter * 3);
      position.set(end.toArray(), endCenter * 3);
      normal.set(startTangent.toArray(), startCenter * 3);
      normal.set(endTangent.toArray(), endCenter * 3);
      uv.set([0.5, 0.5], startCenter * 2);
      uv.set([0.5, 0.5], endCenter * 2);
      const sourceIndex = tube.getIndex();
      const indices = sourceIndex ? Array.from(sourceIndex.array) : [];
      const ring = radialSegments + 1;
      const endRing = tubularSegments * ring;
      for (let segment = 0; segment < radialSegments; segment += 1) {
        indices.push(startCenter, segment + 1, segment);
        indices.push(endCenter, endRing + segment, endRing + segment + 1);
      }
      const capped = new THREE.BufferGeometry();
      capped.setAttribute('position', new THREE.BufferAttribute(position, 3));
      capped.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
      capped.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      capped.setIndex(indices);
      tube.dispose();
      return capped;
    }
    case 'bladeLoft': {
      const across = geometry.grindCurve ?? [0.04, 0.62, 1, 0.62, 0.04];
      const acrossX = [-1, -0.5, 0, 0.5, 1];
      const positions: number[] = [];
      const indices: number[] = [];
      const halfStock = mm(geometry.thickness) * 0.5;
      const halfApex = mm(geometry.apexThickness) * 0.5;
      for (const [y, halfWidth] of geometry.sections) {
        for (const side of [1, -1]) {
          for (let column = 0; column < acrossX.length; column += 1) {
            const profile = across[column];
            positions.push(
              mm(halfWidth * acrossX[column]),
              mm(y),
              side * (halfApex + (halfStock - halfApex) * profile),
            );
          }
        }
      }
      const columns = acrossX.length;
      const rowStride = columns * 2;
      for (let row = 0; row < geometry.sections.length - 1; row += 1) {
        const base = row * rowStride;
        const next = (row + 1) * rowStride;
        for (let column = 0; column < columns - 1; column += 1) {
          const fa = base + column;
          const fb = base + column + 1;
          const fc = next + column + 1;
          const fd = next + column;
          indices.push(fa, fb, fc, fa, fc, fd);
          const ba = base + columns + column;
          const bb = next + columns + column;
          const bc = next + columns + column + 1;
          const bd = base + columns + column + 1;
          indices.push(ba, bb, bc, ba, bc, bd);
        }
        for (const column of [0, columns - 1]) {
          const frontA = base + column;
          const frontB = next + column;
          const backB = next + columns + column;
          const backA = base + columns + column;
          if (column === 0) indices.push(frontA, backB, frontB, frontA, backA, backB);
          else indices.push(frontA, frontB, backB, frontA, backB, backA);
        }
      }
      const cap = (row: number, reverse: boolean) => {
        const base = row * rowStride;
        for (let column = 0; column < columns - 1; column += 1) {
          const a = base + column;
          const b = base + column + 1;
          const c = base + columns + column + 1;
          const d = base + columns + column;
          if (reverse) indices.push(a, c, b, a, d, c);
          else indices.push(a, b, c, a, c, d);
        }
      };
      cap(0, true);
      cap(geometry.sections.length - 1, false);
      const result = new THREE.BufferGeometry();
      result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      result.setIndex(indices);
      result.computeVertexNormals();
      return result;
    }
  }
}

function compileMaterial(component: AssemblyComponentIR, mode: ViewMode): THREE.MeshPhysicalMaterial {
  const source = component.material;
  const transmission = mode === 'beauty' ? (source.transmission ?? 0) : 0;
  const ghost = mode === 'rig' && (component.category === 'enclosure' || component.category === 'display');
  return new THREE.MeshPhysicalMaterial({
    color: mode === 'clay' ? '#c5c6c3' : source.color,
    roughness: mode === 'clay' ? 0.82 : (source.roughness ?? 0.48),
    metalness: mode === 'clay' ? 0 : (source.metalness ?? 0.05),
    transmission,
    transparent: ghost || transmission > 0,
    opacity: ghost ? 0.1 : transmission > 0 ? Math.max(0.28, 1 - transmission * 0.68) : 1,
    depthWrite: !ghost,
    thickness: transmission > 0 ? mm(1.2) : 0,
    clearcoat: mode === 'beauty' ? 0.16 : 0,
    clearcoatRoughness: 0.38,
    emissive: source.emissive ?? '#000000',
    emissiveIntensity: source.emissive ? 0.35 : 0,
    wireframe: mode === 'wireframe',
  });
}

export function compileAssemblyIR(ir: AssemblyIR, mode: ViewMode): ProductBuild {
  validateAssemblyIR(ir);
  const root = new THREE.Group();
  root.name = ir.name;
  root.userData.assemblyIR = structuredClone(ir);
  const parts: ProductPartInfo[] = [];
  for (const component of ir.components) {
    const mesh = new THREE.Mesh(compileGeometry(component.geometry), compileMaterial(component, mode));
    mesh.name = component.id;
    if (component.position) mesh.position.set(...component.position.map(mm) as [number, number, number]);
    if (component.rotation) mesh.rotation.set(...component.rotation);
    if (component.scale) mesh.scale.set(...component.scale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const info: ProductPartInfo = {
      id: component.id,
      name: component.name,
      category: component.category,
      material: component.materialName,
      detail: component.detail,
    };
    mesh.userData.part = info;
    parts.push(info);
    root.add(mesh);
  }
  const connectivity = ir.electrical
    ? compileElectricalHarness(root, parts, ir.electrical, mode)
    : undefined;
  let vertices = 0;
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    vertices += position?.count ?? 0;
    const index = object.geometry.getIndex();
    triangles += index ? index.count / 3 : (position?.count ?? 0) / 3;
  });
  const bounds = new THREE.Box3().setFromObject(root);
  const heightMeters = bounds.getSize(new THREE.Vector3()).y;
  return {
    root,
    parts,
    metrics: {
      vertices,
      triangles,
      heightMeters,
      bounds,
      parts: parts.length,
      categories: new Set(parts.map((part) => part.category)).size,
      connectivity,
    },
  };
}
