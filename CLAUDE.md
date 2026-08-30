# Claude instructions for Morphloom

Follow the same vendor-neutral contract as `AGENTS.md`. Produce only `morphloom.character/0.1` or `morphloom.assembly/0.1`; do not introduce a Claude-specific format.

For an image-to-asset request:

1. List visible evidence and unknown geometry.
2. Build a part tree before writing geometry.
3. Express the asset with the operations in `schemas/assembly-ir.schema.json`.
4. Label assumptions as `inferred`.
5. Run the topology, benchmark, and production build commands.
6. Compare from the admitted camera views and report any criterion where the baseline is still stronger.

No Meshy, Tripo, dedicated 3D generator, or external 3D MCP is required or permitted by the default pipeline.
