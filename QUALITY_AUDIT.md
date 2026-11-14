# Shoreline quality audit

Updated 14 November 2026. This is a working backlog, not a claim that the requested visual standard has been reached.

## Reference-fidelity audit — 14 November 2026

The user reiterated that the game must look like the destination, and that supplied reference images were insufficiently followed. Geographic fidelity comes before material polish. A technically improved generic beach does not satisfy this brief.

Recovered and visually inspected from the original Claude history:

- The user's 12 September PowerPoint comparison: satellite/map view beside game screenshots, with a red correction to the inland outline. This is direct evidence of the requested spatial relationships and the rejected rectangular/triangular interpretation.
- The accompanying coastal photo board: dark exposed rock, grassy headland tops, irregular cliff silhouettes, pale buildings distributed through the landscape, and natural surf. Individual photographs must be located before treating their geometry as an exact survey of Mawgan Porth; use the map for layout and the photos for supported views/materials.
- The user's level-two sketch: upper lake feeding a waterfall, a receiving pool, and a river through several lower terraces. Later comments require connected accessible ground beside the upper lake, without the unintended intervening canyon.

The recovered files and a provenance index are retained locally in `../outputs/shoreline-reference-audit/`. They are audit evidence, not runtime assets; do not publish the conversation archive or assume image redistribution rights.

Pre-release-112 source findings (retained as the reason for rebuilding):

- `src/terrain.js`, `coastTContinuousLevel1`: the coast uses a sine-derived crescent plus noise, not a calibrated trace of the reference outline.
- `src/terrain.js`, `streamCenterXLevel1`: a sinusoidal/noise path is based at 78% of the grid width. Comments explicitly explain a displacement away from the researched mouth position to accommodate the taper algorithm. That is an implementation compromise, not evidence of geographic fidelity; the comments' geographic claims require independent verification before reconstruction.
- `src/village.js`, `buildCoastalVillage`: 24 cottages are placed by a seeded random sampler within a rectangular area, with slope/spacing exclusions. Architectural details exist, but placement does not encode the reference village's roads, clusters or relationship to the bay.
- Reference-driven palette and headland adjustments exist. They do not demonstrate that the overall destination has been reproduced.

Acceptance requirements for a visual rebuild:

1. Establish one consistent map orientation, scale and reference extent. Label the beach perimeter, both headlands, stream approach/mouth, low inland opening, village clusters and roads. Compare outlines in a common top-down view; do not infer compass directions from a rotated screenshot.
2. Fit the terrain and village composition to those landmarks. Any scale compression needed for play must preserve their spatial relationships and be documented. The simulation grid may remain rectangular internally without dictating the visible footprint.
3. Compare a plain, untextured model against the map and matching photographic viewpoints before adding fine materials. Tide level and camera perspective must be accounted for when comparing waterlines.
4. Add locally appropriate cliff forms, turf, wet/dry sand and architecture after the large shapes agree. Generic repository presets are techniques to adapt, not the destination design.
5. Retain fixed reference/game comparison views (overview, beach toward village, and headland across bay). Passing physics tests, adding detail or fixing an isolated defect cannot count as passing visual fidelity. Repeat the comparisons after erosion/digging and check performance on the intended devices.

That initial audit changed no runtime code. The rebuild and checks below followed the user's instruction to fix it.

## Release 113: bridge, measured hills and touch play

