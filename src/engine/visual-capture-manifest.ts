import type { MaterialExpectation } from './material-comparison';
import type { ComparisonRegion } from './reference-comparison';
import type { BlindVisualRating, VisualBenchmarkDomain } from './visual-benchmark';

export interface CameraCalibrationManifest {
  projection: 'perspective' | 'orthographic';
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fovDegrees?: number;
  orthographicHeight?: number;
}

export interface VisualCaptureSetViewManifest {
  viewId: string;
  camera: CameraCalibrationManifest;
  reference: string;
  morphloom: string;
  img2threejs: string;
  /** Local compiled scene artifacts hashed by the audit runner, never caller-supplied hashes. */
  sceneArtifacts: { morphloom: string; img2threejs: string };
  /** Capture-harness hash-chain receipts binding the browser scene, camera, reference and PNG. */
  captureReceipts: { morphloom: string; img2threejs: string };
  referenceOrigin: 'admitted-local-reference' | 'redistributable-reference';
  thresholds?: { reference?: number; morphloom?: number; img2threejs?: number };
  regions: ComparisonRegion[];
  materialExpectation?: MaterialExpectation;
}

export interface VisualRenderProtocol {
  canvas: { width: number; height: number; pixelRatio: number };
  outputColorSpace: 'srgb';
  toneMapping: 'none' | 'aces-filmic' | 'neutral';
  exposure: number;
  backgroundRgba: [number, number, number, number];
  lightingRigArtifact: string;
  lightingRigSha256: string;
  environmentArtifact: string | 'none';
  environmentSha256: string | 'none';
  shadows: 'off' | 'on';
}

export interface VisualCaptureSetManifest {
  schema: 'morphloom.visual-capture-set/0.4';
  id: string;
  domain: VisualBenchmarkDomain;
  rendererVersions: { morphloom: string; img2threejs: string };
  renderProtocol: VisualRenderProtocol;
  views: VisualCaptureSetViewManifest[];
  blindRatings?: BlindVisualRating[];
}

export interface BrowserCaptureReceipt {
  schema: 'morphloom.browser-capture-receipt/0.2';
  candidateId: 'morphloom' | 'img2threejs';
  viewId: string;
  rendererVersion: string;
  captureMethod: 'browser-webgl-canvas';
  inputFingerprint: string;
  sceneSha256: string;
  cameraFingerprint: string;
  referenceSha256: string;
  renderSha256: string;
  canvas: { width: number; height: number; pixelRatio: number };
  renderSettingsFingerprint: string;
}

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const HEX_FINGERPRINT = /^[a-f0-9]{8,128}$/;
const DOMAINS = new Set<VisualBenchmarkDomain>(['industrial-design', 'architecture', 'character', 'surface']);
const FAMILIES = new Set(['metal', 'glass', 'gemstone', 'plastic', 'fabric', 'wood', 'coating', 'other']);
const CHARACTERS = new Set(['smooth', 'directional', 'granular', 'woven', 'porous']);
const MAX_CAPTURE_PIXELS = 16_777_216;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function finiteTuple(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error(`${label} must contain three finite numbers.`);
  }
  return [...value] as [number, number, number];
}

function localPath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1_000 || value.includes('\0')
    || /^(?:https?:|data:|blob:|[a-z]:[\\/]|[\\/])/i.test(value)
    || value.split(/[\\/]+/).includes('..')) {
    throw new Error(`${label} must be a bounded manifest-relative path.`);
  }
  return value;
}

function receiptPath(value: unknown, label: string): string {
  const path = localPath(value, label);
  if (!/\.json$/i.test(path)) throw new Error(`${label} must identify a JSON capture receipt.`);
  return path;
}

function sceneArtifactPath(value: unknown, label: string): string {
  const path = localPath(value, label);
  if (!/\.(?:glb|gltf|json)$/i.test(path)) {
    throw new Error(`${label} must identify a GLB, glTF, or scene JSON artifact.`);
  }
  return path;
}

function threshold(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 254) {
    throw new Error(`${label} must be an integer within 1..254.`);
  }
  return value as number;
}

