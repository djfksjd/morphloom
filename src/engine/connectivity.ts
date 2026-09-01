import * as THREE from 'three';
import type { ViewMode } from '../types';
import type {
  ElectricalHarnessIR,
  ElectricalPortIR,
  ElectricalWireIR,
} from './assembly-ir';
import type { ProductPartInfo } from './product';
import { createSurfaceMaterial } from './surface-system';
import { analyzeSelfIntersections } from './self-intersection';

const mm = (value: number) => value / 1000;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,80}$/;
const ELECTRICAL_SIGNALS = new Set(['power', 'ground', 'data', 'rf', 'audio', 'sensor', 'control']);
const VERIFICATION_STATES = new Set(['datasheet', 'design', 'bench-required', 'bench-verified', 'inferred']);

export interface ConnectivityReport {
  ports: number;
  requiredPorts: number;
  connectedRequiredPorts: number;
  wires: number;
  connectedWires: number;
  danglingWires: number;
  openRequiredPorts: number;
  overloadedPorts: number;
  offComponentPorts: number;
  portOutsideDistanceMaxMm: number;
  endpointErrorMaxMm: number;
  documentedPhysicalPins: number;
  specifiedGaugeWires: number;
  documentedVerificationWires: number;
  benchRequiredWires: number;
  benchVerifiedWires: number;
  inferredWires: number;
  outstandingBenchChecks: number;
  liveAnchors: boolean;
  productionReady: boolean;
  errors: string[];
}

function finiteVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value)
    && value.length === 3
    && value.every((item) => typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1_000_000);
}

/**
 * Validates the electrical graph before any geometry is allocated. A required
 * port must be used and every conductor must terminate on two real component
 * ports with a compatible signal class.
 */
