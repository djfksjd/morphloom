import type { FidelityContract } from './fidelity-pipeline';
import type { VisualHullDescriptor } from './visual-hull';

export type AssemblyGeometryIR =
  | { op: 'roundedBox'; size: [number, number, number]; radius: number; segments?: number }
  | { op: 'cylinder'; radiusTop: number; radiusBottom: number; depth: number; radialSegments?: number }
  | { op: 'sphere'; radius: number; widthSegments?: number; heightSegments?: number }
  | { op: 'torus'; radius: number; tube: number; radialSegments?: number; tubularSegments?: number }
  | {
    op: 'extrude';
    points: Array<[number, number]>;
    depth: number;
    /** Closed polygon loops removed from the profile by Three.js' tessellator. */
    holes?: Array<Array<[number, number]>>;
    /** Compact circular/elliptical through-holes expanded deterministically at compile time. */
    ovalHoles?: Array<{ center: [number, number]; radii: [number, number]; segments?: number }>;
    bevelSize?: number;
    bevelThickness?: number;
    bevelSegments?: number;
    /** Real wedge thinning along one or more cutting-edge paths, in profile XY millimetres. */
    edgeTapers?: Array<{
      path: Array<[number, number]>;
      width: number;
      tipThickness: number;
      curve?: number;
    }>;
  }
  | { op: 'lathe'; profile: Array<[number, number]>; segments?: number }
  | { op: 'tube'; points: Array<[number, number, number]>; radius: number; tubularSegments?: number; radialSegments?: number; closed?: boolean }
  | { op: 'hipRoof'; width: number; depth: number; rise: number; thickness: number; ridgeLength: number }
  | { op: 'bladeLoft'; sections: Array<[number, number]>; thickness: number; apexThickness: number; grindCurve?: number[] }
  | { op: 'visualHull'; descriptor: VisualHullDescriptor };

export interface AssemblyMaterialIR {
  color: string;
  /** Physically based micro-surface recipe; scalar values below may override it. */
  surface?: SurfaceFinishIR;
  roughness?: number;
  metalness?: number;
  transmission?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  ior?: number;
  iridescence?: number;
  anisotropy?: number;
  anisotropyRotation?: number;
  sheen?: number;
  sheenRoughness?: number;
  specularIntensity?: number;
  microNormalStrength?: number;
  textureScale?: [number, number];
  thicknessMm?: number;
  emissive?: string;
  /**
   * Optional local, user-owned reference plate projected in assembly XY space.
   * Remote URLs are rejected so a local-only build never contacts a third party.
   */
  referenceProjection?: {
    uri: string;
    mapping: 'assembly-xy';
    /** Source-image crop as normalized [x, y, width, height], y measured from the top. */
    crop: [number, number, number, number];
    /** Assembly-space projection bounds [minX, minY, maxX, maxY] in millimetres. */
    boundsMm: [number, number, number, number];
    fingerprint?: string;
    /** Derive tangent-space micro relief and local roughness from visible source detail. */
    relief?: {
      strength?: number;
      maxResolution?: number;
    };
  };
}

export type SurfaceFinishIR =
  | 'raw'
  | 'concrete'
  | 'plaster'
  | 'stone'
  | 'coated-metal'
  | 'brushed-metal'
  | 'bead-blasted-metal'
  | 'anodized-metal'
  | 'polished-metal'
  | 'machined-copper'
  | 'ceramic-glass'
  | 'optical-glass'
  | 'sapphire'
  | 'pcb-soldermask'
  | 'molded-polymer'
  | 'soft-touch-polymer'
  | 'rubber'
  | 'leather'
  | 'wood'
  | 'skin'
  | 'fabric'
  | 'hex-knit'
  | 'hair'
  | 'semiconductor';

export type EvidenceStatusIR = 'measured' | 'datasheet' | 'estimated' | 'inferred';

export interface ComponentEvidenceIR {
  /** Strongest evidence supporting the dimensions and identity of this edit unit. */
  status: EvidenceStatusIR;
  source?: string;
  notes?: string[];
}

export interface AssemblyComponentIR {
  id: string;
  name: string;
  category: 'enclosure' | 'display' | 'logic' | 'power' | 'camera' | 'audio' | 'radio' | 'mechanical' | 'interconnect';
  materialName: string;
  detail: string;
  /** Optional architectural/storey grouping used by the read-only viewer. */
  level?: string;
  geometry: AssemblyGeometryIR;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  material: AssemblyMaterialIR;
  /** Optional physically inspectable light source compiled with the fixture. */
  light?: {
    color: string;
    intensity: number;
    rangeMm: number;
    decay?: number;
  };
  evidence?: ComponentEvidenceIR;
}

export type ElectricalSignalIR = 'power' | 'ground' | 'data' | 'rf' | 'audio' | 'sensor' | 'control';

export interface ElectricalPortIR {
  id: string;
  componentId: string;
  pin: string;
  /** Connector/pad label visible to an assembler, for example J1-21 or VIN+. */
  physicalPin?: string;
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
  /** Human-readable conductor size such as 16AWG or 0.25mm2. */
  gauge?: string;
  /** What has actually established this connection; never imply a bench test from graph validation. */
  verification?: 'datasheet' | 'design' | 'bench-required' | 'bench-verified' | 'inferred';
}

export interface PassiveNodeIR {
  ref: string;
  node: string;
  detail: string;
  verification: 'datasheet' | 'design' | 'bench-required' | 'bench-verified' | 'inferred';
}

export interface BenchCheckIR {
  id: string;
  instruction: string;
  status: 'required' | 'passed' | 'failed';
}

export interface ElectricalHarnessIR {
  ports: ElectricalPortIR[];
  wires: ElectricalWireIR[];
  endpointToleranceMm?: number;
  /** Maximum distance a declared port may sit outside its owning component bounds. */
  portToleranceMm?: number;
  verificationScope?: string;
  passiveNodes?: PassiveNodeIR[];
  benchChecks?: BenchCheckIR[];
}

export interface AssemblyIR {
  schema: 'morphloom.assembly/0.1';
  name: string;
  units: 'mm';
  components: AssemblyComponentIR[];
  electrical?: ElectricalHarnessIR;
  /** Optional locked detail-and-proof contract used by semi-professional delivery gates. */
  fidelity?: FidelityContract;
  metadata?: Record<string, string | number | boolean>;
}
