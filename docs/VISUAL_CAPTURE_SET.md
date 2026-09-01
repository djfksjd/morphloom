# Multi-view visual proof

Use a capture-set manifest when two or more real reference views and matching browser renders exist. Paths stay local; the report stores basenames, hashes, calibrated camera values, normalization thresholds, scores, and blockers rather than redistributing third-party images.

```json
{
  "schema": "morphloom.visual-capture-set/0.1",
  "id": "product-two-view-proof",
  "domain": "industrial-design",
  "rendererVersions": {
    "morphloom": "morphloom-compiler/0.16.0",
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
      "sceneFingerprints": {
        "morphloom": "0123456789abcdef",
        "img2threejs": "fedcba9876543210"
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

Add a distinct manifest entry for every real view, then run:

```bash
npm run benchmark:visual-set -- --manifest captures/manifest.json --output benchmarks/visual-set-latest.json
```

Use `--require-claim` in a release gate. It exits unsuccessfully unless the domain's minimum distinct views, automatic thresholds, and a balanced panel of at least five unique blind raters all permit a winner claim.

The validator requires independent structural scene fingerprints exported by both engines; a screenshot hash is not accepted as a scene fingerprint. It refuses remote paths, oversized files, duplicate view IDs, reused file paths, reused reference/render content hashes, reused scene fingerprints, uncalibrated cameras, unsafe thresholds, out-of-frame regions, mismatched regions between engines, and identical candidate pixels. A copied front image renamed as a side view cannot satisfy the contract.
