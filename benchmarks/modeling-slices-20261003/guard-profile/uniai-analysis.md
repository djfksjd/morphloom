**Proposal scope:** add one opt-in quadratic path to the existing `tube` operation. This addresses the reported flat, straight-spoke guard defect; it does not establish a general photo-to-CAD capability. I have not seen the photos or run tests.

### Schema, compiler, and validation

Add an optional, explicitly versioned field to the tube IR, for example:

```ts
curve?: {
  schema: 'morphloom.tube-quadratic-bezier/0.1';
  controlPointMm: [number, number, number];
}
```

Require exactly two endpoint `points` when `curve` is present, and require `closed` to be absent or `false`. The endpoints remain the existing tube points; the control point is in the same component-local millimetre coordinates. Do not add a default or rewrite legacy IR.

In the compiler’s tube case, construct a `THREE.QuadraticBezierCurve3` from endpoint–control–endpoint **only** for this declared option. Otherwise retain the current `CatmullRomCurve3` branch, segment defaults, `TubeGeometry` invocation, and cap code unchanged. That gives absent-option legacy assemblies byte parity rather than merely visual similarity. Ring radii and their `torus` operation remain independent.

Validate at both IR ingestion and edit time: exact schema, finite three-element coordinates within the project’s geometry bounds, exactly two distinct endpoints, positive finite radius, bounded segment counts, and a nondegenerate curve with usable endpoint tangents. Reject a control point coincident with either endpoint, near-zero path length, or other cases that make `TubeGeometry` frames or cap normals unstable. Establish numerical tolerances in **mm**, accounting for the compiler’s mm-to-scene-unit conversion. Limit control-point excursion relative to endpoint span as well as absolute coordinate size; a value inside ±100,000 mm can still create an enormous, misleading, or costly loop. Validate the resulting geometry as well as its inputs.

### Patch and editor

Add a geometry patch operation such as `tube-quadratic-control` with a discriminated action: `set` carrying the versioned absolute `controlPointMm`, or `clear`. It must target a two-point, open tube; `clear` removes only the curve declaration. Keep the existing fingerprint precondition, isolated-component receipt, no-op rejection, and batch atomicity. Apply the same post-edit tube validation to endpoint-delta patches: moving an endpoint can invalidate a previously valid curve. A `set` that changes no value should be rejected as a no-op, not produce a misleading receipt.

In `AssemblyComponentEditor`, show an **Opt in to quadratic curve** control and three labelled control-point mm inputs only for a selected eligible tube. An initial suggestion could be the endpoint midpoint, but do not silently commit it; if that position produces a straight path, label it as such. `Apply` uses the component patch route and `validateAssemblyIR`; `Cancel` resets the draft without modifying IR. The editor’s existing history supplies undo/redo. Preserve its stale-IR and changed-selection checks, and disable controls during an in-flight apply. Explain that the control point is local, not world-space, and that editing it does not move rings, caps, or connected parts.

### Fan fixture and verification plan

For this fixture only, manually estimate the front guard’s paraboloid rise from the agent’s four photos and record the dimensions and placement as **inferred/estimated**, not measured. Explicitly target the guard-group rings, spokes, and cap for any needed shifts; use stable IDs and an isolated batch edit where appropriate. Check the receipt’s unaffected-component fingerprint and assert that the 69 or more unrelated components are unchanged. Do not convert the concentric torus rings to tubes merely to add curvature.

Proposed tests should cover the Bézier’s exact endpoints and midpoint \(B(0.5)=0.25P_0+0.5P_1+0.25P_2\), including mm conversion; legacy absent-option output byte parity; malformed schemas, limits, and degeneracies; patch set/clear, cancel, undo/redo, stale fingerprints, and endpoint edits that invalidate a curve. Check the capped mesh for closed **geometric** topology and outward-facing caps. The current `TubeGeometry` seam and cap-center construction duplicates some vertices, so an indexed-edge manifold test may require welding or a separate cap/topology correction—do not claim it passes from the source alone. Finally, export and inspect the GLB for retained shape, scale, and orientation, and repeat with an alternate guard size and orientation rather than tuning only one fixture.