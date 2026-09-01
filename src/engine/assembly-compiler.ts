import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ViewMode } from '../types';
import type { ProductBuild, ProductPartInfo } from './product';
import type { AssemblyComponentIR, AssemblyGeometryIR, AssemblyIR } from './assembly-ir';
import { compileElectricalHarness, validateElectricalHarness } from './connectivity';
import { createSurfaceMaterial, inferSurfaceFinish, inspectSurfaceSystem } from './surface-system';
import { analyzeTopology } from './topology';
import { inspectEngineeringEvidence } from './engineering-audit';
import { auditFidelityContract } from './fidelity-pipeline';
import { carveVisualHull, validateVisualHullDescriptor, visualHullToBufferGeometry } from './visual-hull';
import { polygonizeImplicitSurface, validateImplicitSurfaceDescriptor } from './implicit-surface';
import { createLayeredSurfaceGeometry } from './layered-surface';
import {
  analyzeReferenceSurface,
  MAX_REFERENCE_HEIGHT_SAMPLES,
  type ReferenceSurfaceMetrics,
} from './reference-surface';
import type { QuantizedReferenceHeightField } from './reference-surface';
import { auditPlanFootprint, validatePlanFootprintDescriptor } from './plan-footprint';
import {
  delightReferenceProjection,
  extendOpaqueProjectionColors,
  type ReferenceDelightMetrics,
} from './reference-projection-image';

const mm = (value: number) => value / 1000;
type ReferenceProjectionIR = NonNullable<AssemblyComponentIR['material']['referenceProjection']>;
type ProjectionStatus = { declared: number; loaded: number; failed: number; errors: string[] };
const projectionReadiness = new WeakMap<THREE.Object3D, Promise<ProjectionStatus>>();

function validateReferenceProjection(projection: ReferenceProjectionIR, componentId: string): void {
  if (!/^(?:\/(?!\/)|blob:)/.test(projection.uri) || projection.uri.includes('\\') || projection.uri.includes('\0')) {
    throw new Error(`Reference projection URI must be local or blob-backed in ${componentId}.`);
  }
  const [x, y, width, height] = projection.crop;
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1) {
    throw new Error(`Reference projection crop is invalid in ${componentId}.`);
  }
  const [minX, minY, maxX, maxY] = projection.boundsMm;
  if (maxX <= minX || maxY <= minY) throw new Error(`Reference projection bounds are invalid in ${componentId}.`);
  if (projection.relief?.strength !== undefined && (projection.relief.strength < 0 || projection.relief.strength > 2)) {
    throw new Error(`Reference relief strength is invalid in ${componentId}.`);
  }
  if (projection.relief?.maxResolution !== undefined
    && (!Number.isInteger(projection.relief.maxResolution)
      || projection.relief.maxResolution < 256
      || projection.relief.maxResolution > 2048)) {
    throw new Error(`Reference relief resolution is invalid in ${componentId}.`);
  }
}

