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

### 2026-09-12 — River checkerboard/crenellation (FIXED for real this time, see below)
Was: severe - the river's depth field oscillated row-to-row/column-to-column,
which fed directly into vertex Y position - rendered as literal castle-tooth
pillars with cast shadows at a low camera angle.

First fix attempt (commit 98e2376): a topology-aware, per-edge mass-conserving
blur applied after the main transfer step. Looked fixed in short-lived
verification right after landing (pillars gone) - but a live tab left open on
production for several real minutes (~470s) showed the pattern fully regrow to
original severity. The blur was fighting a symptom that kept regenerating
faster than it could damp, not removing its source.

Root cause (found by instrumenting `window.__game.water`/`terrain` step-by-
step): the flux-transfer step's per-link "move up to half the height
difference" cap was computed independently for each of a cell's up to 4
downhill neighbours, all from the same start-of-step state. For a cell with
only one active downhill link this is exact (lands precisely on the shared
equilibrium), but with two or more simultaneously active links each one
assumes it alone is moving the sender's water - the combination overshoots
the true multi-way equilibrium, and next step the roles reverse. Erosion
changing bedrock height every step continuously re-triggers this, which is
why it kept regrowing no matter how strong the after-the-fact blur was.
Fixed by dividing that per-link cap by the number of simultaneously-active
downhill directions, so the joint transfer can no longer overshoot regardless
of how long erosion keeps disturbing the bed. The earlier blur pass is kept
as a cheap, provably mass-conserving secondary safety net, but is no longer
load-bearing.

Verified: a cell's own height no longer alternates step-to-step (confirmed by
direct instrumentation - previously a clean, undamped period-2 cycle,
forever); a channel-wide relative-oscillation metric stayed flat/bounded
(~5-7%) across 900+ simulated seconds of fast-forwarded play (vs. the
blur-only fix, which grew monotonically over the same kind of window); river
continues reaching the sea with no dry-out; no measurable frame-time impact.

Residual, much milder issue noted during the first re-verification pass: at
close zoom the sandbars poking into the channel from alternating banks form a
fairly regular, evenly-spaced "comb" pattern rather than organic variation -
flat, no geometry spikes, unrelated to the checkerboard mechanism above (still
present, unchanged, with the new fix). Worth a follow-up pass if there's time;
not urgent.