- Replaced authored hill heights with Environment Agency LiDAR ground data, resampled from a public 3m extract. Roads, river and terrain share one coordinate transform; see `REFERENCE_SOURCES.md` for datum, compression, licences and limits. The village now sits on the measured Trenance/Trevarrian slopes.
- Added the mapped B3276 bridge, continuous walking ramps, stone parapets and an open waterway beneath it. Moved the river to its mapped crossing. Excluded approximate house footprints and random boulders from roads.
- Stitched the distant landscape to every detailed terrain-edge vertex and update that join after terrain changes. This removes the open cracks where coarse headland triangles previously met the finer playable ground.
- Kept automatic river top-up within its bed, reduced source inflow to suit the narrower valley, and made inland turf firmer. The original flow settings flooded the village approach in the new terrain; regression coverage checks the banks as well as channel continuity.
- Disabled page double-tap/gesture zoom on the game surface. Pointer capture keeps Dig/Sprint held when a thumb drifts; release, cancellation and interruption clear held actions. The game zoom controls remain available.
- Removed camera-heading feedback that curved a held joystick direction. Lowered the phone camera, moved the shovel target closer, added a ground aim ring, made the first scoop immediate, and enabled slow walking while digging. The dig animation timer now advances instead of restarting every frame.
- Revised the child's proportions, fringe, hood and striped shorts from the relayed description. The latest photograph is inaccessible here, so likeness remains unverified. No child photo is included in source or runtime assets.
- Beach terrain version 9 has a new save slot. Version 8 earthworks remain in their original slot; old terrain cannot be overlaid on the measured landscape. Gorge/mill terrain versions stay 9/10.

Validation uses the six-file physics/regression suite plus native Chromium touch input in `tests/touch.browser.cjs`: sustained joystick movement, independent camera drag, simultaneous walking/digging, thumb drift, touch cancellation, repeated taps, in-game zoom and a full-loop bridge crossing. Ten UI-driven scoops produce a hole and spoil. This is browser touch testing, not a physical iPhone/Safari performance pass. The child photo likeness, exact building architecture and a complete manual playthrough remain unverified.

## Release 112: reference-led beach rebuild

- Recovered the original annotated aerial and coastal photo board before rebuilding. North/south orientation was checked against Making Space for Sand; the Menalhyl follows the southern margin. See `REFERENCE_SOURCES.md` for the map transform, sources, licence and limits.
- Replaced the warped rectangular beach and enclosing skirt with an asymmetric bay, low inland approach, grassy slate headlands and continuous hinterland. Both physical ground and its continuation use one height profile. Removed the invented sea arch.
- Added mapped road/path routes and building sites from OpenStreetMap. The unmodified-terrain test places 129 separated cottages in 11 material batches; actual placements depend on restored terrain. Projected road shading follows erosion without floating/intersecting ribbon meshes. Building elevations, details and garden vegetation are authored.
- Added GPU material grain, rock bedding, wet-sand response and coordinated shallow/outer sea shading. The hydraulic model remains 140 x 140. Terrain render triangles reduced from 618,272 to 347,778 (43.75%); this is a mesh reduction, not a measured mobile frame-rate claim.
- Added a whole-bay Overview/Explore toggle on desktop and narrow screens. Refined cliff/building proportions and coastal lighting against the references.
- New beach terrain version 8 writes its own save slot. Legacy beach earthworks remain in the original slot and are also backed up when storage permits. They cannot be applied directly to the rebuilt landscape. Gorge/mill terrain versions remain 9/10.

Validation:

- Full six-file regression suite passes: mill diversion/pump power and stagnant water, earth conservation, village placement, cave movement/trigger bounds, complete incremental terrain refresh, scenery anchoring, new bay spatial checks, two minutes of river flow, old-save preservation and edited-height save/reload equality.
- Headless Chrome at 1440 x 1000 and touch layout 390 x 844: play and whole-bay screenshots inspected; Overview and Controls work; no logged script/shader errors. This is desktop browser/phone-layout testing, not an actual iPhone performance pass.
- Actual keyboard input moves the player. Touch DIG events execute three scoops and alter terrain. Browser save/reload succeeds. The village prompt enters the gorge; cave passage enters the mill. Entry positions were set through QA controls, so these are transition checks, not a full manual traversal.
- Source syntax and whitespace checks pass. Evidence stays outside the public source under `../outputs/shoreline-reference-audit/`.

