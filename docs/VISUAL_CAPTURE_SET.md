# Multi-view visual proof

Use a capture-set manifest when two or more real reference views and matching browser renders exist. Paths stay local; the report stores basenames, hashes, calibrated camera values, normalization thresholds, scores, and blockers rather than redistributing third-party images.

```json
{
  "schema": "morphloom.visual-capture-set/0.3",
  "id": "product-two-view-proof",
  "domain": "industrial-design",
  "rendererVersions": {
    "morphloom": "morphloom-compiler/0.22.0",
    "img2threejs": "pinned-commit-or-build"
  },
  "views": [
    {
      "viewId": "front",
      "camera": {
        "projection": "perspective",
        "position": [0, 0, 1.4],
        "target": [0, 0, 0],
        "up": [0, 1, 0],
        "fovDegrees": 31
      },
      "reference": "captures/front-reference.png",
      "morphloom": "captures/front-morphloom.png",
      "img2threejs": "captures/front-img2threejs.png",
      "sceneArtifacts": {
        "morphloom": "scenes/morphloom.glb",
        "img2threejs": "scenes/img2threejs.glb"
      },
      "captureReceipts": {
        "morphloom": "receipts/front-morphloom.json",
        "img2threejs": "receipts/front-img2threejs.json"
      },
      "referenceOrigin": "admitted-local-reference",
      "regions": [
        { "featureId": "silhouette", "x": 0, "y": 0, "width": 512, "height": 256 },
        { "featureId": "primary-detail", "x": 0, "y": 0, "width": 256, "height": 256 },
        { "featureId": "secondary-detail", "x": 256, "y": 0, "width": 256, "height": 256 }
      ]
    }
  ]
}
```

Each receipt has this bounded shape; every digest is a lowercase 64-character SHA-256 value:

```json
{
  "schema": "morphloom.browser-capture-receipt/0.1",
  "candidateId": "morphloom",
  "viewId": "front",
  "rendererVersion": "0.4.0",
  "captureMethod": "browser-webgl-canvas",
  "inputFingerprint": "<sha256>",
  "sceneSha256": "<sha256>",
  "cameraFingerprint": "<sha256>",
  "referenceSha256": "<sha256>",
  "renderSha256": "<sha256>",
  "canvas": { "width": 1024, "height": 1024, "pixelRatio": 2 },
  "renderSettingsFingerprint": "<sha256>"
}
```

Add a distinct manifest entry for every real view, then run:

```bash
npm run benchmark:visual-set -- --manifest captures/manifest.json --output benchmarks/visual-set-latest.json
```

Use `--require-claim` in a release gate. It exits unsuccessfully unless the domain's minimum distinct views, automatic thresholds, and a balanced panel of at least five unique blind raters all permit a winner claim.

The validator requires one local compiled scene artifact from each engine and streams the file itself to derive an independent 64-character structural SHA-256. Every calibrated view for that candidate must point to the same artifact; a changed path or hash means the supposedly matched views came from different scene builds. Scene files are bounded to 256 MB, and a screenshot hash is never accepted as structural scene evidence.

Each PNG also needs a `morphloom.browser-capture-receipt/0.1` JSON recorded by the instrumented capture harness. The receipt binds candidate and view IDs, renderer version, locked input, scene, camera, reference and PNG SHA-256 values, canvas dimensions/pixel ratio, and a render-settings fingerprint. The runner recomputes every file hash and camera/input fingerprint, checks the PNG dimensions, and rejects reused receipts. All evidence paths are relative to the manifest directory and cannot escape it. A receipt is tamper-evident consistency evidence, not a cryptographic attestation that makes an unsupervised third-party render trustworthy; winner claims still require retained capture provenance and blind review.

The validator also refuses remote or parent-traversing paths, duplicate view IDs, reused capture paths or content hashes, uncalibrated cameras, unsafe thresholds, out-of-frame regions, mismatched regions between engines, and identical candidate pixels. A copied front image renamed as a side view cannot satisfy the contract.