export function inspectElectricalHarness(
  harness: ElectricalHarnessIR,
  componentIds: ReadonlySet<string>,
): ConnectivityReport {
  const errors: string[] = [];
  const ports = new Map<string, ElectricalPortIR>();
  const connections = new Map<string, number>();
  const wireIds = new Set<string>();
  let documentedPhysicalPins = 0;
  const portList = Array.isArray(harness.ports) ? harness.ports : [];
  const wireList = Array.isArray(harness.wires) ? harness.wires : [];

  if (!Array.isArray(harness.ports) || harness.ports.length > 2_000) {
    errors.push('Electrical harness must contain at most 2,000 ports.');
  }
  if (!Array.isArray(harness.wires) || harness.wires.length > 2_000) {
    errors.push('Electrical harness must contain at most 2,000 wires.');
  }

  for (const port of portList) {
    if (!port || typeof port !== 'object') {
      errors.push('Electrical harness contains an invalid port record.');
      continue;
    }
    if (!SAFE_ID.test(port.id) || ports.has(port.id)) errors.push(`Invalid or duplicate port id: ${port.id}`);
    if (!componentIds.has(port.componentId)) errors.push(`Port ${port.id} references missing component ${port.componentId}.`);
    if (!finiteVec3(port.position)) errors.push(`Port ${port.id} has an unsafe position.`);
    if (port.direction && !finiteVec3(port.direction)) errors.push(`Port ${port.id} has an unsafe direction.`);
    if (!port.pin || port.pin.length > 80) errors.push(`Port ${port.id} has an invalid pin label.`);
    if (!ELECTRICAL_SIGNALS.has(port.signal)) errors.push(`Port ${port.id} has an invalid signal class.`);
    if (port.physicalPin !== undefined) {
      if (typeof port.physicalPin !== 'string' || port.physicalPin.trim().length < 1 || port.physicalPin.length > 120) {
        errors.push(`Port ${port.id} has an invalid physical pin label.`);
      } else {
        documentedPhysicalPins += 1;
      }
    }
    const maxConnections = port.maxConnections ?? 1;
    if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 64) {
      errors.push(`Port ${port.id} has an invalid maxConnections value.`);
    }
    ports.set(port.id, port);
    connections.set(port.id, 0);
  }

  let connectedWires = 0;
  let specifiedGaugeWires = 0;
  let documentedVerificationWires = 0;
  let benchRequiredWires = 0;
  let benchVerifiedWires = 0;
  let inferredWires = 0;
  for (const wire of wireList) {
    if (!wire || typeof wire !== 'object') {
      errors.push('Electrical harness contains an invalid wire record.');
      continue;
    }
    if (!SAFE_ID.test(wire.id) || wireIds.has(wire.id)) errors.push(`Invalid or duplicate wire id: ${wire.id}`);
    wireIds.add(wire.id);
    if (!wire.name || wire.name.length > 120) errors.push(`Wire ${wire.id} has an invalid name.`);
    if (!SAFE_ID.test(wire.net)) errors.push(`Wire ${wire.id} has an invalid net id.`);
    if (!ELECTRICAL_SIGNALS.has(wire.signal)) errors.push(`Wire ${wire.id} has an invalid signal class.`);
    if (!Number.isFinite(wire.diameter) || wire.diameter <= 0 || wire.diameter > 20) {
      errors.push(`Wire ${wire.id} has an unsafe diameter.`);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(wire.color)) errors.push(`Wire ${wire.id} has an invalid color.`);
    if (wire.gauge !== undefined) {
      if (typeof wire.gauge !== 'string' || wire.gauge.length > 32 || !/^(?:\d{1,2}(?:\.\d+)?AWG|\d+(?:\.\d+)?mm2)$/i.test(wire.gauge)) {
        errors.push(`Wire ${wire.id} has an invalid conductor gauge.`);
      } else {
        specifiedGaugeWires += 1;
      }
    }
    if (wire.verification === 'bench-required') benchRequiredWires += 1;
    else if (wire.verification === 'bench-verified') benchVerifiedWires += 1;
    else if (wire.verification === 'inferred') inferredWires += 1;
    else if (wire.verification !== undefined && !VERIFICATION_STATES.has(wire.verification)) {
      errors.push(`Wire ${wire.id} has an invalid verification state.`);
    }
    if (wire.verification !== undefined && VERIFICATION_STATES.has(wire.verification)) documentedVerificationWires += 1;
    if (wire.from === wire.to) errors.push(`Wire ${wire.id} cannot connect a port to itself.`);
    if (wire.waypoints && (wire.waypoints.length > 128 || wire.waypoints.some((point) => !finiteVec3(point)))) {
      errors.push(`Wire ${wire.id} has unsafe waypoints.`);
    }
    const from = ports.get(wire.from);
    const to = ports.get(wire.to);
    if (!from) errors.push(`Wire ${wire.id} references missing source port ${wire.from}.`);
    if (!to) errors.push(`Wire ${wire.id} references missing destination port ${wire.to}.`);
    if (from && to) {
      if (from.signal !== wire.signal || to.signal !== wire.signal) {
        errors.push(`Wire ${wire.id} signal does not match both endpoint ports.`);
      } else {
        connectedWires += 1;
      }
      connections.set(from.id, (connections.get(from.id) ?? 0) + 1);
      connections.set(to.id, (connections.get(to.id) ?? 0) + 1);
    }
  }

  let requiredPorts = 0;
  let connectedRequiredPorts = 0;
  let overloadedPorts = 0;
  for (const port of ports.values()) {
    const count = connections.get(port.id) ?? 0;
    if (port.required !== false) {
      requiredPorts += 1;
      if (count > 0) connectedRequiredPorts += 1;
      else errors.push(`Required port ${port.id} is open.`);
    }
    if (count > (port.maxConnections ?? 1)) {
      overloadedPorts += 1;
      errors.push(`Port ${port.id} exceeds its connection limit.`);
    }
  }
  if (harness.verificationScope !== undefined && (typeof harness.verificationScope !== 'string' || harness.verificationScope.length > 500)) {
    errors.push('Electrical harness has an invalid verification scope.');
  }
  const passiveNodes = Array.isArray(harness.passiveNodes) ? harness.passiveNodes : [];
  if (harness.passiveNodes !== undefined && !Array.isArray(harness.passiveNodes)) errors.push('Electrical passiveNodes must be an array.');
  if (passiveNodes.length > 256) errors.push('Electrical harness must contain at most 256 passive nodes.');
  for (const node of passiveNodes) {
    if (!node || typeof node !== 'object'
      || typeof node.ref !== 'string' || node.ref.length < 1 || node.ref.length > 120
      || typeof node.node !== 'string' || node.node.length < 1 || node.node.length > 500
      || typeof node.detail !== 'string' || node.detail.length > 500
      || !VERIFICATION_STATES.has(node.verification)) {
      errors.push('Electrical harness contains an invalid passive node.');
    }
  }
  const benchChecks = Array.isArray(harness.benchChecks) ? harness.benchChecks : [];
  if (harness.benchChecks !== undefined && !Array.isArray(harness.benchChecks)) errors.push('Electrical benchChecks must be an array.');
  if (benchChecks.length > 128) errors.push('Electrical harness must contain at most 128 bench checks.');
  const benchIds = new Set<string>();
  for (const check of benchChecks) {
    if (!check || typeof check !== 'object' || !SAFE_ID.test(check.id) || benchIds.has(check.id) || !check.instruction || check.instruction.length > 500 || !['required', 'passed', 'failed'].includes(check.status)) {
      errors.push('Electrical harness contains an invalid bench check.');
      continue;
    }
    benchIds.add(check.id);
  }
  const outstandingBenchChecks = benchChecks.filter((check) => check.status !== 'passed').length;

  return {
    ports: ports.size,
    requiredPorts,
    connectedRequiredPorts,
    wires: wireList.length,
    connectedWires,
    danglingWires: wireList.length - connectedWires,
    openRequiredPorts: requiredPorts - connectedRequiredPorts,
    overloadedPorts,
    offComponentPorts: 0,
    portOutsideDistanceMaxMm: 0,
    endpointErrorMaxMm: 0,
    documentedPhysicalPins,
    specifiedGaugeWires,
    documentedVerificationWires,
    benchRequiredWires,
    benchVerifiedWires,
    inferredWires,
    outstandingBenchChecks,
    liveAnchors: false,
    productionReady: errors.length === 0 && benchRequiredWires === 0 && inferredWires === 0 && outstandingBenchChecks === 0,
    errors,
  };
}

