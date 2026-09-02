import * as THREE from 'three';

export type DimensionAxis = 'x' | 'y' | 'z' | 'spatial';
export type DimensionMeasurement = 'size' | 'min' | 'max' | 'center' | 'distance';
export type DimensionSpace = 'world' | 'component-local';
export interface DimensionAnchorRef {
  componentId: string;
  anchorId: string;
}

export type DimensionTarget =
  | { kind: 'assembly' }
  | { kind: 'component'; componentId: string }
  | { kind: 'anchorPair'; from: DimensionAnchorRef; to: DimensionAnchorRef };

export interface DimensionContract {
  id: string;
  label: string;
  target: DimensionTarget;
  axis: DimensionAxis;
  measurement: DimensionMeasurement;
  /** World axes by default; component-local is available for rotated part size. */
  space?: DimensionSpace;
  expectedMm: number;
  toleranceMm: number;
  evidence: {
    status: 'measured' | 'datasheet';
    source: string;
    note?: string;
  };
}

export interface DimensionAuditCheck {
  id: string;
  label: string;
  target: DimensionContract['target'];
  axis: DimensionAxis;
  measurement: DimensionMeasurement;
  space: DimensionSpace;
  expectedMm: number;
  actualMm: number | null;
  deviationMm: number | null;
  toleranceMm: number;
  pass: boolean;
  evidence: DimensionContract['evidence'];
}

export interface DimensionAudit {
  schema: 'morphloom.dimension-audit/0.2';
  pass: boolean;
  checks: DimensionAuditCheck[];
  blockers: string[];
}

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

export function validateDimensionContracts(
  contracts: readonly DimensionContract[],
  componentIds: ReadonlySet<string>,
  anchorIds: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): void {
  if (!Array.isArray(contracts) || contracts.length < 1 || contracts.length > 256) {
    throw new Error('Dimension contracts must contain 1–256 checks.');
  }
  const ids = new Set<string>();
  for (const contract of contracts) {
    if (!contract || !ID_PATTERN.test(contract.id) || ids.has(contract.id)) {
      throw new Error(`Invalid or duplicate dimension contract id: ${contract?.id ?? 'missing'}`);
    }
    ids.add(contract.id);
    if (typeof contract.label !== 'string' || contract.label.trim().length < 1 || contract.label.length > 120) {
      throw new Error(`Invalid dimension contract label in ${contract.id}.`);
    }
    if (!['x', 'y', 'z', 'spatial'].includes(contract.axis)
      || !['size', 'min', 'max', 'center', 'distance'].includes(contract.measurement)) {
      throw new Error(`Invalid dimension axis or measurement in ${contract.id}.`);
    }
    const space = contract.space ?? 'world';
    const validLocalComponent = contract.target?.kind === 'component'
      && contract.measurement === 'size' && contract.axis !== 'spatial';
    const validLocalAnchorPair = contract.target?.kind === 'anchorPair'
      && contract.measurement === 'distance' && contract.axis !== 'spatial'
      && contract.target.from.componentId === contract.target.to.componentId;
    if (!['world', 'component-local'].includes(space)
      || (space === 'component-local' && !validLocalComponent && !validLocalAnchorPair)) {
      throw new Error(`Invalid dimension space in ${contract.id}.`);
    }
    const isAnchorPair = contract.target?.kind === 'anchorPair';
    if ((isAnchorPair && contract.measurement !== 'distance')
      || (!isAnchorPair && (contract.axis === 'spatial' || contract.measurement === 'distance'))) {
      throw new Error(`Dimension target and measurement are incompatible in ${contract.id}.`);
    }
    if (!Number.isFinite(contract.expectedMm) || Math.abs(contract.expectedMm) > 1_000_000
      || (['size', 'distance'].includes(contract.measurement) && contract.expectedMm <= 0)
      || !Number.isFinite(contract.toleranceMm) || contract.toleranceMm < 0 || contract.toleranceMm > 100_000) {
      throw new Error(`Invalid expected value or tolerance in ${contract.id}.`);
    }
    if (!contract.target || !['assembly', 'component', 'anchorPair'].includes(contract.target.kind)) {
      throw new Error(`Invalid dimension target in ${contract.id}.`);
    }
    if (contract.target.kind === 'component'
      && (!ID_PATTERN.test(contract.target.componentId) || !componentIds.has(contract.target.componentId))) {
      throw new Error(`Dimension contract ${contract.id} references a missing component.`);
    }
    if (contract.target.kind === 'anchorPair') {
      for (const ref of [contract.target.from, contract.target.to]) {
        if (!ref || !ID_PATTERN.test(ref.componentId) || !componentIds.has(ref.componentId)
          || !ID_PATTERN.test(ref.anchorId) || !anchorIds.get(ref.componentId)?.has(ref.anchorId)) {
          throw new Error(`Dimension contract ${contract.id} references a missing anchor.`);
        }
      }
      if (contract.target.from.componentId === contract.target.to.componentId
        && contract.target.from.anchorId === contract.target.to.anchorId) {
        throw new Error(`Dimension contract ${contract.id} must reference two distinct anchors.`);
      }
    }
    if (!contract.evidence || !['measured', 'datasheet'].includes(contract.evidence.status)
      || typeof contract.evidence.source !== 'string' || contract.evidence.source.trim().length < 1
      || contract.evidence.source.length > 500
      || (contract.evidence.note !== undefined
        && (typeof contract.evidence.note !== 'string' || contract.evidence.note.length > 500))) {
      throw new Error(`Invalid dimension evidence in ${contract.id}.`);
    }
  }
}

