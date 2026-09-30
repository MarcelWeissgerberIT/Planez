// Laden der (mit Higgsfield generierten) Grafiken + abgeleitete Hilfsgrafiken
export const IMG = {};
const SPRITES = ['tower', 'hangar', 'cargo', 'fire_station', 'fuel_farm', 'parking', 'hotel', 'gse_depot', 'radar', 'terminal_hall', 'tree1', 'tree2', 'plane_narrow', 'plane_wide', 'plane_prop', 'plane_cargo', 'plane_bizjet', 'crane', 'excavator', 'mixer', 'site_office', 'skeleton'];
const VEHICLES = ['veh_tug', 'veh_baggage', 'veh_fuel', 'veh_catering', 'veh_bus', 'veh_cleaning', 'veh_fire'];
const TEXTURES = ['tex_facade', 'tex_roof', 'tex_grass', 'tex_concrete', 'tex_asphalt', 'tex_gravel'];

function loadImg(src) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => {
      console.warn('Grafik fehlt:', src);
      res(null);
    };
    im.src = src;
  });
}

export async function loadAssets(onProgress = () => {}) {
  const jobs = [
    ...SPRITES.map((n) => [n, `assets/sprites/${n}.webp`]),
    ...VEHICLES.map((n) => [n, `assets/vehicles/${n}.webp`]),
    ...TEXTURES.map((n) => [n, `assets/textures/${n}.jpg`]),
  ];
  let done = 0;
  await Promise.all(
    jobs.map(async ([n, src]) => {
      IMG[n] = await loadImg(src);
      done++;
      onProgress(done / jobs.length);
    })
  );
  IMG.glow = makeGlow();
  IMG.glowSoft = makeGlow(128, [1, 0.35, 0]);
}

// Schwarze Silhouette (für Schatten)
const shadowCache = {};
export function shadowOf(name) {
  if (shadowCache[name]) return shadowCache[name];
  const im = IMG[name];
  if (!im) return null;
  const c = document.createElement('canvas');
  const s = Math.min(1, 256 / Math.max(im.width, im.height));
  c.width = Math.max(1, Math.round(im.width * s));
  c.height = Math.max(1, Math.round(im.height * s));
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  shadowCache[name] = c;
  return c;
}

function makeGlow(size = 64, stops = [1, 0.4, 0]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, `rgba(255,255,255,${stops[0]})`);
  gr.addColorStop(0.25, `rgba(255,255,255,${stops[1]})`);
  gr.addColorStop(1, `rgba(255,255,255,${stops[2]})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

// Eingefärbter Glow (gecacht)
const tintCache = {};
export function glowTinted(color, soft = false) {
  const key = color + soft;
  if (tintCache[key]) return tintCache[key];
  const base = soft ? IMG.glowSoft : IMG.glow;
  const c = document.createElement('canvas');
  c.width = base.width;
  c.height = base.height;
  const g = c.getContext('2d');
  g.drawImage(base, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  tintCache[key] = c;
  return c;
}
