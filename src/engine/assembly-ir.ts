export type AssemblyGeometryIR =
  | { op: 'roundedBox'; size: [number, number, number]; radius: number; segments?: number }
  | { op: 'cylinder'; radiusTop: number; radiusBottom: number; depth: number; radialSegments?: number }
  | { op: 'sphere'; radius: number; widthSegments?: number; heightSegments?: number }
  | { op: 'torus'; radius: number; tube: number; radialSegments?: number; tubularSegments?: number }
  | { op: 'extrude'; points: Array<[number, number]>; depth: number; bevelSize?: number; bevelThickness?: number; bevelSegments?: number }
  | { op: 'lathe'; profile: Array<[number, number]>; segments?: number }
  | { op: 'tube'; points: Array<[number, number, number]>; radius: number; tubularSegments?: number; radialSegments?: number; closed?: boolean }
  | { op: 'bladeLoft'; sections: Array<[number, number]>; thickness: number; apexThickness: number; grindCurve?: number[] };

export interface AssemblyMaterialIR {
  color: string;
  roughness?: number;
  metalness?: number;
  transmission?: number;
  emissive?: string;
}

export interface AssemblyComponentIR {
  id: string;
  name: string;
  category: 'enclosure' | 'display' | 'logic' | 'power' | 'camera' | 'audio' | 'radio' | 'mechanical' | 'interconnect';
  materialName: string;
  detail: string;
  geometry: AssemblyGeometryIR;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  material: AssemblyMaterialIR;
}

export type ElectricalSignalIR = 'power' | 'ground' | 'data' | 'rf' | 'audio' | 'sensor' | 'control';

export interface ElectricalPortIR {
  id: string;
  componentId: string;
  pin: string;
  signal: ElectricalSignalIR;
  /** Position in the owning component's local coordinate system, in millimetres. */
  position: [number, number, number];
  /** Outward lead direction in the owning component's local coordinate system. */
  direction?: [number, number, number];
  required?: boolean;
  maxConnections?: number;
}

export interface ElectricalWireIR {
  id: string;
  name: string;
  net: string;
  signal: ElectricalSignalIR;
  from: string;
  to: string;
  /** Intermediate assembly-local routing points in millimetres. Endpoints come from ports. */
  waypoints?: Array<[number, number, number]>;
  diameter: number;
  color: string;
  materialName?: string;
  shielded?: boolean;
}

export interface ElectricalHarnessIR {
  ports: ElectricalPortIR[];
  wires: ElectricalWireIR[];
  endpointToleranceMm?: number;
  /** Maximum distance a declared port may sit outside its owning component bounds. */
  portToleranceMm?: number;
}

export interface AssemblyIR {
  schema: 'morphloom.assembly/0.1';
  name: string;
  units: 'mm';
  components: AssemblyComponentIR[];
  electrical?: ElectricalHarnessIR;
  metadata?: Record<string, string | number | boolean>;
}
