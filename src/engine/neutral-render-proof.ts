export type NeutralRenderView = 'front' | 'rear' | 'iso';

export interface NeutralRenderReport {
  schema: 'morphloom.neutral-glb-render/0.2';
  protocol: 'morphloom-neutral-glb-v1';
  viewId: NeutralRenderView;
  blenderVersion: string;
  source: string;
  sourceBytes: number;
  sourceSha256: string;
  render: string;
  renderBytes: number;
  renderSha256: string;
  meshes: number;
  materials: number;
  normalization: {
    method: 'broadside-xz-max-extent';
    targetExtent: 2;
    sourceBounds: Bounds;
    scale: number;
    normalizedBounds: Bounds;
  };
  camera: {
    projection: 'orthographic';
    position: [number, number, number];
    target: [number, number, number];
    up: [number, number, number];
    orthographicHeight: number;
  };
  renderSettings: Record<string, unknown>;
  studio: Record<string, unknown>;
}

interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
}

export interface NeutralRenderPairAudit {
  schema: 'morphloom.neutral-render-pair-audit/0.1';
  status: 'pass' | 'blocked';
  viewId?: NeutralRenderView;
  sourceSha256?: { morphloom: string; img2threejs: string };
  renderSha256?: { morphloom: string; img2threejs: string };
  blockers: string[];
  limitation: string;
}

export interface NeutralRenderSetAudit {
  schema: 'morphloom.neutral-render-set-audit/0.1';
  status: 'pass' | 'blocked';
  views: NeutralRenderView[];
  pairs: NeutralRenderPairAudit[];
  blockers: string[];
  limitation: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const VIEW_IDS = new Set<NeutralRenderView>(['front', 'rear', 'iso']);
const VIEW_CAMERAS: Record<NeutralRenderView, NeutralRenderReport['camera']> = {
  front: { projection: 'orthographic', position: [0, -4, 0], target: [0, 0, 0], up: [0, 0, 1], orthographicHeight: 2.35 },
  rear: { projection: 'orthographic', position: [0, 4, 0], target: [0, 0, 0], up: [0, 0, 1], orthographicHeight: 2.35 },
  iso: { projection: 'orthographic', position: [2.8, -3.4, 1.8], target: [0, 0, 0], up: [0, 0, 1], orthographicHeight: 2.55 },
};
const RENDER_SETTINGS = {
  engine: 'BLENDER_EEVEE', width: 1024, height: 512, transparent: true,
  viewTransform: 'AgX', look: 'AgX - Medium High Contrast',
};
const STUDIO = {
  world: { color: [0.12, 0.12, 0.12, 1], strength: 0.28 },
  lights: [
    { name: 'Neutral key', location: [-2.5, -3, 3.5], energy: 900, size: 4 },
    { name: 'Neutral fill', location: [3, -2, 1.2], energy: 500, size: 3 },
    { name: 'Neutral rim', location: [0.5, 2.5, 2.5], energy: 700, size: 2.5 },
  ],
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
    throw new Error(`${label} must be ${positive ? 'positive and ' : ''}finite.`);
  }
  return value;
}

function tuple(value: unknown, label: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) throw new Error(`${label} must contain three numbers.`);
  return value.map((entry, index) => finite(entry, `${label}[${index}]`)) as [number, number, number];
}