export function validateElectricalHarness(
  harness: ElectricalHarnessIR,
  componentIds: ReadonlySet<string>,
): ConnectivityReport {
  const report = inspectElectricalHarness(harness, componentIds);
  if (report.errors.length > 0) throw new Error(`Electrical connectivity failed: ${report.errors.join(' ')}`);
  return report;
}

function resolvePortPosition(root: THREE.Group, component: THREE.Object3D, port: ElectricalPortIR): THREE.Vector3 {
  root.updateMatrixWorld(true);
  const world = component.localToWorld(new THREE.Vector3(...port.position.map(mm) as [number, number, number]));
  return root.worldToLocal(world);
}

function resolvePortDirection(root: THREE.Group, component: THREE.Object3D, port: ElectricalPortIR): THREE.Vector3 {
  const direction = new THREE.Vector3(...(port.direction ?? [0, 0, 1]));
  if (direction.lengthSq() < 1e-10) direction.set(0, 0, 1);
  const componentWorld = component.getWorldQuaternion(new THREE.Quaternion());
  const rootWorldInverse = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  direction.normalize().applyQuaternion(componentWorld).applyQuaternion(rootWorldInverse);
  return direction.normalize();
}

function createRoundedRoute(points: THREE.Vector3[], radius: number): THREE.Curve<THREE.Vector3> {
  const curve = new THREE.CurvePath<THREE.Vector3>();
  let cursor = points[0]!.clone();
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const corner = points[index]!;
    const next = points[index + 1]!;
    const incomingLength = previous.distanceTo(corner);
    const outgoingLength = corner.distanceTo(next);
    if (incomingLength < 1e-9 || outgoingLength < 1e-9) continue;
    const cut = Math.min(radius * 3, incomingLength * 0.24, outgoingLength * 0.24);
    const entry = corner.clone().lerp(previous, cut / incomingLength);
    const exit = corner.clone().lerp(next, cut / outgoingLength);
    if (cursor.distanceToSquared(entry) > 1e-18) curve.add(new THREE.LineCurve3(cursor, entry));
    curve.add(new THREE.QuadraticBezierCurve3(entry, corner, exit));
    cursor = exit;
  }
  const end = points[points.length - 1]!.clone();
  if (cursor.distanceToSquared(end) > 1e-18) curve.add(new THREE.LineCurve3(cursor, end));
  return curve;
}

