# Default quality contract

Apply these requirements even when the user gives only a subject and one source.

## Evidence

- Record the source and status (`measured`, `datasheet`, `estimated`, or `inferred`) on every edit unit.
- Compare the compiled asset against the same view as the source. Counts and watertight topology do not prove visual fidelity.
- A single image cannot directly establish hidden depth, rear detail, exact scale, or internal construction. Keep those values explicit as inference.

## Geometry and topology

- Use real units and independently named parts or architectural elements.
- Model silhouette-changing features, openings, seams, fasteners, trim, bezels, joints, and gaps as geometry when visible at the intended use distance.
- Require finite dimensions, bounded segment counts, zero degenerate triangles, zero non-manifold edges, and closed meshes where the component should be solid.

## Surface response

- Choose a finish from the Morphloom surface system instead of relying on base colour alone.
- Set roughness and metalness by material class. Use clearcoat for coated surfaces, transmission and IOR for glass, anisotropy for brushed metal/hair, and sheen for textile/leather/skin.
- Add deterministic micro-normal and roughness variation at a scale appropriate to the real material. Do not use one texture scale for every object size.
- Check Beauty under grazing light, Clay for form, Wire for topology, and X-Ray for internal structure.

## Stop conditions

Delivery may be called an editable base when topology and IR pass. Do not call it survey-, manufacturing-, identity-, or construction-ready without the matching physical evidence and validation.