function boundedUnit(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be within 0..1.`);
  }
  return value;
}

function validateCamera(value: unknown, label: string): CameraCalibrationManifest {
  const input = object(value, label);
  const projection = input.projection;
  if (projection !== 'perspective' && projection !== 'orthographic') throw new Error(`${label}.projection is invalid.`);
  const position = finiteTuple(input.position, `${label}.position`);
  const target = finiteTuple(input.target, `${label}.target`);
  const up = finiteTuple(input.up, `${label}.up`);
  if (Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) <= 1e-6) {
    throw new Error(`${label} position and target must differ.`);
  }
  if (Math.hypot(...up) <= 1e-6) throw new Error(`${label}.up must be non-zero.`);
  const fovDegrees = input.fovDegrees;
  const orthographicHeight = input.orthographicHeight;
  if (projection === 'perspective' && (typeof fovDegrees !== 'number' || !Number.isFinite(fovDegrees) || fovDegrees < 5 || fovDegrees > 120)) {
    throw new Error(`${label}.fovDegrees must be 5..120 for perspective cameras.`);
  }
  if (projection === 'orthographic' && (typeof orthographicHeight !== 'number' || !Number.isFinite(orthographicHeight) || orthographicHeight <= 0)) {
    throw new Error(`${label}.orthographicHeight must be positive for orthographic cameras.`);
  }
  return {
    projection,
    position,
    target,
    up,
    ...(projection === 'perspective' ? { fovDegrees: fovDegrees as number } : { orthographicHeight: orthographicHeight as number }),
  };
}

function validateRegions(value: unknown, label: string): ComparisonRegion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) throw new Error(`${label} must contain 1..32 regions.`);
  const ids = new Set<string>();
  const rectangles = new Set<string>();
  return value.map((entry, index) => {
    const region = object(entry, `${label}[${index}]`);
    if (typeof region.featureId !== 'string' || !ID.test(region.featureId) || ids.has(region.featureId)) {
      throw new Error(`${label}[${index}].featureId is invalid or duplicated.`);
    }
    ids.add(region.featureId);
    const coordinates = ['x', 'y', 'width', 'height'].map((key) => region[key]);
    if (coordinates.some((item) => !Number.isInteger(item))) throw new Error(`${label}[${index}] coordinates must be integers.`);
    const [x, y, width, height] = coordinates as number[];
    if (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 512 || y + height > 256) {
      throw new Error(`${label}[${index}] exceeds the normalized 512x256 frame.`);
    }
    const rectangle = `${x}:${y}:${width}:${height}`;
    if (rectangles.has(rectangle)) throw new Error(`${label}[${index}] duplicates another region rectangle.`);
    rectangles.add(rectangle);
    return { featureId: region.featureId, x, y, width, height };
  });
}

function rgbaTuple(value: unknown, label: string): [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4
    || value.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    throw new Error(`${label} must contain four bytes.`);
  }
  return [...value] as [number, number, number, number];
}

function validateCanvas(value: unknown, label: string): VisualRenderProtocol['canvas'] {
  const canvas = object(value, label);
  const width = canvas.width;
  const height = canvas.height;
  const pixelRatio = canvas.pixelRatio;
  const pixels = Number(width) * Number(height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || (width as number) < 64 || (height as number) < 64
    || !Number.isSafeInteger(pixels) || pixels > MAX_CAPTURE_PIXELS
    || typeof pixelRatio !== 'number' || !Number.isFinite(pixelRatio) || pixelRatio < 0.25 || pixelRatio > 8) {
    throw new Error(`${label} is outside the safe render bounds.`);
  }
  return { width: width as number, height: height as number, pixelRatio };
}

function validateRenderProtocol(value: unknown): VisualRenderProtocol {
  const protocol = object(value, 'renderProtocol');
  if (protocol.outputColorSpace !== 'srgb') throw new Error('renderProtocol.outputColorSpace must be srgb.');
  if (protocol.toneMapping !== 'none' && protocol.toneMapping !== 'aces-filmic' && protocol.toneMapping !== 'neutral') {
    throw new Error('renderProtocol.toneMapping is invalid.');
  }
  if (typeof protocol.exposure !== 'number' || !Number.isFinite(protocol.exposure)
    || protocol.exposure < 0.1 || protocol.exposure > 4) {
    throw new Error('renderProtocol.exposure must be within 0.1..4.');
  }
  if (protocol.shadows !== 'off' && protocol.shadows !== 'on') throw new Error('renderProtocol.shadows is invalid.');
  const lightingRigArtifact = localPath(protocol.lightingRigArtifact, 'renderProtocol.lightingRigArtifact');
  const lightingRigSha256 = exactSha256(protocol.lightingRigSha256, 'renderProtocol.lightingRigSha256');
  if ((protocol.environmentArtifact === 'none') !== (protocol.environmentSha256 === 'none')) {
    throw new Error('renderProtocol environment artifact and SHA-256 must both be none or both be provided.');
  }
  const environmentDisabled = protocol.environmentArtifact === 'none' && protocol.environmentSha256 === 'none';
  const environmentArtifact = environmentDisabled
    ? 'none'
    : localPath(protocol.environmentArtifact, 'renderProtocol.environmentArtifact');
  const environmentSha256 = environmentDisabled
    ? 'none'
    : exactSha256(protocol.environmentSha256, 'renderProtocol.environmentSha256');
  return {
    canvas: validateCanvas(protocol.canvas, 'renderProtocol.canvas'),
    outputColorSpace: protocol.outputColorSpace,
    toneMapping: protocol.toneMapping,
    exposure: protocol.exposure,
    backgroundRgba: rgbaTuple(protocol.backgroundRgba, 'renderProtocol.backgroundRgba'),
    lightingRigArtifact,
    lightingRigSha256,
    environmentArtifact,
    environmentSha256,
    shadows: protocol.shadows,
  };
}

function validateExpectation(value: unknown, label: string): MaterialExpectation | undefined {
  if (value === undefined) return undefined;
  const input = object(value, label);
  if (input.family !== undefined && !FAMILIES.has(String(input.family))) throw new Error(`${label}.family is invalid.`);
  if (input.surfaceCharacter !== undefined && !CHARACTERS.has(String(input.surfaceCharacter))) throw new Error(`${label}.surfaceCharacter is invalid.`);
  return {
    ...(input.family !== undefined ? { family: input.family as MaterialExpectation['family'] } : {}),
    ...(input.surfaceCharacter !== undefined ? { surfaceCharacter: input.surfaceCharacter as MaterialExpectation['surfaceCharacter'] } : {}),
    ...(input.roughness !== undefined ? { roughness: boundedUnit(input.roughness, `${label}.roughness`)! } : {}),
    ...(input.anisotropy !== undefined ? { anisotropy: boundedUnit(input.anisotropy, `${label}.anisotropy`)! } : {}),
  };
}

export function validateVisualCaptureSetManifest(value: unknown): VisualCaptureSetManifest {
  const input = object(value, 'Capture manifest');
  if (input.schema !== 'morphloom.visual-capture-set/0.4') throw new Error('Capture manifest schema is unsupported.');
  if (typeof input.id !== 'string' || !ID.test(input.id)) throw new Error('Capture manifest id is invalid.');
  if (!DOMAINS.has(input.domain as VisualBenchmarkDomain)) throw new Error('Capture manifest domain is invalid.');
  const versions = object(input.rendererVersions, 'rendererVersions');
  for (const id of ['morphloom', 'img2threejs']) {
    if (typeof versions[id] !== 'string' || versions[id].trim().length < 1 || versions[id].length > 160) {
      throw new Error(`rendererVersions.${id} is invalid.`);
    }
  }
  const renderProtocol = validateRenderProtocol(input.renderProtocol);
  if (!Array.isArray(input.views) || input.views.length < 1 || input.views.length > 8) {
    throw new Error('Capture manifest must contain 1..8 calibrated views.');
  }
  const viewIds = new Set<string>();
  const pathSets = { reference: new Set<string>(), morphloom: new Set<string>(), img2threejs: new Set<string>() };
  const receiptPathSets = { morphloom: new Set<string>(), img2threejs: new Set<string>() };
  const lockedSceneArtifacts: Partial<Record<'morphloom' | 'img2threejs', string>> = {};
  const views = input.views.map((entry, index): VisualCaptureSetViewManifest => {
    const view = object(entry, `views[${index}]`);
    if (typeof view.viewId !== 'string' || !ID.test(view.viewId) || viewIds.has(view.viewId)) {
      throw new Error(`views[${index}].viewId is invalid or duplicated.`);
    }
    viewIds.add(view.viewId);
    const paths = {
      reference: localPath(view.reference, `views[${index}].reference`),
      morphloom: localPath(view.morphloom, `views[${index}].morphloom`),
      img2threejs: localPath(view.img2threejs, `views[${index}].img2threejs`),
    };
    if (new Set(Object.values(paths)).size !== 3) throw new Error(`views[${index}] must use three distinct files.`);
    for (const id of ['reference', 'morphloom', 'img2threejs'] as const) {
      if (pathSets[id].has(paths[id])) throw new Error(`${id} capture path was reused across calibrated views.`);
      pathSets[id].add(paths[id]);
    }
    if (view.referenceOrigin !== 'admitted-local-reference' && view.referenceOrigin !== 'redistributable-reference') {
      throw new Error(`views[${index}].referenceOrigin is invalid.`);
    }
    const sceneArtifactsInput = object(view.sceneArtifacts, `views[${index}].sceneArtifacts`);
    const sceneArtifacts = {
      morphloom: sceneArtifactPath(sceneArtifactsInput.morphloom, `views[${index}].sceneArtifacts.morphloom`),
      img2threejs: sceneArtifactPath(sceneArtifactsInput.img2threejs, `views[${index}].sceneArtifacts.img2threejs`),
    };
    if (sceneArtifacts.morphloom === sceneArtifacts.img2threejs) {
      throw new Error(`views[${index}] candidates must use distinct scene artifacts.`);
    }
    for (const id of ['morphloom', 'img2threejs'] as const) {
      if (lockedSceneArtifacts[id] !== undefined && lockedSceneArtifacts[id] !== sceneArtifacts[id]) {
        throw new Error(`${id} scene artifact changed across calibrated views.`);
      }
      lockedSceneArtifacts[id] ??= sceneArtifacts[id];
    }
    const captureReceiptsInput = object(view.captureReceipts, `views[${index}].captureReceipts`);
    const captureReceipts = {
      morphloom: receiptPath(captureReceiptsInput.morphloom, `views[${index}].captureReceipts.morphloom`),
      img2threejs: receiptPath(captureReceiptsInput.img2threejs, `views[${index}].captureReceipts.img2threejs`),
    };
    if (captureReceipts.morphloom === captureReceipts.img2threejs) {
      throw new Error(`views[${index}] candidates must use distinct capture receipts.`);
    }
    for (const id of ['morphloom', 'img2threejs'] as const) {
      if (receiptPathSets[id].has(captureReceipts[id])) throw new Error(`${id} capture receipt was reused across calibrated views.`);
      receiptPathSets[id].add(captureReceipts[id]);
    }
    const thresholds = view.thresholds === undefined ? undefined : object(view.thresholds, `views[${index}].thresholds`);
    return {
      viewId: view.viewId,
      camera: validateCamera(view.camera, `views[${index}].camera`),
      ...paths,
      sceneArtifacts,
      captureReceipts,
      referenceOrigin: view.referenceOrigin,
      ...(thresholds ? { thresholds: {
        reference: threshold(thresholds.reference, `views[${index}].thresholds.reference`),
        morphloom: threshold(thresholds.morphloom, `views[${index}].thresholds.morphloom`),
        img2threejs: threshold(thresholds.img2threejs, `views[${index}].thresholds.img2threejs`),
      } } : {}),
      regions: validateRegions(view.regions, `views[${index}].regions`),
      materialExpectation: validateExpectation(view.materialExpectation, `views[${index}].materialExpectation`),
    };
  });
  let blindRatings: BlindVisualRating[] | undefined;
  if (input.blindRatings !== undefined) {
    if (!Array.isArray(input.blindRatings) || input.blindRatings.length > 200) throw new Error('blindRatings is invalid.');
    blindRatings = input.blindRatings.map((entry, index) => {
      const rating = object(entry, `blindRatings[${index}]`);
      if (typeof rating.raterFingerprint !== 'string' || !HEX_FINGERPRINT.test(rating.raterFingerprint)
        || (rating.presentationOrder !== 'morphloom-first' && rating.presentationOrder !== 'img2threejs-first')
        || (rating.preferred !== 'morphloom' && rating.preferred !== 'img2threejs' && rating.preferred !== 'tie')) {
        throw new Error(`blindRatings[${index}] is invalid.`);
      }
      return rating as unknown as BlindVisualRating;
    });
  }
  return {
    schema: input.schema,
    id: input.id,
    domain: input.domain as VisualBenchmarkDomain,
    rendererVersions: { morphloom: versions.morphloom as string, img2threejs: versions.img2threejs as string },
    renderProtocol,
    views,
    ...(blindRatings ? { blindRatings } : {}),
  };
}

function exactSha256(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a SHA-256 digest.`);
  return value;
}

