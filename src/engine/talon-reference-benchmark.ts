import type { AssemblyComponentIR, AssemblyIR } from './assembly-ir';

/**
 * Same-input comparison fixture derived from the public Talon broadside reference.
 * The source bitmap is deliberately not redistributed; the values below are bounded
 * geometric measurements (silhouette, openings and visible hardware), not copied
 * showcase model data.
 */
const SOURCE = 'https://img2threejs.io/references/talon-doppler-ruby.webp';
const SCALE_MM_PER_PIXEL = 240 / 787;
const profile = (points: Array<[number, number]>): Array<[number, number]> =>
  points.map(([x, y]) => [x - 120, y]);
const referenceProfile = (points: Array<[number, number]>): Array<[number, number]> =>
  points.map(([x, y]) => [(x - 7) * SCALE_MM_PER_PIXEL - 120, -(y - 237.5) * SCALE_MM_PER_PIXEL]);

const OUTER = profile([[100.64,41.63],[101.86,41.63],[103.07,40.71],[104.29,41.02],[116.49,34.61],[128.08,31.56],[147.29,30.04],[162.54,30.04],[174.43,28.51],[200.97,20.58],[214.99,14.79],[222.31,10.83],[228.72,6.25],[233.9,1.37],[233.6,0.15],[237.26,-3.81],[240,-12.35],[240,-18.75],[238.78,-23.33],[235.73,-28.21],[230.55,-32.48],[225.36,-34],[218.35,-33.7],[209.2,-30.04],[205.54,-26.99],[201.27,-19.97],[197.31,-9.91],[194.56,-7.17],[189.07,-4.73],[183.28,-3.51],[167.12,-3.2],[154.31,3.81],[147.6,6.25],[140.58,7.47],[134.18,7.17],[129.91,5.95],[127.17,3.51],[122.9,-3.81],[119.54,-3.81],[114.97,-2.9],[110.7,-1.07],[102.16,5.34],[96.98,5.64],[95.76,6.56],[93.32,6.86],[83.86,5.34],[67.7,1.37],[57.03,-2.59],[43.91,-9],[23.79,-21.8],[9.45,-33.09],[0,-41.63],[0.91,-34],[4.27,-22.41],[9.76,-10.83],[12.81,-5.64],[17.38,0.15],[30.19,12.35],[39.95,19.67],[49.71,25.46],[61.91,31.56],[63.13,31.56],[63.13,28.51],[63.74,28.51],[68.61,34.31],[69.22,33.7],[69.22,31.26],[69.83,30.95],[74.1,36.44],[75.02,35.83],[75.32,33.09],[75.93,33.09],[80.51,38.27],[81.42,38.27],[81.73,35.53],[82.64,34.92],[84.17,36.14],[86,39.49],[93.93,41.02],[94.84,41.02],[94.84,40.41],[92.4,37.36],[92.4,35.53],[93.32,35.53]]);
const HOLES = [
  profile([[220.18,-2.29],[215.91,-4.42],[212.25,-8.69],[210.42,-13.57],[210.42,-18.75],[212.25,-23.63],[213.77,-25.16],[217.13,-26.99],[222.31,-27.29],[226.28,-26.07],[230.55,-22.41],[232.68,-18.14],[232.99,-12.96],[231.46,-8.39],[228.41,-4.73],[224.14,-2.59]]),
  profile([[85.08,30.04],[83.25,29.43],[81.42,26.38],[82.03,23.63],[84.17,22.11],[87.22,22.72],[89.05,25.16],[88.44,28.82],[87.22,29.73]]),
  profile([[74.71,26.07],[72.88,24.85],[72.58,21.8],[73.8,20.28],[75.93,20.28],[77.76,21.8],[78.07,23.94],[76.85,26.07]]),
  profile([[65.87,22.11],[64.35,20.89],[64.04,18.75],[64.96,17.23],[66.48,16.93],[68.01,17.84],[68.61,20.58],[67.7,22.11]]),
];

const PANELS = [
  referenceProfile([[345,104],[459,128],[458,211],[430,210],[407,208],[400,218],[398,226],[386,221],[374,209],[363,186]]),
  referenceProfile([[463,129],[632,159],[612,248],[575,245],[544,227],[512,217],[460,211]]),
  referenceProfile([[636,160],[773,230],[763,240],[731,244],[714,257],[698,292],[696,315],[686,323],[676,313],[663,271],[651,250],[614,248]]),
];

const ruby = { color: '#b91529', surface: 'polished-metal' as const, roughness: 0.19, metalness: 0.76, clearcoat: 0.82, clearcoatRoughness: 0.09, iridescence: 0.18, microNormalStrength: 0.42 };
const ivory = { color: '#d9d6c7', surface: 'polished-metal' as const, roughness: 0.31, metalness: 0.08, clearcoat: 0.58, clearcoatRoughness: 0.18, microNormalStrength: 0.16 };
const brass = { color: '#9a7931', surface: 'polished-metal' as const, roughness: 0.26, metalness: 0.88, clearcoat: 0.35, clearcoatRoughness: 0.2 };

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
      detail: 'One continuous profile with five traced saw teeth, three true blade openings and a true finger-ring bore.',
      geometry: { op: 'extrude', points: OUTER, holes: HOLES, depth: 4, bevelSize: 0.32, bevelThickness: 0.24, bevelSegments: 2 },
      material: ruby,
      evidence: { status: 'estimated', source: SOURCE, notes: ['Broadside silhouette measured; depth inferred.'] },
    },
    {
      id: 'cutting_edge', name: 'Ground cutting edge', category: 'mechanical', materialName: 'dark polished steel',
      detail: 'Curved bevel terminator follows the photographed hawkbill edge and remains independently inspectable.',
      geometry: { op: 'tube', points: [[-120,-41.6,2.15],[-110,-25,2.15],[-92,-8,2.15],[-68,3,2.15],[-41,9,2.15],[-23,7,2.15]], radius: 0.78, tubularSegments: 96, radialSegments: 10 },
      material: { color: '#232b34', surface: 'polished-metal', roughness: 0.16, metalness: 0.92, anisotropy: 0.42 },
      evidence: { status: 'estimated', source: SOURCE },
    },
    ...panelComponents,
    ...pinComponents,
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
