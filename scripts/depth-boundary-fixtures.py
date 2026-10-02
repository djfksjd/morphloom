"""Add authored independent boundary/envelope contracts; raw fields unchanged."""
import argparse,json
from pathlib import Path
import numpy as np
from collections import deque

def main():
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--study',type=Path,required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True)
 for file in sorted((args.source/'fixtures').glob('*-depth.depth.json')):
  old=json.loads(file.read_text());name=old['id'].removesuffix('-depth');truth=np.load(args.study/'fixtures'/(name+'-truth.npy'),allow_pickle=False);radius=14 if name=='torus' else (70 if name.startswith('large') else 48)
  depth=1/(truth*(1/(300-radius)-1/300)+1/300);mask=np.array(old['mask']).reshape(old['height'],old['width']);band=np.zeros_like(mask)
  # Four-neighbour two-pixel interior band, including real hole boundaries.
  interior=np.pad(mask,1);core=mask.copy()
  for shift in [(1,0),(-1,0),(0,1),(0,-1)]:core&=interior[1+shift[0]:1+shift[0]+mask.shape[0],1+shift[1]:1+shift[1]+mask.shape[1]]
  boundary=mask&~core
  expanded=boundary.copy();pad=np.pad(boundary,1)
  for shift in [(1,0),(-1,0),(0,1),(0,-1)]:expanded|=pad[1+shift[0]:1+shift[0]+mask.shape[0],1+shift[1]:1+shift[1]+mask.shape[1]]
  pixels=np.flatnonzero(expanded&mask);taken={a['pixel'] for a in old['calibration']['fit']+old['calibration']['validation']};available=[int(i) for i in pixels if int(i) not in taken]
  selected=[available[int(i)] for i in np.linspace(0,len(available)-1,min(128,len(available)),dtype=int)]
  s={**old,'schema':'morphloom.depth-surface/0.2','quality':{'depthEnvelope':{'status':'declared','nearMm':300-radius,'farMm':300,'toleranceMm':.001,'basis':'authored-fixture'},'boundary':{'status':'declared','bandPixels':2,'toleranceMm':.001,'basis':'authored-fixture','anchors':[{'id':f'boundary-{i}','pixel':i,'depthMm':float(depth.flat[i])} for i in selected]}}}
  if name!='torus':s['primaryForm']={'schema':'morphloom.sphere-front-constraint/0.1','radiusMm':radius,'centerMm':[0,0,0],'centerFitToleranceMm':.001,'basis':'authored-fixture'}
  assert s['samples']==old['samples'] and s['mask']==old['mask'] and s['calibration']==old['calibration']
  (args.output/(s['id']+'.depth.json')).write_text(json.dumps(s,separators=(',',':'))+'\n')
  if name=='small-matte':
   ball=json.loads(json.dumps(s));factor=3/48;ball['id']='ball_0000';ball['camera']['cameraZMm']*=factor;ball['camera']['frameMm']=[v*factor for v in ball['camera']['frameMm']]
   for group in [ball['calibration']['fit'],ball['calibration']['validation'],ball['quality']['boundary']['anchors']]:
    for a in group:a['depthMm']*=factor
   for key in ['nearMm','farMm']:ball['quality']['depthEnvelope'][key]*=factor
   ball['primaryForm']['radiusMm']=3
   (args.output/'bearing-ball-depth.depth.json').write_text(json.dumps(ball,separators=(',',':'))+'\n')
if __name__=='__main__':main()