export function validateBrowserCaptureReceipt(
  value: unknown,
  expected: Omit<BrowserCaptureReceipt, 'schema' | 'captureMethod'>,
): BrowserCaptureReceipt {
  const receipt = object(value, 'Capture receipt');
  if (receipt.schema !== 'morphloom.browser-capture-receipt/0.2') throw new Error('Capture receipt schema is unsupported.');
  if (receipt.captureMethod !== 'browser-webgl-canvas') throw new Error('Capture receipt method is not browser WebGL canvas.');
  const canvas = validateCanvas(receipt.canvas, 'Capture receipt canvas');
  const normalized: BrowserCaptureReceipt = {
    schema: receipt.schema,
    candidateId: receipt.candidateId as BrowserCaptureReceipt['candidateId'],
    viewId: String(receipt.viewId ?? ''),
    rendererVersion: String(receipt.rendererVersion ?? ''),
    captureMethod: receipt.captureMethod,
    inputFingerprint: exactSha256(receipt.inputFingerprint, 'Capture receipt inputFingerprint'),
    sceneSha256: exactSha256(receipt.sceneSha256, 'Capture receipt sceneSha256'),
    cameraFingerprint: exactSha256(receipt.cameraFingerprint, 'Capture receipt cameraFingerprint'),
    referenceSha256: exactSha256(receipt.referenceSha256, 'Capture receipt referenceSha256'),
    renderSha256: exactSha256(receipt.renderSha256, 'Capture receipt renderSha256'),
    canvas,
    renderSettingsFingerprint: exactSha256(receipt.renderSettingsFingerprint, 'Capture receipt renderSettingsFingerprint'),
  };
  for (const key of ['candidateId', 'viewId', 'rendererVersion', 'inputFingerprint', 'sceneSha256', 'cameraFingerprint', 'referenceSha256', 'renderSha256'] as const) {
    if (normalized[key] !== expected[key]) throw new Error(`Capture receipt ${key} does not match the audited files and calibration.`);
  }
  if (normalized.canvas.width !== expected.canvas.width || normalized.canvas.height !== expected.canvas.height
    || normalized.canvas.pixelRatio !== expected.canvas.pixelRatio) {
    throw new Error('Capture receipt canvas does not match the locked render protocol.');
  }
  if (normalized.renderSettingsFingerprint !== expected.renderSettingsFingerprint) {
    throw new Error('Capture receipt renderSettingsFingerprint does not match the locked render protocol.');
  }
  return normalized;
}

export function canonicalCameraCalibration(camera: CameraCalibrationManifest): string {
  return JSON.stringify({
    projection: camera.projection,
    position: camera.position,
    target: camera.target,
    up: camera.up,
    ...(camera.projection === 'perspective' ? { fovDegrees: camera.fovDegrees } : { orthographicHeight: camera.orthographicHeight }),
  });
}

export function canonicalVisualRenderProtocol(protocol: VisualRenderProtocol): string {
  return JSON.stringify({
    canvas: protocol.canvas,
    outputColorSpace: protocol.outputColorSpace,
    toneMapping: protocol.toneMapping,
    exposure: protocol.exposure,
    backgroundRgba: protocol.backgroundRgba,
    lightingRigSha256: protocol.lightingRigSha256,
    environmentSha256: protocol.environmentSha256,
    shadows: protocol.shadows,
  });
}
