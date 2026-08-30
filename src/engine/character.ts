import * as THREE from 'three';
import type { CharacterSpec, HumanPack, PoseStyle, ViewMode } from '../types';
import { morphPositions } from './morph';
import { createSurfaceMaterial, inspectSurfaceSystem, type SurfaceReport } from './surface-system';
import { createWebHeroDetails } from './web-hero';

export interface CharacterMetrics {
  vertices: number;
  triangles: number;
  heightMeters: number;
  bounds: THREE.Box3;
  headCenter: THREE.Vector3;
  headRadius: number;
  frontZ: number;
  torsoFrontZ: number;
  surfaces: SurfaceReport;
  renderedVertices: number;
  renderedTriangles: number;
  namedDetailParts: number;
  inferredDetailParts: number;
}

export interface CharacterBuild {
  root: THREE.Group;
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  rig: THREE.Group;
  metrics: CharacterMetrics;
}

interface BodyTopology {
  boundary: number;
  indices: Uint32Array;
}

const bodyTopologyCache = new WeakMap<HumanPack, BodyTopology>();

/**
 * MakeHuman stores the visible skin first and appends helper tights/joint
 * geometry as disconnected suffixes. Find the first clean triangle cut that
 * already spans the full person, then keep only the skin triangles.
 */
export function deriveBodyTopology(pack: HumanPack): BodyTopology {
  const cached = bodyTopologyCache.get(pack);
  if (cached) return cached;
  const positions = pack.positions;
  const indices = pack.indices;
  const vertexCount = positions.length / 3;
  const diff = new Int32Array(vertexCount + 2);
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index];
    const b = indices[index + 1];
    const c = indices[index + 2];
    const min = Math.min(a, b, c);
    const max = Math.max(a, b, c);
    diff[min + 1] += 1;
    if (max < vertexCount) diff[max + 1] -= 1;
  }
  let fullMinY = Number.POSITIVE_INFINITY;
  let fullMaxY = Number.NEGATIVE_INFINITY;
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const y = positions[vertex * 3 + 1];
    fullMinY = Math.min(fullMinY, y);
    fullMaxY = Math.max(fullMaxY, y);
  }
  const fullHeight = fullMaxY - fullMinY;
  let boundary = vertexCount;
  let running = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let cut = 1; cut < vertexCount; cut += 1) {
    const y = positions[(cut - 1) * 3 + 1];
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    running += diff[cut];
    if (running === 0 && maxY - minY >= fullHeight * 0.93 && cut >= vertexCount * 0.5) {
      boundary = cut;
      break;
    }
  }
  const bodyIndices: number[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index];
    const b = indices[index + 1];
    const c = indices[index + 2];
    if (a < boundary && b < boundary && c < boundary) bodyIndices.push(a, b, c);
  }
  const topology = { boundary, indices: Uint32Array.from(bodyIndices) };
  bodyTopologyCache.set(pack, topology);
  return topology;
}

function mixHex(a: string, b: string, amount: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), amount);
}

