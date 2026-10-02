"""Compare actual accessor bytes and exported mesh/PBR/hierarchy metadata, not receipts."""
import json,struct,hashlib,pathlib,sys
SIZES={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};WIDTH={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def read(path):
 b=pathlib.Path(path).read_bytes();n=struct.unpack('<I',b[12:16])[0];return json.loads(b[20:20+n]),b[28+n:],hashlib.sha256(b).hexdigest()
def attribute(j,b,i):
 a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];size=SIZES[a['componentType']]*WIDTH[a['type']];off=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',size)
 return b''.join(b[off+k*stride:off+k*stride+size] for k in range(a['count']))
a,ab,ah=read(sys.argv[1]);c,cb,ch=read(sys.argv[2]);checks={}
checks['meshCount']=len(a['meshes'])==len(c['meshes'])
for i,(x,y) in enumerate(zip(a['meshes'],c['meshes'])):
 for k,(p,q) in enumerate(zip(x['primitives'],y['primitives'])):
  checks[f'{i}/{k}/attributeKeys']=set(p['attributes'])==set(q['attributes'])
  for name,idx in p['attributes'].items():checks[f'{i}/{k}/{name}']=attribute(a,ab,idx)==attribute(c,cb,q['attributes'][name])
  checks[f'{i}/{k}/indices']=('indices' in p)==('indices' in q) and ('indices' not in p or attribute(a,ab,p['indices'])==attribute(c,cb,q['indices']))
checks['meshMaterialsHierarchy']=all(a.get(k)==c.get(k) for k in ['meshes','materials','nodes','scenes'])
r={'pass':all(checks.values()),'inputs':[{'path':sys.argv[1],'sha256':ah},{'path':sys.argv[2],'sha256':ch}],'checks':checks}
pathlib.Path(sys.argv[3]).write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'pass':r['pass'],'failed':[k for k,v in checks.items() if not v]}));sys.exit(0 if r['pass'] else 1)
