"""Bridge authored study fields into experimental native depth sources.
Only known synthetic camera/depth anchors are used; never guesses metric scale.
"""
import argparse, hashlib, json
from pathlib import Path
import numpy as np
from PIL import Image

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def main():
    p=argparse.ArgumentParser();p.add_argument('--study',type=Path,required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    for name in ['large-matte','large-checker','small-matte','small-checker','torus']:
        image=args.study/'fixtures'/(name+'.png'); folder=args.study/'current'/name
        receipt=json.loads((folder/'manifest.json').read_text())
        if receipt['sourceSha256']!=sha(image) or any(receipt['artifacts'][n]!=sha(folder/n) for n in ['depth.npy','mask.npy']): raise ValueError('Raw evidence hash mismatch')
        raw=np.load(folder/'depth.npy',allow_pickle=False);mask=np.load(folder/'mask.npy',allow_pickle=False);truth=np.load(args.study/'fixtures'/(name+'-truth.npy'),allow_pickle=False)
        relief=14 if name=='torus' else (70 if name.startswith('large') else 48)
        depth=1/(truth*(1/(300-relief)-1/300)+1/300)
        pixels=np.arange(mask.size).reshape(mask.shape);fit=np.flatnonzero((mask==1)&(pixels%97==0));validation=np.flatnonzero((mask==1)&(pixels%89==0)&(pixels%97!=0))
        anchor=lambda i:{'id':f'pixel-{int(i)}','pixel':int(i),'depthMm':float(depth.flat[i])}
        rgb=np.array(Image.open(image))[:,:,:3]/255.;luma=rgb@np.array([.2126,.7152,.0722])
        for method,field in [('depth',raw),('luma',luma)]:
            source={'schema':'morphloom.depth-surface/0.1','id':name+'-'+method,'imageSha256':sha(image),
                'rawFieldSha256':receipt['artifacts']['depth.npy'] if method=='depth' else hashlib.sha256(luma.astype('<f4').tobytes()).hexdigest(),
                'width':raw.shape[1],'height':raw.shape[0],'samples':field.ravel().tolist(),'mask':mask.ravel().tolist(),
                'camera':{'projection':'orthographic-front','units':'mm','axes':'right-handed-y-up','frameMm':[-100,100,-100,100],'cameraZMm':300},
                'calibration':{'basis':'authored-fixture','fit':[anchor(i) for i in fit],'validation':[anchor(i) for i in validation]},'stride':2}
            (args.output/(source['id']+'.depth.json')).write_text(json.dumps(source,separators=(',',':'))+'\n')
if __name__=='__main__':main()
