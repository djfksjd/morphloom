import {compileGearChamfer,validateGearChamferAmount} from './gear-chamfer';
import { Euler, Quaternion, Vector3 } from 'three';
import { validatePartGeometry, type PartGeometry } from './part-geometry';

export type Vec3 = [number, number, number];
export type Evidence = { status: 'authored' | 'inferred' | 'observed'; source: string };
export type Params = { length: number; width: number; thickness: number; curvature: number; twist: number; color: string; roughness: number };
export type Kind = 'feather' | 'strand';
export type Override = { params?: Partial<Params>; position?: Vec3; rotation?: Vec3; visible?: boolean; locked?: boolean };
export type PartSurface={finish:'brushed-metal'|'bead-blasted-metal'|'anodized-metal';channels:'roughness-only';repeat:[number,number]};
export type PartMaterial = { roughness: number; metalness: number; surface?:PartSurface };
export type AssemblyGroup = { id: string; name: string; axis: Vec3 };
export type Part = { id: string; name: string; position: Vec3; rotation: Vec3; scale: Vec3; shape: 'ellipsoid' | 'beak' | 'assembly-geometry'; geometry?: PartGeometry; material?: PartMaterial; assemblyId?: string; creaseAngle?: number; uvScale?: number; axialChamferMm?: number; color: string; evidence: Evidence; visible: boolean; locked: boolean; home?: { position: Vec3; rotation: Vec3; assemblyId?: string } };
export type Region = { id: string; partId: string; name: string };
export type Group = { id: string; regionId: string; kind: Kind; count: number; distribution?: 'volume' | 'ellipsoid-surface'; root: Vec3; spread: Vec3; rotation: Vec3; fan: number; params: Params; overrides: Record<string, Override>; deleted: string[]; evidence: Evidence };
export type Element = { id: string; kind: Kind; partId: string; groupId?: string; position: Vec3; rotation: Vec3; params: Params; visible: boolean; locked: boolean; evidence: Evidence; original?: { groupId: string; slot: string; override?: Override } };
export type ElementProject = { selection?: string[]; schema: 'morphloom.elements/0.1' | 'morphloom.elements/0.2' | 'morphloom.elements/0.3' | 'morphloom.elements/0.4' | 'morphloom.elements/0.5' | 'morphloom.elements/0.6'; assemblies?: AssemblyGroup[]; seed: number; units: 'mm'; coordinates: 'right-handed-y-up'; parts: Part[]; regions: Region[]; groups: Group[]; elements: Element[] };
export type ResolvedElement = Omit<Element, 'original'> & { source: 'generated' | 'explicit' };
export const DEFAULT_PARAMS: Params = { length: 28, width: 7, thickness: 2, curvature: 0, twist: 0, color: '#805b40', roughness: 0.8 };

