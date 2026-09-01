import * as THREE from 'three';

export interface LodQualityAudit {
  pass: boolean;
  lodMeshes: number;
  triangleRatio: number;
  monotonicTriangleReduction: boolean;
  skinWeightCoverage: number;
  skeletonCoverage: number;
  neutralBoundsError: number;
  neutralSilhouetteEnvelopeError: number;
  posedBoundsError: number;
  posedSilhouetteEnvelopeError: number;
}

interface MeshSample {
  points: THREE.Vector3[];
  triangles: number;
}

function collectPoints(mesh: THREE.SkinnedMesh, deformed: boolean): MeshSample {
  const position = mesh.geometry.getAttribute('position');
  const points: THREE.Vector3[] = [];
  const point = new THREE.Vector3();
  if (!position) return { points, triangles: 0 };
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    if (deformed) mesh.applyBoneTransform(index, point);
    point.applyMatrix4(mesh.matrixWorld);
    if (![point.x, point.y, point.z].every(Number.isFinite)) return { points: [], triangles: 0 };
    points.push(point.clone());
  }
  const index = mesh.geometry.getIndex();
  return { points, triangles: (index?.count ?? position.count) / 3 };
}

function boundsError(reference: THREE.Vector3[], candidate: THREE.Vector3[]): number {
  if (reference.length === 0 || candidate.length === 0) return 1;
  const referenceBounds = new THREE.Box3().setFromPoints(reference);
  const candidateBounds = new THREE.Box3().setFromPoints(candidate);
  const referenceSize = referenceBounds.getSize(new THREE.Vector3());
  const candidateSize = candidateBounds.getSize(new THREE.Vector3());
  const referenceCenter = referenceBounds.getCenter(new THREE.Vector3());
  const candidateCenter = candidateBounds.getCenter(new THREE.Vector3());
  const diagonal = Math.max(referenceSize.length(), 1e-9);
  return Math.max(
    referenceSize.distanceTo(candidateSize) / diagonal,
    referenceCenter.distanceTo(candidateCenter) / diagonal,
  );
}

function silhouetteEnvelopeError(reference: THREE.Vector3[], candidate: THREE.Vector3[]): number {
  if (reference.length === 0 || candidate.length === 0) return 1;
  const referenceBounds = new THREE.Box3().setFromPoints(reference);
  const referenceSize = referenceBounds.getSize(new THREE.Vector3());
  const diagonal = Math.max(referenceSize.length(), 1e-9);
  const axes: Array<['x' | 'y' | 'z', 'x' | 'y' | 'z', 'x' | 'y' | 'z']> = [
    ['x', 'y', 'z'], ['y', 'x', 'z'], ['z', 'x', 'y'],
  ];
  let squaredError = 0;
  let samples = 0;
  const bins = 32;
  for (const [sliceAxis, firstAxis, secondAxis] of axes) {
    const minimum = referenceBounds.min[sliceAxis];
    const span = Math.max(referenceSize[sliceAxis], 1e-9);
    const envelopes = (points: THREE.Vector3[]) => {
      const result = Array.from({ length: bins }, () => [
        Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
        Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
      ]);
      for (const point of points) {
        const bin = THREE.MathUtils.clamp(Math.floor((point[sliceAxis] - minimum) / span * bins), 0, bins - 1);
        const envelope = result[bin]!;
        envelope[0] = Math.min(envelope[0]!, point[firstAxis]);
        envelope[1] = Math.max(envelope[1]!, point[firstAxis]);
        envelope[2] = Math.min(envelope[2]!, point[secondAxis]);
        envelope[3] = Math.max(envelope[3]!, point[secondAxis]);
      }
      return result;
    };
    const source = envelopes(reference);
    const target = envelopes(candidate);
    for (let bin = 0; bin < bins; bin += 1) {
      const sourceEnvelope = source[bin]!;
      const targetEnvelope = target[bin]!;
      const sourceOccupied = Number.isFinite(sourceEnvelope[0]);
      const targetOccupied = Number.isFinite(targetEnvelope[0]);
      if (!sourceOccupied && !targetOccupied) continue;
      if (!sourceOccupied || !targetOccupied) {
        squaredError += 1;
        samples += 1;
        continue;
      }
      for (let edge = 0; edge < 4; edge += 1) {
        const error = (sourceEnvelope[edge]! - targetEnvelope[edge]!) / diagonal;
        squaredError += error * error;
        samples += 1;
      }
    }
  }
  return Math.sqrt(squaredError / Math.max(1, samples));
}

