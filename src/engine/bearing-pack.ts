import { DomainPackError, type DomainPack } from './element-domain-packs';
import { validateProject, type ElementProject, type Part, type Vec3 } from './element-project';

export const BEARING_PACK_REVISION = 'morphloom.bearing-visual/0.1';
const defaults = { boreDiameterMm: 20, outerDiameterMm: 40, widthMm: 12, ballDiameterMm: 6, ballCount: 8 };
const finite = (x: unknown): x is number => typeof x==='number' && Number.isFinite(x);
const round = (x:number):number => Number(x.toFixed(9)) || 0;
const circle = (radius:number, center:[number,number]=[0,0], segments=128):[number,number][] =>
  Array.from({length:segments},(_,i)=>[round(center[0]+radius*Math.cos(2*Math.PI*i/segments)),round(center[1]+radius*Math.sin(2*Math.PI*i/segments))]);

/** Authored open bearing visualization. Clearances are design choices, not datasheet tolerances. */
export function generateBearingProject(input: Readonly<Record<string, unknown>>): ElementProject {
  const values = Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,input[k]??v])) as typeof defaults;
  if (Object.keys(input).some(k=>!['seed','units','coordinates',...Object.keys(defaults)].includes(k)) ||
    (input.units!==undefined && input.units!=='mm') || (input.coordinates!==undefined && input.coordinates!=='right-handed-y-up') ||
    !Object.values(values).every(finite) || (input.seed!==undefined && (!Number.isSafeInteger(input.seed) || (input.seed as number)<0))) throw new DomainPackError('invalid-input','mechanical.bearing.visual');
  const {boreDiameterMm,outerDiameterMm,widthMm,ballDiameterMm,ballCount}=values;
  const bore=boreDiameterMm/2, outer=outerDiameterMm/2, r=ballDiameterMm/2;
  const pitch=(bore+outer)/2, half=widthMm/2, chamfer=r*0.08, grooveRadius=r*1.15, grooveSpan=r*0.82;
  if (boreDiameterMm<1 || outerDiameterMm>400 || widthMm>100 || ballDiameterMm<0.4 ||
    !Number.isInteger(ballCount) || ballCount<3 || ballCount>32 ||
    outer<=bore || pitch-grooveRadius-bore<r*0.25 || outer-pitch-grooveRadius<r*0.25 ||
    half-chamfer<=grooveSpan || widthMm<ballDiameterMm*1.15 ||
    2*pitch*Math.sin(Math.PI/ballCount)<=ballDiameterMm*1.12) throw new DomainPackError('invalid-input','mechanical.bearing.visual');
  const lipOffset=Math.sqrt(grooveRadius**2-grooveSpan**2), innerLip=pitch-lipOffset, outerLip=pitch+lipOffset;
  const arc = (side:-1|1,descending:boolean):[number,number][] => Array.from({length:25},(_,i)=>{
    const y=grooveSpan*(descending ? 1-2*i/24 : -1+2*i/24);
    return [round(pitch+side*Math.sqrt(grooveRadius**2-y**2)),round(y)];
  });
  const innerProfile:[number,number][] = [[bore,-half+chamfer],[bore,half-chamfer],[bore+chamfer,half],
    [innerLip-chamfer,half],[innerLip,half-chamfer],...arc(-1,true),[innerLip,-half+chamfer],
    [innerLip-chamfer,-half],[bore+chamfer,-half],[bore,-half+chamfer]].map(p=>[round(p[0]),round(p[1])]);
  const outerProfile:[number,number][] = [[outerLip,-half+chamfer],...arc(1,false),[outerLip,half-chamfer],
    [outerLip+chamfer,half],[outer-chamfer,half],[outer,half-chamfer],[outer,-half+chamfer],
    [outer-chamfer,-half],[outerLip+chamfer,-half],[outerLip,-half+chamfer]].map(p=>[round(p[0]),round(p[1])]);
  const part = (id:string,name:string,geometry:NonNullable<Part['geometry']>,position:Vec3=[0,0,0]):Part => ({
    id,name,shape:'assembly-geometry',geometry,position,rotation:[0,0,0],scale:[1,1,1],assemblyId:'bearing_assembly',
    creaseAngle:Math.PI/6,color:'#b8bec6',material:{roughness:0.24,metalness:0.94},
    visible:true,locked:false,evidence:{status:'authored',source:BEARING_PACK_REVISION+'; conceptual visual geometry, no manufacturer reference or load rating'}
  });
  const parts:Part[]=[part('inner_race','Inner race · bored and grooved',{op:'lathe',profile:innerProfile,segments:128}),
    part('outer_race','Outer race · grooved',{op:'lathe',profile:outerProfile,segments:128})];
  const positions:Vec3[]=Array.from({length:ballCount},(_,i)=>[round(pitch*Math.cos(2*Math.PI*i/ballCount)),0,round(pitch*Math.sin(2*Math.PI*i/ballCount))]);
  const cage=part('cage','Cage · real through pockets',{op:'extrude',points:circle(pitch+r*1.045),
    holes:[circle(pitch-r*1.045),...positions.map(p=>circle(r*1.025,[p[0],p[2]],64))],depth:ballDiameterMm*0.18,bevelSize:0,bevelThickness:0});
  cage.rotation=[Math.PI/2,0,0]; cage.color='#b18c48'; cage.material={roughness:0.36,metalness:0.85};
  parts.push(cage,...positions.map((position,i)=>part(`ball_${String(i).padStart(4,'0')}`,`Ball ${i+1}`,{op:'sphere',radius:r,widthSegments:48,heightSegments:32},position)));
  return validateProject({schema:'morphloom.elements/0.2',seed:(input.seed as number|undefined)??42,units:'mm',coordinates:'right-handed-y-up',
    assemblies:[{id:'bearing_assembly',name:'Authored open bearing',axis:[0,1,0]}],parts,regions:[],groups:[],elements:[]});
}

export const bearingPack:DomainPack={
  metadata:{version:'morphloom.domain-pack/0.2',id:'mechanical.bearing.visual',domain:'mechanical-visualization',status:'experimental',
    capabilities:['generate','semantic-part-editing','selected-scene-export','assembly-membership','part-detach-restore'],
    representation:{id:'morphloom.elements/0.2',mode:'native'},units:'mm',coordinates:'right-handed-y-up',
    parameters:{seed:'uint-safe-integer',dimensions:{
      boreDiameterMm:{min:1,max:200,default:20},outerDiameterMm:{min:4,max:400,default:40},widthMm:{min:1,max:100,default:12},
      ballDiameterMm:{min:0.4,max:50,default:6},ballCount:{min:3,max:32,default:8}}},
    parameterNotes:['Outer diameter minus bore diameter must exceed 2.8 × ball diameter.', 'Width must be at least 1.15 × ball diameter.', 'Ball count is an integer; neighboring centers must be more than 1.12 × ball diameter apart.', 'Generate starts a new project; save existing edits before regenerating.'],
    constraints:{maxElements:5000},operations:['generate'],tools:['generic-inspector'],evidencePaths:['parts.*.evidence'],
    exportAdapters:[{id:'source-json',editing:'full'},{id:'baked-glb',editing:'baked-only'}],dependencies:{engineApi:'0.2'}},
  generate:generateBearingProject
};