function validateReferenceRelief(reference: QuantizedReferenceHeightField, componentId: string): void {
  if (!['image-highpass-height-v1', 'image-multiscale-height-v2'].includes(reference.method)) {
    throw new Error(`Reference relief method is invalid in ${componentId}.`);
  }
  if (!Number.isInteger(reference.width) || !Number.isInteger(reference.height)
    || reference.width < 2 || reference.height < 2
    || reference.width * reference.height > MAX_REFERENCE_HEIGHT_SAMPLES) {
    throw new Error(`Reference relief dimensions are invalid in ${componentId}.`);
  }
  if (reference.samples.length !== reference.width * reference.height) {
    throw new Error(`Reference relief sample count is invalid in ${componentId}.`);
  }
  if (reference.samples.some((sample) => !Number.isInteger(sample) || sample < -32_767 || sample > 32_767)) {
    throw new Error(`Reference relief sample range is invalid in ${componentId}.`);
  }
  if (!Number.isFinite(reference.amplitudeMm) || reference.amplitudeMm <= 0 || reference.amplitudeMm > 100) {
    throw new Error(`Reference relief amplitude is invalid in ${componentId}.`);
  }
  if (!Number.isFinite(reference.blend) || reference.blend < 0 || reference.blend > 1) {
    throw new Error(`Reference relief blend is invalid in ${componentId}.`);
  }
  if (!Number.isFinite(reference.irregularity) || reference.irregularity < 0 || reference.irregularity > 1) {
    throw new Error(`Reference relief irregularity is invalid in ${componentId}.`);
  }
  if (!/^[a-f0-9]{8,128}$/i.test(reference.fingerprint)) {
    throw new Error(`Reference relief fingerprint is invalid in ${componentId}.`);
  }
}

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
  const allowedOps = new Set(['roundedBox', 'cylinder', 'sphere', 'torus', 'extrude', 'lathe', 'tube', 'surfacePatch', 'hipRoof', 'bladeLoft', 'visualHull', 'implicitSurface']);
  const allowedSurfaces = new Set([
    'raw', 'concrete', 'asphalt', 'plaster', 'stone', 'coated-metal', 'brushed-metal', 'bead-blasted-metal', 'anodized-metal', 'polished-metal',
    'machined-copper', 'ceramic-glass', 'optical-glass', 'sapphire', 'pcb-soldermask',
    'molded-polymer', 'soft-touch-polymer', 'rubber', 'leather', 'wood', 'skin',
    'fabric', 'hex-knit', 'hair', 'semiconductor',
  ]);
  const allowedEvidence = new Set(['measured', 'datasheet', 'estimated', 'inferred']);
  let inspectedNodes = 0;
  const inspect = (node: unknown, key = '', depth = 0): void => {
    inspectedNodes += 1;
    if (inspectedNodes > 200_000) throw new Error('AssemblyIR is too complex to inspect safely.');
    if (depth > 16) throw new Error(`AssemblyIR nesting is too deep at ${key}.`);
    if (typeof node === 'number') {
      if (!Number.isFinite(node) || Math.abs(node) > 1_000_000) throw new Error(`Unsafe numeric value at ${key}.`);
      const minSegments = /(^|\.)bevelSegments$/.test(key) ? 0 : 3;
      if (/segments/i.test(key) && (node < minSegments || node > 512)) throw new Error(`Unsafe segment count at ${key}.`);
      return;
    }
    if (typeof node === 'string') {
      if (node.length > 2_000) throw new Error(`String is too long at ${key}.`);
      return;
    }
    if (Array.isArray(node)) {
      const arrayLimit = key.endsWith('.referenceRelief.samples') ? MAX_REFERENCE_HEIGHT_SAMPLES : 4096;
      if (node.length > arrayLimit) throw new Error(`Array is too large at ${key}.`);
      node.forEach((item, index) => inspect(item, `${key}[${index}]`, depth + 1));
      return;
    }
    if (node && typeof node === 'object') {
      const entries = Object.entries(node);
      if (entries.length > 512) throw new Error(`Object has too many fields at ${key}.`);
      for (const [childKey, child] of entries) {
        if (childKey === '__proto__' || childKey === 'prototype' || childKey === 'constructor') {
          throw new Error(`Unsafe object key at ${key}.${childKey}.`);
        }
        inspect(child, key ? `${key}.${childKey}` : childKey, depth + 1);
      }
    }
  };
  inspect(candidate.metadata, 'metadata');
  inspect(candidate.fidelity, 'fidelity');
  inspect(candidate.planFootprint, 'planFootprint');
  for (const component of candidate.components as AssemblyComponentIR[]) {
    if (!component || typeof component !== 'object') throw new Error('AssemblyIR component is invalid.');
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(component.id) || ids.has(component.id)) throw new Error(`Invalid or duplicate component id: ${component.id}`);
    ids.add(component.id);
    if (!component.geometry || !allowedOps.has(component.geometry.op)) throw new Error(`Unsupported geometry op in ${component.id}.`);
    if (typeof component.name !== 'string' || component.name.length < 1 || component.name.length > 120
      || typeof component.materialName !== 'string' || component.materialName.length < 1 || component.materialName.length > 120
      || typeof component.detail !== 'string' || component.detail.length > 500) {
      throw new Error(`Invalid component text metadata in ${component.id}.`);
    }
    inspect(component.geometry, `${component.id}.geometry`);
    switch (component.geometry.op) {
      case 'roundedBox': {
        const minDimension = Math.min(...component.geometry.size);
        if (minDimension <= 0) throw new Error(`Rounded box dimensions must be positive in ${component.id}.`);
        if (component.geometry.radius < 0 || component.geometry.radius > minDimension * 0.49) {
          throw new Error(`Rounded box radius exceeds the safe half-dimension limit in ${component.id}.`);
        }
        break;
      }
      case 'cylinder':
        if (component.geometry.depth <= 0 || component.geometry.radiusTop < 0 || component.geometry.radiusBottom < 0
          || component.geometry.radiusTop + component.geometry.radiusBottom <= 0) throw new Error(`Cylinder dimensions must be positive in ${component.id}.`);
        break;
      case 'sphere':
        if (component.geometry.radius <= 0) throw new Error(`Sphere radius must be positive in ${component.id}.`);
        break;
      case 'torus':
        if (component.geometry.radius <= 0 || component.geometry.tube <= 0 || component.geometry.tube >= component.geometry.radius) {
          throw new Error(`Torus radii are invalid in ${component.id}.`);
        }
        break;
      case 'extrude':
        if (component.geometry.points.length < 3 || component.geometry.depth <= 0) throw new Error(`Extrude profile is invalid in ${component.id}.`);
        if (component.geometry.holes?.some((loop) => loop.length < 3)) throw new Error(`Extrude hole loop is invalid in ${component.id}.`);
        if (component.geometry.ovalHoles?.some((hole) => hole.radii.some((radius) => radius <= 0)
          || (hole.segments !== undefined && (hole.segments < 8 || hole.segments > 256)))) {
          throw new Error(`Extrude oval hole is invalid in ${component.id}.`);
        }
        if (((component.geometry.bevelSize ?? 0) > 0 || (component.geometry.bevelThickness ?? 0) > 0)
          && (component.geometry.bevelSegments ?? 3) < 1) throw new Error(`Extrude bevel segments are invalid in ${component.id}.`);
        {
          const extrudeDepth = component.geometry.depth;
          if (component.geometry.edgeTapers && (component.geometry.edgeTapers.length > 8
          || component.geometry.edgeTapers.some((taper) => taper.path.length < 2
            || taper.path.length > 512
            || taper.width <= 0
            || taper.tipThickness <= 0
            || taper.tipThickness >= extrudeDepth
            || (taper.curve !== undefined && (taper.curve < 0.25 || taper.curve > 4))))) {
            throw new Error(`Extrude edge taper is invalid in ${component.id}.`);
          }
        }
        break;
      case 'lathe':
        if (component.geometry.profile.length < 2 || component.geometry.profile.some(([radius]) => radius < 0)) throw new Error(`Lathe profile is invalid in ${component.id}.`);
        break;
      case 'tube':
        if (component.geometry.points.length < 2 || component.geometry.radius <= 0) throw new Error(`Tube path is invalid in ${component.id}.`);
        break;
      case 'surfacePatch': {
        const [segmentsX, segmentsZ] = component.geometry.segments;
        const gridVertices = (segmentsX + 1) * (segmentsZ + 1) * 2;
        const reference = component.geometry.referenceRelief;
        if (reference) validateReferenceRelief(reference, component.id);
        if (component.geometry.size.some((value) => value <= 0)
          || component.geometry.baseThickness <= 0
          || !Number.isInteger(segmentsX) || !Number.isInteger(segmentsZ)
          || segmentsX < 2 || segmentsZ < 2 || segmentsX > 256 || segmentsZ > 256
          || gridVertices > 80_000
          || !Number.isInteger(component.geometry.seed)
          || component.geometry.seed < 0 || component.geometry.seed > 0x7fff_ffff
          || component.geometry.macroAmplitude < 0
          || component.geometry.aggregateAmplitude < 0
          || component.geometry.aggregateScale <= 0
          || component.geometry.macroAmplitude + component.geometry.aggregateAmplitude + (reference?.amplitudeMm ?? 0)
            >= component.geometry.baseThickness * 0.45) {
          throw new Error(`Surface patch is invalid in ${component.id}.`);
        }
        break;
      }
      case 'hipRoof':
        if (component.geometry.width <= 0 || component.geometry.depth <= 0 || component.geometry.rise <= 0
          || component.geometry.thickness <= 0 || component.geometry.ridgeLength < 0
          || component.geometry.ridgeLength >= component.geometry.width) {
          throw new Error(`Hip roof dimensions are invalid in ${component.id}.`);
        }
        break;
      case 'bladeLoft':
        if (component.geometry.sections.length < 2 || component.geometry.thickness <= 0 || component.geometry.apexThickness < 0) {
          throw new Error(`Blade loft is invalid in ${component.id}.`);
        }
        break;
      case 'visualHull':
        validateVisualHullDescriptor(component.geometry.descriptor);
        break;
      case 'implicitSurface':
        validateImplicitSurfaceDescriptor(component.geometry.descriptor);
        break;
    }
    inspect(component.position, `${component.id}.position`);
    inspect(component.rotation, `${component.id}.rotation`);
    inspect(component.scale, `${component.id}.scale`);
    if (!component.material || typeof component.material !== 'object' || !/^#[0-9a-fA-F]{6}$/.test(component.material.color)) {
      throw new Error(`Invalid material in ${component.id}.`);
    }
    inspect(component.material, `${component.id}.material`);
    if (component.material.surface && !allowedSurfaces.has(component.material.surface)) {
      throw new Error(`Unsupported surface finish in ${component.id}.`);
    }
    for (const key of ['roughness', 'metalness', 'transmission', 'clearcoat', 'clearcoatRoughness', 'iridescence', 'anisotropy', 'sheen', 'sheenRoughness', 'specularIntensity', 'microNormalStrength'] as const) {
      const value = component.material[key];
      if (value !== undefined && (value < 0 || value > 1)) throw new Error(`Unsafe ${key} in ${component.id}.`);
    }
    if (component.material.ior !== undefined && (component.material.ior < 1 || component.material.ior > 2.5)) {
      throw new Error(`Unsafe ior in ${component.id}.`);
    }
    if (component.material.textureScale?.some((value) => value <= 0 || value > 1024)) {
      throw new Error(`Unsafe textureScale in ${component.id}.`);
    }
    if (component.material.thicknessMm !== undefined && (component.material.thicknessMm < 0 || component.material.thicknessMm > 100)) {
      throw new Error(`Unsafe thicknessMm in ${component.id}.`);
    }
    if (component.material.referenceProjection) validateReferenceProjection(component.material.referenceProjection, component.id);
    if (component.evidence) {
      if (!allowedEvidence.has(component.evidence.status)) throw new Error(`Unsupported evidence status in ${component.id}.`);
      if (component.evidence.source !== undefined && (typeof component.evidence.source !== 'string' || component.evidence.source.length > 500)) {
        throw new Error(`Invalid evidence source in ${component.id}.`);
      }
      if (component.evidence.notes !== undefined && (!Array.isArray(component.evidence.notes)
        || component.evidence.notes.length > 32
        || component.evidence.notes.some((note) => typeof note !== 'string' || note.length > 500))) {
        throw new Error(`Invalid evidence notes in ${component.id}.`);
      }
    }
    if (component.light) {
      if (!/^#[0-9a-fA-F]{6}$/.test(component.light.color)
        || !Number.isFinite(component.light.intensity) || component.light.intensity < 0 || component.light.intensity > 1_000
        || !Number.isFinite(component.light.rangeMm) || component.light.rangeMm <= 0 || component.light.rangeMm > 1_000_000
        || (component.light.decay !== undefined && (!Number.isFinite(component.light.decay) || component.light.decay < 0 || component.light.decay > 4))) {
        throw new Error(`Invalid light fixture in ${component.id}.`);
      }
    }
    if (component.level !== undefined && (typeof component.level !== 'string'
      || component.level.trim().length === 0 || component.level.length > 40)) {
      throw new Error(`Invalid level in ${component.id}.`);
    }
  }
  if (candidate.electrical) validateElectricalHarness(candidate.electrical, ids);
  if (candidate.planFootprint) {
    validatePlanFootprintDescriptor(candidate.planFootprint);
    const missingFootprintIds = candidate.planFootprint.componentIds.filter((id) => !ids.has(id));
    if (missingFootprintIds.length > 0) throw new Error(`Plan-footprint references missing components: ${missingFootprintIds.join(', ')}`);
  }
  if (candidate.fidelity) {
    const fidelityAudit = auditFidelityContract(candidate.fidelity, candidate as AssemblyIR);
    if (!fidelityAudit.pass) throw new Error(`AssemblyIR fidelity contract is blocked: ${fidelityAudit.blockers.join('; ')}`);
  }
}