function createCappedTube(points: THREE.Vector3[], radius: number): THREE.BufferGeometry {
  const curve = createRoundedRoute(points, radius);
  const tubularSegments = Math.max(36, Math.min(192, points.length * 14));
  const radialSegments = 10;
  const tube = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false);
  const sourcePosition = tube.getAttribute('position');
  const sourceNormal = tube.getAttribute('normal');
  const sourceUv = tube.getAttribute('uv');
  const position = new Float32Array((sourcePosition.count + 2) * 3);
  const normal = new Float32Array((sourceNormal.count + 2) * 3);
  const uv = new Float32Array((sourceUv.count + 2) * 2);
  position.set(sourcePosition.array as Float32Array);
  normal.set(sourceNormal.array as Float32Array);
  uv.set(sourceUv.array as Float32Array);
  const startCenter = sourcePosition.count;
  const endCenter = sourcePosition.count + 1;
  position.set(points[0].toArray(), startCenter * 3);
  position.set(points[points.length - 1].toArray(), endCenter * 3);
  normal.set(curve.getTangentAt(0).normalize().multiplyScalar(-1).toArray(), startCenter * 3);
  normal.set(curve.getTangentAt(1).normalize().toArray(), endCenter * 3);
  uv.set([0.5, 0.5], startCenter * 2);
  uv.set([0.5, 0.5], endCenter * 2);
  const indices = tube.getIndex() ? Array.from(tube.getIndex()!.array) : [];
  const ring = radialSegments + 1;
  const endRing = tubularSegments * ring;
  for (let segment = 0; segment < radialSegments; segment += 1) {
    indices.push(startCenter, segment + 1, segment);
    indices.push(endCenter, endRing + segment, endRing + segment + 1);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(position, 3));
  result.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  result.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  result.setIndex(indices);
  tube.dispose();
  return result;
}

function routeWire(
  root: THREE.Group,
  components: ReadonlyMap<string, THREE.Object3D>,
  ports: ReadonlyMap<string, ElectricalPortIR>,
  wire: ElectricalWireIR,
  routeIndex: number,
  clearanceLift = 0,
  leadScale = 1,
): THREE.Vector3[] {
  const from = ports.get(wire.from)!;
  const to = ports.get(wire.to)!;
  const fromComponent = components.get(from.componentId)!;
  const toComponent = components.get(to.componentId)!;
  const start = resolvePortPosition(root, fromComponent, from);
  const end = resolvePortPosition(root, toComponent, to);
  const baseLead = Math.max(mm(wire.diameter * 3), 0.0014);
  const lead = Math.max(mm(wire.diameter * 0.6), baseLead * leadScale);
  const startLead = start.clone().addScaledVector(resolvePortDirection(root, fromComponent, from), lead);
  const endLead = end.clone().addScaledVector(resolvePortDirection(root, toComponent, to), lead);
  const waypointVectors = (wire.waypoints ?? []).map((point) => new THREE.Vector3(...point.map(mm) as [number, number, number]));
  if (waypointVectors.length === 0) {
    const lane = (routeIndex % 11) - 5;
    const layer = Math.floor(routeIndex / 11);
    const routeZ = Math.max(startLead.z, endLead.z) + 0.006 + layer * 0.0025 + clearanceLift;
    const middle = startLead.clone().lerp(endLead, 0.5);
    const planar = new THREE.Vector2(endLead.x - startLead.x, endLead.y - startLead.y);
    const planarLength = planar.length();
    if (planarLength > 1e-9 && lane !== 0) {
      const laneOffset = Math.min(Math.abs(lane) * 0.0018, planarLength * 0.35) * Math.sign(lane);
      middle.x += (-planar.y / planarLength) * laneOffset;
      middle.y += (planar.x / planarLength) * laneOffset;
    }
    waypointVectors.push(
      new THREE.Vector3(startLead.x, startLead.y, routeZ),
      new THREE.Vector3(middle.x, middle.y, routeZ),
      new THREE.Vector3(endLead.x, endLead.y, routeZ),
    );
  }
  return [start, startLead, ...waypointVectors, endLead, end];
}