function inspectSkin(mesh: THREE.SkinnedMesh): { weightCoverage: number; skeletonCoverage: number } {
  const position = mesh.geometry.getAttribute('position');
  const weights = mesh.geometry.getAttribute('skinWeight');
  const indices = mesh.geometry.getAttribute('skinIndex');
  if (!position || position.count === 0 || !weights || !indices || weights.count !== position.count || indices.count !== position.count
    || weights.itemSize !== 4 || indices.itemSize !== 4) return { weightCoverage: 0, skeletonCoverage: 0 };
  let validWeights = 0;
  let validSkeleton = 0;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    let sum = 0;
    let indicesValid = true;
    for (let slot = 0; slot < 4; slot += 1) {
      const weight = weights.getComponent(vertex, slot);
      const bone = indices.getComponent(vertex, slot);
      if (!Number.isFinite(weight) || weight < 0) sum = Number.NaN;
      else sum += weight;
      if (!Number.isInteger(bone) || bone < 0 || bone >= mesh.skeleton.bones.length) indicesValid = false;
    }
    if (Number.isFinite(sum) && Math.abs(sum - 1) <= 1e-3) validWeights += 1;
    if (indicesValid) validSkeleton += 1;
  }
  return {
    weightCoverage: validWeights / position.count,
    skeletonCoverage: validSkeleton / position.count,
  };
}

export function auditSkinnedLodQuality(root: THREE.Object3D): LodQualityAudit {
  const bases: THREE.SkinnedMesh[] = [];
  const lods: THREE.SkinnedMesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    if (object.userData.morphloomDeliveryRole === 'lod') lods.push(object);
    else bases.push(object);
  });
  const base = bases.sort((left, right) => (
    (right.geometry.getIndex()?.count ?? right.geometry.getAttribute('position')?.count ?? 0)
    - (left.geometry.getIndex()?.count ?? left.geometry.getAttribute('position')?.count ?? 0)
  ))[0];
  const lod = lods.sort((left, right) => Number(left.userData.lodLevel) - Number(right.userData.lodLevel))[0];
  if (!base || !lod) return {
    pass: false, lodMeshes: lods.length, triangleRatio: 1, monotonicTriangleReduction: false,
    skinWeightCoverage: 0, skeletonCoverage: 0,
    neutralBoundsError: 1, neutralSilhouetteEnvelopeError: 1,
    posedBoundsError: 1, posedSilhouetteEnvelopeError: 1,
  };

  root.updateMatrixWorld(true);
  base.skeleton.update();
  lods.forEach((candidate) => candidate.skeleton.update());
  const baseNeutral = collectPoints(base, true);
  const lodNeutral = lods.map((candidate) => collectPoints(candidate, true));
  const skins = lods.map(inspectSkin);
  const elbow = base.skeleton.bones.find((bone) => bone.name === 'elbow_L');
  let posedBoundsErrors = lods.map(() => 1);
  let posedSilhouetteEnvelopeErrors = lods.map(() => 1);
  if (elbow) {
    const original = elbow.quaternion.clone();
    try {
      elbow.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.35)));
      root.updateMatrixWorld(true);
      base.skeleton.update();
      lods.forEach((candidate) => candidate.skeleton.update());
      const basePosed = collectPoints(base, true).points;
      const lodPosed = lods.map((candidate) => collectPoints(candidate, true).points);
      posedBoundsErrors = lodPosed.map((points) => boundsError(basePosed, points));
      posedSilhouetteEnvelopeErrors = lodPosed.map((points) => silhouetteEnvelopeError(basePosed, points));
    } finally {
      elbow.quaternion.copy(original);
      root.updateMatrixWorld(true);
      base.skeleton.update();
      lods.forEach((candidate) => candidate.skeleton.update());
    }
  }
  const triangleRatios = lodNeutral.map((sample) => sample.triangles / Math.max(1, baseNeutral.triangles));
  const triangleRatio = triangleRatios[0] ?? 1;
  const monotonicTriangleReduction = triangleRatios.every((ratio, index) => (
    ratio > 0 && ratio < (index === 0 ? 1 : triangleRatios[index - 1]!)
  ));
  const skinWeightCoverage = Math.min(...skins.map((skin) => skin.weightCoverage));
  const skeletonCoverage = Math.min(...skins.map((skin) => skin.skeletonCoverage));
  const neutralBoundsError = Math.max(...lodNeutral.map((sample) => boundsError(baseNeutral.points, sample.points)));
  const neutralSilhouetteEnvelopeError = Math.max(...lodNeutral.map((sample) => silhouetteEnvelopeError(baseNeutral.points, sample.points)));
  const posedBoundsError = Math.max(...posedBoundsErrors);
  const posedSilhouetteEnvelopeError = Math.max(...posedSilhouetteEnvelopeErrors);
  const pass = triangleRatio >= 0.1 && triangleRatio <= 0.85 && monotonicTriangleReduction
    && skinWeightCoverage === 1 && skeletonCoverage === 1
    && neutralBoundsError <= 0.03 && neutralSilhouetteEnvelopeError <= 0.012
    && posedBoundsError <= 0.04 && posedSilhouetteEnvelopeError <= 0.016;
  return {
    pass,
    lodMeshes: lods.length,
    triangleRatio,
    monotonicTriangleReduction,
    skinWeightCoverage,
    skeletonCoverage,
    neutralBoundsError,
    neutralSilhouetteEnvelopeError,
    posedBoundsError,
    posedSilhouetteEnvelopeError,
  };
}
