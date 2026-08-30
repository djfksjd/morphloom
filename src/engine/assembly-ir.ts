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
  category: 'enclosure' | 'display' | 'logic' | 'power' | 'camera' | 'audio' | 'radio' | 'mechanical';
  materialName: string;
  detail: string;
  geometry: AssemblyGeometryIR;
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  material: AssemblyMaterialIR;
}

export interface AssemblyIR {
  schema: 'morphloom.assembly/0.1';
  name: string;
  units: 'mm';
  components: AssemblyComponentIR[];
  metadata?: Record<string, string | number | boolean>;
}
