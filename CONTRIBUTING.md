# Contributing

Keep changes vendor-neutral: Codex and Claude must compile the same IR. New geometry operations need bounded inputs, a topology test, and a documented unit convention. New electronic examples must use port-to-port conductors and include a failure test for dangling or incompatible wiring.

Before opening a change:

```bash
npm test
npm run benchmark
npm run build
```

Do not submit proprietary reference images, model weights, copyrighted game assets, or generated meshes whose redistribution rights are unclear. Add provenance for every bundled asset.
