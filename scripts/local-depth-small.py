"""Opt-in offline Small depth evidence. Never writes AssemblyIR or measured depth.
Requires the reviewed upstream checkout and separately hash-verified weights.
Run in a subprocess with a 120s deadline; this CLI does not install/download.
"""
import argparse, hashlib, json, os, signal, subprocess, sys, time
from pathlib import Path

UPSTREAM = '6d8f415392eafb49c96a38cc4dedbd09a1607f50'
WEIGHTS = '56a173c0e1b5045bf6296a5c1fb16eace0bbde2eddc24b37532cb1774ac09caa'

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-dir', required=True, type=Path)
    parser.add_argument('--weights', required=True, type=Path)
    parser.add_argument('--input', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.input.stat().st_size > 16 * 1024 * 1024:
        raise ValueError('Image byte budget exceeded')
    if args.weights.stat().st_size != 99165428 or sha(args.weights) != WEIGHTS:
        raise ValueError('Unreviewed Small checkpoint')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=args.source_dir, timeout=10, text=True).strip()
    if commit != UPSTREAM:
        raise ValueError('Unreviewed upstream revision')
    subprocess.run(['git', 'diff', '--exit-code', 'HEAD', '--', 'distillanydepth'], cwd=args.source_dir,
                   check=True, timeout=10, stdout=subprocess.DEVNULL)
    args.output.mkdir(parents=True, exist_ok=True)
    if any((args.output / name).exists() for name in ['depth.npy', 'mask.npy', 'manifest.json']):
        raise ValueError('Output already contains depth evidence; choose a fresh directory')
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
    started = time.monotonic()
    import cv2
    import numpy as np
    import torch
    from PIL import Image
    from safetensors.torch import load_file
    Image.MAX_IMAGE_PIXELS = 1048576
    with Image.open(args.input) as image:
        if image.width > 1024 or image.height > 1024 or image.width < 2 or image.height < 2:
            raise ValueError('Image dimensions outside 2..1024 budget')
        rgba = np.array(image.convert('RGBA'))
    height, width = rgba.shape[:2]
    torch.set_num_threads(4)
    torch.manual_seed(17)
    torch.use_deterministic_algorithms(True)
    sys.path.insert(0, str(args.source_dir.resolve()))
    from distillanydepth.depth_anything_v2.dpt import DepthAnythingV2
    model = DepthAnythingV2(encoder='vits', features=64, out_channels=[48, 96, 192, 384])
    model.load_state_dict(load_file(str(args.weights)), strict=True)
    model.eval()
    pixels = cv2.resize(rgba[:, :, :3].astype(np.float32) / 255, (700, 700), interpolation=cv2.INTER_CUBIC)
    pixels = (pixels - np.array([.485, .456, .406], dtype=np.float32)) / np.array([.229, .224, .225], dtype=np.float32)
    tensor = torch.from_numpy(np.ascontiguousarray(pixels.transpose(2, 0, 1))).unsqueeze(0)
    with torch.inference_mode():
        prediction, _ = model(tensor)
        raw = torch.nn.functional.interpolate(prediction, size=(height, width), mode='bilinear', align_corners=False)[0, 0].numpy().astype('<f4')
    mask = (rgba[:, :, 3] > 0).astype(np.uint8)
    values = raw[mask == 1]
    if values.size < 16 or not np.isfinite(raw).all() or float(np.ptp(values)) <= 1e-8:
        raise ValueError('Empty, non-finite or constant depth evidence')
    np.save(args.output / 'depth.npy', raw, allow_pickle=False)
    np.save(args.output / 'mask.npy', mask, allow_pickle=False)
    import resource
    receipt = {'schema': 'morphloom.relative-depth-evidence/0.1', 'status': 'experimental',
        'workerVersion': 'morphloom.local-depth-small/0.1', 'workerSha256': sha(Path(__file__)),
        'semantics': 'relative-inverse-depth-proxy', 'units': 'arbitrary', 'metricCalibrated': False,
        'sourceSha256': sha(args.input), 'model': 'Distill-Any-Depth-Small', 'upstreamCommit': UPSTREAM,
        'checkpointRevision': '38095a41cca1e28a28e8bb6372c68df721455a2d', 'checkpointSha256': WEIGHTS,
        'preprocess': {'version': 'square-cv2-cubic-700-v1', 'originalSize': [width, height],
            'modelSize': [700, 700], 'mapping': 'stretch-original-pixel-centres', 'preservesAspectRatio': False,
            'resampleOutput': 'bilinear-align-corners-false'},
        'seed': 17, 'device': 'cpu', 'threads': 4, 'torchVersion': torch.__version__,
        'secondsIncludingImportsAndLoad': time.monotonic()-started,
        'peakRssNativeUnits': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        'rssUnits': 'bytes-on-macOS-KiB-on-Linux',
        'artifacts': {name: sha(args.output / name) for name in ['depth.npy', 'mask.npy']},
        'limitations': ['relative depth, no absolute millimetres', 'hidden surfaces are not observed',
            'no IR fitting or delivery approval', 'square stretching may affect shape estimates',
            'alpha mask is input validity, not model confidence']}
    (args.output / 'manifest.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps({'status': 'raw-evidence-written', 'seconds': receipt['secondsIncludingImportsAndLoad']}))

if __name__ == '__main__':
    if not hasattr(signal, 'SIGALRM'):
        raise SystemExit('This optional worker requires a Unix deadline signal')
    def timeout_handler(signum, frame):
        raise TimeoutError('Local depth worker exceeded 120s deadline')
    previous = signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(120)
    try:
        main()
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)
