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

### 2026-09-13 — "Sandbar comb" pattern along the bank (FIXED - was NOT the checkerboard)
Follow-up to the residual note above: the user and a second live check both
confirmed this was more than cosmetic - at zoom~60 near spawn, both banks
showed a regular row of small triangular sandbar teeth with real cast shadows.
Initially suspected as a leftover of the checkerboard fix above (a spatial,
erosion-driven alternation rather than the temporal one already fixed), so
that was investigated first: `terrain.height` (raw bedrock) and `water.depth`
were both confirmed smooth, at coarse AND fine/render resolution, right
through the exact reported location and timeframe (checked repeatedly, at
t~42s and after 100-500s of fast-forwarded play) - so it was NOT bedrock
erosion noise, and not the flux-transfer relay either.
Ruled out, each via a direct live A/B test (change it, reload, compare):
cosmetic fine-grain noise detail layer, Catmull-Rom bicubic interpolation of
the fine terrain mesh (tested against plain bilinear too), and stale
background fine-mesh refresh (tested with a forced full refresh).
Root cause: found by comparing the fine mesh's baked vertex COLOUR (not its
smooth height) at the live location - a discrete brightness jump between
rows that height didn't have. Traced to the `moisture` field in water.js's
`_erode()`: a hard `depth > 0.003` threshold fed into an exponential filter
whose old gain (0.06) has a fixed point of 12, not 1 - so a continuously-wet
cell saturates at 12 and takes ~16s of being dry before even starting to
register as less wet (far longer than the ~6.6s decay time-constant alone
suggests). Right at the channel's marginal cells - confirmed live, several
adjacent rows all sitting at depth 0.002-0.003, i.e. within noise of each
other and of the cutoff - that sub-millimetre, visually meaningless
difference was enough to flip the binary target, and the saturating filter
then froze whichever side a cell first landed on for a long time: a
persistent, frozen wet/dry (mud vs. dry sand) mosaic along the bank,
unrelated to any real depth difference, reading as a shadowed "toothy" edge
on geometrically smooth ground.
Fixed by (1) replacing the hard threshold with `THREE.MathUtils.smoothstep`
over a small depth range, so a marginal, near-constant depth gives a
correspondingly small, stable target instead of a coin-flip, and (2) fixing
the filter's gain so its fixed point is exactly 1, removing the multi-
second-long hysteresis. Decay is unchanged, so the "stays damp-looking for a
while after the water recedes" feel is preserved.
Verified: the bank reads as a clean, natural grid-scale staircase (no dense
comb/teeth) at t~42s AND after 250s and 490s of fast-forwarded play, at the
same zoom~60/near-spawn reproduction used to find it; `water.update` cost
unchanged (~3.4ms/call).
