import {it,expect} from 'vitest';
import {createElementDomainRegistry,DomainPackError,type DomainPack} from '../src/engine/element-domain-packs';
import {surfaceGearPack} from '../examples/domain-packs/surface-gear-pack';
import {gearPack} from '../src/engine/gear-pack';
it('registers API0.4 independently of native schema0.6, retaining old Pack output',()=>{
 const r=createElementDomainRegistry();r.register(gearPack);const old=r.generate(gearPack.metadata.id,{});r.register(surfaceGearPack);
 const p=r.generate(surfaceGearPack.metadata.id,{},['native-uv-scaling','authored-roughness-surface']);expect(p.schema).toBe('morphloom.elements/0.6');expect(p.parts[0].uvScale).toBe(100);expect(p.parts[0].material?.surface?.repeat).toEqual([8,8]);expect(r.generate(gearPack.metadata.id,{})).toEqual(old);
});
it('rejects incompatible metadata/output, input conflicts and required capabilities and isolates provider errors',()=>{
 const r=createElementDomainRegistry();r.register(surfaceGearPack);const good=r.generate(surfaceGearPack.metadata.id,{});
 for(const input of [{units:'cm'},{coordinates:'z-up'},{uvScale:0},{surfaceRepeat:1025},{unknown:1}])expect(()=>r.generate(surfaceGearPack.metadata.id,input)).toThrow(DomainPackError);
 expect(()=>r.generate(surfaceGearPack.metadata.id,{},['brep'])).toThrow(/unsupported/);
 for(const change of [{version:'morphloom.domain-pack/9'},{representation:{id:'morphloom.elements/9',mode:'native'}},{dependencies:{engineApi:'0.3'}},{units:'cm'},{coordinates:'z-up'},{representation:{id:'nurbs',mode:'native'}}])expect(()=>r.register({...surfaceGearPack,metadata:{...surfaceGearPack.metadata,...change,id:'bad.pack'} as DomainPack['metadata']})).toThrow(/invalid-pack/);
 r.register({...surfaceGearPack,metadata:{...surfaceGearPack.metadata,id:'bad.output'},generate:()=>({...good,schema:'morphloom.elements/0.3'})});expect(()=>r.generate('bad.output',{})).toThrow(/invalid-project/);
 r.register({...surfaceGearPack,metadata:{...surfaceGearPack.metadata,id:'bad.provider'},generate:()=>{throw new Error('private');}});expect(()=>r.generate('bad.provider',{})).toThrow(/provider-error/);expect(r.generate(surfaceGearPack.metadata.id,{})).toEqual(good);
});
it.each(['0.1','0.2','0.3','0.4','0.5','0.6'])('API0.4 explicitly declares supported native schema%s without implicit migration',version=>{
 const r=createElementDomainRegistry();const project=r.generate('morphloom.fur',{});project.schema=`morphloom.elements/${version}` as typeof project.schema;
 const pack:DomainPack={metadata:{...surfaceGearPack.metadata,id:`test.schema-${version}`,representation:{id:project.schema,mode:'native'}},generate:()=>project};r.register(pack);expect(r.generate(pack.metadata.id,{})).toEqual(project);
});
it('retains legacy representation coupling and rejects missing output declarations',()=>{
 const r=createElementDomainRegistry();for(const version of ['0.1','0.2','0.3'])expect(()=>r.register({...surfaceGearPack,metadata:{...surfaceGearPack.metadata,version:`morphloom.domain-pack/${version}`,dependencies:{engineApi:version}} as DomainPack['metadata']})).toThrow(/invalid-pack/);
 expect(()=>r.register({...surfaceGearPack,metadata:{...surfaceGearPack.metadata,representation:undefined} as unknown as DomainPack['metadata']})).toThrow(DomainPackError);
});
