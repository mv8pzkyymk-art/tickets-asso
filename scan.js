'use strict';
// Repère le ticket (ou la facture) dans la photo, le recadre, le redresse et le rend plus net.
// Tout se fait sur le téléphone, sans bibliothèque.

// Renvoie les 4 coins du document [haut-gauche, haut-droit, bas-droit, bas-gauche] en pixels du canvas, ou null.
// Méthode : on cherche les bords droits de la photo (transformée de Hough), puis le quadrilatère
// dont les bords séparent le mieux un intérieur clair (le papier) d'un extérieur plus sombre.
function findDocument(canvas) {
  const S = 320 / Math.max(canvas.width, canvas.height);
  const w = Math.round(canvas.width * S), h = Math.round(canvas.height * S);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.drawImage(canvas, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const g0 = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g0[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
  const g = blur(g0, w, h, 1);

  // Gradients (Sobel)
  const mag = new Float32Array(w * h), ang = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1];
    const gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
    mag[i] = Math.hypot(gx, gy); ang[i] = Math.atan2(gy, gx);
  }
  const thr = Float32Array.from(mag).sort()[Math.floor(w * h * 0.80)];

  // Transformée de Hough guidée par la direction du gradient.
  const NT = 180, diag = Math.ceil(Math.hypot(w, h)), NR = 2 * diag + 1;
  const acc = new Float32Array(NT * NR);
  const cos = [], sin = [];
  for (let t = 0; t < NT; t++) { cos[t] = Math.cos(t * Math.PI / NT); sin[t] = Math.sin(t * Math.PI / NT); }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (mag[i] < thr) continue;
    let a = ang[i]; if (a < 0) a += Math.PI; const t0 = Math.round(a / Math.PI * NT);
    for (let dt = -6; dt <= 6; dt++) {
      const t = ((t0 + dt) % NT + NT) % NT;
      acc[t * NR + Math.round(x * cos[t] + y * sin[t]) + diag] += 1;
    }
  }
  // Pics principaux
  const lines = [];
  const order = Array.from(acc.keys()).filter(k => acc[k] > Math.min(w, h) * 0.12).sort((a, b) => acc[b] - acc[a]);
  for (const k of order) {
    const t = Math.floor(k / NR), r = k % NR - diag;
    if (lines.some(l => { const dt = Math.min(Math.abs(l.t - t), NT - Math.abs(l.t - t)); return dt < 8 && Math.abs(l.r - r) < 10; })) continue;
    lines.push({ t, r, v: acc[k] });
    if (lines.length >= 40) break;
  }
  const vert = lines.filter(l => l.t < 30 || l.t > 150), hor = lines.filter(l => l.t > 60 && l.t < 120);
  // Les bords de la photo servent de bord quand le document dépasse du cadre.
  const V = vert.slice(0, 12).concat([{ t: 0, r: 0, border: 1 }, { t: 0, r: w - 1, border: 1 }]);
  const Hl = hor.slice(0, 12).concat([{ t: 90, r: 0, border: 1 }, { t: 90, r: h - 1, border: 1 }]);
  const xAt = (l, y) => (l.r - y * sin[l.t]) / cos[l.t];   // ligne quasi verticale
  const yAt = (l, x) => (l.r - x * cos[l.t]) / sin[l.t];   // ligne quasi horizontale
  const meet = (lv, lh) => {
    const det = cos[lv.t] * sin[lh.t] - sin[lv.t] * cos[lh.t];
    return [(lv.r * sin[lh.t] - lh.r * sin[lv.t]) / det, (cos[lv.t] * lh.r - cos[lh.t] * lv.r) / det];
  };
  const at = (x, y) => { x = Math.round(x); y = Math.round(y); return x < 0 || y < 0 || x >= w || y >= h ? null : g[y * w + x]; };

  let best = null;
  for (let a = 0; a < V.length; a++) for (let b = 0; b < V.length; b++) {
    if (a === b) continue; const L = V[a], R = V[b];
    if (xAt(L, h / 2) >= xAt(R, h / 2) - w * 0.15) continue;
    for (let cI = 0; cI < Hl.length; cI++) for (let dI = 0; dI < Hl.length; dI++) {
      if (cI === dI) continue; const T = Hl[cI], B = Hl[dI];
      if (yAt(T, w / 2) >= yAt(B, w / 2) - h * 0.15) continue;
      const q = [meet(L, T), meet(R, T), meet(R, B), meet(L, B)];
      if (q.some(([x, y]) => x < -w * 0.05 || y < -h * 0.05 || x > w * 1.05 || y > h * 1.05)) continue;
      const area = quadArea(q);
      if (area < w * h * 0.12 || !convex(q)) continue;
      // Contraste de part et d'autre de chaque bord (papier clair dedans, fond plus sombre dehors).
      const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
      const sides = [[q[0], q[1], T], [q[1], q[2], R], [q[2], q[3], B], [q[3], q[0], L]];
      // Un vrai bord est continu : sur la majorité de sa longueur, l'intérieur est nettement plus clair
      // que l'extérieur (les lignes de texte, elles, sont interrompues).
      let score = 0, real = 0, ok = true;
      for (const [p1, p2, line] of sides) {
        if (line.border) continue;
        let good = 0, n = 0, busy = 0, nb = 0;
        for (let k = 1; k < 30; k++) {
          const x = p1[0] + (p2[0] - p1[0]) * k / 30, y = p1[1] + (p2[1] - p1[1]) * k / 30;
          const dx = cx - x, dy = cy - y, dl = Math.hypot(dx, dy) || 1;
          const inn = at(x + dx / dl * 3, y + dy / dl * 3), out = at(x - dx / dl * 3, y - dy / dl * 3);
          if (inn == null || out == null) continue;
          n++; if (inn - out > 8) good++;
          // Juste au-delà du bord, on doit trouver le fond (uni), pas la suite du texte du ticket.
          for (const off of [7, 11, 15]) {
            const ox = Math.round(x - dx / dl * off), oy = Math.round(y - dy / dl * off);
            if (ox >= 0 && oy >= 0 && ox < w && oy < h) { nb++; if (mag[oy * w + ox] > thr) busy++; }
          }
        }
        const support = n ? good / n : 0;
        if (support < 0.6 || (nb && busy / nb > 0.2)) { ok = false; break; }
        score += support; real++;
      }
      if (!ok || real < 2) continue;
      // Entre deux candidats (le ticket, ou le carton sur lequel il est posé), on préfère le plus clair.
      let inside = 0, ni = 0; const vals = [];
      for (let u = 1; u < 10; u++) for (let v = 1; v < 10; v++) {
        const top = [q[0][0] + (q[1][0] - q[0][0]) * u / 10, q[0][1] + (q[1][1] - q[0][1]) * u / 10];
        const bot = [q[3][0] + (q[2][0] - q[3][0]) * u / 10, q[3][1] + (q[2][1] - q[3][1]) * u / 10];
        const val = at(top[0] + (bot[0] - top[0]) * v / 10, top[1] + (bot[1] - top[1]) * v / 10);
        if (val != null) vals.push(val);
      }
      // Teinte du papier (le texte noir ne doit pas compter, mais un fond mélangé doit faire baisser la note).
      vals.sort((x, y) => x - y); ni = vals.length ? 1 : 0; inside = vals.length ? vals[Math.floor(vals.length * 0.4)] : 0;
      score = (ni ? inside / ni : 0) + 20 * score / real + 2 * real + 30 * Math.sqrt(area / (w * h));
      if (!best || score > best.score) best = { score, q };
    }
  }
  if (!best) return null;
  return best.q.map(([x, y]) => [Math.min(canvas.width, Math.max(0, x / S)), Math.min(canvas.height, Math.max(0, y / S))]);
}

