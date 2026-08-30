# Contributing

Keep changes vendor-neutral: Codex and Claude must compile the same IR. New geometry operations need bounded inputs, a topology test, and a documented unit convention. New electronic examples must use port-to-port conductors and include a failure test for dangling or incompatible wiring.

Before opening a change:

```bash
npm test
npm run benchmark
npm run build
```

For material changes, add or reuse a bounded finish in `src/engine/surface-system.ts`, preserve its values in AssemblyIR, and add an evidence-based test for the reflection controls. Do not use triangle count or a single beauty render as proof of surface fidelity.

Do not submit proprietary reference images, model weights, copyrighted game assets, or generated meshes whose redistribution rights are unclear. Add provenance for every bundled asset.
