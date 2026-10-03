# Flat tube cap contract

Next step after outward winding: remove flat-end shading pinching with explicit `capFinish: flat-outward` (compiler0.35). Absence preserves all prior buffers. No global smoothing or normals recomputation. Duplicate only cap rims with endpoint outward normals and component-local planar UV; cap charts intentionally overlap/tile. Geometry silhouette/bounds/triangle count and original side position/normal/UV/index data must stay exact.

Acceptance frozen before implementation: every cap vertex normal dot geometric cap normal >0.99999; finite UV in0..1, finite tangents in actual GLB; cap winding >0.99; welded closure/manifold/degenerate counts0. Cases straight, rotated multi-point and Bezier at0.5/1/2 sizes. Cap set/clear restores old IR; other components geometry/UV/material untouched. Actual same-camera1024 clay/grazing renders and Blender file reopens. Target fan remains estimated geometry; no CAD or BRDF claim.

Budget same120k triangles/16MiB textures/20MiB GLB/2s compile. Added vertices <=2*(radialSegments+1) per open tube; no new dependencies. <=3 UNI_AI completion proposals in this step. 45-minute checkpoint; retain failures and diagnose twice-repeated defect. Continue next step on evidence, with releaseAllowed/quality thresholds unchanged.
