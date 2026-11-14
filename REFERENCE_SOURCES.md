# Mawgan Porth reconstruction — release 113

## Reference hierarchy

The user's 12 September 2026 annotated aerial/game comparison controls the broad bay composition. Their coastal photographs guide rock, turf, architecture and surf. These are held in the local audit evidence folder, not redistributed in this repository. Individual photographs are not claimed to be geolocated survey images.

Map orientation and physical setting were cross-checked against [Making Space for Sand](https://www.makingspaceforsand.co.uk/locations/mawgan-porth/): west-facing beach, Menalhyl along the southern margin, Berryl's Point south and Trenance Point north. The former code comment assigning the river to the northern side was incorrect.

## Map data and attribution

`src/mawgan-map.js` contains projected building centres, approximate oriented dimensions, and road/path polylines from OpenStreetMap. Extract downloaded 14 November 2026 from `https://api.openstreetmap.org/api/0.6/map?bbox=-5.038,50.462,-5.023,50.471`.

© OpenStreetMap contributors. Map database and derived data are provided under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/); see [OpenStreetMap copyright and licence information](https://www.openstreetmap.org/copyright). This data licence applies to `src/mawgan-map.js`, independently of application code. Visible attribution links to that information in the game.

Projection: local east/north offsets about longitude -5.0315, latitude 50.467, using 70,850 metres/degree longitude and 111,320 metres/degree latitude. Rotated axes: x increases southwards across the bay; z increases seawards. Horizontal coordinates are compressed to 0.15 scale for the existing playable world. Buildings use approximate mapped footprints and generic architecture; overlap/slope checks omit unsuitable buildings. This is not a building-by-building surveyed digital twin.

## Environment Agency elevation data

Release 113 replaces authored hill heights with public ground data in `src/mawgan-elevation.js`, derived from the [LIDAR Composite Digital Terrain Model, 1m, 2022](https://www.data.gov.uk/dataset/01b3ee39-da3f-47b6-83da-dc98e73a461f/lidar-composite-digital-terrain-model-dtm-1m).

© Environment Agency copyright and/or database right 2022. All rights reserved. Contains public sector information licensed under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). This attribution applies to elevation data independently of application code. The game displays a terrain attribution link.

Acquired 14 November 2026 through the Environment Agency WCS endpoint:

`https://environment.data.gov.uk/geoservices/datasets/13787b9a-26a4-4775-8523-806d13af58fc/wcs`

- WCS 1.0.0 GetCoverage; coverage `13787b9a-26a4-4775-8523-806d13af58fc:Lidar_Composite_Elevation_DTM_1m`.
- EPSG:27700; bounding box `183651,65790,186570,68883`; `resx=3`, `resy=3`, `format=GeoTIFF`, `interpolation=bilinear`.
- The source product is 1m LiDAR, but this extract is resampled at 3m and then bilinearly sampled onto the compressed game grid. Do not claim native 1m fidelity in the game.
- Heights use the source Ordnance Datum Newlyn datum. The derived grid starts at game x=-131.2, z=-164, with step 0.82 and dimensions 454 × 397. Heights are signed little-endian centimetres, Base64 encoded.
- Source no-data water pixels use an authored -20m fallback. Offshore bathymetry is not surveyed by this dataset; the game adds an authored seabed continuation.

## Bridge and shared transform

The B3276 bridge is OSM way 424487882, with endpoints (-5.0317452, 50.4649146) and (-5.0320914, 50.4648465), projected to approximately (86.62, 15.54) and (88.95, 18.61). The upstream river follows way 307894885. The tidal sand channel beyond its mapped outlet is authored along the southern cliff foot; this channel migrates in reality. The [Hydrock flood-risk assessment](https://docs.planning.org.uk/20210422/5/QPYZTQFG1XL00/owc9rjbu0pyh9831.pdf) documents the B3276 crossing and roads rising towards Trenance and Trevarrian.

For longitude/latitude, let e=(lon+5.0315)×70850 and n=(lat−50.467)×111320. Game coordinates are x=53+0.15×(−0.94n−0.342e), z=25+0.15×(−0.94e+0.342n). The LiDAR was transformed through EPSG:27700 using pyproj and this same map transform. Heights are multiplied by 0.22: the 0.15 horizontal compression and modest vertical exaggeration keep the small playable landscape readable.

## Reconstruction limits

Both physical terrain and distant ground sample this elevation profile. The hydraulic simulation remains 140 × 140; procedural surface detail runs in the rendering layer. The riverbed, flow rate, tide, bridge deck/ramps and scenery are adjusted for play. Inland turf is firmer than diggable beach sand. Building heights, facades, foundations and vegetation are generic, not surveyed architecture. Approximate footprints that overlap roads or unsuitable slopes are omitted.

This is a stylised reconstruction with measured terrain, not a surveyed digital twin or photographic rendering.

Acceptance requires comparison views in addition to numerical tests. Neither procedural detail nor a passing physics suite establishes photographic realism.

## Character reference privacy

The latest child photograph could not be retrieved in this desktop session. Character changes use a relayed description of proportions, fringe, cream bear-ear hood, brown top and striped shorts. No verified photographic likeness is claimed. No child photo was copied into this workspace, committed, used as a texture or published. Temporary cloud reference copies were reported deleted by the originating chat; original chat/Library attachment deletion was not verified here.
