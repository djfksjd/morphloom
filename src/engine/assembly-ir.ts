import type { FidelityContract } from './fidelity-pipeline';
import type { VisualHullDescriptor } from './visual-hull';
import type { QuantizedReferenceHeightField } from './reference-surface';
import type { ImplicitSurfaceDescriptor } from './implicit-surface';
import type { PlanFootprintDescriptor } from './plan-footprint';
import type { DimensionContract } from './dimension-contract';
import type { PartDecompositionContract } from './part-decomposition';
import type { VisualPlanningContract } from './visual-plan-audit';

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
  | {
    op: 'surfacePatch';
    /** Horizontal X×Z size in millimetres. */
    size: [number, number];
    baseThickness: number;
    segments: [number, number];
    seed: number;
    macroAmplitude: number;
    aggregateAmplitude: number;
    aggregateScale: number;
    /** Optional image-conditioned local relief. Physical height remains estimated until calibrated. */
    referenceRelief?: QuantizedReferenceHeightField;
  }
  | { op: 'hipRoof'; width: number; depth: number; rise: number; thickness: number; ridgeLength: number }
  | { op: 'bladeLoft'; sections: Array<[number, number]>; thickness: number; apexThickness: number; grindCurve?: number[] }
  | { op: 'visualHull'; descriptor: VisualHullDescriptor }
  | { op: 'implicitSurface'; descriptor: ImplicitSurfaceDescriptor };

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
  /** Optional local, user-owned reference plate projected in a declared assembly plane. */
  referenceProjection?: {
    uri: string;
    mapping: 'assembly-xy' | 'assembly-xz';
    /** Source-image crop as normalized [x, y, width, height], y measured from the top. */
    crop: [number, number, number, number];
    /** Assembly-plane bounds [minA, minB, maxA, maxB] in millimetres. */
    boundsMm: [number, number, number, number];
    fingerprint?: string;
    /**
     * Strength of the conservative single-image de-light pass. Lower values
     * preserve photographed broad illumination; higher values make the plate
     * more relightable. The engine caps this at 0.35 because a single image
     * cannot recover ground-truth albedo.
     */
    delightStrength?: number;
    /**
     * Blends the projected material multiplier back toward neutral white.
     * Use only when source colour fidelity matters more than removing baked
     * exposure. This never changes the hidden-side synthesis boundary.
     */
    colorRetention?: number;
    /** Derive tangent-space micro relief and local roughness from visible source detail. */
    relief?: {
      strength?: number;
      maxResolution?: number;
    };
    /**
     * Hidden faces are not allowed to reuse a one-view photograph.  This
     * recipe carries only the observed material character (not markings or
     * ornaments) onto those faces as a deterministic seamless PBR surface.
     */
    unobservedSurface?: {
      pattern: 'grain' | 'directional' | 'mineral-flow';
      /** Estimated bulk colour for cut edges and the unseen face. */
      color?: string;
      /** Optional bounded physical-response overrides for the unseen partition. */
      roughness?: number;
      metalness?: number;
      colorVariation?: number;
      microNormalStrength?: number;
      textureScale?: [number, number];
    };
  };
}

export type SurfaceFinishIR =
  | 'raw'
  | 'concrete'
  | 'asphalt'
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
  /** Stable evidence-pack view id. Required by strict delivery jobs for strong claims. */
  sourceViewId?: string;
  source?: string;
  notes?: string[];
}

export interface AssemblyDimensionAnchorIR {
  /** Stable CAD-style datum name local to the owning component. */
  id: string;
  /** Point in the owning component's local coordinate system, in millimetres. */
  position: [number, number, number];
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
  /** Evidence-addressable local datum points for pitches and interface spacing. */
  dimensionAnchors?: AssemblyDimensionAnchorIR[];
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
  /** Evidence-first expected-part inventory. Detects omissions before a fidelity contract is derived from geometry. */
  partDecomposition?: PartDecompositionContract;
  /** Immutable evidence/count/quality baseline created before geometry or recovery retries. */
  visualPlan?: VisualPlanningContract;
  /** Source-derived plan regions checked against the compiled top-down mesh projection. */
  planFootprint?: PlanFootprintDescriptor;
  /** Evidence-bound dimensions re-measured from compiled world-space geometry. */
  dimensionContracts?: DimensionContract[];
  metadata?: Record<string, string | number | boolean>;
}