function distanceToProfilePath(x: number, y: number, path: Array<[number, number]>): number {
  let minimumSquared = Number.POSITIVE_INFINITY;
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index]!;
    const end = path[index + 1]!;
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const lengthSquared = dx * dx + dy * dy;
    const projected = lengthSquared > 1e-12
      ? Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared))
      : 0;
    const offsetX = x - (start[0] + dx * projected);
    const offsetY = y - (start[1] + dy * projected);
    minimumSquared = Math.min(minimumSquared, offsetX * offsetX + offsetY * offsetY);
  }
  return Math.sqrt(minimumSquared);
}

function pointSegmentDistance(
  x: number,
  y: number,
  start: [number, number],
  end: [number, number],
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const projected = lengthSquared > 1e-12
    ? Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / lengthSquared))
    : 0;
  return Math.hypot(x - (start[0] + dx * projected), y - (start[1] + dy * projected));
}

function applyExtrudeEdgeTapers(
  geometry: THREE.BufferGeometry,
  tapers: NonNullable<Extract<AssemblyGeometryIR, { op: 'extrude' }>['edgeTapers']>,
): void {
  const position = geometry.getAttribute('position');
  if (!position || tapers.length === 0) return;
  let fullHalfThickness = 0;
  for (let index = 0; index < position.count; index += 1) {
    fullHalfThickness = Math.max(fullHalfThickness, Math.abs(position.getZ(index)));
  }
  for (let index = 0; index < position.count; index += 1) {
    const originalZ = position.getZ(index);
    let targetHalfThickness = fullHalfThickness;
    const xMm = position.getX(index) * 1000;
    const yMm = position.getY(index) * 1000;
    for (const taper of tapers) {
      const normalizedDistance = Math.min(1, distanceToProfilePath(xMm, yMm, taper.path) / taper.width);
      if (normalizedDistance >= 1) continue;
      const smoothDistance = normalizedDistance * normalizedDistance * (3 - 2 * normalizedDistance);
      const blend = Math.pow(smoothDistance, taper.curve ?? 1);
      const tipHalfThickness = mm(taper.tipThickness) * 0.5;
      targetHalfThickness = Math.min(
        targetHalfThickness,
        tipHalfThickness + (fullHalfThickness - tipHalfThickness) * blend,
      );
    }
    if (targetHalfThickness < fullHalfThickness) {
      position.setZ(index, Math.sign(originalZ || 1) * Math.min(Math.abs(originalZ), targetHalfThickness));
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.morphloomEdgeTapers = tapers.map((taper) => {
    const segmentThicknesses: number[] = [];
    for (let segment = 0; segment < taper.path.length - 1; segment += 1) {
      let maximum = 0;
      let samples = 0;
      for (let index = 0; index < position.count; index += 1) {
        const distanceMm = pointSegmentDistance(
          position.getX(index) * 1000,
          position.getY(index) * 1000,
          taper.path[segment]!,
          taper.path[segment + 1]!,
        );
        if (distanceMm > 0.025) continue;
        maximum = Math.max(maximum, Math.abs(position.getZ(index)) * 2000);
        samples += 1;
      }
      if (samples === 0) throw new Error(`Edge taper segment ${segment} has no geometric samples.`);
      segmentThicknesses.push(maximum);
    }
    const measuredMaxTipThicknessMm = Math.max(...segmentThicknesses);
    if (measuredMaxTipThicknessMm > taper.tipThickness * 1.05) {
      throw new Error(`Edge taper exceeds authored tip thickness: ${measuredMaxTipThicknessMm.toFixed(3)} mm.`);
    }
    return {
      widthMm: taper.width,
      tipThicknessMm: taper.tipThickness,
      curve: taper.curve ?? 1,
      verifiedSegments: segmentThicknesses.length,
      measuredMaxTipThicknessMm,
    };
  });
}

function compileGeometry(geometry: AssemblyGeometryIR): THREE.BufferGeometry {
  switch (geometry.op) {
    case 'roundedBox':
      return geometry.radius > 0
        ? new RoundedBoxGeometry(
          mm(geometry.size[0]), mm(geometry.size[1]), mm(geometry.size[2]),
          geometry.segments ?? 4, mm(geometry.radius),
        )
        : new THREE.BoxGeometry(mm(geometry.size[0]), mm(geometry.size[1]), mm(geometry.size[2]));
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
      const holeLoops = [...(geometry.holes ?? [])];
      for (const oval of geometry.ovalHoles ?? []) {
        const segments = oval.segments ?? 32;
        holeLoops.push(Array.from({ length: segments }, (_, index) => {
          const angle = (index / segments) * Math.PI * 2;
          return [
            oval.center[0] + Math.cos(angle) * oval.radii[0],
            oval.center[1] + Math.sin(angle) * oval.radii[1],
          ] as [number, number];
        }));
      }
      for (const loop of holeLoops) {
        const path = new THREE.Path();
        const [holeFirst, ...holeRest] = loop;
        path.moveTo(mm(holeFirst[0]), mm(holeFirst[1]));
        for (const point of holeRest) path.lineTo(mm(point[0]), mm(point[1]));
        path.closePath();
        shape.holes.push(path);
      }
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
      if (geometry.edgeTapers?.length) applyExtrudeEdgeTapers(result, geometry.edgeTapers);
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
    case 'surfacePatch':
      return createLayeredSurfaceGeometry(geometry);
    case 'hipRoof': {
      const halfWidth = mm(geometry.width) * 0.5;
      const halfDepth = mm(geometry.depth) * 0.5;
      const halfRidge = mm(geometry.ridgeLength) * 0.5;
      const rise = mm(geometry.rise);
      const thickness = mm(geometry.thickness);
      const top = [
        [-halfWidth, 0, -halfDepth], [halfWidth, 0, -halfDepth],
        [halfWidth, 0, halfDepth], [-halfWidth, 0, halfDepth],
        [-halfRidge, rise, 0], [halfRidge, rise, 0],
      ];
      const positions = [...top, ...top.map(([x, y, z]) => [x, y - thickness, z])].flat();
      const indices: number[] = [];
      const face = (...vertices: number[]) => {
        for (let index = 1; index < vertices.length - 1; index += 1) {
          indices.push(vertices[0], vertices[index], vertices[index + 1]);
        }
      };
      face(0, 4, 5, 1); // front pitch
      face(1, 5, 2); // east hip
      face(2, 5, 4, 3); // rear pitch
      face(3, 4, 0); // west hip
      face(6, 7, 11, 10); // soffit front
      face(7, 8, 11); // soffit east
      face(8, 9, 10, 11); // soffit rear
      face(9, 6, 10); // soffit west
      face(0, 1, 7, 6);
      face(1, 2, 8, 7);
      face(2, 3, 9, 8);
      face(3, 0, 6, 9);
      const result = new THREE.BufferGeometry();
      result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      result.setIndex(indices);
      result.computeVertexNormals();
      return result;
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
    case 'visualHull': {
      const carve = carveVisualHull(geometry.descriptor);
      if (carve.status === 'empty') throw new Error('Visual hull silhouettes have no shared occupied volume.');
      const result = visualHullToBufferGeometry(carve);
      result.scale(0.001, 0.001, 0.001);
      result.userData.visualHullEvidence = {
        occupiedVoxelCount: carve.occupiedVoxelCount,
        totalVoxelCount: carve.totalVoxelCount,
        viewAxes: carve.viewAxes,
        viewAgreement: carve.viewAgreement,
        minimumViewIoU: carve.minimumViewIoU,
        confidenceWeightedIoU: carve.confidenceWeightedIoU,
        unconstrainedAxes: carve.unconstrainedAxes,
        limitations: carve.limitations,
      };
      return result;
    }
    case 'implicitSurface': {
      const result = polygonizeImplicitSurface(geometry.descriptor).geometry;
      result.scale(0.001, 0.001, 0.001);
      return result;
    }
  }
}

function ensurePrimaryUv(source: THREE.BufferGeometry): THREE.BufferGeometry {
  if (source.hasAttribute('uv')) return source;
  // A single planar projection collapses every face parallel to the chosen
  // plane. Expand only custom geometry that lacks authored UVs and project
  // each triangle along its dominant normal axis. The chosen plane has the
  // largest possible projected area, so every non-degenerate 3D triangle also
  // receives a non-degenerate finite UV triangle.
  const geometry = source.index ? source.toNonIndexed() : source;
  if (geometry !== source) {
    // BufferGeometry.toNonIndexed() intentionally rebuilds attributes, but it
    // does not preserve provenance stored in userData. Visual-hull and
    // implicit-surface audits consume that evidence after compilation, so UV
    // repair must remain metadata-lossless.
    geometry.name = source.name;
    geometry.userData = structuredClone(source.userData);
  }
  const rejectUvGeneration = (message: string): never => {
    if (geometry !== source) geometry.dispose();
    throw new Error(message);
  };
  const position = geometry.getAttribute('position')
    ?? rejectUvGeneration('Custom geometry cannot receive a valid primary UV set.');
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox
    ?? rejectUvGeneration('Custom geometry cannot receive a valid primary UV set.');
  if (position.count % 3 !== 0) {
    rejectUvGeneration('Custom geometry cannot receive a valid primary UV set.');
  }
  const size = bounds.getSize(new THREE.Vector3());
  const uv = new Float32Array(position.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const axesForTriangle = (): [['x' | 'y' | 'z', number], ['x' | 'y' | 'z', number]] => {
    const absolute = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
    if (absolute[0]! >= absolute[1]! && absolute[0]! >= absolute[2]!) return [['z', size.z], ['y', size.y]];
    if (absolute[1]! >= absolute[2]!) return [['x', size.x], ['z', size.z]];
    return [['x', size.x], ['y', size.y]];
  };
  for (let triangle = 0; triangle < position.count; triangle += 3) {
    a.fromBufferAttribute(position, triangle);
    b.fromBufferAttribute(position, triangle + 1);
    c.fromBufferAttribute(position, triangle + 2);
    normal.crossVectors(ab.copy(b).sub(a), ac.copy(c).sub(a));
    if (normal.lengthSq() <= 1e-20) rejectUvGeneration('Custom geometry contains a degenerate triangle before UV generation.');
    const [[uAxis, uSize], [vAxis, vSize]] = axesForTriangle();
    if (uSize <= 1e-12 || vSize <= 1e-12) rejectUvGeneration('Custom geometry UV projection axis is degenerate.');
    for (let corner = 0; corner < 3; corner += 1) {
      const point = corner === 0 ? a : corner === 1 ? b : c;
      uv[(triangle + corner) * 2] = (point[uAxis] - bounds.min[uAxis]) / uSize;
      uv[(triangle + corner) * 2 + 1] = (point[vAxis] - bounds.min[vAxis]) / vSize;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (geometry !== source) source.dispose();
  return geometry;
}

function partitionReferenceProjectionFaces(mesh: THREE.Mesh, projection: ReferenceProjectionIR): void {
  if (!Array.isArray(mesh.material) || mesh.material.length !== 2) {
    throw new Error(`Reference projection materials are not partitionable in ${mesh.name}.`);
  }
  const source = mesh.geometry;
  const geometry = source.index ? source.toNonIndexed() : source;
  if (geometry !== source) {
    geometry.name = source.name;
    geometry.userData = structuredClone(source.userData);
    mesh.geometry = geometry;
  }
  const rejectProjection = (message: string): never => {
    if (geometry !== source) geometry.dispose();
    throw new Error(message);
  };
  const position = geometry.getAttribute('position')
    ?? rejectProjection(`Reference projection geometry has no positions in ${mesh.name}.`);
  if (position.count % 3 !== 0) rejectProjection(`Reference projection geometry is not triangle-expanded in ${mesh.name}.`);
  const existingUv = geometry.getAttribute('uv');
  const uv = new Float32Array(position.count * 2);
  if (existingUv) {
    for (let index = 0; index < position.count; index += 1) {
      uv[index * 2] = existingUv.getX(index);
      uv[index * 2 + 1] = existingUv.getY(index);
    }
  }
  mesh.updateMatrix();
  const [minX, minSecondary, maxX, maxSecondary] = projection.boundsMm;
  const width = maxX - minX;
  const height = maxSecondary - minSecondary;
  const points = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const projectionAxis = projection.mapping === 'assembly-xz' ? 'y' : 'z';
  // Keep the admitted plate on every genuinely source-visible triangle,
  // including rounded bevels.  A high front-facing cutoff leaves hard seams
  // across curved products (for example a knife handle) even though those
  // facets are visible in the source.  Only tangent/rear triangles must fall
  // back to authored UVs: at 0.05 the planar footprint still has meaningful
  // area while near-degenerate side projections remain excluded.
  const minimumFacing = 0.05;
  let projectedTriangles = 0;
  let sideTriangles = 0;
  let groupStart = 0;
  let activeMaterial = -1;
  geometry.clearGroups();
  for (let triangle = 0; triangle < position.count; triangle += 3) {
    for (let corner = 0; corner < 3; corner += 1) {
      points[corner].fromBufferAttribute(position, triangle + corner).applyMatrix4(mesh.matrix).multiplyScalar(1000);
    }
    normal.crossVectors(edgeA.copy(points[1]).sub(points[0]), edgeB.copy(points[2]).sub(points[0]));
    const normalLength = normal.length();
    if (normalLength <= 1e-12) rejectProjection(`Reference projection encountered a degenerate triangle in ${mesh.name}.`);
    // A single admitted image constrains only the source-facing hemisphere.
    // Projecting it onto the hidden rear would duplicate evidence and mirror
    // visible detail onto geometry the source never observed.
    const materialIndex = normal[projectionAxis] / normalLength >= minimumFacing ? 0 : 1;
    if (materialIndex === 0) {
      projectedTriangles += 1;
      for (let corner = 0; corner < 3; corner += 1) {
        const point = points[corner];
        uv[(triangle + corner) * 2] = (point.x - minX) / width;
        const secondary = projection.mapping === 'assembly-xz' ? point.z : point.y;
        uv[(triangle + corner) * 2 + 1] = (secondary - minSecondary) / height;
      }
    } else {
      sideTriangles += 1;
    }
    if (activeMaterial < 0) activeMaterial = materialIndex;
    if (materialIndex !== activeMaterial) {
      geometry.addGroup(groupStart, triangle - groupStart, activeMaterial);
      groupStart = triangle;
      activeMaterial = materialIndex;
    }
  }
  if (activeMaterial >= 0) geometry.addGroup(groupStart, position.count - groupStart, activeMaterial);
  if (projectedTriangles === 0) rejectProjection(`Reference projection has no source-facing triangles in ${mesh.name}.`);
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.userData.morphloomReferenceProjectionPartition = {
    method: 'source-facing-triangle-partition-v1',
    projectionAxis,
    minimumFacing,
    projectedTriangles,
    sideTriangles,
    groups: geometry.groups.length,
  };
  if (geometry !== source) source.dispose();
}

interface ProjectionLoadRecord {
  texture: THREE.Texture;
  normalTexture?: THREE.Texture;
  roughnessTexture?: THREE.Texture;
  metrics?: ReferenceSurfaceMetrics;
  alphaFillPixels?: number;
  delightMetrics?: ReferenceDelightMetrics;
  materials: Set<THREE.MeshPhysicalMaterial>;
  state: 'loading' | 'loaded' | 'failed';
  promise: Promise<boolean>;
}

export function referenceProjectionDiffuseGain(metalness: number, authoredLinearLuma: number): number {
  if (!Number.isFinite(metalness) || metalness < 0 || metalness > 1
    || !Number.isFinite(authoredLinearLuma) || authoredLinearLuma < 0 || authoredLinearLuma > 1) {
    throw new Error('Reference projection metalness and authored luminance must be within 0..1.');
  }
  return THREE.MathUtils.clamp(0.8 - authoredLinearLuma * 0.42 + metalness * 0.2, 0.5, 0.95);
}

function applyReferenceProjectionAppearance(
  material: THREE.MeshPhysicalMaterial,
  record: ProjectionLoadRecord,
): void {
  material.map = record.texture;
  if (record.normalTexture) material.normalMap = record.normalTexture;
  if (record.roughnessTexture) material.roughnessMap = record.roughnessTexture;
  // The admitted plate already contains photographed illumination. Applying a
  // full white multiplier under a second PBR studio rig overexposes pale
  // dielectrics while highly metallic regions receive much less diffuse light.
  // Keep a bounded, deterministic diffuse-energy compensation that approaches
  // neutral for metals and remains visibly light-responsive for every finish.
  const recordedLuma = material.userData.morphloomSurface?.referenceAuthoredLinearLuma;
  const authoredLinearLuma = typeof recordedLuma === 'number'
    ? recordedLuma
    : material.color.r * 0.2126 + material.color.g * 0.7152 + material.color.b * 0.0722;
  const colorGain = referenceProjectionDiffuseGain(material.metalness, authoredLinearLuma);
  material.color.setRGB(colorGain, colorGain, colorGain);
  material.userData.morphloomSurface = {
    ...material.userData.morphloomSurface,
    referenceProjectionState: 'loaded',
    referenceRelief: Boolean(record.normalTexture && record.roughnessTexture),
    referenceIrregularity: record.metrics?.irregularity,
    referenceAlphaFillPixels: record.alphaFillPixels,
    referenceAuthoredLinearLuma: authoredLinearLuma,
    referenceDiffuseEnergyGain: colorGain,
    referenceDelight: record.delightMetrics,
  };
  material.needsUpdate = true;
}

function createOpaqueCroppedProjectionTexture(
  texture: THREE.Texture,
  projection: ReferenceProjectionIR,
): { texture: THREE.CanvasTexture; filledPixels: number; delightMetrics: ReferenceDelightMetrics } | undefined {
  if (typeof document === 'undefined') return undefined;
  const source = texture.image as CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const sourceWidth = source.naturalWidth ?? source.width ?? 0;
  const sourceHeight = source.naturalHeight ?? source.height ?? 0;
  if (sourceWidth < 1 || sourceHeight < 1) return undefined;
  const [cropX, cropY, cropWidth, cropHeight] = projection.crop;
  const width = Math.max(1, Math.round(sourceWidth * cropWidth));
  const height = Math.max(1, Math.round(sourceHeight * cropHeight));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(
    source,
    Math.round(sourceWidth * cropX),
    Math.round(sourceHeight * cropY),
    width,
    height,
    0,
    0,
    width,
    height,
  );
  let pixels: ImageData;
  try {
    pixels = context.getImageData(0, 0, width, height);
  } catch {
    return undefined;
  }
  const extended = extendOpaqueProjectionColors(pixels.data, width, height);
  const delighted = delightReferenceProjection(extended.rgba, width, height);
  const opaqueImage = context.createImageData(width, height);
  opaqueImage.data.set(delighted.rgba);
  context.putImageData(opaqueImage, 0, 0);
  const result = new THREE.CanvasTexture(canvas);
  result.name = `morphloom_reference_opaque_${projection.fingerprint ?? 'unverified'}`;
  result.colorSpace = THREE.SRGBColorSpace;
  result.wrapS = result.wrapT = THREE.ClampToEdgeWrapping;
  result.userData.morphloomProjectionOwned = true;
  result.userData.morphloomTransparentColorFill = extended.filledPixels;
  result.userData.morphloomReferenceDelight = delighted.metrics;
  result.needsUpdate = true;
  return { texture: result, filledPixels: extended.filledPixels, delightMetrics: delighted.metrics };
}

function projectionKey(projection: ReferenceProjectionIR): string {
  return `${projection.uri}|${projection.mapping}|${projection.crop.join(',')}|${projection.boundsMm.join(',')}|${projection.fingerprint ?? ''}|${projection.relief?.strength ?? ''}|${projection.relief?.maxResolution ?? ''}`;
}

async function verifyReferenceFingerprint(projection: ReferenceProjectionIR): Promise<boolean> {
  if (!projection.fingerprint) return true;
  if (typeof fetch !== 'function' || !globalThis.crypto?.subtle) return false;
  try {
    const response = await fetch(projection.uri, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) return false;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    const actual = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
    return actual.startsWith(projection.fingerprint.toLowerCase());
  } catch {
    return false;
  }
}

function createReferenceSurfaceMaps(
  texture: THREE.Texture,
  projection: ReferenceProjectionIR,
): { normal: THREE.CanvasTexture; roughness: THREE.CanvasTexture; metrics: ReferenceSurfaceMetrics } | undefined {
  if (!projection.relief || typeof document === 'undefined') return undefined;
  const source = texture.image as CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  const sourceWidth = source.naturalWidth ?? source.width ?? 0;
  const sourceHeight = source.naturalHeight ?? source.height ?? 0;
  if (sourceWidth <= 0 || sourceHeight <= 0) return undefined;
  const [cropX, cropY, cropWidth, cropHeight] = projection.crop;
  const sourceCropWidth = Math.max(1, Math.round(sourceWidth * cropWidth));
  const sourceCropHeight = Math.max(1, Math.round(sourceHeight * cropHeight));
  const maxResolution = projection.relief.maxResolution ?? 1536;
  const scale = Math.min(1, maxResolution / Math.max(sourceCropWidth, sourceCropHeight));
  const width = Math.max(2, Math.round(sourceCropWidth * scale));
  const height = Math.max(2, Math.round(sourceCropHeight * scale));
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) return undefined;
  sourceContext.drawImage(
    source,
    Math.round(sourceWidth * cropX),
    Math.round(sourceHeight * cropY),
    sourceCropWidth,
    sourceCropHeight,
    0,
    0,
    width,
    height,
  );
  let pixels: ImageData;
  try {
    pixels = sourceContext.getImageData(0, 0, width, height);
  } catch {
    return undefined;
  }
  const normalCanvas = document.createElement('canvas');
  const roughnessCanvas = document.createElement('canvas');
  normalCanvas.width = roughnessCanvas.width = width;
  normalCanvas.height = roughnessCanvas.height = height;
  const normalContext = normalCanvas.getContext('2d');
  const roughnessContext = roughnessCanvas.getContext('2d');
  if (!normalContext || !roughnessContext) return undefined;
  const analysis = analyzeReferenceSurface(pixels.data, width, height, projection.relief.strength ?? 0.72);
  // ImageData requires an ArrayBuffer-backed view in newer DOM typings. Copying
  // also prevents the canvas from sharing mutable analysis buffers.
  const normalPixels = new ImageData(new Uint8ClampedArray(analysis.normalRgba), width, height);
  const roughnessPixels = new ImageData(new Uint8ClampedArray(analysis.roughnessRgba), width, height);
  normalContext.putImageData(normalPixels, 0, 0);
  roughnessContext.putImageData(roughnessPixels, 0, 0);
  sourceCanvas.width = sourceCanvas.height = 1;
  const configure = (map: THREE.CanvasTexture, kind: string) => {
    map.name = `morphloom_reference_${kind}_${projection.fingerprint ?? 'unverified'}`;
    map.colorSpace = THREE.NoColorSpace;
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    map.userData.morphloomProjectionOwned = true;
    map.userData.morphloomReferenceDerived = kind;
    map.needsUpdate = true;
  };
  const normal = new THREE.CanvasTexture(normalCanvas);
  const roughness = new THREE.CanvasTexture(roughnessCanvas);
  configure(normal, 'normal');
  configure(roughness, 'roughness');
  normal.userData.morphloomReferenceMetrics = analysis.metrics;
  roughness.userData.morphloomReferenceMetrics = analysis.metrics;
  return { normal, roughness, metrics: analysis.metrics };
}

function createProjectionRecord(
  root: THREE.Group,
  projection: ReferenceProjectionIR,
  status: ProjectionStatus,
): ProjectionLoadRecord | undefined {
  if (typeof document === 'undefined') return undefined;
  const materials = new Set<THREE.MeshPhysicalMaterial>();
  let resolveLoad: (loaded: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((resolve) => { resolveLoad = resolve; });
  const record = {} as ProjectionLoadRecord;
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  const texture = loader.load(
    projection.uri,
    () => {
      void (async () => {
        if (root.userData.morphloomProjectionActive !== true) {
          texture.dispose();
          resolveLoad(false);
          return;
        }
        if (!await verifyReferenceFingerprint(projection)) {
          record.state = 'failed';
          status.failed += 1;
          status.errors.push(`Reference projection fingerprint mismatch: ${projection.uri}`);
          texture.dispose();
          resolveLoad(false);
          return;
        }
        if (root.userData.morphloomProjectionActive !== true) {
          texture.dispose();
          resolveLoad(false);
          return;
        }
        const opaqueProjection = createOpaqueCroppedProjectionTexture(texture, projection);
        if (!opaqueProjection) {
          record.state = 'failed';
          status.failed += 1;
          status.errors.push(`Unable to prepare opaque reference projection: ${projection.uri}`);
          texture.dispose();
          resolveLoad(false);
          return;
        }
        const croppedProjection = { ...projection, crop: [0, 0, 1, 1] as [number, number, number, number] };
        const derivedMaps = createReferenceSurfaceMaps(opaqueProjection.texture, croppedProjection);
        if (projection.relief && !derivedMaps) {
          record.state = 'failed';
          status.failed += 1;
          status.errors.push(`Unable to derive local reference relief: ${projection.uri}`);
          opaqueProjection.texture.dispose();
          texture.dispose();
          resolveLoad(false);
          return;
        }
        record.normalTexture = derivedMaps?.normal;
        record.roughnessTexture = derivedMaps?.roughness;
        record.metrics = derivedMaps?.metrics;
        record.alphaFillPixels = opaqueProjection.filledPixels;
        record.delightMetrics = opaqueProjection.delightMetrics;
        record.texture = opaqueProjection.texture;
        texture.dispose();
        record.state = 'loaded';
        status.loaded += 1;
        for (const material of materials) {
          applyReferenceProjectionAppearance(material, record);
        }
        resolveLoad(true);
      })().catch(() => {
        record.state = 'failed';
        status.failed += 1;
        status.errors.push(`Unable to verify local reference projection: ${projection.uri}`);
        texture.dispose();
        resolveLoad(false);
      });
    },
    undefined,
    () => {
      record.state = 'failed';
      status.failed += 1;
      status.errors.push(`Unable to load local reference projection: ${projection.uri}`);
      for (const material of materials) {
        material.userData.morphloomSurface = {
          ...material.userData.morphloomSurface,
          referenceProjectionState: 'failed',
        };
      }
      texture.dispose();
      resolveLoad(false);
    },
  );
  texture.name = `morphloom_reference_${projection.fingerprint ?? 'unverified'}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.userData.morphloomProjectionOwned = true;
  Object.assign(record, { texture, materials, state: 'loading' as const, promise });
  return record;
}

export async function waitForReferenceProjections(root: THREE.Object3D, timeoutMs = 8_000): Promise<ProjectionStatus | undefined> {
  const ready = projectionReadiness.get(root);
  if (!ready) return undefined;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error('Reference projection timeout is invalid.');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      ready,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Reference projection load timed out.')), timeoutMs);
      }),
    ]);
    if (result.failed > 0) throw new Error(result.errors.join(' · '));
    return result;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function compileAssemblyIR(ir: AssemblyIR, mode: ViewMode): ProductBuild {
  validateAssemblyIR(ir);
  const root = new THREE.Group();
  root.name = ir.name;
  root.userData.assemblyIR = structuredClone(ir);
  root.userData.morphloomProjectionActive = true;
  const projectionLoads = new Map<string, ProjectionLoadRecord>();
  const declaredProjectionKeys = new Set<string>();
  const projectionStatus: ProjectionStatus = { declared: 0, loaded: 0, failed: 0, errors: [] };
  const parts: ProductPartInfo[] = [];
  for (const component of ir.components) {
    const geometry = ensurePrimaryUv(compileGeometry(component.geometry));
    const baseMaterial = createSurfaceMaterial(component.material, {
      mode,
      category: component.category,
      materialName: `${component.materialName} ${component.id}`,
    });
    const projection = mode === 'beauty' ? component.material.referenceProjection : undefined;
    const projectedMaterial = projection ? baseMaterial : undefined;
    const sideMaterial = projection ? baseMaterial.clone() : undefined;
    if (sideMaterial) {
      sideMaterial.name = `${baseMaterial.name || component.id}_cut_edges`;
      sideMaterial.userData = structuredClone(baseMaterial.userData);
      // A single plate does not observe cut edges or the rear hemisphere.
      // Repeating the front image there is false evidence, while retaining a
      // strongly directional procedural normal creates barcode-like seams at
      // rounded silhouettes. Keep only the authored bulk PBR response on the
      // unobserved partition and mark the evidence boundary explicitly.
      sideMaterial.normalMap = null;
      sideMaterial.roughnessMap = null;
      sideMaterial.anisotropy = 0;
      sideMaterial.userData.morphloomSurface = {
        ...sideMaterial.userData.morphloomSurface,
        referenceProjection: null,
        referenceProjectionState: 'unobserved-side',
        referenceRelief: false,
      };
      sideMaterial.needsUpdate = true;
    }
    const mesh = new THREE.Mesh(
      geometry,
      projectedMaterial && sideMaterial
        ? [projectedMaterial, sideMaterial]
        : projectedMaterial ?? baseMaterial,
    );
    mesh.name = component.id;
    if (component.position) mesh.position.set(...component.position.map(mm) as [number, number, number]);
    if (component.rotation) mesh.rotation.set(...component.rotation);
    if (component.scale) mesh.scale.set(...component.scale);
    if (projection && projectedMaterial) {
      partitionReferenceProjectionFaces(mesh, projection);
      const key = projectionKey(projection);
      let record = projectionLoads.get(key);
      if (!record) {
        if (!declaredProjectionKeys.has(key)) {
          declaredProjectionKeys.add(key);
          projectionStatus.declared += 1;
        }
        record = createProjectionRecord(root, projection, projectionStatus);
        if (record) projectionLoads.set(key, record);
      }
      if (record) {
        record.materials.add(projectedMaterial);
        projectedMaterial.userData.morphloomSurface = {
          ...projectedMaterial.userData.morphloomSurface,
          referenceProjection: projection.mapping,
          referenceFingerprint: projection.fingerprint ?? null,
          referenceProjectionState: record.state,
        };
        if (record.state === 'loaded') {
          applyReferenceProjectionAppearance(projectedMaterial, record);
        }
      }
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const info: ProductPartInfo = {
      id: component.id,
      name: component.name,
      category: component.category,
      material: component.materialName,
      surface: inferSurfaceFinish(`${component.materialName} ${component.id}`, component.material.surface),
      detail: component.detail,
      level: component.level,
    };
    mesh.userData.part = info;
    if (component.light && mode === 'beauty') {
      const fixtureLight = new THREE.PointLight(
        component.light.color,
        component.light.intensity,
        mm(component.light.rangeMm),
        component.light.decay ?? 2,
      );
      fixtureLight.name = `${component.id}_light_source`;
      fixtureLight.userData.morphloomFixture = true;
      fixtureLight.userData.dayIntensity = Math.min(0.35, component.light.intensity * 0.01);
      fixtureLight.userData.nightIntensity = component.light.intensity;
      mesh.add(fixtureLight);
    }
    parts.push(info);
    root.add(mesh);
  }
  if (projectionLoads.size > 0) {
    const ready = Promise.all([...projectionLoads.values()].map((record) => record.promise)).then(() => {
      const surfaces = inspectSurfaceSystem(root);
      root.userData.surfaceSystem = structuredClone(surfaces);
      if (root.userData.morphloomProjectionActive === true) {
        root.dispatchEvent({ type: 'morphloom-reference-projection-ready' } as never);
      }
      return { ...projectionStatus, errors: [...projectionStatus.errors] };
    });
    projectionReadiness.set(root, ready);
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
  const surfaces = inspectSurfaceSystem(root);
  const topology = analyzeTopology(root);
  const engineering = inspectEngineeringEvidence(ir, connectivity);
  const planFootprint = ir.planFootprint ? auditPlanFootprint(root, ir.planFootprint) : undefined;
  root.userData.surfaceSystem = structuredClone(surfaces);
  root.userData.topology = structuredClone(topology);
  root.userData.engineeringAudit = structuredClone(engineering);
  if (planFootprint) root.userData.planFootprintAudit = structuredClone(planFootprint);
  if (ir.fidelity) root.userData.fidelityContract = structuredClone(ir.fidelity);
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
      surfaces,
      topology,
      engineering,
      planFootprint,
    },
  };
}
