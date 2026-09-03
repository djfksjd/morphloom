import type { AssemblyComponentIR, AssemblyIR } from './assembly-ir';

/**
 * Same-input comparison fixture derived from the public Talon broadside reference.
 * The source bitmap is deliberately not redistributed; the values below are bounded
 * geometric measurements (silhouette, openings and visible hardware), not copied
 * showcase model data.
 */
const SOURCE = 'https://img2threejs.io/references/talon-doppler-ruby.webp';
const REFERENCE_PROJECTION = {
  uri: '/benchmark-input/talon-doppler-ruby.webp',
  mapping: 'assembly-xy' as const,
  crop: [22 / 2560, 323 / 1440, 2520 / 2560, 876 / 1440] as [number, number, number, number],
  boundsMm: [-120, -41.63, 120, 41.63] as [number, number, number, number],
  fingerprint: 'f0a791552b385e5a9ccc3718b2b2e8f0c40201e8d271c2cb6d3df735e77f02e5',
  relief: { strength: 0.72, maxResolution: 1536 },
};
const SCALE_MM_PER_PIXEL = 240 / 787;
const profile = (points: Array<[number, number]>): Array<[number, number]> =>
  points.map(([x, y]) => [x - 120, y]);
const referenceProfile = (points: Array<[number, number]>): Array<[number, number]> =>
  points.map(([x, y]) => [(x - 7) * SCALE_MM_PER_PIXEL - 120, -(y - 237.5) * SCALE_MM_PER_PIXEL]);

// Outer boundary traced from the admitted broadside mask and simplified at a
// sub-millimetre tolerance. This removes hand-fit handle inflation while
// retaining the tooth peaks, guard transition, choils and finger-ring mass.
const OUTER: Array<[number, number]> = [[-120,-39.66],[-115.56,-21.92],[-110.64,-11.58],[-107.19,-5.67],[-101.77,1.23],[-92.4,10.1],[-81.07,18.97],[-59.88,30.79],[-57.41,31.78],[-56.43,28.33],[-51.5,34.24],[-50.51,30.79],[-46.08,36.21],[-45.59,36.21],[-44.6,32.76],[-39.18,38.18],[-38.69,38.18],[-37.7,34.73],[-36.22,35.72],[-34.25,39.17],[-25.38,41.14],[-24.89,37.2],[-19.47,41.63],[-18.48,41.63],[-17,40.64],[-16.51,41.14],[-14.05,40.15],[-9.61,37.2],[-4.19,34.73],[3.7,32.27],[17.49,30.3],[49.53,29.31],[60.86,26.85],[81.07,20.45],[98.32,13.06],[108.17,6.65],[112.61,2.71],[114.09,-0.25],[117.04,-3.69],[118.52,-6.65],[120,-12.56],[120,-18.47],[117.54,-25.37],[112.11,-31.28],[109.65,-32.76],[105.71,-33.75],[100.29,-33.75],[92.4,-31.28],[86.49,-27.34],[83.04,-22.91],[79.1,-13.06],[76.63,-8.62],[72.69,-5.67],[68.75,-4.19],[63.82,-3.2],[49.03,-3.2],[47.06,-2.71],[33.26,4.68],[23.41,7.64],[14.54,7.64],[9.61,6.16],[7.15,3.69],[3.2,-3.2],[1.23,-3.69],[0.74,-3.2],[-2.71,-3.2],[-7.15,-1.72],[-11.58,0.74],[-17.99,5.67],[-23.41,6.16],[-24.89,7.14],[-27.84,7.14],[-41.15,4.68],[-52.48,1.72],[-61.85,-1.72],[-76.14,-8.62],[-91.42,-17.98],[-102.75,-26.36],[-110.64,-32.76],[-120,-41.63]];
const HOLES = [
  profile([[220.18,-2.29],[215.91,-4.42],[212.25,-8.69],[210.42,-13.57],[210.42,-18.75],[212.25,-23.63],[213.77,-25.16],[217.13,-26.99],[222.31,-27.29],[226.28,-26.07],[230.55,-22.41],[232.68,-18.14],[232.99,-12.96],[231.46,-8.39],[228.41,-4.73],[224.14,-2.59]]),
  profile([[85.08,30.04],[83.25,29.43],[81.42,26.38],[82.03,23.63],[84.17,22.11],[87.22,22.72],[89.05,25.16],[88.44,28.82],[87.22,29.73]]),
  profile([[74.71,26.07],[72.88,24.85],[72.58,21.8],[73.8,20.28],[75.93,20.28],[77.76,21.8],[78.07,23.94],[76.85,26.07]]),
  profile([[65.87,22.11],[64.35,20.89],[64.04,18.75],[64.96,17.23],[66.48,16.93],[68.01,17.84],[68.61,20.58],[67.7,22.11]]),
];
const CUTTING_EDGE_PATH: Array<[number, number]> = [
  [-120, -41.63], [-110.64, -32.76], [-102.75, -26.36], [-91.42, -17.98], [-76.14, -8.62],
  [-61.85, -1.72], [-52.48, 1.72], [-41.15, 4.68], [-27.84, 7.14], [-23.41, 6.16],
  [-17.99, 5.67], [-11.58, 0.74], [-7.15, -1.72], [-2.71, -3.2], [3.2, -3.2],
];

