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

## Open priorities

1. Beach scenery: houses remain plain boxes with oversized blank walls; background cliff polygons are conspicuous. The landscape still lacks the real place's architectural and geological detail. Improve based on actual references and compare broad views, not just the player's immediate surroundings.
2. Banks: coarse stepping and residual geometric water/terrain intersections are visible despite the alignment and shading improvements. Isolate rendered height interpolation versus actual bed shape before changing the solver.
3. River decoration: some static grass/pebbles end up in the active stream. Re-anchor or suppress them as the bank erodes; do not hide movable gameplay rocks.
4. Gorge: visually inspect the revised upper plateau, lake outlet and entire on-foot/vehicle access route, including the hidden door. The core mill test does not cover this level.
5. Mill composition: improve the view of the wheel, river fork and fountain together, particularly in portrait. Existing trees and stonework are still visibly stylised. Garden-complete text should distinguish historical completion from a currently stopped pump.
6. Full physical playthrough: drive both machines and solve using player controls, check spoil placement around blocked/boundary cells, and test saving mid-action. The automated diversion uses the terrain API, not a vehicle-control replay.
7. Real mobile hardware performance/input, audio behaviour and extended natural tide cycles remain unverified. Do not present desktop emulation as an iPhone pass.

## Release practice

Fetch origin/main and inspect changes first. The local branch is master; Pages publishes main. Use ordinary merges and preserve remote work. Never use an ours-only merge to bypass reconciliation again. Bump version.txt, APP_VERSION and module query versions together. Confirm Pages build and the actual public version after pushing; unverified work stays local.
