export type HairStyle = 'crop' | 'bob' | 'buzz' | 'none';
export type OutfitStyle = 'second-skin' | 'field' | 'studio' | 'web-hero';
export type PoseStyle = 'neutral' | 'reference-action';
export type HandGesture = 'relaxed' | 'web-shooting';
export type ViewMode = 'beauty' | 'clay' | 'wireframe' | 'rig';
export type AssetKind = 'human' | 'product';

export interface ProductSpec {
  kind: 'smartphone' | 'ornate-knife';
  widthMm: number;
  heightMm: number;
  depthMm: number;
  cornerRadiusMm: number;
  explode: number;
  frameColor: string;
  glassColor: string;
  boardColor: string;
  batteryColor: string;
}

export interface CharacterSpec {
  heightCm: number;
  weight: number;
  muscle: number;
  ageYears: number;
  genderBlend: number;
  shoulderScale: number;
  legScale: number;
  headScale: number;
  skinTone: string;
  suitColor: string;
  accentColor: string;
  hairColor: string;
  hairStyle: HairStyle;
  outfit: OutfitStyle;
  pose: PoseStyle;
  abdominalProjection: number;
  chestSoftness: number;
  gluteScale: number;
  forwardHead: number;
  rearBalance: number;
  handGesture: HandGesture;
}

export interface MorphTarget {
  name: string;
  category: string;
  scale: number;
  quantizationError: number;
  indices: Uint32Array;
  deltas: Int16Array;
}

export interface OhpkManifest {
  name: string;
  version: string;
  license: string;
  provenance?: {
    upstream_repo?: string;
    upstream_commit?: string;
  };
  age_floor_years?: number;
  categories?: string[];
  target_names?: string[];
}

export interface HumanPack {
  manifest: OhpkManifest;
  positions: Float32Array;
  indices: Uint32Array;
  uvs?: Float32Array;
  helperMetadata?: Uint8Array;
  targets: MorphTarget[];
  quantizationError: number;
}

export interface ReferenceEvidence {
  fileName: string;
  width: number;
  height: number;
  averageColor: string;
  brightness: number;
  portraitSuitability: number;
  notes: string[];
}

export type QualityStatus = 'pass' | 'warn' | 'blocked';

export interface QualityCheck {
  id: 'geometry' | 'silhouette' | 'materials' | 'rig' | 'export';
  label: string;
  score: number;
  status: QualityStatus;
  detail: string;
}

export interface QualityReport {
  total: number;
  /** Independent source confidence; never inflate it to match model completeness. */
  evidenceScore?: number;
  deliveryReady?: boolean;
  checks: QualityCheck[];
  triangles: number;
  vertices: number;
}

export const DEFAULT_SPEC: CharacterSpec = {
  heightCm: 178,
  weight: 0.52,
  muscle: 0.58,
  ageYears: 29,
  genderBlend: 0.32,
  shoulderScale: 1.04,
  legScale: 1,
  headScale: 1,
  skinTone: '#b97858',
  suitColor: '#20252d',
  accentColor: '#335cff',
  hairColor: '#181513',
  hairStyle: 'crop',
  outfit: 'field',
  pose: 'neutral',
  abdominalProjection: 0.12,
  chestSoftness: 0.12,
  gluteScale: 1,
  forwardHead: 0,
  rearBalance: 0,
  handGesture: 'relaxed',
};

export const WEB_HERO_SPEC: CharacterSpec = {
  ...DEFAULT_SPEC,
  heightCm: 178,
  weight: 0.48,
  muscle: 0.5,
  ageYears: 26,
  genderBlend: 0,
  shoulderScale: 1.02,
  legScale: 1.025,
  headScale: 0.98,
  skinTone: '#8a1734',
  suitColor: '#8a1734',
  accentColor: '#073b70',
  hairStyle: 'none',
  outfit: 'web-hero',
  pose: 'reference-action',
  abdominalProjection: 0.38,
  chestSoftness: 0.3,
  gluteScale: 0.86,
  forwardHead: 0.32,
  rearBalance: 0.35,
  handGesture: 'web-shooting',
};

/** Shared runtime and benchmark base for editable game/animation delivery. */
export const FIELD_HUMAN_SPEC: CharacterSpec = {
  ...DEFAULT_SPEC,
  muscle: 0.72,
  weight: 0.56,
  shoulderScale: 1.1,
  outfit: 'field',
  suitColor: '#242a33',
};

export const DEFAULT_PRODUCT_SPEC: ProductSpec = {
  kind: 'smartphone',
  widthMm: 76.7,
  heightMm: 159.9,
  depthMm: 8.25,
  cornerRadiusMm: 11.2,
  explode: 0.72,
  frameColor: '#b8bab9',
  glassColor: '#0f141b',
  boardColor: '#164c3a',
  batteryColor: '#292c31',
};

export const DEFAULT_KNIFE_SPEC: ProductSpec = {
  kind: 'ornate-knife',
  widthMm: 96,
  heightMm: 438,
  depthMm: 22,
  cornerRadiusMm: 3,
  explode: 0.18,
  frameColor: '#aeb5bd',
  glassColor: '#20437b',
  boardColor: '#5c241b',
  batteryColor: '#b79343',
};
