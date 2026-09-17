// Shared geometry for the river simulation, scenery and objective sampling.
// Distances are metres. The eastern leat is silted at the fork; the deeper
// western branch takes most of the spring until the player moves that earth.
export const MILL = { x: 67, z: 64, forkZ: 32, fountainX: 82, fountainZ: 72 };
export const millRaceX = z => 56 + 11 * Math.min(1, Math.max(0, (z - 30) / 26));
export const bypassX = z => 56 - 23 * Math.sin(Math.min(1, Math.max(0, (z - 30) / 78)) * Math.PI * 0.8);
export const valleyFloor = z => 5.5 - z * 0.031;
export function millHeight(x, z) {
  const floor = valleyFloor(z);
  const bank = floor + 1.45;
  const hills = Math.pow(Math.max(0, Math.abs(x - 57) - 33) / 24, 2) * 9;
  const detail = (Math.sin(x * .16 + z * .09) + Math.cos(z * .14 - x * .08)) * .13;
  const mainX = z < 30 ? 56 + Math.sin(z * .11) * .6 : bypassX(z);
  let h = bank + hills + detail;
  h -= 2.15 * Math.exp(-Math.pow((x - mainX) / 3.2, 2));
  if (z > 28) {
    const race = Math.exp(-Math.pow((x - millRaceX(z)) / 2.15, 2));
    h -= 1.95 * race;
    // A visible, diggable deposit; not an invisible switch or scripted gate.
    h += 1.55 * race * Math.exp(-Math.pow((z - 39) / 4.5, 4));
  }
  return h;
}

export function readMillFlow(water, cell, grid) {
  const j = Math.round((MILL.z - 2) / cell);
  let discharge = 0;
  for (let i = Math.round((MILL.x - 2) / cell); i <= Math.round((MILL.x + 2) / cell); i++) {
    const k = j * grid + i;
    // Actual downstream volume flux through a cross-section, not water depth:
    // a full but stagnant pond must not power a waterwheel.
    discharge += Math.max(0, water.velZ[k]) * water.depth[k] * cell;
  }
  return discharge;
}

export const millRpmForFlow = discharge => Math.min(18, Math.max(0, discharge) * 140);
