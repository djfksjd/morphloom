# Claude instructions for Morphloom

Follow the same vendor-neutral contract as `AGENTS.md`. Produce only `morphloom.character/0.2` or `morphloom.assembly/0.1`; do not introduce a Claude-specific format.

For an image-to-asset request:

Read `skills/morphloom-asset-foundry/SKILL.md` and its asset-specific reference first. A short user request already includes the default detail, material, evidence, and validation contract; do not require the user to rewrite it as a long prompt.

1. List visible evidence and unknown geometry.
2. Build a part tree before writing geometry.
3. Express the asset with the operations in `schemas/assembly-ir.schema.json`.
4. Label assumptions as `inferred`.
5. For electronics, give every conductor explicit `from` and `to` ports and leave no required port open.
6. Run the topology, connectivity, benchmark, and production build commands.
7. Compare from the admitted camera views and report any criterion where the baseline is still stronger.
8. Use explicit AssemblyIR `material.surface` finishes for hero parts. Author roughness, micro-normal, clearcoat, IOR/transmission, and anisotropy according to the visible material evidence.

No Meshy, Tripo, dedicated 3D generator, or external 3D MCP is required or permitted by the default pipeline.