const PANELS = [
  referenceProfile([[345,104],[459,128],[458,211],[430,210],[407,208],[400,218],[398,226],[386,221],[374,209],[363,186]]),
  referenceProfile([[463,129],[632,159],[612,248],[575,245],[544,227],[512,217],[460,211]]),
  referenceProfile([[636,160],[773,230],[763,240],[731,244],[714,257],[698,292],[696,315],[686,323],[676,313],[663,271],[651,250],[614,248]]),
];

const ruby = {
  color: '#b91529', surface: 'polished-metal' as const, roughness: 0.19, metalness: 0.76,
  clearcoat: 0.82, clearcoatRoughness: 0.09, iridescence: 0.18, microNormalStrength: 0.42,
  referenceProjection: {
    ...REFERENCE_PROJECTION,
    unobservedSurface: {
      pattern: 'mineral-flow' as const,
      color: '#760a1f',
      roughness: 0.28,
      metalness: 0.5,
      colorVariation: 0.3,
      microNormalStrength: 0.24,
      textureScale: [1.35, 0.9] as [number, number],
    },
  },
};
const ivory = {
  color: '#d9d6c7', surface: 'polished-metal' as const, roughness: 0.31, metalness: 0.08,
  clearcoat: 0.58, clearcoatRoughness: 0.18, microNormalStrength: 0.16,
  referenceProjection: {
    ...REFERENCE_PROJECTION,
    unobservedSurface: {
      pattern: 'grain' as const,
      color: '#cfc9b6',
      roughness: 0.4,
      metalness: 0,
      colorVariation: 0.07,
      microNormalStrength: 0.12,
      textureScale: [3, 2] as [number, number],
    },
  },
};
const brass = {
  color: '#b58a31', surface: 'polished-metal' as const, roughness: 0.22, metalness: 0.9,
  clearcoat: 0.38, clearcoatRoughness: 0.18,
  referenceProjection: {
    ...REFERENCE_PROJECTION,
    unobservedSurface: {
      pattern: 'grain' as const,
      colorVariation: 0.035,
      microNormalStrength: 0.06,
      textureScale: [4, 4] as [number, number],
    },
  },
};

const panelComponents: AssemblyComponentIR[] = PANELS.flatMap((points, index) => [-1, 1].map((side) => ({
  id: `ivory_panel_${index + 1}_${side > 0 ? 'front' : 'back'}`,
  name: `Ivory grip panel ${index + 1} ${side > 0 ? 'front' : 'back'}`,
  category: 'mechanical' as const,
  materialName: 'aged ivory composite',
  detail: 'Separately editable grip scale reconstructed from the admitted broadside evidence.',
  geometry: { op: 'extrude' as const, points, depth: 1.25, bevelSize: 0.28, bevelThickness: 0.18, bevelSegments: 2 },
  position: [0, 0, side * 2.65] as [number, number, number],
  material: ivory,
  evidence: { status: 'estimated' as const, source: SOURCE },
})));

const pinPixels: Array<[number, number]> = [[367,137],[420,169],[402,210],[500,174],[603,193],[662,243],[691,203]];
const pinComponents: AssemblyComponentIR[] = pinPixels.flatMap(([x, y], index) => [-1, 1].map((side) => {
  const [px, py] = referenceProfile([[x, y]])[0];
  return {
    id: `brass_pin_${index + 1}_${side > 0 ? 'front' : 'back'}`,
    name: `Brass through-pin ${index + 1} ${side > 0 ? 'front' : 'back'}`,
    category: 'mechanical' as const,
    materialName: 'aged brass',
    detail: 'Visible fastener head retained as an independent edit unit.',
    geometry: { op: 'cylinder' as const, radiusTop: 1.78, radiusBottom: 1.78, depth: 0.82, radialSegments: 40 },
    position: [px, py, side * 3.7] as [number, number, number],
    rotation: [Math.PI / 2, 0, 0] as [number, number, number],
    material: brass,
    evidence: { status: 'estimated' as const, source: SOURCE },
  };
}));

