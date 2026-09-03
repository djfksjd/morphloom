import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { Canvas, ImageData } from '@napi-rs/canvas';
import type * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { AssemblyIR } from '../../src/engine/assembly-ir';
import {
  applyAssemblyComponentPatch,
  fingerprintAssemblyIR,
  type AssemblyComponentPatch,
  type AssemblyEditReceipt,
} from '../../src/engine/assembly-edit';
import { compileAssemblyIR, validateAssemblyIR, waitForReferenceProjections } from '../../src/engine/assembly-compiler';
import { attachEvidenceReadinessToAssembly, type SemiProfessionalEvidencePack } from '../../src/engine/evidence-readiness';
import { auditAssemblyEvidenceClaims, type EvidenceClaimAudit } from '../../src/engine/evidence-claim-audit';
import { auditAssemblyDetail, type AssemblyDetailAudit } from '../../src/engine/generation-policy';
import { canonicalizeGlbBufferViews } from '../../src/engine/glb-canonicalization';
import { createPortableGltfExportInput, preparePortableGltfGeometry } from '../../src/engine/gltf-export-preparation';
import { validateGlbStandard, type GltfStandardValidation } from '../../src/engine/gltf-standard-validation';
import { createModelingRoute, type ModelingRoute } from '../../src/engine/modeling-orchestrator';
import { decodeReferenceImage } from './reference-image-decoder';

export interface MorphloomSourceBinding {
  viewId: string;
  /** Workspace-relative path. Absolute and parent-escaping paths are rejected. */
  path: string;
  sha256: string;
}

export interface MorphloomSourceReceipt {
  viewId: string;
  path: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface MorphloomSourceAudit {
  schema: 'morphloom.source-audit/0.1';
  pass: boolean;
  receipts: MorphloomSourceReceipt[];
  blockers: string[];
}

export interface MorphloomJob {
  schema: 'morphloom.job/0.1';
  id: string;
  request: string;
  target: 'review' | 'delivery';
  sources: MorphloomSourceBinding[];
  evidencePack: SemiProfessionalEvidencePack;
  assembly: AssemblyIR;
  patches?: AssemblyComponentPatch[];
}

export interface MorphloomJobInspection {
  schema: 'morphloom.job-inspection/0.1';
  jobId: string;
  target: MorphloomJob['target'];
  assemblyFingerprint: string;
  sourceAudit: MorphloomSourceAudit;
  evidenceAudit: EvidenceClaimAudit;
  route: ModelingRoute;
  detailAudit: AssemblyDetailAudit;
  patchReceipts: AssemblyEditReceipt[];
  releaseAllowed: boolean;
  blockers: string[];
}

export interface MorphloomJobResult extends MorphloomJobInspection {
  schema: 'morphloom.job-result/0.1';
  status: 'review-pass' | 'delivery-pass' | 'blocked';
  glb?: Uint8Array;
  glbSha256?: string;
  repeatGlbSha256?: string;
  byteDeterministic?: boolean;
  validation?: GltfStandardValidation;
  metrics?: {
    parts: number;
    triangles: number;
    vertices: number;
    bytes: number;
  };
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const MAX_REQUEST_LENGTH = 8_000;
const MAX_PATCHES = 64;
const MAX_SOURCE_BYTES = 96 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((result) => {
      this.result = result;
      queueMicrotask(() => this.onloadend?.());
    });
  }
}

class NodeOffscreenCanvas extends Canvas {
  toBlob(callback: (blob: Blob) => void, type = 'image/png'): void {
    const format = type === 'image/jpeg' ? 'jpeg' : type === 'image/webp' ? 'webp' : 'png';
    callback(new Blob([new Uint8Array(this.encodeSync(format))], { type }));
  }

  async convertToBlob(options?: { type?: string }): Promise<Blob> {
    const type = options?.type ?? 'image/png';
    const format = type === 'image/jpeg' ? 'jpeg' : type === 'image/webp' ? 'webp' : 'png';
    return new Blob([new Uint8Array(this.encodeSync(format))], { type });
  }
}

let nodeExporterReady = false;

