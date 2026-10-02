# Surface cache contract

Persistent procedural cache: count three RGBA8 CPU payloads plus conservative GPU full mip-chain (4/3 base level). Keep 32MiB and96-entry limits. Current code omits CPU payload. Cold isolated asphalt32-material fixtures must measure actual image.data.byteLength plus integer mip levels <=32MiB. Warm/overflow pixels, geometry, UV, PBR and actualGLB must remain identical. Shared textures survive scene disposal; nonshared owners dispose textures. Planned10min reproduction/implementation +10min verification.

Excluded: generation temporary arrays, live nonshared scenes, geometry, reference images, framebuffer, driver alignment/compression/copies, separate1px iridescence map. This is a cache allocation estimate, not measured RAM/VRAM or total-app limit. No schema/pixel/PBR/gate changes or newdependencies. UNI_AI403 localfallback, no external references uploaded.
