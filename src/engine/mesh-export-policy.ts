import {inspectExportedUv} from './uv-delivery';
import {validateGlbStandard} from './gltf-standard-validation';
import type {UvQualityReport} from './uv-quality';
export type MeshExportPurpose='editable-mesh'|'diagnostic';
/** UV-only decision. Callers must also retain topology, standard validation and resource gates. */
export function evaluateMeshUvExport(report:UvQualityReport,purpose:MeshExportPurpose):{allowed:boolean;purpose:MeshExportPurpose;productionApproved:false;issues:{id:string;reason:string}[]}{
 const issues:{id:string;reason:string}[]=[];
 if(!report.meshes.length)issues.push({id:'scene',reason:'No inspected meshes'});
 for(const mesh of report.meshes){
  if(mesh.blocked)issues.push({id:mesh.id,reason:mesh.blocked});
  else if(!mesh.integrityPass)issues.push({id:mesh.id,reason:`UV integrity failed: ${mesh.degenerateUvTriangles}/${mesh.eligibleUvTriangles} degenerate; ${mesh.invalidUvVertices} invalid vertices; ${mesh.invalidWorldTriangles} invalid world triangles`});
  for(const feature of mesh.features)if(!feature.integrityPass)issues.push({id:feature.id,reason:`Critical feature UV failed: ${feature.degenerateUvTriangles}/${feature.triangles} degenerate`});
 }
 if(report.fingerprintCoverage!=='complete')issues.push({id:'scene',reason:'Static mesh inspection coverage incomplete'});
 if(!report.integrityPass&&!issues.length)issues.push({id:'scene',reason:'UV integrity failed'});
 return {allowed:purpose==='diagnostic'||issues.length===0,purpose,productionApproved:false,issues};
}

/** Inspect actual bytes, not a potentially stale viewport receipt. Does not replace caller topology/resource gates. */
export async function inspectMeshExport(bytes:ArrayBuffer,sourceJson:string,purpose:MeshExportPurpose){
 const [receipt,standard]=await Promise.all([inspectExportedUv(bytes,sourceJson),validateGlbStandard(bytes)]);
 if(standard.errors||standard.truncated||standard.independentRead.status!=='pass')throw new Error('Mesh export blocked: actual GLB standard validation incomplete or failed');
 const uv=evaluateMeshUvExport(receipt.report,purpose);
 if(!uv.allowed)throw new Error(`Mesh export blocked: ${uv.issues.slice(0,12).map(i=>`${i.id}: ${i.reason}`).join('; ')}. Fix the affected UVs or use explicit diagnostic export. This is not production approval.`);
 return {...receipt,meshExport:{schema:'morphloom.mesh-export-decision/0.1' as const,scope:'static edited mesh; not atlas, manufacturing or production approval',uv,standard}};
}
