import type { AssemblyGeometryIR, AssemblyIR, AssemblyMaterialIR } from './assembly-ir';

type Vector3 = [number, number, number];

export interface AssemblyComponentPatch {
  schema: 'morphloom.component-patch/0.1';
  operationId: string;
  componentId: string;
  expectedInputFingerprint: string;
  translateMm?: Vector3;
  rotateRadians?: Vector3;
  scaleMultiplier?: Vector3;
  geometry?: {
    operation: 'tube-point-deltas';
    deltas: Array<{ pointIndex: number; deltaMm: Vector3 }>;
  };
  material?: Partial<Pick<AssemblyMaterialIR,
    | 'color' | 'roughness' | 'metalness' | 'transmission' | 'clearcoat'
    | 'clearcoatRoughness' | 'ior' | 'anisotropy' | 'anisotropyRotation'
    | 'sheen' | 'sheenRoughness' | 'specularIntensity' | 'microNormalStrength'>>;
}

export interface AssemblyEditReceipt {
  schema: 'morphloom.component-edit-receipt/0.1';
  operationId: string;
  componentId: string;
  inputFingerprint: string;
  outputFingerprint: string;
  unaffectedInputFingerprint: string;
  unaffectedOutputFingerprint: string;
  unaffectedComponentsPreserved: boolean;
  changedFields: string[];
}

export interface AssemblyComponentBatchPatch {
  schema: 'morphloom.component-batch-patch/0.1';
  operationId: string;
  expectedInputFingerprint: string;
  edits: Array<Omit<AssemblyComponentPatch, 'schema' | 'operationId' | 'expectedInputFingerprint'>>;
}