function routeCollisionSafeWire(
  root: THREE.Group,
  components: ReadonlyMap<string, THREE.Object3D>,
  ports: ReadonlyMap<string, ElectricalPortIR>,
  wire: ElectricalWireIR,
  routeIndex: number,
): { points: THREE.Vector3[]; geometry: THREE.BufferGeometry } {
  const radius = mm(wire.diameter) * 0.5;
  const attempted: number[] = [];
  for (const [clearanceLift, leadScale] of [
    [0, 1], [0.006, 1], [0.012, 0.5], [0.024, 0.25],
  ] as const) {
    const points = routeWire(root, components, ports, wire, routeIndex, clearanceLift, leadScale);
    const geometry = createCappedTube(points, radius);
    const report = analyzeSelfIntersections(geometry);
    attempted.push(report.intersections);
    if (report.complete && report.intersections === 0) {
      geometry.userData.morphloomWireRoute = {
        selfIntersectionChecked: true,
        candidatePairs: report.candidatePairs,
        clearanceLiftMm: clearanceLift * 1000,
        leadScale,
      };
      return { points, geometry };
    }
    geometry.dispose();
  }
  throw new Error(`Wire ${wire.id} cannot be routed without self-intersection within the bounded clearance search (intersection counts: ${attempted.join(', ')}).`);
}

