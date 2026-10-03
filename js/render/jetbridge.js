// Fluggastbrücken an den Kontaktpositionen als Fahrzeug-Objekte für Karte und 3D-Ansicht (Modell in vehicles3d.js):
// Rotunde fest am Terminal, die Kabine fährt von der Parkstellung (st.bridge = 0) an die vordere linke Tür des
// Flugzeugs (st.bridge = 1); der Faltenbalg liegt am Rumpf an, der Kabinenboden auf der Türschwelle.
import * as LY from '../layout.js';
import { fuselage, doorSill, doorAlong } from '../acshape.js';
import { JB } from './jbdims.js';

const H0 = 0.36; // Boden der Rotunde (Obergeschoss des Terminals)
const lerp = (a, b, t) => a + (b - a) * t;
const angLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const OBJ = new Map();

export function jetBridges(state) {
  if (LY.GEO.stage < 2) return [];
  const out = [];
  for (const st of state.stands) {
    if (!st.built || st.kind !== 'contact') continue;
    const root = LY.bridgeRoot(st), R = { x: root.x, y: root.y + 0.12 };
    const ac = st.occ ? state.acs.find((a) => a.id === st.occ && a.mode === 'map') : null;
    const e = ac ? st.bridge || 0 : Math.min(st.bridge || 0, 0);
    // Parkstellung: Kabine dicht vor dem Terminal, quer zum Vorfeld
    let C = { x: st.x - 0.95, y: 15.68 }, face = 0, h1 = H0;
    if (ac) {
      const fx = Math.cos(ac.hdg), fy = Math.sin(ac.hdg), rx = -fy, ry = fx, f = fuselage(ac.type, ac.len);
      const a = doorAlong(ac.type) * ac.len, l = -(f.rz + 0.004 + JB.cab + 0.05); // links neben dem Rumpf
      const D = { x: ac.x + fx * a + rx * l, y: ac.y + fy * a + ry * l };
      C = { x: lerp(C.x, D.x, e), y: lerp(C.y, D.y, e) };
      face = angLerp(0, Math.atan2(ry, rx), e);
      h1 = lerp(H0, doorSill(ac.type, ac.len), e);
    }
    const hdg = Math.atan2(C.y - R.y, C.x - R.x), len = Math.min(JB.max, Math.hypot(C.x - R.x, C.y - R.y));
    let o = OBJ.get(st.id);
    if (!o) OBJ.set(st.id, (o = { id: 'jb' + st.id, type: 'jetbridge' }));
    Object.assign(o, { x: (R.x + C.x) / 2, y: (R.y + C.y) / 2, hdg, len, h0: H0, h1, cab: face - hdg, st: e > 0.001 && e < 0.999 ? 'work' : 'idle', stand: st });
    out.push(o);
  }
  return out;
}
