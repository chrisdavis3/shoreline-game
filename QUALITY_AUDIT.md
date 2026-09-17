# Shoreline quality audit

Updated 17 September 2026. This is a working backlog, not a claim that the requested visual standard has been reached.

## Non-negotiable brief

- Recognisable Mawgan Porth geography, beach outline, village and grassy headlands; natural scenery rather than a rectangular or triangular island.
- Visible water flow and clean banks, no checkerboard, teeth, perforation lines or evolving swirl artefacts.
- Digging transfers visible scoops of earth; machines move material rather than creating it.
- Highfall's upper lake must feed the waterfall and connect to accessible ground on either side.
- Hidden progression only: village door to the gorge, door behind the waterfall to the mill. No public location picker.
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

1. Beach scenery: cottages now have architectural detail, but their arrangement needs lanes, gardens and a better relationship to the actual village; background cliff polygons remain conspicuous. The landscape still lacks the real place's architectural and geological detail. Improve based on actual references and compare broad views, not just the player's immediate surroundings.
2. Banks: coarse stepping and residual geometric water/terrain intersections are visible despite the alignment and shading improvements. Isolate rendered height interpolation versus actual bed shape before changing the solver.
3. River decoration: some static grass/pebbles end up in the active stream. Re-anchor or suppress them as the bank erodes; do not hide movable gameplay rocks.
4. Gorge: visually inspect the revised upper plateau, lake outlet and entire on-foot/vehicle access route, including the hidden door. The core mill test does not cover this level.
5. Mill composition: improve the view of the wheel, river fork and fountain together, particularly in portrait. Existing trees and stonework are still visibly stylised. Garden-complete text should distinguish historical completion from a currently stopped pump.
6. Full physical playthrough: drive both machines and solve using player controls, check spoil placement around blocked/boundary cells, and test saving mid-action. The automated diversion uses the terrain API, not a vehicle-control replay.
7. Real mobile hardware performance/input, audio behaviour and extended natural tide cycles remain unverified. Do not present desktop emulation as an iPhone pass.

## Release practice

Fetch origin/main and inspect changes first. The local branch is master; Pages publishes main. Use ordinary merges and preserve remote work. Never use an ours-only merge to bypass reconciliation again. Bump version.txt, APP_VERSION and module query versions together. Confirm Pages build and the actual public version after pushing; unverified work stays local.

## Release 108: waterfall cave correction

Removed the wooden door entirely. The gorge now has a sheltered rock passage with a walkable floor behind a wider, dense waterfall curtain. Camera moves into the shelter after the player crosses the water. Walking into the back of the cave enters level 3 directly; there is no proximity popup outside the waterfall. Save format and simulation terrain remain unchanged. Automated player movement checks crossing and passage arrival, and rejects exterior/side trigger positions. Local visual and transition checks use explicit QA approach positioning, not a full gorge traversal.

Local browser verification: exterior waterfall conceals the opening; inside view has no door; continuous player-update steps entered Stillwater Mill. Gorge save is written outside the cave for the return trip. Cave floor clears the current saved terrain; the water surface is masked inside the shelter, without altering flow simulation. The cave remains stylised rock geometry and needs further material detailing.