export class ProjectError extends Error {
  constructor(public readonly code: string, public readonly path: string) {
    super(`${code}: ${path}`);
    this.name = 'ProjectError';
  }
}
function fail(code: string, path: string): never { throw new ProjectError(code, path); }
const own = (v: object, k: string): boolean => Object.hasOwn(v, k);
const obj = (v: unknown, path: string, required: string[], optional: string[] = []): Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return fail('type', path);
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return fail('type', path);
  const r = v as Record<string, unknown>;
  for (const k of required) if (!own(r, k)) fail('missing', `${path}.${k}`);
  for (const k of Object.keys(r)) if (![...required, ...optional].includes(k)) fail('unknown', `${path}.${k}`);
  return r;
};
const arr = (v: unknown, p: string): unknown[] => Array.isArray(v) ? v : fail('type', p);
const num = (v: unknown, p: string, min = -Infinity, max = Infinity): number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail('range', p);
const integer = (v: unknown, p: string, max: number): number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max ? v as number : fail('range', p);
const str = (v: unknown, p: string): string => typeof v === 'string' ? v : fail('type', p);
const id = (v: unknown, p: string, slash = false): string => {
  const s = str(v, p);
  const pattern = slash ? /^[A-Za-z0-9_-]+(?:\/[0-9]{6})?$/ : /^[A-Za-z0-9_-]+$/;
  return s.length <= 128 && pattern.test(s) && !['__proto__', 'prototype', 'constructor'].includes(s) ? s : fail('id', p);
};
const bool = (v: unknown, p: string): boolean => typeof v === 'boolean' ? v : fail('type', p);
const choice = <T extends string>(v: unknown, p: string, values: readonly T[]): T => values.includes(v as T) ? v as T : fail('value', p);
const vec = (v: unknown, p: string, min = -1e6, max = 1e6): Vec3 => {
  const a = arr(v, p);
  if (a.length !== 3) fail('length', p);
  return [num(a[0], `${p}[0]`, min, max), num(a[1], `${p}[1]`, min, max), num(a[2], `${p}[2]`, min, max)];
};
const angles = (v: unknown, p: string): Vec3 => vec(v, p, -Math.PI * 2, Math.PI * 2);
const color = (v: unknown, p: string): string => {
  const s = str(v, p);
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fail('color', p);
};
const evidence = (v: unknown, p: string): Evidence => {
  const r = obj(v, p, ['status', 'source']);
  const source = str(r.source, `${p}.source`);
  if (source.length > 512) fail('length', `${p}.source`);
  return { status: choice(r.status, `${p}.status`, ['authored', 'inferred', 'observed']), source };
};
const params = (v: unknown, p: string, partial = false): Partial<Params> => {
  const keys = ['length', 'width', 'thickness', 'curvature', 'twist', 'color', 'roughness'];
  const r = obj(v, p, partial ? [] : keys, partial ? keys : []);
  const out: Partial<Params> = {};
  for (const k of keys as (keyof Params)[]) if (own(r, k)) {
    const path = `${p}.${k}`;
    if (k === 'color') out.color = color(r[k], path);
    else if (k === 'length' || k === 'width' || k === 'thickness') out[k] = num(r[k], path, 0.01, 100_000);
    else if (k === 'curvature') out.curvature = num(r[k], path, -1, 1);
    else if (k === 'twist') out.twist = num(r[k], path, -Math.PI * 2, Math.PI * 2);
    else out.roughness = num(r[k], path, 0, 1);
  }
  return out;
};
const override = (v: unknown, p: string): Override => {
  const r = obj(v, p, [], ['params', 'position', 'rotation', 'visible', 'locked']);
  return {
    ...(own(r, 'params') ? { params: params(r.params, `${p}.params`, true) } : {}),
    ...(own(r, 'position') ? { position: vec(r.position, `${p}.position`) } : {}),
    ...(own(r, 'rotation') ? { rotation: angles(r.rotation, `${p}.rotation`) } : {}),
    ...(own(r, 'visible') ? { visible: bool(r.visible, `${p}.visible`) } : {}),
    ...(own(r, 'locked') ? { locked: bool(r.locked, `${p}.locked`) } : {})
  };
};
export const slotId = (groupId: string, index: number): string => `${groupId}/${String(index).padStart(6, '0')}`;
function slotIndex(s: string, group: string, p: string): number {
  if (!s.startsWith(`${group}/`) || !/^\d{6}$/.test(s.slice(group.length + 1))) fail('slot', p);
  return Number(s.slice(group.length + 1));
}