export interface AssemblyBatchEditReceipt {
  schema: 'morphloom.component-batch-edit-receipt/0.1';
  operationId: string;
  inputFingerprint: string;
  outputFingerprint: string;
  editedComponentIds: string[];
  unaffectedInputFingerprint: string;
  unaffectedOutputFingerprint: string;
  unaffectedComponentsPreserved: boolean;
  componentReceipts: AssemblyEditReceipt[];
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonical(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function fingerprintAssemblyIR(ir: AssemblyIR): Promise<string> {
  return fingerprint(ir);
}

function finiteVector(value: Vector3 | undefined, minimum: number, maximum: number): boolean {
  return value === undefined || (
    value.length === 3
    && value.every((item) => Number.isFinite(item) && item >= minimum && item <= maximum)
  );
}

function validMaterialPatch(material: AssemblyComponentPatch['material']): boolean {
  if (!material) return true;
  const entries = Object.entries(material);
  if (entries.length < 1 || entries.length > 16) return false;
  return entries.every(([key, value]) => {
    if (key === 'color') return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (key === 'ior') return value >= 1 && value <= 2.5;
    if (key === 'anisotropyRotation') return value >= -Math.PI * 2 && value <= Math.PI * 2;
    return value >= 0 && value <= 1;
  });
}

function validGeometryPatch(geometry: AssemblyComponentPatch['geometry']): boolean {
  if (!geometry) return true;
  return geometry.operation === 'tube-point-deltas'
    && Array.isArray(geometry.deltas) && geometry.deltas.length >= 1 && geometry.deltas.length <= 16
    && new Set(geometry.deltas.map((delta) => delta?.pointIndex)).size === geometry.deltas.length
    && geometry.deltas.every((delta) => Number.isInteger(delta?.pointIndex)
      && delta.pointIndex >= 0 && delta.pointIndex <= 4_096
      && finiteVector(delta.deltaMm, -10_000, 10_000));
}

function applyGeometryPatch(
  source: AssemblyGeometryIR,
  patch: NonNullable<AssemblyComponentPatch['geometry']>,
): AssemblyGeometryIR {
  if (patch.operation !== 'tube-point-deltas' || source.op !== 'tube') {
    throw new Error(`Geometry patch ${patch.operation} is incompatible with ${source.op}.`);
  }
  if (patch.deltas.some((delta) => delta.pointIndex >= source.points.length)) {
    throw new Error('Geometry patch references a missing tube point.');
  }
  const deltaByIndex = new Map(patch.deltas.map((delta) => [delta.pointIndex, delta.deltaMm]));
  return {
    ...source,
    points: source.points.map((point, pointIndex) => {
      const delta = deltaByIndex.get(pointIndex);
      return delta ? addVector(point, delta) : [...point];
    }),
  };
}

function addVector(source: Vector3 | undefined, delta: Vector3): Vector3 {
  const start = source ?? [0, 0, 0];
  return [start[0] + delta[0], start[1] + delta[1], start[2] + delta[2]];
}

function multiplyVector(source: Vector3 | undefined, multiplier: Vector3): Vector3 {
  const start = source ?? [1, 1, 1];
  return [start[0] * multiplier[0], start[1] * multiplier[1], start[2] * multiplier[2]];
}

export async function applyAssemblyComponentPatch(
  ir: AssemblyIR,
  patch: AssemblyComponentPatch,
): Promise<{ ir: AssemblyIR; receipt: AssemblyEditReceipt }> {
  if (patch.schema !== 'morphloom.component-patch/0.1'
    || !SAFE_ID.test(patch.operationId) || !SAFE_ID.test(patch.componentId)
    || !SHA256.test(patch.expectedInputFingerprint)
    || !finiteVector(patch.translateMm, -100_000, 100_000)
    || !finiteVector(patch.rotateRadians, -Math.PI * 2, Math.PI * 2)
    || !finiteVector(patch.scaleMultiplier, 0.01, 100)
    || !validGeometryPatch(patch.geometry)
    || !validMaterialPatch(patch.material)) {
    throw new Error('Component patch is unsafe.');
  }
  const changedFields = [
    patch.translateMm && 'position', patch.rotateRadians && 'rotation',
    patch.scaleMultiplier && 'scale', patch.material && 'material',
    patch.geometry && 'geometry',
  ].filter((value): value is string => Boolean(value));
  if (changedFields.length < 1) throw new Error('Component patch has no edit operation.');
  const inputFingerprint = await fingerprintAssemblyIR(ir);
  if (inputFingerprint !== patch.expectedInputFingerprint) throw new Error('Component patch targets a stale AssemblyIR fingerprint.');
  const targetIndex = ir.components.findIndex((component) => component.id === patch.componentId);
  if (targetIndex < 0) throw new Error(`Component patch target does not exist: ${patch.componentId}`);
  const unaffectedBefore = ir.components.filter((_, index) => index !== targetIndex);
  const target = ir.components[targetIndex]!;
  const edited = {
    ...target,
    ...(patch.translateMm ? { position: addVector(target.position, patch.translateMm) } : {}),
    ...(patch.rotateRadians ? { rotation: addVector(target.rotation, patch.rotateRadians) } : {}),
    ...(patch.scaleMultiplier ? { scale: multiplyVector(target.scale, patch.scaleMultiplier) } : {}),
    ...(patch.material ? { material: { ...target.material, ...patch.material } } : {}),
    ...(patch.geometry ? { geometry: applyGeometryPatch(target.geometry, patch.geometry) } : {}),
  };
  const components = [...ir.components];
  components[targetIndex] = edited;
  const result: AssemblyIR = { ...ir, components };
  const unaffectedAfter = result.components.filter((_, index) => index !== targetIndex);
  const unaffectedInputFingerprint = await fingerprint(unaffectedBefore);
  const unaffectedOutputFingerprint = await fingerprint(unaffectedAfter);
  const receipt: AssemblyEditReceipt = {
    schema: 'morphloom.component-edit-receipt/0.1',
    operationId: patch.operationId,
    componentId: patch.componentId,
    inputFingerprint,
    outputFingerprint: await fingerprintAssemblyIR(result),
    unaffectedInputFingerprint,
    unaffectedOutputFingerprint,
    unaffectedComponentsPreserved: unaffectedInputFingerprint === unaffectedOutputFingerprint,
    changedFields,
  };
  if (!receipt.unaffectedComponentsPreserved || receipt.outputFingerprint === inputFingerprint) {
    throw new Error('Component patch did not produce an isolated edit.');
  }
  return { ir: result, receipt };
}

/**
 * Applies a bounded set of isolated edits atomically. The source object is
 * never mutated, duplicate targets are rejected, and every component outside
 * the declared target set is fingerprinted before and after the batch.
 */
export async function applyAssemblyComponentBatchPatch(
  ir: AssemblyIR,
  batch: AssemblyComponentBatchPatch,
): Promise<{ ir: AssemblyIR; receipt: AssemblyBatchEditReceipt }> {
  if (batch?.schema !== 'morphloom.component-batch-patch/0.1'
    || !SAFE_ID.test(batch?.operationId ?? '')
    || !SHA256.test(batch?.expectedInputFingerprint ?? '')
    || !Array.isArray(batch?.edits) || batch.edits.length < 1 || batch.edits.length > 64) {
    throw new Error('Component batch patch is unsafe.');
  }
  const sourceFingerprint = await fingerprintAssemblyIR(ir);
  if (sourceFingerprint !== batch.expectedInputFingerprint) {
    throw new Error('Component batch patch targets a stale AssemblyIR fingerprint.');
  }
  const editedComponentIds = batch.edits.map((edit) => edit?.componentId);
  if (editedComponentIds.some((id) => !SAFE_ID.test(id ?? ''))
    || new Set(editedComponentIds).size !== editedComponentIds.length) {
    throw new Error('Component batch patch targets are invalid or duplicated.');
  }
  const editedIdSet = new Set(editedComponentIds);
  const unaffectedBefore = ir.components.filter((component) => !editedIdSet.has(component.id));
  let result = ir;
  let currentFingerprint = sourceFingerprint;
  const componentReceipts: AssemblyEditReceipt[] = [];
  for (let index = 0; index < batch.edits.length; index += 1) {
    const edit = batch.edits[index]!;
    const applied = await applyAssemblyComponentPatch(result, {
      schema: 'morphloom.component-patch/0.1',
      operationId: `${batch.operationId}:${index + 1}`,
      expectedInputFingerprint: currentFingerprint,
      ...edit,
    });
    result = applied.ir;
    currentFingerprint = applied.receipt.outputFingerprint;
    componentReceipts.push(applied.receipt);
  }
  const unaffectedAfter = result.components.filter((component) => !editedIdSet.has(component.id));
  const unaffectedInputFingerprint = await fingerprint(unaffectedBefore);
  const unaffectedOutputFingerprint = await fingerprint(unaffectedAfter);
  const receipt: AssemblyBatchEditReceipt = {
    schema: 'morphloom.component-batch-edit-receipt/0.1',
    operationId: batch.operationId,
    inputFingerprint: sourceFingerprint,
    outputFingerprint: currentFingerprint,
    editedComponentIds: [...editedComponentIds].sort(),
    unaffectedInputFingerprint,
    unaffectedOutputFingerprint,
    unaffectedComponentsPreserved: unaffectedInputFingerprint === unaffectedOutputFingerprint,
    componentReceipts,
  };
  if (!receipt.unaffectedComponentsPreserved || receipt.outputFingerprint === receipt.inputFingerprint) {
    throw new Error('Component batch patch did not produce an isolated edit.');
  }
  return { ir: result, receipt };
}