function smoothstep(min: number, max: number, value: number): number {
  const normalized = THREE.MathUtils.clamp((value - min) / Math.max(0.000_001, max - min), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

/**
 * A deterministic, topology-preserving pose estimate for the supplied
 * front-three-quarter reference. It bends the existing editable body instead
 * of replacing it with a baked render or a second disconnected mesh.
 */
export function poseCharacterPoint(source: THREE.Vector3, height: number, pose: PoseStyle): THREE.Vector3 {
  const point = source.clone();
  if (pose !== 'reference-action') return point;

  const y01 = THREE.MathUtils.clamp(point.y / Math.max(height, 0.001), 0, 1);
  const side = point.x < 0 ? -1 : 1;
  const armHeight = smoothstep(0.44, 0.56, y01) * (1 - smoothstep(0.79, 0.86, y01));
  const armReach = smoothstep(height * 0.085, height * 0.19, Math.abs(point.x));
  const arm = armHeight * armReach;
  const hand = arm * smoothstep(height * 0.18, height * 0.285, Math.abs(point.x));

  // Both hands project toward the camera like the source web-shooting action.
  // The asymmetric lift avoids a mirrored mannequin pose.
  point.z += height * (0.12 * arm + 0.3 * hand);
  point.y += height * hand * (side < 0 ? 0.095 : 0.055);
  point.x *= 1 - arm * 0.12 - hand * (side < 0 ? 0.38 : 0.16);

  // Subtle upper-body lean inferred from the visible shoulder/waist axis.
  const upperLean = smoothstep(0.5, 0.9, y01) * (1 - arm * 0.38);
  point.z += height * 0.034 * upperLean;

  const headTilt = smoothstep(0.81, 0.89, y01) * -0.12;
  if (headTilt !== 0) {
    const pivotY = height * 0.835;
    const dx = point.x;
    const dy = point.y - pivotY;
    const cosine = Math.cos(headTilt);
    const sine = Math.sin(headTilt);
    point.x = dx * cosine - dy * sine;
    point.y = pivotY + dx * sine + dy * cosine;
  }

  // One knee advances and the other recedes. The falloff returns to zero at
  // hip/ankle, so the skin remains continuous and the sole stays grounded.
  const leg = 1 - smoothstep(0.5, 0.58, y01);
  const knee = Math.pow(Math.max(0, 1 - Math.abs(y01 - 0.29) / 0.25), 1.55) * leg;
  point.z += height * knee * (side < 0 ? 0.105 : -0.068);
  point.x += height * knee * (side < 0 ? -0.025 : -0.045);
  return point;
}

function transformBody(pack: HumanPack, spec: CharacterSpec, boundary: number): Float32Array {
  const source = morphPositions(pack, spec);
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  const bodyLength = boundary * 3;
  for (let i = 0; i < bodyLength; i += 3) {
    point.set(source[i], source[i + 1], source[i + 2]);
    bounds.expandByPoint(point);
  }

  const rawSize = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = spec.heightCm / 100 / rawSize.y;
  const out = new Float32Array(bodyLength);
  const headPivot = bounds.min.y + rawSize.y * 0.89;

  for (let i = 0; i < bodyLength; i += 3) {
    const rawX = source[i];
    const rawY = source[i + 1];
    const rawZ = source[i + 2];
    const y01 = (rawY - bounds.min.y) / rawSize.y;

    let widthFactor = 1;
    if (y01 > 0.52 && y01 < 0.82) {
      const shoulderBand = Math.sin(((y01 - 0.52) / 0.3) * Math.PI);
      widthFactor += (spec.shoulderScale - 1) * shoulderBand;
    }

    let x = (rawX - center.x) * widthFactor;
    let y = rawY - bounds.min.y;
    let z = rawZ - center.z;

    if (spec.outfit === 'web-hero' && y01 > 0.64 && y01 < 0.82 && Math.abs(x) < rawSize.x * 0.24 && z > 0) {
      const chestBand = Math.sin(((y01 - 0.64) / 0.18) * Math.PI);
      z *= 1 - chestBand * 0.43;
    }
    if (spec.outfit === 'web-hero' && y01 > 0.4 && y01 < 0.64) {
      const hipBand = Math.sin(((y01 - 0.4) / 0.24) * Math.PI);
      x *= 1 - hipBand * 0.095;
    }

    if (y01 < 0.54) y *= spec.legScale;
    else y += rawSize.y * 0.54 * (spec.legScale - 1);

    if (y01 > 0.84) {
      x *= spec.headScale;
      z *= spec.headScale;
      y = headPivot + (rawY - headPivot) * spec.headScale - bounds.min.y;
    }

    out[i] = x * scale;
    out[i + 1] = y * scale;
    out[i + 2] = z * scale;
  }
  let finalMinY = Number.POSITIVE_INFINITY;
  let finalMaxY = Number.NEGATIVE_INFINITY;
  for (let index = 1; index < out.length; index += 3) {
    finalMinY = Math.min(finalMinY, out[index]);
    finalMaxY = Math.max(finalMaxY, out[index]);
  }
  const finalScale = spec.heightCm / 100 / Math.max(0.001, finalMaxY - finalMinY);
  for (let index = 0; index < out.length; index += 3) {
    out[index] *= finalScale;
    out[index + 1] = (out[index + 1] - finalMinY) * finalScale;
    out[index + 2] *= finalScale;
    if (spec.pose === 'reference-action') {
      point.set(out[index], out[index + 1], out[index + 2]);
      const posed = poseCharacterPoint(point, spec.heightCm / 100, spec.pose);
      out[index] = posed.x;
      out[index + 1] = posed.y;
      out[index + 2] = posed.z;
    }
  }
  return out;
}

function buildVertexColors(positions: Float32Array, spec: CharacterSpec): Float32Array {
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    point.set(positions[i], positions[i + 1], positions[i + 2]);
    bounds.expandByPoint(point);
  }

  const size = bounds.getSize(new THREE.Vector3());
  const skin = new THREE.Color(spec.skinTone);
  const suit = new THREE.Color(spec.suitColor);
  const accent = new THREE.Color(spec.accentColor);
  const colors = new Float32Array(positions.length);

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y01 = (positions[i + 1] - bounds.min.y) / size.y;
    const x01 = Math.abs(x) / Math.max(size.x * 0.5, 0.001);
    const isHead = y01 > 0.835;
    const isHand = x01 > 0.79 && y01 > 0.48 && y01 < 0.77;
    const isCollar = y01 > 0.77 && y01 < 0.835 && x01 < 0.3;
    const accentPanel =
      spec.outfit === 'field' && y01 > 0.56 && y01 < 0.73 && Math.abs(x) < size.x * 0.055;

    if (spec.outfit === 'web-hero') {
      const isMask = y01 > 0.835;
      const isBoot = y01 < 0.16;
      const isLeg = y01 < 0.56;
      const isForearmOrGlove = x01 > 0.66 && y01 >= 0.46 && y01 < 0.7;
      const isUpperArm = x01 > 0.5 && y01 >= 0.64 && y01 < 0.81;
      const isRedTorso = y01 >= 0.57 && y01 < 0.84 && Math.abs(x) < size.x * 0.105;
      const isRedPelvis = y01 >= 0.47 && y01 < 0.59 && Math.abs(x) < size.x * 0.065;
      const color = isMask || isBoot || isForearmOrGlove || isRedTorso || isRedPelvis
        ? suit
        : isLeg || isUpperArm
          ? accent
          : mixHex(spec.accentColor, '#081528', 0.12);
      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
      continue;
    }

    let color = isHead || isHand || isCollar ? skin : suit;
    if (accentPanel) color = accent;
    if (!isHead && !isHand && !isCollar && y01 < 0.48) {
      color = mixHex(spec.suitColor, '#0e1014', 0.18);
    }

    colors[i] = color.r;
    colors[i + 1] = color.g;
    colors[i + 2] = color.b;
  }
  return colors;
}