export function validateProject(value: unknown): ElementProject {
  const r = obj(value, 'project', ['schema', 'seed', 'units', 'coordinates', 'parts', 'regions', 'groups', 'elements'], ['selection','assemblies']);
  const version2 = r.schema === 'morphloom.elements/0.2' || r.schema === 'morphloom.elements/0.3' || r.schema === 'morphloom.elements/0.4' || r.schema === 'morphloom.elements/0.5' || r.schema === 'morphloom.elements/0.6';
  if (!version2 && own(r,'assemblies')) fail('version', 'assemblies');
  if (own(r, 'selection')) { const selected = arr(r.selection, 'selection'); if (selected.length > 128 || new Set(selected).size !== selected.length) fail('selection', 'selection'); selected.forEach((value, i) => id(value, `selection[${i}]`, true)); }
  choice(r.schema, 'schema', ['morphloom.elements/0.1','morphloom.elements/0.2','morphloom.elements/0.3','morphloom.elements/0.4','morphloom.elements/0.5','morphloom.elements/0.6']);
  integer(r.seed, 'seed', Number.MAX_SAFE_INTEGER);
  choice(r.units, 'units', ['mm']);
  choice(r.coordinates, 'coordinates', ['right-handed-y-up']);
  const parts = arr(r.parts, 'parts'), regions = arr(r.regions, 'regions');
  const groups = arr(r.groups, 'groups'), elements = arr(r.elements, 'elements');
  if (parts.length > 256 || regions.length > 512 || groups.length > 256 || elements.length > 5000) fail('budget', 'project');
  const partIds = new Set<string>(), regionIds = new Set<string>(), groupIds = new Set<string>(), used = new Set<string>();
  const unique = (s: string, p: string, set: Set<string>): void => {
    if (set.has(s)) fail('duplicate', p);
    set.add(s);
  };
  const assemblyIds = new Set<string>();
  const assemblies = own(r,'assemblies') ? arr(r.assemblies,'assemblies') : [];
  if (assemblies.length > 64) fail('budget','assemblies');
  assemblies.forEach((v,i) => {
    const path = `assemblies[${i}]`, a = obj(v,path,['id','name','axis']);
    const aid = id(a.id, `${path}.id`); unique(aid,path,assemblyIds); unique(aid,path,used);
    if (str(a.name,`${path}.name`).length > 512) fail('length',path);
    const axis = vec(a.axis,`${path}.axis`,-1,1);
    if (Math.abs(Math.hypot(...axis)-1) > 1e-6) fail('axis',path);
  });
  parts.forEach((v, i) => {
    const p = `parts[${i}]`, a = obj(v, p, ['id','name','position','rotation','scale','shape','color','evidence','visible','locked'], version2 ? ['home','geometry','material','assemblyId','creaseAngle',...((r.schema==='morphloom.elements/0.4'||r.schema==='morphloom.elements/0.5'||r.schema==='morphloom.elements/0.6')?['uvScale']:[]),...((r.schema==='morphloom.elements/0.5'||r.schema==='morphloom.elements/0.6')?['axialChamferMm']:[])] : ['home']);
    const key = id(a.id, `${p}.id`);
    unique(key, p, partIds); unique(key, p, used);
    if (str(a.name, `${p}.name`).length > 512) fail('length', `${p}.name`);
    vec(a.position, `${p}.position`); angles(a.rotation, `${p}.rotation`);
    vec(a.scale, `${p}.scale`, 0.01, 100_000);
    choice(a.shape, `${p}.shape`, version2 ? ['ellipsoid','beak','assembly-geometry'] : ['ellipsoid','beak']);
    if (a.shape === 'assembly-geometry') {
      try { validatePartGeometry(a.geometry, (r.schema==='morphloom.elements/0.3'||r.schema==='morphloom.elements/0.4'||r.schema==='morphloom.elements/0.5'||r.schema==='morphloom.elements/0.6'));  } catch { fail('geometry', `${p}.geometry`); }
      vec(a.scale, `${p}.scale`, 0.01, 100);
    } else if (own(a,'geometry')) fail('geometry',`${p}.geometry`);
    if (own(a,'material')) {
      const m = obj(a.material,`${p}.material`,['roughness','metalness'],r.schema==='morphloom.elements/0.6'?['surface']:[]);
      if(own(m,'surface'))validatePartSurface(m.surface,`${p}.material.surface`);
      num(m.roughness,`${p}.material.roughness`,0,1); num(m.metalness,`${p}.material.metalness`,0,1);
    }
    if(own(a,'axialChamferMm')){try{if(a.shape!=='assembly-geometry'||(a.geometry as PartGeometry)?.op!=='spur-gear')throw Error();validateGearChamferAmount(a.geometry as import('./spur-gear').SpurGearGeometry,a.axialChamferMm);}catch{fail('chamfer',`${p}.axialChamferMm`);}}
    if (own(a,'uvScale')) num(a.uvScale,`${p}.uvScale`,0.001,1000);
    if (own(a,'creaseAngle')) num(a.creaseAngle,`${p}.creaseAngle`,0,Math.PI);
    if (own(a,'assemblyId') && !assemblyIds.has(id(a.assemblyId,`${p}.assemblyId`))) fail('reference',`${p}.assemblyId`);
    color(a.color, `${p}.color`); evidence(a.evidence, `${p}.evidence`);
    bool(a.visible, `${p}.visible`); bool(a.locked, `${p}.locked`);
    if (own(a, 'home')) {
      const h = obj(a.home, `${p}.home`, ['position', 'rotation'], version2 ? ['assemblyId'] : []);
      if (own(h,'assemblyId') && (!assemblyIds.has(id(h.assemblyId,`${p}.home.assemblyId`)) || own(a,'assemblyId'))) fail('reference',`${p}.home.assemblyId`);
      vec(h.position, `${p}.home.position`); angles(h.rotation, `${p}.home.rotation`);
    }
  });
  regions.forEach((v, i) => {
    const p = `regions[${i}]`, a = obj(v, p, ['id','partId','name']);
    const key = id(a.id, `${p}.id`);
    unique(key, p, regionIds); unique(key, p, used);
    if (!partIds.has(id(a.partId, `${p}.partId`))) fail('reference', p);
    if (str(a.name, `${p}.name`).length > 512) fail('length', `${p}.name`);
  });
  let reserved = elements.length;
  const groupData = new Map<string, { kind: Kind; partId: string; count: number; deleted: Set<string> }>();
  groups.forEach((v, i) => {
    const p = `groups[${i}]`, a = obj(v, p, ['id','regionId','kind','count','root','spread','rotation','fan','params','overrides','deleted','evidence'], ['distribution']);
    if (own(a, 'distribution')) choice(a.distribution, `${p}.distribution`, ['volume', 'ellipsoid-surface']);
    const gid = id(a.id, `${p}.id`);
    unique(gid, p, groupIds); unique(gid, p, used);
    const regionId = id(a.regionId, `${p}.regionId`);
    const region = (regions as Region[]).find(x => x.id === regionId);
    if (!region) fail('reference', p);
    const kind = choice(a.kind, `${p}.kind`, ['feather','strand']);
    const count = integer(a.count, `${p}.count`, 5000);
    reserved += count;
    if (reserved > 5000) fail('budget', 'elements');
    vec(a.root, `${p}.root`); vec(a.spread, `${p}.spread`, 0);
    angles(a.rotation, `${p}.rotation`);
    num(a.fan, `${p}.fan`, -Math.PI * 2, Math.PI * 2);
    params(a.params, `${p}.params`); evidence(a.evidence, `${p}.evidence`);
    const rawOverrides = a.overrides;
    if (!rawOverrides || typeof rawOverrides !== 'object' || Array.isArray(rawOverrides)) fail('type', `${p}.overrides`);
    const o = obj(rawOverrides, `${p}.overrides`, [], Object.keys(rawOverrides));
    if (Object.keys(o).length > 5000) fail('budget', `${p}.overrides`);
    for (const [s, x] of Object.entries(o)) {
      if (slotIndex(s, gid, p) >= count) fail('slot', p);
      override(x, `${p}.overrides.${s}`);
    }
    const deleted = arr(a.deleted, `${p}.deleted`), seen = new Set<string>();
    if (deleted.length > 5000) fail('budget', `${p}.deleted`);
    deleted.forEach((x, j) => {
      const s = str(x, `${p}.deleted[${j}]`);
      if (slotIndex(s, gid, p) >= count || seen.has(s)) fail('slot', p);
      seen.add(s);
    });
    groupData.set(gid, { kind, partId: region.partId, count, deleted: seen });
  });
  // Reserve every procedural ID, including tombstones, before accepting explicit IDs.
  const reservedSlots = new Set<string>();
  for (const [gid, g] of groupData) for (let i = 0; i < g.count; i++) {
    const s = slotId(gid, i);
    if (s.length > 128) fail('id', s);
    if (used.has(s) || reservedSlots.has(s)) fail('duplicate', s);
    reservedSlots.add(s);
  }
  elements.forEach((v, i) => {
    const p = `elements[${i}]`;
    const a = obj(v, p, ['id','kind','partId','position','rotation','params','visible','locked','evidence'], ['groupId','original']);
    const key = id(a.id, `${p}.id`, true);
    unique(key, p, used);
    const kind = choice(a.kind, `${p}.kind`, ['feather','strand']);
    const partId = id(a.partId, `${p}.partId`);
    if (!partIds.has(partId)) fail('reference', p);
    if (own(a, 'groupId')) {
      const gid = id(a.groupId, `${p}.groupId`);
      const g = groupData.get(gid);
      if (!g || g.kind !== kind || g.partId !== partId) fail('reference', `${p}.groupId`);
    }
    vec(a.position, `${p}.position`); angles(a.rotation, `${p}.rotation`);
    params(a.params, `${p}.params`);
    bool(a.visible, `${p}.visible`); bool(a.locked, `${p}.locked`);
    evidence(a.evidence, `${p}.evidence`);
    if (own(a, 'original')) {
      const o = obj(a.original, `${p}.original`, ['groupId','slot'], ['override']);
      const gid = id(o.groupId, `${p}.original.groupId`);
      const s = str(o.slot, `${p}.original.slot`);
      const g = groupData.get(gid);
      if (!g || s !== key || slotIndex(s, gid, p) >= 5000 ||
          (slotIndex(s, gid, p) < g.count && !g.deleted.has(s)) || g.kind !== kind || g.partId !== partId ||
          (own(a, 'groupId') && a.groupId !== gid)) fail('reference', `${p}.original`);
      if (own(o, 'override')) override(o.override, `${p}.original.override`);
    } else if (reservedSlots.has(key)) fail('duplicate', p);
  });
  for (const s of reservedSlots) {
    if (used.has(s) && !elements.some(v => {
      const e = v as Element;
      return e.id === s && e.original?.slot === s;
    })) fail('duplicate', s);
  }
  return value as ElementProject;
}
const clone = (p: ElementProject): ElementProject => { validateProject(p); return structuredClone(p); };
const done = (p: ElementProject): ElementProject => validateProject(p);
const find = <T extends { id: string }>(xs: T[], idValue: string): T => xs.find(x => x.id === idValue) ?? fail('notFound', idValue);
const quaternion = (v: Vec3): Quaternion => new Quaternion().setFromEuler(new Euler(...v, 'XYZ'));
const euler = (q: Quaternion): Vec3 => {
  const e = new Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
};
function hash(seed: number, key: string): number {
  let h = 2166136261;
  for (const c of `${seed}:${key}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** Part scale describes mesh dimensions in mm; element roots are mm coordinates, not scaled attachments. */
export function resolveElements(project: ElementProject): ResolvedElement[] {
  validateProject(project);
  const parts = new Map(project.parts.map(p => [p.id, p]));
  const regions = new Map(project.regions.map(r => [r.id, r]));
  const out: ResolvedElement[] = [];
  for (const g of project.groups) {
    const part = parts.get(regions.get(g.regionId)!.partId)!;
    const pq = quaternion(part.rotation), base = quaternion(g.rotation), deleted = new Set(g.deleted);
    for (let i = 0; i < g.count; i++) {
      const id = slotId(g.id, i);
      if (deleted.has(id)) continue;
      const o = own(g.overrides, id) ? g.overrides[id] : undefined;
      const jitter = hash(project.seed, id) * 2 - 1;
      const azimuth = hash(project.seed, `${id}:azimuth`) * 2 * Math.PI;
      const cosPolar = hash(project.seed, `${id}:polar`) * 2 - 1;
      const radial = new Vector3(Math.sqrt(1 - cosPolar * cosPolar) * Math.cos(azimuth), cosPolar,
        Math.sqrt(1 - cosPolar * cosPolar) * Math.sin(azimuth));
      const surface = g.distribution === 'ellipsoid-surface';
      const radii = new Vector3(...part.scale).multiplyScalar(0.5);
      const normal = new Vector3(radial.x / radii.x, radial.y / radii.y, radial.z / radii.z).normalize();
      const local: Vec3 = o?.position ?? (surface ? [radial.x * radii.x, radial.y * radii.y, radial.z * radii.z] : [
        g.root[0] + g.spread[0] * jitter,
        g.root[1] + g.spread[1] * (hash(project.seed, `${id}:y`) * 2 - 1),
        g.root[2] + g.spread[2] * (hash(project.seed, `${id}:z`) * 2 - 1)
      ]);
      const pos = new Vector3(...local).applyQuaternion(pq).add(new Vector3(...part.position));
      out.push({
        id, kind: g.kind, partId: part.id, groupId: g.id,
        position: [pos.x, pos.y, pos.z],
        rotation: euler(pq.clone().multiply(surface ? new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), normal) : new Quaternion()).multiply(base).multiply(quaternion([0, 0, i * g.fan + jitter * 0.025])).multiply(quaternion(o?.rotation ?? [0, 0, 0]))),
        params: { ...g.params, ...o?.params },
        visible: part.visible && (o?.visible ?? true),
        locked: part.locked || (o?.locked ?? false),
        evidence: structuredClone(g.evidence), source: 'generated'
      });
    }
  }
  for (const x of project.elements) {
    const part = parts.get(x.partId)!;
    out.push({
      id: x.id, kind: x.kind, partId: x.partId,
      ...(x.groupId === undefined ? {} : { groupId: x.groupId }),
      position: [...x.position], rotation: [...x.rotation], params: { ...x.params },
      visible: part.visible && x.visible, locked: part.locked || x.locked,
      evidence: structuredClone(x.evidence), source: 'explicit'
    });
  }
  return out;
}
function resolved(p: ElementProject, idValue: string): ResolvedElement {
  return resolveElements(p).find(e => e.id === idValue) ?? fail('notFound', idValue);
}
function generatedGroup(p: ElementProject, idValue: string): Group {
  return find(p.groups, idValue.slice(0, idValue.lastIndexOf('/')));
}
const unlockOnly = (patch: Override | Record<string, unknown>): boolean =>
  Object.keys(patch).length === 1 && own(patch, 'locked') && patch.locked === false;
export function editPart(project: ElementProject, idValue: string, patch: Partial<Pick<Part, 'position' | 'rotation' | 'scale' | 'color' | 'visible' | 'locked' | 'geometry' | 'material' | 'uvScale' | 'axialChamferMm'>>): ElementProject {
  const p = clone(project), x = find(p.parts, idValue);
  const a = obj(patch, 'patch', [], project.schema !== 'morphloom.elements/0.1' ? ['position','rotation','scale','color','visible','locked','geometry','material',...((project.schema==='morphloom.elements/0.4'||project.schema==='morphloom.elements/0.5'||project.schema==='morphloom.elements/0.6')?['uvScale']:[]),...((project.schema==='morphloom.elements/0.5'||project.schema==='morphloom.elements/0.6')?['axialChamferMm']:[])] : ['position','rotation','scale','color','visible','locked']);
  if (own(a,'geometry')) { try { validatePartGeometry(a.geometry,(project.schema==='morphloom.elements/0.3'||project.schema==='morphloom.elements/0.4'||project.schema==='morphloom.elements/0.5'||project.schema==='morphloom.elements/0.6')); } catch { fail('geometry','patch.geometry'); } }
  if (own(a,'material')) { const m = obj(a.material,'patch.material',['roughness','metalness'],project.schema==='morphloom.elements/0.6'?['surface']:[]); if(own(m,'surface'))validatePartSurface(m.surface,'patch.material.surface');num(m.roughness,'material.roughness',0,1); num(m.metalness,'material.metalness',0,1); }
  const checked = {
    ...(own(a, 'position') ? { position: vec(a.position, 'patch.position') } : {}),
    ...(own(a, 'rotation') ? { rotation: angles(a.rotation, 'patch.rotation') } : {}),
    ...(own(a, 'scale') ? { scale: vec(a.scale, 'patch.scale', 0.01, 100_000) } : {}),
    ...(own(a, 'color') ? { color: color(a.color, 'patch.color') } : {}),
    ...(own(a, 'visible') ? { visible: bool(a.visible, 'patch.visible') } : {}),
    ...(own(a, 'locked') ? { locked: bool(a.locked, 'patch.locked') } : {}),
    ...(own(a,'geometry') ? { geometry: structuredClone(a.geometry) as PartGeometry } : {}),
    ...(own(a,'axialChamferMm')?{axialChamferMm:num(a.axialChamferMm,'patch.axialChamferMm',0,100)}:{}),
    ...(own(a,'uvScale') ? {uvScale:num(a.uvScale,'patch.uvScale',0.001,1000)} : {}),
    ...(own(a,'material') ? { material: structuredClone(a.material) as PartMaterial } : {})
  };
  if (x.locked && !unlockOnly(checked)) fail('locked', idValue);
  const candidate={...x,...checked};
  if(candidate.axialChamferMm!==undefined){if(candidate.geometry?.op!=='spur-gear')fail('chamfer','patch.axialChamferMm');const g=compileGearChamfer(candidate.geometry,candidate.axialChamferMm);g.dispose();}
  Object.assign(x, checked);
  return done(p);
}
export function editElement(project: ElementProject, idValue: string, change: Override): ElementProject {
  const p = clone(project), x = resolved(p, idValue);
  const checked = override(change, 'change');
  const part = find(p.parts, x.partId);
  if (part.locked || (x.locked && !unlockOnly(checked))) fail('locked', idValue);
  if (x.source === 'explicit') {
    const e = find(p.elements, idValue);
    if (checked.position) e.position = checked.position;
    if (checked.rotation) e.rotation = checked.rotation;
    if (checked.params) e.params = { ...e.params, ...checked.params };
    if (checked.visible !== undefined) e.visible = checked.visible;
    if (checked.locked !== undefined) e.locked = checked.locked;
  } else {
    const g = generatedGroup(p, idValue);
    g.overrides[idValue] = { ...g.overrides[idValue], ...checked, params: { ...g.overrides[idValue]?.params, ...checked.params } };
  }
  return done(p);
}
export function editGroup(project: ElementProject, idValue: string, patch: { params?: Partial<Params>; count?: number }): { project: ElementProject; receipt: { added: string[]; deleted: string[]; remapped: [] } } {
  const p = clone(project), g = find(p.groups, idValue);
  const beforeIds = new Set(resolveElements(p).map(e => e.id));
  const a = obj(patch, 'patch', [], ['params','count']);
  const changedParams = own(a, 'params') ? params(a.params, 'patch.params', true) : undefined;
  const count = own(a, 'count') ? integer(a.count, 'patch.count', 5000) : undefined;
  const part = find(p.parts, find(p.regions, g.regionId).partId);
  if (part.locked || resolveElements(p).some(e => e.groupId === idValue && e.locked)) fail('locked', idValue);
  if (changedParams) g.params = { ...g.params, ...changedParams };
  if (count !== undefined) {
    g.count = count;
    g.deleted = g.deleted.filter(s => slotIndex(s, g.id, 'deleted') < count);
    for (const e of p.elements) {
      if (e.original?.groupId === g.id && slotIndex(e.id, g.id, 'original') < count && !g.deleted.includes(e.id)) g.deleted.push(e.id);
    }
    for (const s of Object.keys(g.overrides)) if (slotIndex(s, g.id, 'overrides') >= count) delete g.overrides[s];
  }
  const result = done(p);
  const afterIds = new Set(resolveElements(result).map(e => e.id));
  return {
    project: result,
    receipt: {
      added: [...afterIds].filter(id => !beforeIds.has(id)),
      deleted: [...beforeIds].filter(id => !afterIds.has(id)),
      remapped: []
    }
  };
}
export function deleteElement(project: ElementProject, idValue: string): ElementProject {
  const p = clone(project), x = resolved(p, idValue);
  if (x.locked) fail('locked', idValue);
  if (x.source === 'explicit') p.elements.splice(p.elements.findIndex(e => e.id === idValue), 1);
  else {
    const g = generatedGroup(p, idValue);
    g.deleted.push(idValue);
    delete g.overrides[idValue];
  }
  return done(p);
}
export function duplicateElement(project: ElementProject, idValue: string, newId: string): ElementProject {
  const p = clone(project), x = resolved(p, idValue);
  if (x.locked) fail('locked', idValue);
  p.elements.push({
    id: newId, kind: x.kind, partId: x.partId, position: x.position,
    rotation: x.rotation, params: x.params, visible: x.visible,
    locked: false, evidence: x.evidence
  });
  return done(p);
}
export function detachElement(project: ElementProject, idValue: string): ElementProject {
  const p = clone(project), x = resolved(p, idValue);
  if (x.source !== 'generated') fail('notGenerated', idValue);
  if (x.locked) fail('locked', idValue);
  const g = generatedGroup(p, idValue), saved = g.overrides[idValue];
  g.deleted.push(idValue);
  delete g.overrides[idValue];
  p.elements.push({
    id: idValue, kind: x.kind, partId: x.partId, position: x.position,
    rotation: x.rotation, params: x.params, visible: x.visible,
    locked: false, evidence: x.evidence,
    original: { groupId: g.id, slot: idValue, ...(saved ? { override: saved } : {}) }
  });
  return done(p);
}
export function restoreElement(project: ElementProject, idValue: string): ElementProject {
  const p = clone(project), e = find(p.elements, idValue);
  if (!e.original) fail('notDetached', idValue);
  if (e.locked || find(p.parts, e.partId).locked) fail('locked', idValue);
  const o = e.original, g = p.groups.find(x => x.id === o.groupId);
  if (!g || slotIndex(o.slot, g.id, idValue) >= g.count || !g.deleted.includes(o.slot)) fail('slotRemoved', idValue);
  // Restore the saved procedural attachment. Detached world position/rotation
  // edits are discarded; current params, visibility and lock state are retained.
  g.overrides[o.slot] = {
    ...o.override,
    params: { ...e.params },
    visible: e.visible,
    locked: e.locked
  };
  g.deleted = g.deleted.filter(s => s !== o.slot);
  p.elements.splice(p.elements.indexOf(e), 1);
  return done(p);
}
export function detachPart(project: ElementProject, idValue: string, offset: Vec3 = [30, 0, 0]): ElementProject {
  const p = clone(project), part = find(p.parts, idValue);
  if (part.locked) fail('locked', idValue);
  const delta = vec(offset, 'offset');
  if (!part.home) part.home = { position: [...part.position], rotation: [...part.rotation], ...(part.assemblyId ? {assemblyId: part.assemblyId} : {}) };
  delete part.assemblyId;
  part.position = vec(part.position.map((n, i) => n + delta[i]), 'position');
  return done(p);
}
export function restorePart(project: ElementProject, idValue: string): ElementProject {
  const p = clone(project), part = find(p.parts, idValue);
  if (part.locked) fail('locked', idValue);
  if (!part.home) fail('notDetached', idValue);
  part.position = part.home.position;
  part.rotation = part.home.rotation;
  if (part.home.assemblyId) part.assemblyId = part.home.assemblyId;
  delete part.home;
  return done(p);
}
export function serializeProject(project: ElementProject): string {
  validateProject(project);
  const text = project.schema !== 'morphloom.elements/0.1'
    ? JSON.stringify(project, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) : value)
    : JSON.stringify(project);
  if (text.length > 2_000_000 || new TextEncoder().encode(text).length > 2_000_000) fail('size', 'project');
  return text;
}
export function parseProject(text: string): ElementProject {
  if (text.length > 2_000_000 || new TextEncoder().encode(text).length > 2_000_000) fail('size', 'project');
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail('json', 'project'); }
  return validateProject(value);
}
/** Selection is optional editor state; references may be stale after an undo and must be resolved by the UI. */
export class ElementHistory {
  private states: ElementProject[];
  private index = 0;
  constructor(initial: ElementProject) {
    serializeProject(initial);
    this.states = [clone(initial)];
  }
  get current(): ElementProject { return structuredClone(this.states[this.index]); }
  commit(project: ElementProject): void {
    serializeProject(project);
    const next = clone(project);
    this.states = this.states.slice(0, this.index + 1);
    this.states.push(next);
    if (this.states.length > 30) this.states.shift();
    this.index = this.states.length - 1;
  }
  undo(): ElementProject { if (this.index > 0) this.index--; return this.current; }
  redo(): ElementProject { if (this.index < this.states.length - 1) this.index++; return this.current; }
}

/** Lossless explicit opt-in migration. Legacy parsing does not silently rewrite source files. */
export function migrateElementProject(value: unknown): ElementProject {
  const p = structuredClone(validateProject(value));
  p.schema = 'morphloom.elements/0.2';
  return validateProject(p);
}

/** Explicit lossless opt-in; old migration to 0.2 remains unchanged. */
export function migrateElementProjectToV3(value:unknown):ElementProject{
  const p=structuredClone(validateProject(value));p.schema='morphloom.elements/0.3';return validateProject(p);
}

/** Explicit migration: no default UV operation is inserted. */
export function migrateElementProjectToV4(value:unknown):ElementProject {
 const p=structuredClone(validateProject(value));p.schema='morphloom.elements/0.4';return validateProject(p);
}

/** No modifier default is inserted by migration. */
export function migrateElementProjectToV5(value:unknown):ElementProject{const p=structuredClone(validateProject(value));p.schema='morphloom.elements/0.5';return validateProject(p);}

export function validatePartSurface(value:unknown,path='material.surface'):asserts value is PartSurface{
 const s=obj(value,path,['finish','channels','repeat']);choice(s.finish,path+'.finish',['brushed-metal','bead-blasted-metal','anodized-metal']);choice(s.channels,path+'.channels',['roughness-only']);const values=arr(s.repeat,path+'.repeat');if(values.length!==2)fail('length',path+'.repeat');values.forEach((v,i)=>num(v,`${path}.repeat[${i}]`,.125,1024));
}
export function migrateElementProjectToV6(value:unknown):ElementProject{const p=structuredClone(validateProject(value));p.schema='morphloom.elements/0.6';return validateProject(p);}
