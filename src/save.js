// Persists and restores player progress (dug/piled terrain, water state, moved
// rocks) across page reloads via localStorage - so a refresh, a crash, or just
// closing the tab doesn't throw away everything the player just did. Never
// touches terrain/water/rock CLASS internals - only reads/writes their already-
// public typed arrays and scalar fields, so this stays independent of whatever
// else is changing inside those files.
import { TERRAIN_VERSION } from './terrain.js?v=94';

// Each level gets its own independent save slot, keyed by level id, so
// progress in one never overwrites or gets clobbered by the other. Level 1's
// key is left byte-identical to before this existed (any existing player's
// save keeps loading normally); level 2 (and any future level) just gets its
// own fresh key.
const KEY_BY_LEVEL = {
  level1: 'shoreline_save_v1',
  level2: 'shoreline_save_level2_v1',
};
function keyFor(levelId) { return KEY_BY_LEVEL[levelId] || KEY_BY_LEVEL.level1; }
const SCHEMA_VERSION = 1;

function f32ToBase64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = '';
  const CHUNK = 0x8000; // String.fromCharCode.apply on a huge array can blow the call stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToF32(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export function saveState({ terrain, water, rocks, player, vehicles, levelId = 'level1' }) {
  try {
    const data = {
      v: SCHEMA_VERSION,
      terrainV: TERRAIN_VERSION,
      savedAt: Date.now(),
      height: f32ToBase64(terrain.height),
      hardness: f32ToBase64(terrain.hardness),
      waterDepth: f32ToBase64(water.depth),
      waterSediment: f32ToBase64(water.sediment),
      tideLevel: water.tideLevel,
      tidePhase: water.tidePhase,
      elapsed: water.elapsed,
      // Carried rocks are saved at their last grounded position/state, not as
      // "still being held" - restoring mid-carry state (which arm, reach, etc.)
      // isn't worth the fragility for what's a rare edge case to be mid-reload.
      rocks: rocks.map(r => ({
        x: r.x, z: r.z, size: r.size,
        q: [r.mesh.quaternion.x, r.mesh.quaternion.y, r.mesh.quaternion.z, r.mesh.quaternion.w],
      })),
      playerX: player.pos.x,
      playerZ: player.pos.z,
      // Vehicles are as much "player work" as moved rocks - keep them wherever
      // they were parked/driven to, not reset to their spawn point every reload.
      // Optional (older saves / a fresh level simply won't have this key), so
      // reading it back is guarded with Array.isArray in main.js.
      vehicles: Array.isArray(vehicles) ? vehicles.map((v) => ({ type: v.type, x: v.pos.x, z: v.pos.z, heading: v.facing })) : undefined,
    };
    localStorage.setItem(keyFor(levelId), JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('[shoreline] save failed (localStorage full or unavailable):', e);
    return false;
  }
}

export function loadSavedData(levelId = 'level1') {
  try {
    const raw = localStorage.getItem(keyFor(levelId));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.v !== SCHEMA_VERSION) return null; // don't try to apply an incompatible shape
    // A save written against an older terrain generation would otherwise
    // silently overwrite freshly (newly) generated terrain with an old raw
    // height snapshot - wrong falls position, no lake, etc. - while
    // everything else keeps using the new constants. Terrain-shape changes
    // discard old saves for that level rather than risk that mismatch;
    // saves missing terrainV entirely predate this check and are treated
    // the same as a mismatch (discarded), not assumed compatible.
    if (data.terrainV !== TERRAIN_VERSION) return null;
    return data;
  } catch (e) {
    console.warn('[shoreline] saved data unreadable, ignoring it:', e);
    return null;
  }
}

export function clearSave(levelId = 'level1') {
  try { localStorage.removeItem(keyFor(levelId)); } catch (e) { /* ignore */ }
}

// Applies a loaded save onto already-constructed terrain/water (which must have
// already run their normal generation/priming for bedrock, colours, meshes,
// etc.) - this only overwrites the specific fields a save actually carries.
export function applySavedData(data, terrain, water) {
  terrain.height.set(base64ToF32(data.height));
  terrain.hardness.set(base64ToF32(data.hardness));
  water.depth.set(base64ToF32(data.waterDepth));
  water.sediment.set(base64ToF32(data.waterSediment));
  water.tideLevel = data.tideLevel;
  water.tidePhase = data.tidePhase;
  water.elapsed = data.elapsed;
}