function createHair(metrics: Pick<CharacterMetrics, 'headRadius' | 'headCenter'>, spec: CharacterSpec): THREE.Group {
  const group = new THREE.Group();
  group.name = 'hair';
  if (spec.hairStyle === 'none') return group;

  const radius = metrics.headRadius * (spec.hairStyle === 'bob' ? 1.08 : 1.015);
  const material = createSurfaceMaterial({
    color: spec.hairColor,
    surface: 'hair',
    roughness: 0.66,
    textureScale: [24, 5],
  }, { mode: 'beauty', category: 'human', materialName: '머리카락 섬유' });
  material.side = THREE.DoubleSide;

  const thetaLength = spec.hairStyle === 'bob' ? Math.PI * 0.62 : Math.PI * 0.49;
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 72, 36, 0, Math.PI * 2, 0, thetaLength),
    material,
  );
  cap.name = 'hair_cap';
  cap.position.copy(metrics.headCenter).add(new THREE.Vector3(0, metrics.headRadius * 0.15, -metrics.headRadius * 0.055));
  cap.scale.set(0.94, spec.hairStyle === 'buzz' ? 0.89 : 1.01, 1.01);
  cap.castShadow = true;
  group.add(cap);

  if (spec.hairStyle === 'bob') {
    const strandCount = 24;
    for (let i = 0; i < strandCount; i += 1) {
      const angle = (i / strandCount) * Math.PI * 2;
      const frontBias = Math.max(0, Math.cos(angle));
      const length = metrics.headRadius * (spec.hairStyle === 'bob' ? 1.15 : 0.34 + frontBias * 0.12);
      const strand = new THREE.Mesh(
        new THREE.CapsuleGeometry(metrics.headRadius * 0.055, length, 3, 8),
        material,
      );
      strand.name = `hair_strand_${String(i).padStart(2, '0')}`;
      strand.position.set(
        metrics.headCenter.x + Math.sin(angle) * radius * 0.76,
        metrics.headCenter.y - length * 0.18,
        metrics.headCenter.z + Math.cos(angle) * radius * 0.76,
      );
      strand.rotation.z = Math.sin(angle) * 0.23;
      strand.rotation.x = Math.cos(angle) * 0.16;
      strand.castShadow = true;
      group.add(strand);
    }
  }
  return group;
}