function measuredValue(
  box: THREE.Box3,
  axis: Exclude<DimensionAxis, 'spatial'>,
  measurement: Exclude<DimensionMeasurement, 'distance'>,
): number {
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const minimum = box.min.getComponent(index) * 1_000;
  const maximum = box.max.getComponent(index) * 1_000;
  if (measurement === 'min') return minimum;
  if (measurement === 'max') return maximum;
  if (measurement === 'center') return (minimum + maximum) / 2;
  return maximum - minimum;
}

function resolveAnchor(root: THREE.Object3D, ref: DimensionAnchorRef): THREE.Vector3 | null {
  const component = root.children.find((object) => object.userData.part?.id === ref.componentId);
  if (!(component instanceof THREE.Mesh)) return null;
  const anchors = component.userData.dimensionAnchors;
  if (!Array.isArray(anchors)) return null;
  const anchor = anchors.find((candidate) => candidate?.id === ref.anchorId);
  if (!anchor || !Array.isArray(anchor.position) || anchor.position.length !== 3
    || anchor.position.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value))) return null;
  const localPoint = new THREE.Vector3(
    anchor.position[0] / 1_000,
    anchor.position[1] / 1_000,
    anchor.position[2] / 1_000,
  );
  component.geometry.computeBoundingBox();
  const localBounds = component.geometry.boundingBox;
  if (!localBounds || !localBounds.clone().expandByScalar(1e-6).containsPoint(localPoint)) return null;
  return component.localToWorld(localPoint);
}

function anchorDistanceMm(
  root: THREE.Object3D,
  target: Extract<DimensionTarget, { kind: 'anchorPair' }>,
  axis: DimensionAxis,
  space: DimensionSpace,
): number | null {
  const from = resolveAnchor(root, target.from);
  const to = resolveAnchor(root, target.to);
  if (!from || !to) return null;
  if (axis === 'spatial') return from.distanceTo(to) * 1_000;
  if (space === 'component-local') {
    const component = root.children.find((object) => object.userData.part?.id === target.from.componentId);
    if (!component || target.from.componentId !== target.to.componentId) return null;
    const xBasis = new THREE.Vector3();
    const yBasis = new THREE.Vector3();
    const zBasis = new THREE.Vector3();
    component.matrixWorld.extractBasis(xBasis, yBasis, zBasis);
    const basis = axis === 'x' ? xBasis : axis === 'y' ? yBasis : zBasis;
    if (basis.lengthSq() <= 1e-20) return null;
    return Math.abs(to.clone().sub(from).dot(basis.normalize())) * 1_000;
  }
  return Math.abs(to[axis] - from[axis]) * 1_000;
}

function componentLocalSizeMm(component: THREE.Mesh, axis: Exclude<DimensionAxis, 'spatial'>): number | null {
  component.geometry.computeBoundingBox();
  const box = component.geometry.boundingBox;
  if (!box || box.isEmpty()) return null;
  const localSize = box.getSize(new THREE.Vector3());
  const worldScale = component.getWorldScale(new THREE.Vector3());
  const size = localSize[axis] * Math.abs(worldScale[axis]) * 1_000;
  return Number.isFinite(size) ? size : null;
}

export function auditDimensionContracts(
  root: THREE.Object3D,
  contracts: readonly DimensionContract[],
): DimensionAudit {
  root.updateMatrixWorld(true);
  const checks = contracts.map<DimensionAuditCheck>((contract) => {
    const space = contract.space ?? 'world';
    let actualMm: number | null = null;
    if (contract.target.kind === 'anchorPair') {
      actualMm = anchorDistanceMm(root, contract.target, contract.axis, space);
    } else {
      const componentId = contract.target.kind === 'component' ? contract.target.componentId : undefined;
      const target = componentId === undefined
        ? root
        : root.children.find((object) => object.userData.part?.id === componentId);
      if (space === 'component-local' && target instanceof THREE.Mesh) {
        actualMm = componentLocalSizeMm(target, contract.axis as Exclude<DimensionAxis, 'spatial'>);
      } else {
        const box = target ? new THREE.Box3().setFromObject(target) : undefined;
        const valid = box !== undefined && !box.isEmpty()
          && [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite);
        actualMm = valid
          ? measuredValue(
            box,
            contract.axis as Exclude<DimensionAxis, 'spatial'>,
            contract.measurement as Exclude<DimensionMeasurement, 'distance'>,
          )
          : null;
      }
    }
    const deviationMm = actualMm === null ? null : Math.abs(actualMm - contract.expectedMm);
    return {
      ...structuredClone(contract),
      space,
      actualMm,
      deviationMm,
      pass: deviationMm !== null && deviationMm <= contract.toleranceMm + 1e-6,
    };
  });
  const blockers = checks.filter((check) => !check.pass).map((check) => (
    check.actualMm === null
      ? check.target.kind === 'anchorPair'
        ? `${check.id}: anchor pair is missing or outside compiled part bounds`
        : `${check.id}: target has no finite compiled bounds`
      : `${check.id}: expected ${check.expectedMm.toFixed(3)}±${check.toleranceMm.toFixed(3)} mm, actual ${check.actualMm.toFixed(3)} mm`
  ));
  return {
    schema: 'morphloom.dimension-audit/0.2',
    pass: blockers.length === 0,
    checks,
    blockers,
  };
}
