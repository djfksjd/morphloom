import * as THREE from 'three';

export const REQUIRED_FACIAL_MORPH_NAMES = [
  'jaw_open',
  'smile',
  'blink_L',
  'blink_R',
  'brow_raise',
] as const;

export interface FacialMorphReport {
  schema: 'morphloom.facial-morphs/0.1';
  names: string[];
  affectedVertices: number;
  maximumDisplacementMm: number;
  nonZeroTargets: number;
}

type MorphRule = (context: {
  x01: number;
  y01: number;
  front01: number;
  side: -1 | 0 | 1;
  size: THREE.Vector3;
}) => THREE.Vector3;

const smoothBand = (value: number, start: number, peak: number, end: number): number => {
  if (value <= start || value >= end) return 0;
  if (value <= peak) return THREE.MathUtils.smoothstep(value, start, peak);
  return 1 - THREE.MathUtils.smoothstep(value, peak, end);
};

/**
 * Adds conservative, editable facial expression targets to the source head.
 * These are delivery controls, not identity reconstruction or FACS claims.
 */
export function attachFacialMorphTargets(
  geometry: THREE.BufferGeometry,
  headBounds: THREE.Box3,
): FacialMorphReport {
  const position = geometry.getAttribute('position');
  if (!(position instanceof THREE.BufferAttribute) || position.itemSize !== 3) {
    throw new Error('Facial morph targets require a 3D position buffer.');
  }
  if (headBounds.isEmpty()) throw new Error('Facial morph targets require finite head bounds.');
  const size = headBounds.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('Facial morph targets require positive head dimensions.');
  }
  const center = headBounds.getCenter(new THREE.Vector3());
  const rules: Array<{ name: typeof REQUIRED_FACIAL_MORPH_NAMES[number]; rule: MorphRule }> = [
    {
      name: 'jaw_open',
      rule: ({ y01, front01, size: headSize }) => {
        const weight = smoothBand(y01, 0.08, 0.28, 0.5) * THREE.MathUtils.smoothstep(front01, 0.42, 0.72);
        return new THREE.Vector3(0, -headSize.y * 0.055 * weight, headSize.z * 0.018 * weight);
      },
    },
    {
      name: 'smile',
      rule: ({ x01, y01, front01, side, size: headSize }) => {
        const mouth = smoothBand(y01, 0.32, 0.44, 0.57) * THREE.MathUtils.smoothstep(front01, 0.48, 0.76);
        const corner = mouth * THREE.MathUtils.smoothstep(Math.abs(x01), 0.18, 0.72);
        return new THREE.Vector3(side * headSize.x * 0.025 * corner, headSize.y * 0.035 * corner, headSize.z * 0.009 * mouth);
      },
    },
    {
      name: 'blink_L',
      rule: ({ x01, y01, front01, size: headSize }) => {
        const sideWeight = THREE.MathUtils.smoothstep(x01, 0.02, 0.22);
        const lid = smoothBand(y01, 0.52, 0.625, 0.74) * THREE.MathUtils.smoothstep(front01, 0.46, 0.74) * sideWeight;
        return new THREE.Vector3(0, (0.625 - y01) * headSize.y * 0.72 * lid, -headSize.z * 0.008 * lid);
      },
    },
    {
      name: 'blink_R',
      rule: ({ x01, y01, front01, size: headSize }) => {
        const sideWeight = THREE.MathUtils.smoothstep(-x01, 0.02, 0.22);
        const lid = smoothBand(y01, 0.52, 0.625, 0.74) * THREE.MathUtils.smoothstep(front01, 0.46, 0.74) * sideWeight;
        return new THREE.Vector3(0, (0.625 - y01) * headSize.y * 0.72 * lid, -headSize.z * 0.008 * lid);
      },
    },
    {
      name: 'brow_raise',
      rule: ({ y01, front01, size: headSize }) => {
        const brow = smoothBand(y01, 0.64, 0.75, 0.86) * THREE.MathUtils.smoothstep(front01, 0.42, 0.72);
        return new THREE.Vector3(0, headSize.y * 0.045 * brow, headSize.z * 0.004 * brow);
      },
    },
  ];
  const targets: THREE.BufferAttribute[] = [];
  const affected = new Set<number>();
  let maximumDisplacementMm = 0;
  let nonZeroTargets = 0;
  for (const { name, rule } of rules) {
    const deltas = new Float32Array(position.count * 3);
    let targetAffected = 0;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index);
      const y = position.getY(index);
      const z = position.getZ(index);
      if (y < headBounds.min.y || y > headBounds.max.y) continue;
      const x01 = (x - center.x) / Math.max(size.x * 0.5, 1e-6);
      const y01 = (y - headBounds.min.y) / size.y;
      const front01 = (z - headBounds.min.z) / size.z;
      const delta = rule({ x01, y01, front01, side: x01 > 0.02 ? 1 : x01 < -0.02 ? -1 : 0, size });
      const length = delta.length();
      if (length <= 1e-7) continue;
      deltas[index * 3] = delta.x;
      deltas[index * 3 + 1] = delta.y;
      deltas[index * 3 + 2] = delta.z;
      targetAffected += 1;
      affected.add(index);
      maximumDisplacementMm = Math.max(maximumDisplacementMm, length * 1_000);
    }
    if (targetAffected === 0) throw new Error(`Facial morph target ${name} affects no vertices.`);
    nonZeroTargets += 1;
    const attribute = new THREE.Float32BufferAttribute(deltas, 3);
    attribute.name = name;
    targets.push(attribute);
  }
  geometry.morphAttributes.position = targets;
  geometry.morphTargetsRelative = true;
  geometry.userData.facialMorphEvidence = {
    schema: 'morphloom.facial-morphs/0.1',
    names: [...REQUIRED_FACIAL_MORPH_NAMES],
    affectedVertices: affected.size,
    maximumDisplacementMm,
    nonZeroTargets,
  } satisfies FacialMorphReport;
  return structuredClone(geometry.userData.facialMorphEvidence as FacialMorphReport);
}
