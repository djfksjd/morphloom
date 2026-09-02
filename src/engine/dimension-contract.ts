import * as THREE from 'three';

export type DimensionAxis = 'x' | 'y' | 'z';
export type DimensionMeasurement = 'size' | 'min' | 'max' | 'center';

export interface DimensionContract {
  id: string;
  label: string;
  target:
    | { kind: 'assembly' }
    | { kind: 'component'; componentId: string };
  axis: DimensionAxis;
  measurement: DimensionMeasurement;
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
  expectedMm: number;
  actualMm: number | null;
  deviationMm: number | null;
  toleranceMm: number;
  pass: boolean;
  evidence: DimensionContract['evidence'];
}

export interface DimensionAudit {
  schema: 'morphloom.dimension-audit/0.1';
  pass: boolean;
  checks: DimensionAuditCheck[];
  blockers: string[];
}

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

export function validateDimensionContracts(
  contracts: readonly DimensionContract[],
  componentIds: ReadonlySet<string>,
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
    if (!['x', 'y', 'z'].includes(contract.axis)
      || !['size', 'min', 'max', 'center'].includes(contract.measurement)) {
      throw new Error(`Invalid dimension axis or measurement in ${contract.id}.`);
    }
    if (!Number.isFinite(contract.expectedMm) || Math.abs(contract.expectedMm) > 1_000_000
      || (contract.measurement === 'size' && contract.expectedMm <= 0)
      || !Number.isFinite(contract.toleranceMm) || contract.toleranceMm < 0 || contract.toleranceMm > 100_000) {
      throw new Error(`Invalid expected value or tolerance in ${contract.id}.`);
    }
    if (!contract.target || !['assembly', 'component'].includes(contract.target.kind)) {
      throw new Error(`Invalid dimension target in ${contract.id}.`);
    }
    if (contract.target.kind === 'component'
      && (!ID_PATTERN.test(contract.target.componentId) || !componentIds.has(contract.target.componentId))) {
      throw new Error(`Dimension contract ${contract.id} references a missing component.`);
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

function measuredValue(box: THREE.Box3, axis: DimensionAxis, measurement: DimensionMeasurement): number {
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const minimum = box.min.getComponent(index) * 1_000;
  const maximum = box.max.getComponent(index) * 1_000;
  if (measurement === 'min') return minimum;
  if (measurement === 'max') return maximum;
  if (measurement === 'center') return (minimum + maximum) / 2;
  return maximum - minimum;
}

export function auditDimensionContracts(
  root: THREE.Object3D,
  contracts: readonly DimensionContract[],
): DimensionAudit {
  root.updateMatrixWorld(true);
  const checks = contracts.map<DimensionAuditCheck>((contract) => {
    const componentId = contract.target.kind === 'component' ? contract.target.componentId : undefined;
    const target = componentId === undefined
      ? root
      : root.children.find((object) => object.userData.part?.id === componentId);
    const box = target ? new THREE.Box3().setFromObject(target) : undefined;
    const valid = box !== undefined && !box.isEmpty()
      && [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite);
    const actualMm = valid ? measuredValue(box, contract.axis, contract.measurement) : null;
    const deviationMm = actualMm === null ? null : Math.abs(actualMm - contract.expectedMm);
    return {
      ...structuredClone(contract),
      actualMm,
      deviationMm,
      pass: deviationMm !== null && deviationMm <= contract.toleranceMm + 1e-6,
    };
  });
  const blockers = checks.filter((check) => !check.pass).map((check) => (
    check.actualMm === null
      ? `${check.id}: target has no finite compiled bounds`
      : `${check.id}: expected ${check.expectedMm.toFixed(3)}±${check.toleranceMm.toFixed(3)} mm, actual ${check.actualMm.toFixed(3)} mm`
  ));
  return {
    schema: 'morphloom.dimension-audit/0.1',
    pass: blockers.length === 0,
    checks,
    blockers,
  };
}