function bounds(value: unknown, label: string): Bounds {
  const input = record(value, label);
  const minimum = tuple(input.min, `${label}.min`);
  const maximum = tuple(input.max, `${label}.max`);
  const size = tuple(input.size, `${label}.size`);
  if (size.some((entry) => entry < 0)) throw new Error(`${label}.size cannot be negative.`);
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs((maximum[axis]! - minimum[axis]!) - size[axis]!) > 1e-5) {
      throw new Error(`${label}.size does not match min/max.`);
    }
  }
  return { min: minimum, max: maximum, size };
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be a SHA-256 digest.`);
  return value;
}

function positiveInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`${label} must be within 1..${maximum}.`);
  }
  return value as number;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validateLockedRenderSettings(value: unknown): Record<string, unknown> {
  const settings = record(value, 'Neutral render settings');
  if (!hasExactKeys(settings, Object.keys(RENDER_SETTINGS))
    || settings.engine !== RENDER_SETTINGS.engine || settings.width !== RENDER_SETTINGS.width
    || settings.height !== RENDER_SETTINGS.height || settings.transparent !== RENDER_SETTINGS.transparent
    || settings.viewTransform !== RENDER_SETTINGS.viewTransform || settings.look !== RENDER_SETTINGS.look) {
    throw new Error('Neutral render settings contract changed.');
  }
  return RENDER_SETTINGS;
}

function validateLockedStudio(value: unknown): Record<string, unknown> {
  const studio = record(value, 'Neutral render studio');
  if (!hasExactKeys(studio, ['world', 'lights'])) throw new Error('Neutral render studio contract changed.');
  const world = record(studio.world, 'Neutral render studio.world');
  const lights = studio.lights;
  if (!hasExactKeys(world, ['color', 'strength']) || !Array.isArray(world.color)
    || world.color.length !== 4 || world.color.some((entry, index) => entry !== STUDIO.world.color[index])
    || world.strength !== STUDIO.world.strength || !Array.isArray(lights) || lights.length !== STUDIO.lights.length) {
    throw new Error('Neutral render studio contract changed.');
  }
  for (let index = 0; index < STUDIO.lights.length; index += 1) {
    const light = record(lights[index], `Neutral render studio.lights[${index}]`);
    const expected = STUDIO.lights[index]!;
    if (!hasExactKeys(light, ['name', 'location', 'energy', 'size']) || light.name !== expected.name
      || !Array.isArray(light.location) || light.location.length !== 3
      || light.location.some((entry, axis) => entry !== expected.location[axis])
      || light.energy !== expected.energy || light.size !== expected.size) {
      throw new Error('Neutral render studio contract changed.');
    }
  }
  return STUDIO;
}

export function validateNeutralRenderReport(value: unknown): NeutralRenderReport {
  const input = record(value, 'Neutral render report');
  if (input.schema !== 'morphloom.neutral-glb-render/0.2' || input.protocol !== 'morphloom-neutral-glb-v1') {
    throw new Error('Neutral render protocol is unsupported.');
  }
  if (!VIEW_IDS.has(input.viewId as NeutralRenderView)) throw new Error('Neutral render view is unsupported.');
  if (typeof input.blenderVersion !== 'string' || input.blenderVersion.length < 1 || input.blenderVersion.length > 80) {
    throw new Error('Neutral render Blender version is invalid.');
  }
  for (const key of ['source', 'render']) {
    if (typeof input[key] !== 'string' || input[key].length < 1 || input[key].length > 255 || /[\\/\0]/.test(input[key] as string)) {
      throw new Error(`Neutral render ${key} name is invalid.`);
    }
  }
  const normalizationInput = record(input.normalization, 'Neutral render normalization');
  if (normalizationInput.method !== 'broadside-xz-max-extent' || normalizationInput.targetExtent !== 2) {
    throw new Error('Neutral render normalization contract changed.');
  }
  const normalizedBounds = bounds(normalizationInput.normalizedBounds, 'Neutral render normalizedBounds');
  const broadsideExtent = Math.max(normalizedBounds.size[0], normalizedBounds.size[2]);
  if (Math.abs(broadsideExtent - 2) > 1e-5) throw new Error('Neutral render did not normalize the broadside extent to 2.');
  const cameraInput = record(input.camera, 'Neutral render camera');
  if (cameraInput.projection !== 'orthographic') throw new Error('Neutral render camera must be orthographic.');
  const camera = {
    projection: 'orthographic' as const,
    position: tuple(cameraInput.position, 'Neutral render camera.position'),
    target: tuple(cameraInput.target, 'Neutral render camera.target'),
    up: tuple(cameraInput.up, 'Neutral render camera.up'),
    orthographicHeight: finite(cameraInput.orthographicHeight, 'Neutral render camera.orthographicHeight', true),
  };
  if (Math.hypot(...camera.position.map((entry, index) => entry - camera.target[index]!)) < 1e-6) {
    throw new Error('Neutral render camera position and target must differ.');
  }
  if (canonical(camera) !== canonical(VIEW_CAMERAS[input.viewId as NeutralRenderView])) {
    throw new Error('Neutral render camera does not match its locked view preset.');
  }
  const renderSettings = validateLockedRenderSettings(input.renderSettings);
  const studio = validateLockedStudio(input.studio);
  return {
    schema: input.schema,
    protocol: input.protocol,
    viewId: input.viewId as NeutralRenderView,
    blenderVersion: input.blenderVersion,
    source: input.source as string,
    sourceBytes: positiveInteger(input.sourceBytes, 'Neutral render sourceBytes', 256 * 1024 * 1024),
    sourceSha256: digest(input.sourceSha256, 'Neutral render sourceSha256'),
    render: input.render as string,
    renderBytes: positiveInteger(input.renderBytes, 'Neutral render renderBytes', 256 * 1024 * 1024),
    renderSha256: digest(input.renderSha256, 'Neutral render renderSha256'),
    meshes: positiveInteger(input.meshes, 'Neutral render meshes', 1_000_000),
    materials: positiveInteger(input.materials, 'Neutral render materials', 1_000_000),
    normalization: {
      method: normalizationInput.method,
      targetExtent: normalizationInput.targetExtent,
      sourceBounds: bounds(normalizationInput.sourceBounds, 'Neutral render sourceBounds'),
      scale: finite(normalizationInput.scale, 'Neutral render scale', true),
      normalizedBounds,
    },
    camera,
    renderSettings,
    studio,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue).sort().map((key) => `${JSON.stringify(key)}:${canonical(objectValue[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function auditNeutralRenderPair(morphloomValue: unknown, competitorValue: unknown): NeutralRenderPairAudit {
  const blockers: string[] = [];
  let morphloom: NeutralRenderReport;
  let competitor: NeutralRenderReport;
  try {
    morphloom = validateNeutralRenderReport(morphloomValue);
    competitor = validateNeutralRenderReport(competitorValue);
  } catch (error) {
    return {
      schema: 'morphloom.neutral-render-pair-audit/0.1',
      status: 'blocked',
      blockers: [error instanceof Error ? error.message : String(error)],
      limitation: 'A blocked neutral render pair cannot support visual quality claims.',
    };
  }
  if (morphloom.viewId !== competitor.viewId) blockers.push('Candidate view ids differ.');
  if (morphloom.blenderVersion !== competitor.blenderVersion) blockers.push('Blender versions differ.');
  if (canonical(morphloom.camera) !== canonical(competitor.camera)) blockers.push('Neutral cameras differ.');
  if (canonical(morphloom.renderSettings) !== canonical(competitor.renderSettings)) blockers.push('Render settings differ.');
  if (canonical(morphloom.studio) !== canonical(competitor.studio)) blockers.push('Studio lighting differs.');
  if (morphloom.sourceSha256 === competitor.sourceSha256) blockers.push('Candidates use the same source GLB.');
  if (morphloom.renderSha256 === competitor.renderSha256) blockers.push('Candidates produced byte-identical renders.');
  return {
    schema: 'morphloom.neutral-render-pair-audit/0.1',
    status: blockers.length === 0 ? 'pass' : 'blocked',
    viewId: morphloom.viewId,
    sourceSha256: { morphloom: morphloom.sourceSha256, img2threejs: competitor.sourceSha256 },
    renderSha256: { morphloom: morphloom.renderSha256, img2threejs: competitor.renderSha256 },
    blockers,
    limitation: 'This audit proves identical neutral rendering conditions, not which result is perceptually better.',
  };
}

export function auditNeutralRenderSet(morphloomValues: unknown[], competitorValues: unknown[]): NeutralRenderSetAudit {
  const blockers: string[] = [];
  if (morphloomValues.length !== competitorValues.length || morphloomValues.length < 2 || morphloomValues.length > 3) {
    blockers.push('Neutral comparison requires two or three paired views.');
  }
  const pairCount = Math.min(morphloomValues.length, competitorValues.length, 3);
  const pairs = Array.from({ length: pairCount }, (_, index) => auditNeutralRenderPair(morphloomValues[index], competitorValues[index]));
  pairs.forEach((pair, index) => pair.blockers.forEach((blocker) => blockers.push(`pair ${index + 1}: ${blocker}`)));
  const views = pairs.flatMap((pair) => pair.viewId ? [pair.viewId] : []);
  if (new Set(views).size !== views.length) blockers.push('Neutral comparison reused a view id.');
  const morphloomSources = new Set(pairs.flatMap((pair) => pair.sourceSha256 ? [pair.sourceSha256.morphloom] : []));
  const competitorSources = new Set(pairs.flatMap((pair) => pair.sourceSha256 ? [pair.sourceSha256.img2threejs] : []));
  if (pairs.length > 0 && morphloomSources.size !== 1) blockers.push('Morphloom source GLB changed across views.');
  if (pairs.length > 0 && competitorSources.size !== 1) blockers.push('img2threejs source GLB changed across views.');
  const morphloomRenders = pairs.flatMap((pair) => pair.renderSha256 ? [pair.renderSha256.morphloom] : []);
  const competitorRenders = pairs.flatMap((pair) => pair.renderSha256 ? [pair.renderSha256.img2threejs] : []);
  if (new Set(morphloomRenders).size !== morphloomRenders.length) blockers.push('Morphloom reused a render across views.');
  if (new Set(competitorRenders).size !== competitorRenders.length) blockers.push('img2threejs reused a render across views.');
  return {
    schema: 'morphloom.neutral-render-set-audit/0.1',
    status: blockers.length === 0 ? 'pass' : 'blocked',
    views,
    pairs,
    blockers,
    limitation: 'This audit proves same-GLB multi-view rendering under identical conditions. Perceptual superiority still requires matched references and blind ratings.',
  };
}
