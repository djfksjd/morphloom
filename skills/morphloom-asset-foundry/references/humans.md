# Humans and characters

Separate direct image observations from inferred depth. Record screen-side and anatomical-side mappings before interpreting hands, feet, or pose.

Decide `styleMode` before anatomy review. Realistic humans use anatomical plausibility; stylized characters preserve evidenced exaggeration and are checked for internal proportional consistency. Declare visible extent and rig status: a cropped source becomes an explicit bust/partial asset unless full-body scope is supported, and game/animation/pose-editing intent makes a functional rig mandatory.

Extract body silhouette, joint landmarks, balance, head/neck posture, hand gesture, garment layers, and visible surface pattern. Use multi-view references and measured height for identity-grade work; one image is an editable previs base, not a complete likeness.

Build a human signature manifest before mesh refinement:

- head-to-body ratio, shoulder/waist/hip widths, torso depth, limb lengths, hand/foot scale, and visible asymmetry;
- weight-bearing foot, center of mass, pelvis/ribcage counter-rotation, spine and neck curve, joint bend directions, and foreshortening;
- anatomical left/right for every limb plus finger count, gesture, and contact/occlusion relationships;
- face silhouette and visible landmarks without inventing identity detail hidden by masks, hair, or angle;
- garment layers, compression/looseness, hems, seams, closures, accessories, and silhouette-changing costume pieces.

Run an anatomical sanity gate before surface polish. Block delivery for reversed limbs, impossible joint direction, collapsed shoulders/hips, disconnected hands/feet, implausible balance, finger fusion at the intended distance, or a silhouette that misses the source action. Correct the skeleton/landmarks and body volumes before compensating with clothing.

When resolved by the source, add dedicated face, hair, hand, and foot proof crops. Face review covers cranium/jaw silhouette, hairline, brows, eyelids, gaze, nose, lips/mouth, ears, and visible teeth. Hair review covers silhouette volume, parting/bangs, clump direction, brows/lashes/facial hair, scalp gaps, and intersections. Hand/foot review covers thumb side, visible digit count and separation, nails when resolved, ground/held-object contact, and footwear interfaces.

Model silhouette-changing costume elements and accessories as named geometry. Use skin, hair, fabric, leather, rubber, optical glass, and patterned textile finishes with appropriate roughness, sheen, anisotropy, and micro-normal response.

Every visible garment and accessory is a named layer even when it does not change the outer silhouette. Check overlap order, visible thickness at hems/openings, seams/closures, and body/garment/accessory intersections in the source pose.

Validate the rendered asset from the source camera, not only a flattering three-quarter view. Keep same-view likeness blocked when a comparison render or sufficient evidence is missing.

For game use, additionally verify deformation topology around shoulders, elbows, wrists, hips, knees, neck, jaw, and fingers; neutral/rest transforms; named rig hierarchy; non-zero editable facial controls; garment-body intersections across a small pose set; and an explicit LOD/texture scope. The bundled base requires jaw, smile, independent blink and brow controls, but those controls are not an identity-specific FACS or lip-sync solution. A posed watertight mesh without these checks is not a production-ready character.

`implicitSurface` may be used for an evidence-bounded organic blockout or a non-deforming accessory, but it is not automatically animation topology. Before rigged delivery, retopologize or otherwise prove deformation loops, skin weights, bind pose, joint motion, and the runtime contract. Never call a smooth implicit silhouette a finished character merely because it is manifold.
