// Follow-me-Fahrzeug vor A380, Regierungs- und VIP-Maschinen beim Einrollen: ein Stück voraus auf dem Rollpfad.
// Gemeinsam für Karte und 3D-Ansicht.
export function followMeCars(state) {
  const out = [];
  for (const ac of state.acs) {
    if (ac.mode !== 'map' || ac.phase !== 'TAXI_IN' || !ac.path || ac.pi == null) continue;
    const sp = state.rots[ac.rot] && state.rots[ac.rot].special;
    if (sp !== 'a380' && sp !== 'vip' && sp !== 'state' && ac.type !== 'A388') continue;
    let need = ac.len * 0.55 + 1.5, px = ac.x, py = ac.y, hdg = ac.hdg;
    for (let i = Math.max(1, ac.pi + 1); i < ac.path.length; i++) {
      const q = ac.path[i];
      const dx = q.x - px, dy = q.y - py, L = Math.hypot(dx, dy);
      if (L < 1e-6) continue;
      hdg = Math.atan2(dy, dx);
      if (L >= need) {
        px += (dx / L) * need;
        py += (dy / L) * need;
        need = 0;
        break;
      }
      need -= L;
      px = q.x;
      py = q.y;
    }
    if (need > 0.2) continue; // Pfad fast zu Ende: Fahrzeug fährt schon zur Seite
    out.push({ id: 'fm' + ac.id, x: px, y: py, hdg, st: 'work', brokenUntil: 0 });
  }
  return out;
}