function installNodeExporterRuntime(): void {
  if (nodeExporterReady) return;
  Object.assign(globalThis, { FileReader: NodeFileReader, OffscreenCanvas: NodeOffscreenCanvas, ImageData });
  nodeExporterReady = true;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeJob(job: MorphloomJob): boolean {
  return job?.schema === 'morphloom.job/0.1'
    && SAFE_ID.test(job?.id ?? '')
    && typeof job?.request === 'string'
    && job.request.trim().length > 0
    && job.request.length <= MAX_REQUEST_LENGTH
    && ['review', 'delivery'].includes(job?.target)
    && Array.isArray(job?.sources)
    && job.sources.length > 0
    && job.sources.length <= 24
    && Array.isArray(job?.patches ?? [])
    && (job.patches?.length ?? 0) <= MAX_PATCHES;
}

function assertWorkspaceFile(workspaceRoot: string, requestedPath: string): string {
  if (typeof requestedPath !== 'string' || requestedPath.length < 1 || requestedPath.length > 500
    || requestedPath.includes('\0') || isAbsolute(requestedPath)) {
    throw new Error('Evidence source path must be a bounded workspace-relative path.');
  }
  const root = realpathSync(workspaceRoot);
  const target = resolve(root, requestedPath);
  const relation = relative(root, target);
  if (relation === '' || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new Error(`Evidence source escapes the Morphloom workspace: ${requestedPath}`);
  }
  let cursor = root;
  for (const segment of relation.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    if (!existsSync(cursor)) throw new Error(`Evidence source does not exist: ${requestedPath}`);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Evidence source traverses a symbolic link: ${requestedPath}`);
  }
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.size < 12 || stat.size > MAX_SOURCE_BYTES) {
    throw new Error(`Evidence source is not a bounded regular file: ${requestedPath}`);
  }
  return target;
}

function normalizedImageMime(format: 'png' | 'jpeg' | 'webp'): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

/** Verifies that every Evidence Pack view is bound to the actual immutable local input bytes. */
export async function verifyMorphloomJobSources(job: MorphloomJob, workspaceRoot: string): Promise<MorphloomSourceAudit> {
  const blockers: string[] = [];
  const receipts: MorphloomSourceReceipt[] = [];
  const viewById = new Map(job.evidencePack?.baseManifest?.views?.map((view) => [view.id, view]) ?? []);
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const source of job.sources ?? []) {
    if (!SAFE_ID.test(source?.viewId ?? '') || seen.has(source.viewId) || !SHA256.test(source?.sha256 ?? '')) {
      blockers.push(`unsafe or duplicate source binding: ${source?.viewId ?? 'missing'}`);
      continue;
    }
    seen.add(source.viewId);
    const view = viewById.get(source.viewId);
    if (!view) {
      blockers.push(`source binding ${source.viewId} has no Evidence Pack view`);
      continue;
    }
    try {
      const path = assertWorkspaceFile(workspaceRoot, source.path);
      const bytes = new Uint8Array(readFileSync(path));
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_SOURCE_BYTES) throw new Error('Combined evidence sources exceed 96 MB.');
      const digest = sha256(bytes);
      if (digest !== source.sha256) blockers.push(`source ${source.viewId} SHA-256 mismatch`);
      if (bytes.byteLength !== view.fileSize) blockers.push(`source ${source.viewId} byte-size mismatch`);
      if (basename(source.path) !== view.fileName) blockers.push(`source ${source.viewId} filename mismatch`);
      const receipt: MorphloomSourceReceipt = {
        viewId: source.viewId,
        path: source.path,
        sha256: digest,
        bytes: bytes.byteLength,
        mimeType: view.mimeType,
      };
      if (view.mimeType.startsWith('image/')) {
        const decoded = await decodeReferenceImage(bytes);
        receipt.mimeType = normalizedImageMime(decoded.format);
        receipt.width = decoded.width;
        receipt.height = decoded.height;
        if (receipt.mimeType !== view.mimeType) blockers.push(`source ${source.viewId} MIME mismatch`);
        if (decoded.width !== view.width || decoded.height !== view.height) {
          blockers.push(`source ${source.viewId} decoded dimensions mismatch`);
        }
      }
      receipts.push(receipt);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : `source ${source.viewId} could not be verified`);
    }
  }
  for (const viewId of viewById.keys()) {
    if (!seen.has(viewId)) blockers.push(`Evidence Pack view ${viewId} is not bound to a local source file`);
  }
  return {
    schema: 'morphloom.source-audit/0.1',
    pass: blockers.length === 0 && receipts.length === viewById.size,
    receipts,
    blockers: [...new Set(blockers)],
  };
}

function disposeRoot(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && typeof value === 'object' && 'isTexture' in value && value.isTexture === true) {
          (value as THREE.Texture).dispose();
        }
      }
      material.dispose();
    }
  });
}

async function exportAssembly(assembly: AssemblyIR): Promise<{
  bytes: Uint8Array;
  metrics: MorphloomJobResult['metrics'];
}> {
  installNodeExporterRuntime();
  const build = compileAssemblyIR(assembly, 'beauty');
  try {
    await waitForReferenceProjections(build.root);
    const preparation = preparePortableGltfGeometry(build.root);
    if (preparation.unresolvedNormalMappedMeshes.length > 0) {
      throw new Error(`Portable tangent inputs are unresolved: ${preparation.unresolvedNormalMappedMeshes.join(', ')}`);
    }
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      if (args[0] === 'THREE.GLTFExporter: Merged metalnessMap and roughnessMap textures.') return;
      originalWarn(...args);
    };
    let exported: ArrayBuffer | Record<string, unknown>;
    try {
      exported = await new GLTFExporter().parseAsync(createPortableGltfExportInput(build.root), {
        binary: true,
        onlyVisible: true,
        includeCustomExtensions: true,
        animations: build.root.animations,
      });
    } finally {
      console.warn = originalWarn;
    }
    if (!(exported instanceof ArrayBuffer)) throw new Error('Morphloom job did not produce a binary GLB.');
    const bytes = new Uint8Array(canonicalizeGlbBufferViews(exported));
    return {
      bytes,
      metrics: {
        parts: build.metrics.parts,
        triangles: build.metrics.triangles,
        vertices: build.metrics.vertices,
        bytes: bytes.byteLength,
      },
    };
  } finally {
    disposeRoot(build.root);
  }
}

async function applyPatches(
  assembly: AssemblyIR,
  patches: AssemblyComponentPatch[],
): Promise<{ assembly: AssemblyIR; receipts: AssemblyEditReceipt[] }> {
  let current = structuredClone(assembly);
  const receipts: AssemblyEditReceipt[] = [];
  for (const patch of patches) {
    const result = await applyAssemblyComponentPatch(current, patch);
    current = result.ir;
    receipts.push(result.receipt);
  }
  return { assembly: current, receipts };
}

export async function inspectMorphloomJob(job: MorphloomJob, workspaceRoot = process.cwd()): Promise<{
  inspection: MorphloomJobInspection;
  assembly: AssemblyIR;
}> {
  if (!safeJob(job)) throw new Error('Morphloom job envelope is unsafe.');
  const sourceAudit = await verifyMorphloomJobSources(job, workspaceRoot);
  validateAssemblyIR(job.assembly);
  const patched = await applyPatches(job.assembly, job.patches ?? []);
  validateAssemblyIR(patched.assembly);
  const evidenceAudit = auditAssemblyEvidenceClaims(patched.assembly, job.evidencePack);
  const authoritativeAssembly = attachEvidenceReadinessToAssembly(
    patched.assembly,
    evidenceAudit.recomputedReadiness,
  );
  const route = createModelingRoute(job.request, evidenceAudit.recomputedReadiness);
  const detailAudit = auditAssemblyDetail(authoritativeAssembly);
  const blockers = [
    ...sourceAudit.blockers,
    ...evidenceAudit.blockers,
    ...(!route.buildAllowed ? route.blockers : []),
    ...(job.target === 'delivery' && !route.deliveryAllowed ? route.blockers : []),
    ...(job.target === 'delivery' ? detailAudit.blockers : []),
  ];
  const releaseAllowed = job.target === 'delivery'
    && evidenceAudit.pass
    && route.deliveryAllowed
    && detailAudit.pass;
  return {
    assembly: authoritativeAssembly,
    inspection: {
      schema: 'morphloom.job-inspection/0.1',
      jobId: job.id,
      target: job.target,
      assemblyFingerprint: await fingerprintAssemblyIR(authoritativeAssembly),
      sourceAudit,
      evidenceAudit,
      route,
      detailAudit,
      patchReceipts: patched.receipts,
      releaseAllowed,
      blockers: [...new Set(blockers)],
    },
  };
}

export async function runMorphloomJob(job: MorphloomJob, workspaceRoot = process.cwd()): Promise<MorphloomJobResult> {
  const { inspection, assembly } = await inspectMorphloomJob(job, workspaceRoot);
  if (!inspection.evidenceAudit.pass || !inspection.route.buildAllowed
    || !inspection.sourceAudit.pass
    || (job.target === 'delivery' && !inspection.releaseAllowed)) {
    return { ...inspection, schema: 'morphloom.job-result/0.1', status: 'blocked' };
  }

  const first = await exportAssembly(assembly);
  const validation = await validateGlbStandard(
    first.bytes.buffer.slice(first.bytes.byteOffset, first.bytes.byteOffset + first.bytes.byteLength),
  );
  const second = await exportAssembly(assembly);
  const glbSha256 = sha256(first.bytes);
  const repeatGlbSha256 = sha256(second.bytes);
  const byteDeterministic = glbSha256 === repeatGlbSha256;
  const validationPass = validation.status === 'pass';
  const blockers = [...inspection.blockers];
  if (!validationPass) blockers.push(`exact GLB validation ${validation.status}: ${validation.issueCodes.join(', ') || 'unknown issue'}`);
  if (!byteDeterministic) blockers.push('same AssemblyIR produced byte-different GLBs');
  const passed = validationPass && byteDeterministic;
  return {
    ...inspection,
    schema: 'morphloom.job-result/0.1',
    status: passed ? (job.target === 'delivery' ? 'delivery-pass' : 'review-pass') : 'blocked',
    glb: passed ? first.bytes : undefined,
    glbSha256,
    repeatGlbSha256,
    byteDeterministic,
    validation,
    metrics: first.metrics,
    releaseAllowed: passed && inspection.releaseAllowed,
    blockers: [...new Set(blockers)],
  };
}