function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) {
  const direction = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 10), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function createRig(metrics: Pick<CharacterMetrics, 'heightMeters'>, pose: PoseStyle): THREE.Group {
  const rig = new THREE.Group();
  rig.name = 'humanoid_rig_preview';
  const h = metrics.heightMeters;
  const shoulder = h * 0.15;
  const hip = h * 0.09;
  const points: Record<string, THREE.Vector3> = {
    hips: new THREE.Vector3(0, h * 0.52, 0),
    spine: new THREE.Vector3(0, h * 0.68, 0),
    chest: new THREE.Vector3(0, h * 0.77, 0),
    neck: new THREE.Vector3(0, h * 0.84, 0),
    head: new THREE.Vector3(0, h * 0.93, 0),
    shoulderL: new THREE.Vector3(-shoulder, h * 0.78, 0),
    shoulderR: new THREE.Vector3(shoulder, h * 0.78, 0),
    elbowL: new THREE.Vector3(-h * 0.25, h * 0.64, 0),
    elbowR: new THREE.Vector3(h * 0.25, h * 0.64, 0),
    wristL: new THREE.Vector3(-h * 0.31, h * 0.5, 0),
    wristR: new THREE.Vector3(h * 0.31, h * 0.5, 0),
    hipL: new THREE.Vector3(-hip, h * 0.5, 0),
    hipR: new THREE.Vector3(hip, h * 0.5, 0),
    kneeL: new THREE.Vector3(-hip, h * 0.27, 0),
    kneeR: new THREE.Vector3(hip, h * 0.27, 0),
    ankleL: new THREE.Vector3(-hip, h * 0.055, 0),
    ankleR: new THREE.Vector3(hip, h * 0.055, 0),
  };
  for (const [name, position] of Object.entries(points)) {
    points[name] = poseCharacterPoint(position, h, pose);
  }
  const links: Array<[string, string]> = [
    ['hips', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head'],
    ['chest', 'shoulderL'], ['shoulderL', 'elbowL'], ['elbowL', 'wristL'],
    ['chest', 'shoulderR'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
    ['hips', 'hipL'], ['hipL', 'kneeL'], ['kneeL', 'ankleL'],
    ['hips', 'hipR'], ['hipR', 'kneeR'], ['kneeR', 'ankleR'],
  ];
  const material = new THREE.MeshBasicMaterial({ color: '#ff644b', depthTest: false, transparent: true, opacity: 0.9 });
  for (const [from, to] of links) {
    const bone = cylinderBetween(points[from], points[to], h * 0.006, material);
    bone.name = `${from}_${to}`;
    bone.renderOrder = 10;
    rig.add(bone);
  }
  for (const [name, position] of Object.entries(points)) {
    const joint = new THREE.Mesh(new THREE.SphereGeometry(h * 0.011, 12, 8), material);
    joint.name = name;
    joint.position.copy(position);
    joint.renderOrder = 10;
    rig.add(joint);
  }
  return rig;
}

export function buildCharacter(pack: HumanPack, spec: CharacterSpec, mode: ViewMode): CharacterBuild {
  const topology = deriveBodyTopology(pack);
  const positions = transformBody(pack, spec, topology.boundary);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(buildVertexColors(positions, spec), 3));
  if (pack.uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(pack.uvs.slice(0, topology.boundary * 2), 2));
  geometry.setIndex(new THREE.BufferAttribute(topology.indices.slice(), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const bounds = geometry.boundingBox?.clone() ?? new THREE.Box3();
  const size = bounds.getSize(new THREE.Vector3());
  const headBounds = new THREE.Box3();
  const headFloor = bounds.min.y + size.y * 0.845;
  const point = new THREE.Vector3();
  for (let index = 0; index < positions.length; index += 3) {
    if (positions[index + 1] < headFloor) continue;
    point.set(positions[index], positions[index + 1], positions[index + 2]);
    headBounds.expandByPoint(point);
  }
  const headSize = headBounds.getSize(new THREE.Vector3());
  const headCenter = headBounds.getCenter(new THREE.Vector3());
  const headRadius = Math.max(headSize.x * 0.5, headSize.z * 0.53);
  let torsoFrontZ = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < positions.length; index += 3) {
    const y01 = positions[index + 1] / Math.max(spec.heightCm / 100, 0.001);
    if (y01 < 0.57 || y01 > 0.82 || Math.abs(positions[index]) > spec.heightCm / 100 * 0.14) continue;
    torsoFrontZ = Math.max(torsoFrontZ, positions[index + 2]);
  }
  if (!Number.isFinite(torsoFrontZ)) torsoFrontZ = bounds.max.z;
  const metrics = {
    vertices: positions.length / 3,
    triangles: topology.indices.length / 3,
    heightMeters: size.y,
    bounds,
    headCenter,
    headRadius,
    frontZ: bounds.max.z,
    torsoFrontZ,
  } as Omit<CharacterMetrics, 'surfaces'>;

  const webHero = spec.outfit === 'web-hero';
  const bodyMaterial = createSurfaceMaterial(webHero ? {
    color: '#858990', surface: 'hex-knit', roughness: 0.72, sheen: 0.5,
    clearcoat: 0.08, clearcoatRoughness: 0.58, microNormalStrength: 0.68, textureScale: [34, 42],
  } : {
    color: '#ffffff', surface: 'skin', roughness: 0.56, sheen: 0.17, microNormalStrength: 0.13,
  }, { mode, category: 'human', materialName: webHero ? '웹 히어로 편집형 패브릭 슈트' : '연속형 피부/의상 베이스' });
  bodyMaterial.vertexColors = mode !== 'clay';
  const body = new THREE.Mesh(geometry, bodyMaterial);
  body.name = 'morphloom_human_body';
  body.castShadow = true;
  body.receiveShadow = true;

  const root = new THREE.Group();
  root.name = 'morphloom_character';
  root.userData.characterIR = { version: '0.1', spec: structuredClone(spec) };
  root.add(body);
  if (mode === 'beauty' && !webHero) root.add(createHair(metrics, spec));
  const heroDetails = webHero ? createWebHeroDetails(metrics, mode, spec.pose) : undefined;
  if (heroDetails) {
    root.add(heroDetails.group);
    root.userData.characterIR.evidence = structuredClone(heroDetails.group.userData.referenceEvidence);
  }
  const rig = createRig(metrics, spec.pose);
  rig.visible = mode === 'rig';
  root.add(rig);

  let renderedVertices = 0;
  let renderedTriangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    renderedVertices += position?.count ?? 0;
    renderedTriangles += (object.geometry.getIndex()?.count ?? position?.count ?? 0) / 3;
  });
  const completeMetrics: CharacterMetrics = {
    ...metrics,
    surfaces: inspectSurfaceSystem(root),
    renderedVertices,
    renderedTriangles: Math.round(renderedTriangles),
    namedDetailParts: heroDetails?.namedParts ?? 0,
    inferredDetailParts: heroDetails?.inferredParts.length ?? 0,
  };
  root.userData.surfaceSystem = completeMetrics.surfaces;
  return { root, body, rig, metrics: completeMetrics };
}
