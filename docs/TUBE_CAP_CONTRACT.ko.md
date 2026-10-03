# Tube cap winding contract

Bounded step after 6dec419: fix inward-facing caps on explicitly migrated open legacy tubes. No measured source geometry changes. Product visualization mesh inspection in Blender 5.2.1.

Before implementation: absence of the new option must preserve every legacy position, normal, UV and index byte. Explicit outward winding must affect only cap indices; coordinates, bounds, UV and materials stay unchanged. New/unknown versions and closed-path opt-in must fail explicitly. Existing component patch 0.1 stays unchanged; new set/clear operation requires 0.2. Native edit undo and re-open retain the choice.

Acceptance: every cap triangle cross-product dot outward endpoint tangent >0.99; two-point and multi-point, rotated paths, 0.5/1/2 scales; no degenerate/non-manifold/boundary edges; no unrelated component changes; actual GLB export and Blender reopen. Known side-normal sharing on caps is reported separately; winding alone is not full shading approval. Existing release gates remain unchanged.

Budget: first diagnosis/implementation/review <=3 UNI_AI completions, no simultaneous model calls; 45-minute checkpoint; geometry/texture/compile budgets remain previous guard contract (120k triangles,16MiB,2s,20MiB). No broad cleanup or source-photo transfer. Continue to the next measured defect after this step.
