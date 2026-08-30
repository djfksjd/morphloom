import * as THREE from 'three';
import type { ViewMode } from '../types';
import type {
  ElectricalHarnessIR,
  ElectricalPortIR,
  ElectricalWireIR,
} from './assembly-ir';
import type { ProductPartInfo } from './product';
import { createSurfaceMaterial } from './surface-system';

const mm = (value: number) => value / 1000;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,80}$/;

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

  if (!Array.isArray(harness.ports) || harness.ports.length > 2_000) {
    errors.push('Electrical harness must contain at most 2,000 ports.');
  }
  if (!Array.isArray(harness.wires) || harness.wires.length > 2_000) {
    errors.push('Electrical harness must contain at most 2,000 wires.');
  }

  for (const port of harness.ports ?? []) {
    if (!SAFE_ID.test(port.id) || ports.has(port.id)) errors.push(`Invalid or duplicate port id: ${port.id}`);
    if (!componentIds.has(port.componentId)) errors.push(`Port ${port.id} references missing component ${port.componentId}.`);
    if (!finiteVec3(port.position)) errors.push(`Port ${port.id} has an unsafe position.`);
    if (port.direction && !finiteVec3(port.direction)) errors.push(`Port ${port.id} has an unsafe direction.`);
    if (!port.pin || port.pin.length > 80) errors.push(`Port ${port.id} has an invalid pin label.`);
    const maxConnections = port.maxConnections ?? 1;
    if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 64) {
      errors.push(`Port ${port.id} has an invalid maxConnections value.`);
    }
    ports.set(port.id, port);
    connections.set(port.id, 0);
  }

  let connectedWires = 0;
  for (const wire of harness.wires ?? []) {
    if (!SAFE_ID.test(wire.id) || wireIds.has(wire.id)) errors.push(`Invalid or duplicate wire id: ${wire.id}`);
    wireIds.add(wire.id);
    if (!SAFE_ID.test(wire.net)) errors.push(`Wire ${wire.id} has an invalid net id.`);
    if (!Number.isFinite(wire.diameter) || wire.diameter <= 0 || wire.diameter > 20) {
      errors.push(`Wire ${wire.id} has an unsafe diameter.`);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(wire.color)) errors.push(`Wire ${wire.id} has an invalid color.`);
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

  return {
    ports: ports.size,
    requiredPorts,
    connectedRequiredPorts,
    wires: harness.wires?.length ?? 0,
    connectedWires,
    danglingWires: (harness.wires?.length ?? 0) - connectedWires,
    openRequiredPorts: requiredPorts - connectedRequiredPorts,
    overloadedPorts,
    offComponentPorts: 0,
    portOutsideDistanceMaxMm: 0,
    endpointErrorMaxMm: 0,
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

function resolvePortDirection(component: THREE.Object3D, port: ElectricalPortIR): THREE.Vector3 {
  const direction = new THREE.Vector3(...(port.direction ?? [0, 0, 1]));
  if (direction.lengthSq() < 1e-10) direction.set(0, 0, 1);
  direction.normalize().applyQuaternion(component.getWorldQuaternion(new THREE.Quaternion()));
  return direction.normalize();
}

function createCappedTube(points: THREE.Vector3[], radius: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
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
): THREE.Vector3[] {
  const from = ports.get(wire.from)!;
  const to = ports.get(wire.to)!;
  const fromComponent = components.get(from.componentId)!;
  const toComponent = components.get(to.componentId)!;
  const start = resolvePortPosition(root, fromComponent, from);
  const end = resolvePortPosition(root, toComponent, to);
  const lead = Math.max(mm(wire.diameter * 3), 0.0014);
  const startLead = start.clone().addScaledVector(resolvePortDirection(fromComponent, from), lead);
  const endLead = end.clone().addScaledVector(resolvePortDirection(toComponent, to), lead);
  const waypointVectors = (wire.waypoints ?? []).map((point) => new THREE.Vector3(...point.map(mm) as [number, number, number]));
  if (waypointVectors.length === 0) {
    const lane = (routeIndex % 11) - 5;
    const layer = Math.floor(routeIndex / 11);
    const routeZ = Math.max(startLead.z, endLead.z) + 0.006 + layer * 0.0025;
    const middle = startLead.clone().lerp(endLead, 0.5);
    middle.x += lane * 0.0018;
    waypointVectors.push(
      new THREE.Vector3(startLead.x, startLead.y, routeZ),
      new THREE.Vector3(middle.x, middle.y, routeZ),
      new THREE.Vector3(endLead.x, endLead.y, routeZ),
    );
  }
  return [start, startLead, ...waypointVectors, endLead, end];
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
    const points = routeWire(root, components, ports, wire, wireIndex);
    const geometry = createCappedTube(points, mm(wire.diameter) * 0.5);
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
      detail: `${wire.net} · ${wire.signal.toUpperCase()} · ${wire.from} → ${wire.to} · 단자 스냅 검증`,
    };
    mesh.userData.part = info;
    mesh.userData.connection = structuredClone(wire);
    const terminalMaterial = createSurfaceMaterial({
      color: '#d2b76f', surface: 'polished-metal', roughness: 0.22, metalness: 0.88,
    }, { mode, category: 'interconnect', materialName: '금도금 구리 단자' });
    for (const [terminalIndex, point] of [points[0], points[points.length - 1]].entries()) {
      const terminal = new THREE.Mesh(
        new THREE.SphereGeometry(mm(wire.diameter) * 0.78, 14, 8),
        terminalMaterial.clone(),
      );
      terminal.name = `${wire.id}_terminal_${terminalIndex + 1}`;
      terminal.position.copy(point);
      terminal.userData.part = info;
      mesh.add(terminal);
    }
    terminalMaterial.dispose();
    parts.push(info);
    root.add(mesh);
  }

  const tolerance = harness.endpointToleranceMm ?? 0.05;
  if (report.endpointErrorMaxMm > tolerance) {
    throw new Error(`Electrical geometry missed a terminal by ${report.endpointErrorMaxMm.toFixed(4)} mm (limit ${tolerance} mm).`);
  }

  root.userData.electrical = structuredClone(harness);
  root.userData.connectivity = report;
  return report;
}
