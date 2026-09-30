// Isometrische Kamera: Welt (Kacheln) <-> Bildschirm
import { ZS } from '../config.js';
import { clamp } from '../util.js';
import { W, H } from '../layout.js';

export const HALF_W = 32; // halbe Kachelbreite in px bei Zoom 1
export const HALF_H = 16;

export class Camera {
  constructor() {
    this.x = 40;
    this.y = 20;
    this.zoom = 0.6;
    this.w = 800;
    this.h = 600;
    this.dpr = 1;
    this.tx = null; // Ziel für sanftes Schwenken
  }
  get ox() {
    return this.w / 2 - (this.x - this.y) * HALF_W * this.zoom;
  }
  get oy() {
    return this.h / 2 - (this.x + this.y) * HALF_H * this.zoom;
  }
  toScreen(wx, wy, wz = 0) {
    const z = this.zoom;
    return { x: (wx - wy) * HALF_W * z + this.ox, y: (wx + wy) * HALF_H * z - wz * ZS * z + this.oy };
  }
  toWorld(sx, sy) {
    const z = this.zoom;
    const a = (sx - this.ox) / (HALF_W * z);
    const b = (sy - this.oy) / (HALF_H * z);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }
  // Canvas-Transform: Weltkoordinaten (x,y) auf Bodenhöhe wz
  setIso(ctx, wz = 0) {
    const z = this.zoom * this.dpr;
    ctx.setTransform(HALF_W * z, HALF_H * z, -HALF_W * z, HALF_H * z, this.ox * this.dpr, (this.oy - wz * ZS * this.zoom) * this.dpr);
  }
  setScreen(ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
  zoomAt(factor, sx, sy) {
    const before = this.toWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, 0.22, 2.6);
    const after = this.toWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clampPos();
  }
  panBy(dxs, dys) {
    const z = this.zoom;
    const a = dxs / (HALF_W * z);
    const b = dys / (HALF_H * z);
    this.x -= (a + b) / 2;
    this.y -= (b - a) / 2;
    this.tx = null;
    this.clampPos();
  }
  clampPos() {
    this.x = clamp(this.x, -6, W + 6);
    this.y = clamp(this.y, -6, H + 6);
  }
  focus(x, y) {
    this.tx = { x, y };
  }
  update(dt) {
    if (!this.tx) return;
    const k = 1 - Math.pow(0.001, dt);
    this.x += (this.tx.x - this.x) * k;
    this.y += (this.tx.y - this.y) * k;
    if (Math.hypot(this.tx.x - this.x, this.tx.y - this.y) < 0.02) this.tx = null;
  }
}
