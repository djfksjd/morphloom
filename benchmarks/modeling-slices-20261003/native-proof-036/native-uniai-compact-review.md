**Static review pitfalls—proposal only; no execution claimed:**

- **Local orientation:** compiler0.36 adds shared-edge winding-conflict detection; the unchanged unsigned closure pass does not establish consistent winding or outward orientation. Review these separately.
- **Format compatibility:** geometry buffers matching .35 do not establish GLB equivalence: changed metadata may affect consumers. Propose Blender import→edit→reopen checks plus installed Godot and PrusaSlicer validation. Record absent Unity as **not-run**, never pass.
- **Source fidelity/provenance:** preserve all five native0.35 fixture reports as .35; do not relabel them .36. Use a fresh, deterministic five-domain fixture manifest carrying revision and SHA, with two exports checked for reproducibility. Distinguish metadata changes, buffer identity, and preservation of source semantics.
- **Strict gate:** Cooling UV `UNUSED_OBJECT info23` remains blocked. Do not delete UVs, add dummy maps, or loosen thresholds to manufacture acceptance.
