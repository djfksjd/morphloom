import * as THREE from 'three';
import type { PoseStyle } from '../types';
import { getPoseJoints } from './reference-pose';

export const CLOTH_WRINKLE_EVIDENCE = [
  {
    id: 'cloth3d',
    url: 'https://github.com/hbertiche/CLOTH3D',
    use: 'pose, body shape, garment type, topology, tightness and fabric must remain separate wrinkle-driving evidence',
  },
  {
    id: 'deepwrinkles',
    url: 'https://arxiv.org/abs/1808.03417',
    use: 'separate large-scale cloth deformation from high-frequency normal/surface detail',
  },
  {
    id: 'garment-wrinkle-transfer',
    url: 'https://github.com/Dancingmader/3D-High-quality-Garment-Dataset',
    use: 'keep source garment, target garment and wrinkle-transfer result as distinct comparison artifacts',
  },
  {
    id: 'deep-fashion3d',
    url: 'https://arxiv.org/abs/2003.12753',
    use: 'validate real-garment category, multi-view reconstruction and feature-line evidence independently of synthetic pose tests',
  },
] as const;

export interface ClothWrinkleReport {
  method: 'deterministic-pose-zones-v1';
  affectedVertices: number;
  maximumDisplacementMm: number;
  rmsDisplacementMm: number;
  zones: readonly ['waist', 'left-elbow', 'right-elbow', 'left-knee', 'right-knee'];
  evidenceIds: string[];
}

function smoothEnvelope(distance: number, radius: number): number {
  const t = THREE.MathUtils.clamp(1 - distance / Math.max(radius, 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Adds bounded, deterministic pose-driven folds without changing vertex or
 * triangle identity. This is a semi-professional geometric wrinkle pass, not
 * a cloth simulation or a substitute for multi-view/scan evidence.
 */
export function applyPoseDrivenClothWrinkles(
  geometry: THREE.BufferGeometry,
  heightMeters: number,
  pose: PoseStyle,
): ClothWrinkleReport {
  const position = geometry.getAttribute('position');
  if (!(position instanceof THREE.BufferAttribute) || position.itemSize !== 3) {
    throw new Error('Cloth wrinkle pass requires a 3D position buffer.');
  }
  if (!Number.isFinite(heightMeters) || heightMeters <= 0) throw new Error('Cloth wrinkle height must be positive and finite.');
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');
  if (!(normal instanceof THREE.BufferAttribute) || normal.itemSize !== 3) throw new Error('Cloth wrinkle pass requires vertex normals.');

  // Make duplicate seam vertices move identically. UV seams can carry
  // separate normal records at the same position; displacing those records by
  // different normals would create microscopic cracks in an otherwise closed
  // garment even though its index topology did not change.
  const seamNormals = new Map<string, { sum: THREE.Vector3; count: number }>();
  const seamKey = (x: number, y: number, z: number) => `${x.toFixed(6)}:${y.toFixed(6)}:${z.toFixed(6)}`;
  const sourceNormal = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    const key = seamKey(position.getX(index), position.getY(index), position.getZ(index));
    const entry = seamNormals.get(key) ?? { sum: new THREE.Vector3(), count: 0 };
    entry.sum.add(sourceNormal.fromBufferAttribute(normal, index));
    entry.count += 1;
    seamNormals.set(key, entry);
  }
  for (const entry of seamNormals.values()) entry.sum.multiplyScalar(1 / entry.count).normalize();

  const joints = getPoseJoints(heightMeters, pose);
  const point = new THREE.Vector3();
  const surfaceNormal = new THREE.Vector3();
  const fallbackNormal = new THREE.Vector3(0, 0, 1);
  const delta = new THREE.Vector3();
  const maxDisplacement = heightMeters * 0.00235;
  let affectedVertices = 0;
  let squaredDisplacement = 0;
  let measuredMaximum = 0;

  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    surfaceNormal.copy(seamNormals.get(seamKey(point.x, point.y, point.z))?.sum ?? fallbackNormal);
    let displacement = 0;

    const waist01 = point.y / heightMeters;
    const waistEnvelope = smoothEnvelope(Math.abs(waist01 - 0.565), 0.095)
      * smoothEnvelope(Math.abs(point.x), heightMeters * 0.18);
    if (waistEnvelope > 0) {
      const horizontalBand = Math.sin(waist01 * 182 + point.x / heightMeters * 24 + point.z / heightMeters * 9);
      displacement += horizontalBand * waistEnvelope * heightMeters * 0.00082;
    }

    for (const [joint, radius, amplitude, phase] of [
      [joints.elbowL, 0.085, 0.00135, 0.3],
      [joints.elbowR, 0.085, 0.00135, 1.1],
      [joints.kneeL, 0.105, 0.00175, 0.7],
      [joints.kneeR, 0.105, 0.00175, 1.7],
    ] as const) {
      const distance = point.distanceTo(joint);
      const envelope = smoothEnvelope(distance, heightMeters * radius);
      if (envelope <= 0) continue;
      const relative = delta.copy(point).sub(joint);
      const angular = Math.atan2(relative.z, relative.x);
      const fold = Math.sin(distance / heightMeters * 158 + angular * 1.4 + phase);
      displacement += fold * envelope * heightMeters * amplitude;
    }

    displacement = THREE.MathUtils.clamp(displacement, -maxDisplacement, maxDisplacement);
    if (Math.abs(displacement) < 0.000_002) continue;
    point.addScaledVector(surfaceNormal, displacement);
    position.setXYZ(index, point.x, point.y, point.z);
    affectedVertices += 1;
    squaredDisplacement += displacement * displacement;
    measuredMaximum = Math.max(measuredMaximum, Math.abs(displacement));
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return {
    method: 'deterministic-pose-zones-v1',
    affectedVertices,
    maximumDisplacementMm: measuredMaximum * 1000,
    rmsDisplacementMm: affectedVertices > 0 ? Math.sqrt(squaredDisplacement / affectedVertices) * 1000 : 0,
    zones: ['waist', 'left-elbow', 'right-elbow', 'left-knee', 'right-knee'],
    evidenceIds: CLOTH_WRINKLE_EVIDENCE.map((item) => item.id),
  };
}
