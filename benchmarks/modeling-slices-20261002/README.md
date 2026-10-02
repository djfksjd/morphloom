# Published modeling checkpoint

This is a selected public authored fixture archive, not all local outputs. `archive-manifest.json` hashes the actual included files. Historical `verification.json` files retain original paths and refer to additional local artifacts that are not included here; they are not substituted for fresh checks.

- `texel-density/`: four current GLBs and editable IRs, exact native/GLB measurement comparison, validator reports and Blender pixel reports.
- `part-surface/`: before/after neutral renders, baseline gear IR/GLB and surface/pixel preservation reports.
- `publish-checks/`: checks executed in the isolated, scoped publish checkout. Unrelated circuit/simulation tests are excluded, so this suite has 83 files / 585 tests rather than the original workspace's 86 / 604.

Run `npm ci`, `npm run check`, `npm test`, `npm run build`, `npm run benchmark`. Python policy tests: `python3 -m unittest discover -s scripts -p test_blender_export_policy.py`. Open `/?editor=elements` or `/?editor=workspace`. Load `texel-density/gear.elements.json`, edit a part, save the IR and export GLB.

Production comparison evidence remains insufficient. Procedural metal patterns are authored appearance, not measured physical properties. Atlas/mip bleeding, normal/tangent editing, expert approval and manufacturing remain unverified. Source-spec evidence scripts that read ignored local outputs require the previous slice's generated fixtures; the included IRs/GLBs can be opened directly without those transient outputs.
