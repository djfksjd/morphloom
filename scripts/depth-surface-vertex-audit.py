"""Measure actual diagnostic GLB vertices against authored study truth only."""
import argparse,json,struct
from pathlib import Path
import numpy as np

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--study',type=Path,required=True);args=p.parse_args();root=args.output;rows=[]
 for file in sorted(root.glob('*.diagnostic.glb')):
  data=file.read_bytes();n=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+n]);binstart=20+n+8;primitive=doc['meshes'][0]['primitives'][0]
  def attribute(name,size):
   a=doc['accessors'][primitive['attributes'][name]];v=doc['bufferViews'][a['bufferView']];start=binstart+v.get('byteOffset',0)+a.get('byteOffset',0)
   if a['componentType']!=5126 or a['count']>65536:raise ValueError('Expected bounded Float32 fixture attributes')
   return np.ndarray((a['count'],size),dtype='<f4',buffer=data,offset=start,strides=(v.get('byteStride',size*4),4)).copy()
  pos=attribute('POSITION',3);uv=attribute('TEXCOORD_0',2);source=json.loads((root/'fixtures'/(file.stem.replace('.diagnostic','')+'.depth.json')).read_text())
  # glTF V is image-down after exporter conversion; truth is symmetric in this authored study.
  x=np.rint(uv[:,0]*source['width']-.5).astype(int);y=np.rint(uv[:,1]*source['height']-.5).astype(int)
  name=source['id'].rsplit('-',1)[0];truth=np.load(args.study/'fixtures'/(name+'-truth.npy'),allow_pickle=False)
  relief=14 if name=='torus' else (70 if name.startswith('large') else 48)
  expected=300-1/(truth[y,x]*(1/(300-relief)-1/300)+1/300)
  error=np.abs(pos[:,2]*1000-expected);rows.append({'id':source['id'],'generatedVertexCount':len(pos),'maeMm':float(error.mean()),'maxErrorMm':float(error.max()),'minimumZMm':float(pos[:,2].min()*1000),'maximumZMm':float(pos[:,2].max()*1000),'claim':'authored known visible surface, not physical measurement'})
 (root/'actual-vertex-errors.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(rows))
if __name__=='__main__':main()
