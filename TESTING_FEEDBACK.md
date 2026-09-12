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