const [rosetteX, rosetteY] = referenceProfile([[551, 186]])[0];
const [ringX, ringY] = profile([[221.6, -14.8]])[0];
const dividerLines = [
  referenceProfile([[460, 132], [459, 211]]),
  referenceProfile([[634, 162], [613, 247]]),
];
const dividerComponents: AssemblyComponentIR[] = dividerLines.flatMap((points, index) => [-1, 1].map((side) => ({
  id: `grip_divider_${index + 1}_${side > 0 ? 'front' : 'back'}`,
  name: `Grip divider ${index + 1} ${side > 0 ? 'front' : 'back'}`,
  category: 'mechanical' as const,
  materialName: 'aged brass',
  detail: 'A separately editable brass liner keeps the visible scale break crisp at grazing angles.',
  geometry: {
    op: 'tube' as const,
    points: points.map(([x, y]) => [x, y, 0] as [number, number, number]),
    radius: 0.34,
    tubularSegments: 10,
    radialSegments: 8,
  },
  position: [0, 0, side * 4.03] as [number, number, number],
  material: brass,
  evidence: { status: 'estimated' as const, source: SOURCE },
})));
const rosetteDetailComponents: AssemblyComponentIR[] = [-1, 1].flatMap((side) => {
  const face = side > 0 ? 'front' : 'back';
  const spokes = Array.from({ length: 6 }, (_, index) => {
    const angle = index / 6 * Math.PI * 2;
    return {
      id: `rosette_spoke_${index + 1}_${face}`,
      name: `Rosette spoke ${index + 1} ${face}`,
      category: 'mechanical' as const,
      materialName: 'aged brass',
      detail: 'Independent spoke geometry preserves the signature wheel ornament instead of baking it into colour.',
      geometry: {
        op: 'tube' as const,
        points: [
          [Math.cos(angle) * 1.15, Math.sin(angle) * 1.15, 0],
          [Math.cos(angle) * 3.3, Math.sin(angle) * 3.3, 0],
        ] as Array<[number, number, number]>,
        radius: 0.28,
        tubularSegments: 6,
        radialSegments: 7,
      },
      position: [rosetteX, rosetteY, side * 4.08] as [number, number, number],
      material: brass,
      evidence: { status: 'estimated' as const, source: SOURCE },
    };
  });
  return [
    {
      id: `rosette_hub_${face}`,
      name: `Rosette hub ${face}`,
      category: 'mechanical' as const,
      materialName: 'aged brass',
      detail: 'Raised central hub supports the six-spoke signature ornament.',
      geometry: { op: 'cylinder' as const, radiusTop: 1.25, radiusBottom: 1.25, depth: 0.55, radialSegments: 32 },
      position: [rosetteX, rosetteY, side * 4.08] as [number, number, number],
      rotation: [Math.PI / 2, 0, 0] as [number, number, number],
      material: brass,
      evidence: { status: 'estimated' as const, source: SOURCE },
    },
    ...spokes,
  ];
});

export const TALON_REFERENCE_BENCHMARK_IR: AssemblyIR = {
  schema: 'morphloom.assembly/0.1',
  name: 'Talon Doppler Ruby — same-reference benchmark',
  units: 'mm',
  metadata: {
    assetKind: 'product',
    benchmarkKind: 'same-input-public-reference',
    referenceUrl: SOURCE,
    referenceWidthPx: 2560,
    referenceHeightPx: 1440,
    measuredOverallLengthMm: 240,
    evidenceBoundary: 'Single broadside image; all depths and unseen rear-face details remain estimated.',
  },
  components: [
    {
      id: 'continuous_steel_body', name: 'Continuous blade, tang and finger ring', category: 'mechanical',
      materialName: 'Doppler ruby steel',
      detail: 'One continuous profile with five traced saw teeth, three true blade openings, a true finger-ring bore, and a 0.12 mm closed-mesh cutting wedge.',
      geometry: {
        op: 'extrude', points: OUTER, holes: HOLES, depth: 4,
        edgeTapers: [{ path: CUTTING_EDGE_PATH, width: 11, tipThickness: 0.12, curve: 0.85 }],
      },
      material: ruby,
      evidence: { status: 'estimated', source: SOURCE, notes: ['Broadside silhouette measured; depth inferred.'] },
    },
    ...panelComponents,
    ...pinComponents,
    ...dividerComponents,
    ...rosetteDetailComponents,
    ...[-1, 1].flatMap((side) => ([
      {
        id: `rosette_${side > 0 ? 'front' : 'back'}`, name: `Grip rosette ${side > 0 ? 'front' : 'back'}`,
        category: 'mechanical' as const, materialName: 'aged brass', detail: 'Concentric decorative fastener retained as a separate part.',
        geometry: { op: 'torus' as const, radius: 4.4, tube: 0.82, radialSegments: 18, tubularSegments: 56 },
        position: [rosetteX, rosetteY, side * 4.05] as [number, number, number],
        material: brass, evidence: { status: 'estimated' as const, source: SOURCE },
      },
      {
        id: `ring_lip_${side > 0 ? 'front' : 'back'}`, name: `Finger ring lip ${side > 0 ? 'front' : 'back'}`,
        category: 'mechanical' as const, materialName: 'Doppler ruby steel', detail: 'Raised lip makes the bore legible under oblique lighting.',
        geometry: { op: 'torus' as const, radius: 10.9, tube: 0.72, radialSegments: 18, tubularSegments: 72 },
        position: [ringX, ringY, side * 2.35] as [number, number, number],
        material: ruby, evidence: { status: 'estimated' as const, source: SOURCE },
      },
    ])),
  ],
};
