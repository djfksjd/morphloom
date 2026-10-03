No concrete blocker apparent from the description; implementation still needs verification. Two targeted risks to test:

- **Geometry:** zero-length segments, near-180° turns, and closed/coincident endpoints can destabilize Frenet bases. Verify finite UVs/normals, nondegenerate cap triangles, outward winding at both ends, and exact rim-position equality.
- **Lifecycle:** an obsolete request’s unconditional `finally` could clear `busy` while a newer request remains active. Ensure busy release is token-owned, not merely commit/catch guarded.

Also exercise flag set/clear through undo/redo while switching selection. The busy-release race is the clearest potential concrete blocker.