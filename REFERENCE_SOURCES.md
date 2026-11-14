# Mawgan Porth reconstruction — release 112

## Reference hierarchy

The user's 12 September 2026 annotated aerial/game comparison controls the broad bay composition. Their coastal photographs guide rock, turf, architecture and surf. These are held in the local audit evidence folder, not redistributed in this repository. Individual photographs are not claimed to be geolocated survey images.

Map orientation and physical setting were cross-checked against [Making Space for Sand](https://www.makingspaceforsand.co.uk/locations/mawgan-porth/): west-facing beach, Menalhyl along the southern margin, Berryl's Point south and Trenance Point north. The former code comment assigning the river to the northern side was incorrect.

## Map data and attribution

`src/mawgan-map.js` contains projected building centres, approximate oriented dimensions, and road/path polylines from OpenStreetMap. Extract downloaded 14 November 2026 from `https://api.openstreetmap.org/api/0.6/map?bbox=-5.038,50.462,-5.023,50.471`.

© OpenStreetMap contributors. Map database and derived data are provided under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/); see [OpenStreetMap copyright and licence information](https://www.openstreetmap.org/copyright). This data licence applies to `src/mawgan-map.js`, independently of application code. Visible attribution links to that information in the game.

Projection: local east/north offsets about longitude -5.0315, latitude 50.467, using 70,850 metres/degree longitude and 111,320 metres/degree latitude. Rotated axes: x increases southwards across the bay; z increases seawards. Horizontal coordinates are compressed to 0.15 scale for the existing playable world. Buildings use approximate mapped footprints and generic architecture; overlap/slope checks omit unsuitable buildings. This is not a building-by-building surveyed digital twin.

## Authored geography and limits

`src/mawgan.js` records explicit asymmetric headland control points and a river course. These are a reference-led playable interpretation, not imported LiDAR or a cadastral survey. The waterline moves with the tide; it is not the inland dune outline. One shared height profile creates the physical terrain and its distant continuation, with matching edge samples.

The village's roads/positions are map-derived. Building details, heights, gardens and landscape elevations are not surveyed. Fine surface detail is procedural GPU shading; hydraulic state stays on the existing 140 × 140 grid.

Acceptance requires comparison views in addition to numerical tests. Neither procedural detail nor a passing physics suite establishes photographic realism.
