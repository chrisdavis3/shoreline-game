# Testing feedback

Shared log between actual playtesting (a human, or a browser-equipped agent that
loads the live game and looks at it) and any automated/code-level improvement
pass (which cannot see the game, only read code). Playtesting entries here are
ground truth for what actually needs fixing; a code-level pass should read this
before going looking for its own issue, and mark an item as addressed (not
delete it) once it's shipped a fix, since only a real playtest can confirm it
actually looks right.

## Open items

### 2026-09-12 — Blue sea gap between sand and cliff at headland (low priority)
Screenshot from the user: at the headland where sand meets the rocky
cliff/dune, there's a visible sliver of blue (sea/water colour) showing
through right at that boundary - a seam/gap, not a real water feature. Likely
a mismatch between the water mesh's extent (especially after the recent
RENDER_SS super-sampling and warpX footprint-taper changes) and the terrain
mesh's own boundary at that same location, exposing a gap between them.
Not urgent - explicitly flagged as low priority, fix in a later pass.

## Addressed, needs re-verification

### 2026-09-12 — River checkerboard/crenellation (FIXED, commit 98e2376)
Was: severe - the river's depth field oscillated row-to-row/column-to-column
(the sim's flux scheme could only ever send water toward a strictly-lower
neighbour, so the thalweg relayed between two near-symmetric cells instead of
settling), which fed directly into vertex Y position - rendered as literal
castle-tooth pillars with cast shadows at a low camera angle. Fixed with a
topology-aware, per-edge mass-conserving blur (only smooths cells with wet
neighbours, so a genuine wetting front isn't erased). Verified live: pillars
with shadows are gone.

Residual, much milder issue found during re-verification: at close zoom the
sandbars poking into the channel from alternating banks still form a fairly
regular, evenly-spaced "comb" pattern rather than organic variation - flat,
no geometry spikes, nowhere near the old severity, but still slightly
artificial-looking. Worth a follow-up pass if there's time; not urgent.