/** Compiles one independently selectable, endpoint-snapped mesh per conductor. */
export function compileElectricalHarness(
  root: THREE.Group,
  parts: ProductPartInfo[],
  harness: ElectricalHarnessIR,
  mode: ViewMode,
): ConnectivityReport {
  const components = new Map<string, THREE.Object3D>();
  root.traverse((object) => {
    if (object.name) components.set(object.name, object);
  });
  const report = validateElectricalHarness(harness, new Set(components.keys()));
  const ports = new Map(harness.ports.map((port) => [port.id, port]));
  const harnessRoot = new THREE.Group();
  harnessRoot.name = 'electrical_harness';
  const liveRecords: Array<{
    wire: ElectricalWireIR;
    routeIndex: number;
    mesh: THREE.Mesh;
    terminals: [THREE.Mesh, THREE.Mesh];
    lastStart: THREE.Vector3;
    lastStartLead: THREE.Vector3;
    lastEndLead: THREE.Vector3;
    lastEnd: THREE.Vector3;
  }> = [];

  const portToleranceMm = harness.portToleranceMm ?? 0.25;
  for (const port of harness.ports) {
    const component = components.get(port.componentId);
    if (!(component instanceof THREE.Mesh)) continue;
    component.geometry.computeBoundingBox();
    const bounds = component.geometry.boundingBox;
    if (!bounds) continue;
    const point = new THREE.Vector3(...port.position.map(mm) as [number, number, number]);
    const outside = new THREE.Vector3(
      point.x < bounds.min.x ? bounds.min.x - point.x : point.x > bounds.max.x ? point.x - bounds.max.x : 0,
      point.y < bounds.min.y ? bounds.min.y - point.y : point.y > bounds.max.y ? point.y - bounds.max.y : 0,
      point.z < bounds.min.z ? bounds.min.z - point.z : point.z > bounds.max.z ? point.z - bounds.max.z : 0,
    ).length() * 1000;
    report.portOutsideDistanceMaxMm = Math.max(report.portOutsideDistanceMaxMm, outside);
    if (outside > portToleranceMm) {
      report.offComponentPorts += 1;
      report.errors.push(`Port ${port.id} sits ${outside.toFixed(3)} mm outside component ${port.componentId}.`);
    }
  }
  if (report.errors.length > 0) {
    throw new Error(`Electrical port placement failed: ${report.errors.join(' ')}`);
  }

  for (const [wireIndex, wire] of harness.wires.entries()) {
    const { points, geometry } = routeCollisionSafeWire(root, components, ports, wire, wireIndex);
    const positions = geometry.getAttribute('position');
    const startCap = new THREE.Vector3().fromBufferAttribute(positions, positions.count - 2);
    const endCap = new THREE.Vector3().fromBufferAttribute(positions, positions.count - 1);
    const endpointErrorMm = Math.max(
      startCap.distanceTo(points[0]),
      endCap.distanceTo(points[points.length - 1]),
    ) * 1000;
    report.endpointErrorMaxMm = Math.max(report.endpointErrorMaxMm, endpointErrorMm);
    const materialName = wire.materialName ?? (wire.shielded ? '차폐 구리/불소수지' : '구리/PFA 절연');
    const material = createSurfaceMaterial({
      color: wire.color,
      surface: 'rubber',
      roughness: 0.58,
      microNormalStrength: 0.22,
      textureScale: [28, 4],
    }, { mode, category: 'interconnect', materialName });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = wire.id;
    mesh.castShadow = true;
    const info: ProductPartInfo = {
      id: wire.id,
      name: wire.name,
      category: 'interconnect',
      material: materialName,
      surface: 'rubber',
      detail: [
        wire.net,
        wire.signal.toUpperCase(),
        wire.gauge,
        `${wire.from} → ${wire.to}`,
        `3D 단자 스냅`,
        wire.verification ? `근거 ${wire.verification}` : undefined,
      ].filter(Boolean).join(' · '),
    };
    mesh.userData.part = info;
    mesh.userData.connection = { ...structuredClone(wire), endpointSnapped: true, liveAnchors: true };
    const terminalMaterial = createSurfaceMaterial({
      color: '#d2b76f', surface: 'polished-metal', roughness: 0.22, metalness: 0.88,
    }, { mode, category: 'interconnect', materialName: '금도금 구리 단자' });
    const terminals: THREE.Mesh[] = [];
    for (const [terminalIndex, point] of [points[0], points[points.length - 1]].entries()) {
      const terminal = new THREE.Mesh(
        new THREE.SphereGeometry(mm(wire.diameter) * 0.78, 14, 8),
        terminalMaterial.clone(),
      );
      terminal.name = `${wire.id}_terminal_${terminalIndex + 1}`;
      terminal.position.copy(point);
      terminal.userData.part = {
        ...info,
        id: terminal.name,
        name: `${wire.name} · ${terminalIndex === 0 ? 'source' : 'destination'} terminal`,
        detail: `${info.detail} · endpoint ${terminalIndex + 1}`,
      } satisfies ProductPartInfo;
      terminal.userData.connection = mesh.userData.connection;
      harnessRoot.add(terminal);
      terminals.push(terminal);
    }
    terminalMaterial.dispose();
    parts.push(info);
    harnessRoot.add(mesh);
    liveRecords.push({
      wire,
      routeIndex: wireIndex,
      mesh,
      terminals: terminals as [THREE.Mesh, THREE.Mesh],
      lastStart: points[0].clone(),
      lastStartLead: points[1].clone(),
      lastEndLead: points[points.length - 2].clone(),
      lastEnd: points[points.length - 1].clone(),
    });
  }

  const tolerance = harness.endpointToleranceMm ?? 0.05;
  if (report.endpointErrorMaxMm > tolerance) {
    throw new Error(`Electrical geometry missed a terminal by ${report.endpointErrorMaxMm.toFixed(4)} mm (limit ${tolerance} mm).`);
  }

  root.add(harnessRoot);
  const wiredComponents = [...new Set(harness.ports.map((port) => components.get(port.componentId)!))];
  const transformSnapshots = new Map<THREE.Object3D, Float64Array>();
  const captureTransform = (component: THREE.Object3D, target: Float64Array): void => {
    target[0] = component.position.x;
    target[1] = component.position.y;
    target[2] = component.position.z;
    target[3] = component.quaternion.x;
    target[4] = component.quaternion.y;
    target[5] = component.quaternion.z;
    target[6] = component.quaternion.w;
    target[7] = component.scale.x;
    target[8] = component.scale.y;
    target[9] = component.scale.z;
  };
  for (const component of wiredComponents) {
    const snapshot = new Float64Array(10);
    captureTransform(component, snapshot);
    transformSnapshots.set(component, snapshot);
  }
  const consumeTransformChanges = (): boolean => {
    let changed = false;
    for (const component of wiredComponents) {
      const previous = transformSnapshots.get(component)!;
      const componentChanged = Math.abs(component.position.x - previous[0]) > 1e-12
        || Math.abs(component.position.y - previous[1]) > 1e-12
        || Math.abs(component.position.z - previous[2]) > 1e-12
        || Math.abs(component.quaternion.x - previous[3]) > 1e-12
        || Math.abs(component.quaternion.y - previous[4]) > 1e-12
        || Math.abs(component.quaternion.z - previous[5]) > 1e-12
        || Math.abs(component.quaternion.w - previous[6]) > 1e-12
        || Math.abs(component.scale.x - previous[7]) > 1e-12
        || Math.abs(component.scale.y - previous[8]) > 1e-12
        || Math.abs(component.scale.z - previous[9]) > 1e-12;
      if (!componentChanged) continue;
      captureTransform(component, previous);
      changed = true;
    }
    return changed;
  };
  const updateElectricalHarness = (): void => {
    if (!consumeTransformChanges()) return;
    root.updateMatrixWorld(true);
    for (const record of liveRecords) {
      const routed = routeCollisionSafeWire(root, components, ports, record.wire, record.routeIndex);
      const { points } = routed;
      const start = points[0];
      const startLead = points[1];
      const endLead = points[points.length - 2];
      const end = points[points.length - 1];
      if (record.lastStart.distanceToSquared(start) < 1e-14
        && record.lastStartLead.distanceToSquared(startLead) < 1e-14
        && record.lastEndLead.distanceToSquared(endLead) < 1e-14
        && record.lastEnd.distanceToSquared(end) < 1e-14) {
        routed.geometry.dispose();
        continue;
      }
      const replacement = routed.geometry;
      record.mesh.geometry.dispose();
      record.mesh.geometry = replacement;
      record.terminals[0].position.copy(start);
      record.terminals[1].position.copy(end);
      record.lastStart.copy(start);
      record.lastStartLead.copy(startLead);
      record.lastEndLead.copy(endLead);
      record.lastEnd.copy(end);
    }
  };

  report.liveAnchors = true;
  report.productionReady = report.errors.length === 0
    && report.benchRequiredWires === 0
    && report.inferredWires === 0
    && report.outstandingBenchChecks === 0;
  harnessRoot.userData.electricalRuntime = { liveAnchors: true, conductors: liveRecords.length };
  root.userData.electrical = structuredClone(harness);
  root.userData.updateElectricalHarness = updateElectricalHarness;
  root.userData.connectivity = report;
  return report;
}
