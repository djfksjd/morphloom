import { type DomainPack, DomainPackError } from './element-domain-packs';
import { validateProject, type ElementProject } from './element-project';
import { validateSpurGear, type SpurGearGeometry } from './spur-gear';
export const GEAR_PACK_REVISION='morphloom.spur-gear/0.1';
const defaults={moduleMm:1,toothCount:24,pressureAngleDeg:20,faceWidthMm:8,boreDiameterMm:6};
export function generateSpurGearProject(input:Readonly<Record<string,unknown>>):ElementProject{
  if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Object.keys(input).some(k=>!['seed','units','coordinates',...Object.keys(defaults)].includes(k))||
    (input.units!==undefined&&input.units!=='mm')||(input.coordinates!==undefined&&input.coordinates!=='right-handed-y-up')||
    (input.seed!==undefined&&(!Number.isSafeInteger(input.seed)||(input.seed as number)<0)))throw new DomainPackError('invalid-input','mechanical.spur-gear.visual');
  const geometry={op:'spur-gear',...Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,Object.hasOwn(input,k)?input[k]:v]))} as SpurGearGeometry;
  try{validateSpurGear(geometry);}catch{throw new DomainPackError('invalid-input','mechanical.spur-gear.visual');}
  return validateProject({schema:'morphloom.elements/0.3',seed:input.seed??42,units:'mm',coordinates:'right-handed-y-up',parts:[{
    id:'spur_gear',name:'External involute spur gear · radial root approximation',shape:'assembly-geometry',geometry,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],
    color:'#aeb8c2',material:{roughness:0.32,metalness:0.9},creaseAngle:Math.PI/6,visible:true,locked:false,
    evidence:{status:'authored',source:GEAR_PACK_REVISION+'; zero profile shift; radial root connector, not manufacturing trochoid or approved tolerances'}
  }],regions:[],groups:[],elements:[]});
}
export const gearPack:DomainPack={metadata:{version:'morphloom.domain-pack/0.3',id:'mechanical.spur-gear.visual',domain:'mechanical-visualization',status:'experimental',
  capabilities:['generate','semantic-part-editing','selected-scene-export','connected-feature-editing','diagnostic-feature-extraction'],representation:{id:'morphloom.elements/0.3',mode:'native'},
  units:'mm',coordinates:'right-handed-y-up',parameters:{seed:'uint-safe-integer',dimensions:{moduleMm:{min:0.2,max:5,default:1},toothCount:{min:18,max:64,default:24},pressureAngleDeg:{min:20,max:25,default:20},faceWidthMm:{min:0.1,max:100,default:8},boreDiameterMm:{min:0,max:300,default:6}}},
  parameterNotes:['External spur, zero profile shift; root connectors are radial approximations, not cutter trochoids.','Bore must be below the root diameter; teeth must be integers without theoretical full-depth undercut risk.','Tooth extraction makes a diagnostic cut; teeth are connected features, not detachable assembly parts.'],
  constraints:{maxElements:5000},operations:['generate'],tools:['generic-inspector'],evidencePaths:['parts.*.evidence'],exportAdapters:[{id:'source-json',editing:'full'},{id:'baked-glb',editing:'baked-only'}],dependencies:{engineApi:'0.3'}},generate:generateSpurGearProject};