function blur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += src[y * w + xx]; n++; } }
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; n++; } }
    out[y * w + x] = s / n;
  }
  return out;
}
function morph(m, w, h, r, val) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let hit = false;
    for (let dy = -r; dy <= r && !hit; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      if (m[yy * w + xx] === val) { hit = true; break; }
    }
    out[y * w + x] = hit ? val : 1 - val;
  }
  return out;
}
const dilate = (m, w, h, r) => morph(m, w, h, r, 1);
const erode = (m, w, h, r) => morph(m, w, h, r, 0);

function largestComponent(m, w, h) {
  const label = new Int32Array(w * h); let best = null, id = 0;
  const stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || label[i]) continue;
    id++; let sp = 0, count = 0; const pixels = [];
    stack[sp++] = i; label[i] = id;
    while (sp) {
      const j = stack[--sp]; count++; pixels.push(j);
      const x = j % w, y = (j / w) | 0;
      if (x > 0 && m[j - 1] && !label[j - 1]) { label[j - 1] = id; stack[sp++] = j - 1; }
      if (x < w - 1 && m[j + 1] && !label[j + 1]) { label[j + 1] = id; stack[sp++] = j + 1; }
      if (y > 0 && m[j - w] && !label[j - w]) { label[j - w] = id; stack[sp++] = j - w; }
      if (y < h - 1 && m[j + w] && !label[j + w]) { label[j + w] = id; stack[sp++] = j + w; }
    }
    if (!best || count > best.count) best = { count, pixels };
  }
  return best;
}
// Coins : le plus grand quadrilatère formé de sommets de l'enveloppe convexe de l'objet.
function corners(pixels, w) {
  // Points du contour (premier et dernier pixel de chaque ligne) puis enveloppe convexe.
  const rows = new Map();
  for (const j of pixels) {
    const x = j % w, y = (j / w) | 0, r = rows.get(y);
    if (!r) rows.set(y, [x, x]); else { if (x < r[0]) r[0] = x; if (x > r[1]) r[1] = x; }
  }
  const pts = [];
  for (const [y, [x0, x1]] of rows) { pts.push([x0, y]); if (x1 !== x0) pts.push([x1, y]); }
  let hull = convexHull(pts);
  // Réduit l'enveloppe à ~40 sommets pour garder le calcul rapide.
  while (hull.length > 40) hull = hull.filter((_, i) => i % 2 === 0);
  const n = hull.length; let best = null, bestA = -1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) for (let l = k + 1; l < n; l++) {
    const q = [hull[i], hull[j], hull[k], hull[l]], a = quadArea(q);
    if (a > bestA) { bestA = a; best = q; }
  }
  return best ? orderCorners(best) : extremes(pixels, w);
}
function convexHull(P) {
  P = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// Range 4 points en haut-gauche, haut-droit, bas-droit, bas-gauche.
function orderCorners(q) {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const byAngle = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // byAngle commence vers la gauche (angle -π) et tourne dans le sens horaire à l'écran.
  let start = 0, m = Infinity;
  byAngle.forEach((p, i) => { if (p[0] + p[1] < m) { m = p[0] + p[1]; start = i; } });
  return [0, 1, 2, 3].map(k => byAngle[(start + k) % 4]);
}
function extremes(pixels, w) {
  let tl, tr, br, bl, a = Infinity, b = -Infinity, c = -Infinity, d = Infinity;
  for (const j of pixels) {
    const x = j % w, y = (j / w) | 0;
    if (x + y < a) { a = x + y; tl = [x, y]; }
    if (x + y > b) { b = x + y; br = [x, y]; }
    if (x - y > c) { c = x - y; tr = [x, y]; }
    if (x - y < d) { d = x - y; bl = [x, y]; }
  }
  return [tl, tr, br, bl];
}
function quadArea(q) {
  let s = 0;
  for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2;
}
function convex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4], [cx, cy] = q[(i + 2) % 4];
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
    if (Math.abs(z) < 1e-6) return false;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
}