Useful upstream references checked for future rendering work: [Three.js Water2](https://github.com/mrdoob/three.js/blob/master/examples/jsm/objects/Water2.js) for flow-map water shading, and [THREE-CustomShaderMaterial](https://github.com/FarazzShaikh/THREE-CustomShaderMaterial) for extending standard lit materials. Neither is an added dependency in this release; neither supplies Mawgan Porth geography.

## Non-negotiable brief

- Recognisable Mawgan Porth geography, beach outline, village and grassy headlands; natural scenery rather than a rectangular or triangular island.
- Visible water flow and clean banks, no checkerboard, teeth, perforation lines or evolving swirl artefacts.
- Digging transfers visible scoops of earth; machines move material rather than creating it.
- Highfall's upper lake must feed the waterfall and connect to accessible ground on either side.
- Hidden progression only: village door to the gorge, then a cave concealed behind the waterfall to the mill. No door at the waterfall; walk through the water into the cave. No public location picker.
- The mill responds to actual river flow; the player redirects it to run the pump and fountain. Standing water must not power the wheel.
- Save progress independently per level; preserve a backup before incompatible terrain saves are replaced.
- Test the game ourselves, including phone layouts. Deploy verified improvements only.

## Verified in release 105

- Published commit c2f76db; GitHub Pages reports built and public version.txt reports 105.
- Core simulation test: eight-minute untouched mill remains below pump threshold; excavating the diversion increases discharge to 0.0364 and wheel speed to 5.10 rpm. Finite water/terrain and nonnegative water checked. Standing water produces zero power.
- Scoop/deposit quantity conservation and water-grid Z alignment tested.
- Waterfall-door proximity prompt and its navigation into level 3 were exercised through local QA controls. These controls position the player, so this was a transition test, not proof of the entire walking route.
- Local level 3 and the public beach rendered without logged script/shader errors.

## Release 106 verification

- Fixed unbounded texture distortion: two short crossfaded flow phases replace velocity multiplied by the full elapsed time.
- Surface lighting now interpolates water-surface gradients rather than exposing individual mesh-triangle normals. Reuses unused channels of the existing flow texture.
- Fades negligible water depths into the bank rather than rendering a hard transparent ledge.
- Desktop before/after screenshots in the Codex playtest show a calmer continuous stream surface in the same local beach save. Advanced the river by 30 simulated seconds and inspected it again. Some bank stepping remains visible.
- At 390 x 844, checked level 3 with the touch layout enabled through local QA. Objective expands/collapses, controls dialog opens, touch buttons and navigation remain visible. This is viewport/layout testing, not real iPhone hardware validation.
- No logged shader/script errors in the tested local builds. JavaScript syntax and git diff whitespace checks pass. This release does not change water simulation, terrain generation, saved state, or mill power rules.

## Release 107 verification

- Replaced the placeholder village boxes/prism roofs with plaster cottages, proper gable roofs and eaves, slate courses, chimneys, framed windows, coloured doors and stone thresholds.
- Placement uses a seeded sequence. Footprint spacing checks use building radii; rotated corners are sampled for foundations. On unchanged terrain/obstructions, the gorge entrance no longer relocates merely because scenery is rebuilt.
- Architecture is baked into 11 material batches. `node tests/village.test.js` passes for 24 separated houses, stable entrance coordinates, grounded foundations and finite baked geometry.
- Desktop screenshot from the beach approach shows roof, window and doorway detail at normal play scale. The village remains a stylised interpretation, not a surveyed reconstruction.
- At 390 x 844, the hidden entrance prompt fits and its Highfall Gorge button was exercised. Local QA positions the player at the entrance; this is not a complete manual walking test.
- Visual references consulted for white/pale facades, slate roofs and window/terrace proportions: [Blue Seas aerial](https://www.cottages.com/cottages/blue-seas-cwc103205), [Gwillen](https://www.sykescottages.co.uk/cottage/Cornwall-Mawgan-Porth/Gwillen-960109.html). Reference images are not bundled assets.
- Terrain, simulation, save format, mill mechanics and the waterfall entrance are unchanged.

## Open priorities

1. Beach fidelity: release 113 uses measured LiDAR elevations and mapped bridge, roads and building sites. Architecture and fine surface detail remain stylised; refine them against located photographic viewpoints. The riverbed, tide and horizontal/vertical scales are adapted for play. Do not describe this as a photorealistic reconstruction.
2. Banks: the regular comb pattern is fixed in release 110. Continue checking bank shapes and water intersections under player digging and long erosion runs; the source channel is still too uniform.
3. River decoration: release 111 re-anchors beach pebbles/driftwood and suppresses flooded or disturbed grass. Gorge decorations still need the same review; real mobile performance remains unmeasured.
4. Gorge: visually inspect the revised upper plateau, lake outlet and entire on-foot/vehicle access route, including the concealed cave. The core mill test does not cover this level.
5. Mill composition: improve the view of the wheel, river fork and fountain together, particularly in portrait. Existing trees and stonework are still visibly stylised. Garden-complete text should distinguish historical completion from a currently stopped pump.
6. Full physical playthrough: drive both machines and solve using player controls, check spoil placement around blocked/boundary cells, and test saving mid-action. The automated diversion uses the terrain API, not a vehicle-control replay.
7. Real mobile hardware performance/input, audio behaviour and extended natural tide cycles remain unverified. Do not present desktop emulation as an iPhone pass.

## Release practice

Fetch origin/main and inspect changes first. The local branch is master; Pages publishes main. Use ordinary merges and preserve remote work. Never use an ours-only merge to bypass reconciliation again. Bump version.txt, APP_VERSION and module query versions together. Confirm Pages build and the actual public version after pushing; unverified work stays local.

## Release 108: waterfall cave correction

Removed the wooden door entirely. The gorge now has a sheltered rock passage with a walkable floor behind a wider, dense waterfall curtain. Camera moves into the shelter after the player crosses the water. Walking into the back of the cave enters level 3 directly; there is no proximity popup outside the waterfall. Save format and simulation terrain remain unchanged. Automated player movement checks crossing and passage arrival, and rejects exterior/side trigger positions. Local visual and transition checks use explicit QA approach positioning, not a full gorge traversal.

Local browser verification: exterior waterfall conceals the opening; inside view has no door; continuous player-update steps entered Stillwater Mill. Gorge save is written outside the cave for the return trip. Cave floor clears the current saved terrain; the water surface is masked inside the shelter, without altering flow simulation. The cave remains stylised rock geometry and needs further material detailing.

Release 109 follow-up: unload autosave keeps the return position outside the cave. Browser confirmed returning from Stillwater Mill stays in Highfall Gorge.

## Release 110: stale terrain strips

- Found the principal cause of the regular bank/water comb: the incremental fine-mesh refresh covered coarse rows 0..1 then 2..3, skipping fine vertices between rows 1 and 2. Erosion changed the physical bed but these strips stayed at old heights. Scan strips now share endpoints. No simulation, terrain-generation or save-format changes.
- Regression test raises the coarse bed, runs incremental refresh, and compares every rendered height against a full refresh. Original code fails with 115,299 stale vertices and 0.25m height error. Corrected code passes with zero stale vertices.
- Before/after screenshots from the same saved beach near z=30 show the regular transverse ridges removed during running simulation. Phone viewport 390x844 with touch layout also shows continuous banks; no script/shader errors logged. This is layout testing, not hardware performance validation.
- Eight-minute untouched mill and excavated diversion test passed: discharge 0.03642, wheel 5.10 rpm after diversion; finite water, conserved earth and stagnant-water checks pass.
- Investigated interpolation of water elevation; reverted that experiment after it did not remove the ridges. Only the terrain scan correction is included.

## Release 111: beach scenery follows water and terrain

- Added a bounded update for existing beach decoration batches (256 instances per frame). Pebbles, driftwood and grass follow the current terrain height; grass is suppressed in water deeper than 6cm and over freshly disturbed ground. A 2.5cm reappearance threshold prevents flicker at shallow wet edges.
- Only explicitly registered decorative instances change. No gameplay rocks, hydraulic obstructions, terrain, flow, saved state or cave progression are modified. No extra draw calls are introduced, though existing decorative batches now disable stale static-bound culling and update instance buffers as needed. Real-device performance remains unverified.
- Regression tests cover eroded bed following, submerged grass suppression, wet-edge hysteresis, restoration of original geometry on dry ground, disturbed grass and untouched unregistered objects.
- Desktop and 390x844 touch-layout screenshots show the active stream clear of grass while its banks retain vegetation. Local rendering logged no script/shader errors. Pebbles remain visible under shallow water, grounded on the bed.
