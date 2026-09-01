# Runtime and 3D-print delivery

Apply only the contract matching the requested destination. Never award one universal readiness score.

## Animation

- Require a real `SkinnedMesh`, named bone hierarchy, normalized weights with no more than four non-zero influences per vertex, and deformation-safe closed body topology. Perturb at least one driven joint and measure finite, non-zero vertex movement; metadata-only rigs do not pass.
- Include at least one playable clip with actual tracks. Reopen the delivered GLB and block if skeleton, bone, clip, or track counts drift.
- Treat a posed static mesh, decorative bone names, or metadata-only rig as a failure. When articulated hands are in scope, require named finger segments, non-zero finger-bone weights on actual hand vertices, and at least one finger animation track after GLB reopen. Face rigs, blendshapes, finger collision/muscle deformation, cloth physics, and retargeting remain separate scope unless requested and proved.

## Game and real-time use

- Declare the triangle budget before optimization and verify it after export. Preserve silhouette, UVs, normals, material slots, skeleton, and named edit units while reducing geometry.
- Block non-manifold or degenerate geometry, missing UVs/normals, unnormalized skin weights, and missing runtime PBR surfaces. Open garment/hair borders may be intentional only when identified and free of non-manifold edges.
- Require actual lower-detail render geometry for every declared LOD and preserve its skin attributes when animated. Report LODs, collision, texture resolution, animation set, and target engine import settings as missing when they were not produced; do not infer them from a successful GLB load or metadata alone.

## 3D printing

- Require a closed positive-volume mesh, explicit millimetres, and a source-IR declared minimum feature of at least 0.8 mm unless the target process provides a stricter verified limit.
- Mesh bounding-box width is only a sanity check, not wall-thickness proof. Block print readiness when no physical feature dimension is declared.
- Check boundary, non-manifold and degenerate counts before export, then reopen the exported mesh. Measure generic 45° unsupported area from world-space triangle normals after excluding the build-plate contact band. Keep printer-specific thresholds, orientation, supports, shrinkage, tolerances, and material process as downstream checks until a target printer/slicer profile is provided.

## Shared delivery proof

Compile the locked input twice, require matching structural fingerprints, export the actual GLB, reopen it with an independent loader, and compare finite transforms, names, triangles, bounds, skeletons, and animations. Tie the browser proof to both normalized inputs and the compiler revision so any engine change invalidates stale evidence.