// Homographie qui envoie le rectangle (0,0)-(W,H) sur le quadrilatère q.
function homography(W, H, q) {
  const src = [[0, 0], [W, 0], [W, H], [0, H]];
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  const hcoef = solve(A, B); hcoef.push(1);
  return hcoef;
}
function solve(A, B) {
  const n = B.length, M = A.map((r, i) => [...r, B[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    for (let k = i + 1; k < n; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
  return x;
}

// Redresse le document : renvoie un nouveau canvas rectangulaire.
function warp(canvas, q) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const W = Math.round((d(q[0], q[1]) + d(q[3], q[2])) / 2), H = Math.round((d(q[0], q[3]) + d(q[1], q[2])) / 2);
  const src = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d'), dst = octx.createImageData(W, H);
  const [a, b, c, e, f, g, h, i] = homography(W, H, q), sw = canvas.width, sh = canvas.height, s = src.data, o = dst.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const z = h * x + i * y + 1;
    const u = Math.min(sw - 1, Math.max(0, Math.round((a * x + b * y + c) / z)));
    const v = Math.min(sh - 1, Math.max(0, Math.round((e * x + f * y + g) / z)));
    const si = (v * sw + u) * 4, di = (y * W + x) * 4;
    o[di] = s[si]; o[di + 1] = s[si + 1]; o[di + 2] = s[si + 2]; o[di + 3] = 255;
  }
  octx.putImageData(dst, 0, 0);
  return out;
}

// Rend le papier plus blanc et l'encre plus noire (en gardant les couleurs).
function enhance(canvas) {
  const ctx = canvas.getContext('2d'), im = ctx.getImageData(0, 0, canvas.width, canvas.height), p = im.data;
  const hist = new Uint32Array(256), n = p.length / 4;
  for (let i = 0; i < p.length; i += 4) hist[(p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0]++;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < n * 0.01) lo++;
  acc = 0; while (hi > 0 && (acc += hist[hi]) < n * 0.30) hi--; // le papier occupe la majorité : on le pousse au blanc
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < p.length; i += 4) for (let j = 0; j < 3; j++) p[i + j] = Math.max(0, Math.min(255, (p[i + j] - lo) * k));
  ctx.putImageData(im, 0, 0);
  return canvas;
}

// Point d'entrée : canvas de la photo → { canvas, cropped }
function cleanScan(canvas) {
  let q = null;
  try { q = findDocument(canvas); } catch (e) { console.warn(e); }
  const out = q ? warp(canvas, q) : canvas;
  return { canvas: enhance(out), cropped: !!q };
}
