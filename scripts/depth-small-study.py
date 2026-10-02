"""Reproducible authored fixture study. Optional Python deps; no model downloads.
Generate inputs, run the pinned offline worker, and retain per-feature failures.
"""
import argparse, json, hashlib, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

CASES = ['large-matte', 'large-checker', 'small-matte', 'small-checker', 'torus']

def fixtures(out):
    out.mkdir(parents=True, exist_ok=True)
    y, x = np.mgrid[0:256, 0:256]
    u = (x+.5)/256*2-1; v = 1-(y+.5)/256*2
    light = np.array([-.4,.6,.7]); light /= np.linalg.norm(light)
    for name in CASES:
        if name == 'torus':
            radial = np.sqrt(u*u+v*v); q = radial-.5
            mask = np.abs(q)<.14; z = np.sqrt(np.maximum(0,.14**2-q*q))
            safe = np.maximum(radial,1e-9)
            nx=u/safe*q/.14; ny=v/safe*q/.14; nz=z/.14; depth_range=.14
        else:
            radius=.7 if name.startswith('large') else .48
            mask=u*u+v*v<radius*radius; z=np.sqrt(np.maximum(0,radius*radius-u*u-v*v))
            nx=u/radius; ny=v/radius; nz=z/radius; depth_range=radius
        diffuse=np.maximum(0,nx*light[0]+ny*light[1]+nz*light[2])
        base=np.full((256,256,3),.65)
        if name.endswith('checker'):
            bands=((np.floor((u+radius)*10)+np.floor((v+radius)*10))%2)==0
            base[bands]=[.75,.15,.12]; base[~bands]=[.15,.5,.7]
        rgb=np.ones((256,256,3))*.95
        shaded=base*(.25+.7*diffuse[...,None]); rgb[mask]=shaded[mask]
        rgba=np.concatenate([np.uint8(np.clip(rgb,0,1)*255),np.uint8(mask[...,None])*255],-1)
        Image.fromarray(rgba).save(out/(name+'.png'))
        gt=np.zeros((256,256),dtype='<f4')
        gt[mask]=(1/(3-z[mask])-1/3)/(1/(3-depth_range)-1/3)
        np.save(out/(name+'-truth.npy'),gt,allow_pickle=False)

def evaluate(out):
    rows=[]
    for name in CASES:
        raw=np.load(out/'current'/name/'depth.npy',allow_pickle=False)
        mask=np.load(out/'current'/name/'mask.npy',allow_pickle=False).astype(bool)
        truth=np.load(out/'fixtures'/(name+'-truth.npy'),allow_pickle=False)
        index=np.arange(mask.size).reshape(mask.shape)
        anchors=mask&(index%97==0); held=mask&~anchors
        rgb=np.array(Image.open(out/'fixtures'/(name+'.png')))[:,:,:3]/255.
        luma=rgb@np.array([.2126,.7152,.0722]); row={'case':name}
        for key,pred in [('luma',luma),('depth',raw)]:
            a,b=np.linalg.lstsq(np.stack([pred[anchors],np.ones(anchors.sum())],-1),truth[anchors],rcond=None)[0]
            aligned=a*pred+b
            row[key]={'mae':float(np.abs(aligned[held]-truth[held]).mean()),'positiveScale':bool(a>0)}
        row['improvement']=1-row['depth']['mae']/row['luma']['mae']
        row['pass']=row['depth']['positiveScale'] and row['depth']['mae']<=.1 and row['improvement']>=.1
        rows.append(row)
    result={'schema':'morphloom.depth-study/0.1','perCase':rows,'spherePass':all(r['pass'] for r in rows[:4]),
        'structuralHoldoutPass':rows[4]['pass'],'automaticGeometryAdopted':False,
        'thresholds':{'maxNormalizedMAE':.1,'minimumImprovement':.1},
        'scope':'authored synthetic visible-depth study, no product/hidden-surface accuracy certification'}
    (out/'study.json').write_text(json.dumps(result,indent=2)+'\n')
    # Show the failed structural case alongside passes; fixed [0, 1] display range.
    name = 'torus'
    raw = np.load(out/'current'/name/'depth.npy', allow_pickle=False)
    mask = np.load(out/'current'/name/'mask.npy', allow_pickle=False).astype(bool)
    truth = np.load(out/'fixtures'/(name+'-truth.npy'), allow_pickle=False)
    anchors = mask & (np.arange(mask.size).reshape(mask.shape) % 97 == 0)
    a, b = np.linalg.lstsq(np.stack([raw[anchors], np.ones(anchors.sum())], -1), truth[anchors], rcond=None)[0]
    tiles = [Image.open(out/'fixtures'/(name+'.png')).convert('RGB')]
    for field in [truth, a*raw+b, np.abs(a*raw+b-truth)]:
        pixels = np.repeat(np.uint8(np.clip(field, 0, 1)*255)[:, :, None], 3, 2)
        pixels[~mask] = 240
        tiles.append(Image.fromarray(pixels))
    canvas = Image.new('RGB', (1024, 280), 'white')
    error = rows[4]['depth']['mae']
    labels = ['Input authored torus', 'Known normalized truth', 'Small aligned prediction',
              f"Abs error | {'PASS' if rows[4]['pass'] else 'FAIL'} MAE {error:.3f} limit .100"]
    for index, (tile, label) in enumerate(zip(tiles, labels)):
        canvas.paste(tile, (256*index, 24))
        ImageDraw.Draw(canvas).text((256*index+3, 6), label, fill='black')
    canvas.save(out/'torus-failure.png')
    return result

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--generate-only',action='store_true')
    parser.add_argument('--evaluate-only',action='store_true')
    parser.add_argument('--source-dir',type=Path)
    parser.add_argument('--weights',type=Path)
    args=parser.parse_args()
    if args.evaluate_only: print(json.dumps(evaluate(args.output))); return
    fixtures(args.output/'fixtures')
    if args.generate_only: return
    if args.source_dir is None or args.weights is None: parser.error('Provide reviewed checkout and weights explicitly')
    worker=Path(__file__).with_name('local-depth-small.py')
    for name in CASES:
        subprocess.run([sys.executable,str(worker),'--source-dir',str(args.source_dir),'--weights',str(args.weights),
            '--input',str(args.output/'fixtures'/(name+'.png')),'--output',str(args.output/'current'/name)],check=True,timeout=125)
    print(json.dumps(evaluate(args.output)))

if __name__=='__main__': main()
