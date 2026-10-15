'use strict';
// Lecture automatique du ticket : reconnaissance du texte (Tesseract, hébergé avec l'appli,
// rien n'est envoyé à un service extérieur) puis repérage du fournisseur, de la date et du montant.

const ENSEIGNES = [
  'Carrefour Market', 'Carrefour City', 'Carrefour Contact', 'Carrefour', 'E.Leclerc', 'Leclerc', 'Auchan', 'Lidl',
  'Intermarché', 'Super U', 'Hyper U', 'U Express', 'Système U', 'Casino', 'Géant Casino', 'Monoprix', 'Franprix',
  'Aldi', 'Netto', 'Leader Price', 'Grand Frais', 'Picard', 'Biocoop', 'Naturalia', 'Metro', 'Promocash',
  'Leroy Merlin', 'Castorama', 'Brico Dépôt', 'Bricomarché', 'Mr Bricolage', 'Ikea', 'Decathlon', 'Fnac', 'Darty',
  'Boulanger', 'Cultura', 'Action', 'Gifi', 'La Foir\'Fouille', 'Bureau Vallée', 'Office Depot', 'Cora',
  'Amazon', 'Total', 'TotalEnergies', 'Esso', 'Shell', 'BP', 'La Poste',
  'Truffaut', 'Jardiland', 'Botanic', 'Maxi Zoo', 'Norauto', 'Feu Vert', 'Speedy', 'Point S', 'Sephora', 'Nocibé',
];

const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function parseAmount(s) {
  const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

// Montant : on privilégie les lignes « TOTAL TTC », « À PAYER », « MONTANT », « CB »… en écartant TVA et HT.
function findAmount(lines) {
  // 2 décimales (12,50) ou 3 sur certaines factures (198,350).
  const num = /(\d{1,5}(?:[ .]\d{3})*\s?[.,]\s?\d{2,3})(?!\d)/g;
  const rules = [
    [/t[o0]t[a4][l1i]\s*t\.?t\.?c|t[o0]t[a4][l1i]\s*vers|net\s*a\s*payer|a\s*payer|t[o0]t[a4][l1i]\s*a\s*regler|somme\s*due/, 5],
    [/t[o0]t[a4][l1i]|\bsous[- ]?total\b/, 4],
    [/montant|\bcb\b|\bc\.b\b|carte|visa|mastercard|\bemv\b|paiement|regle|debit|\beur\b|€/, 3],
  ];
  const bad = /tva|\bht\b|hors\s*taxe|rendu|economi|remise|fidelite|avoir|\bpoints?\b|cagnott|\btaux\b/;
  let best = null; const cands = [];
  lines.forEach((line, i) => {
    const l = norm(line);
    if (bad.test(l)) return;
    for (const [re, score] of rules) {
      if (!re.test(l)) continue;
      // Le montant est sur la même ligne, ou parfois sur la suivante.
      let found = [...line.matchAll(num)].map(m => parseAmount(m[1]));
      if (!found.length && lines[i + 1]) found = [...lines[i + 1].matchAll(num)].map(m => parseAmount(m[1]));
      const v = found.filter(x => x !== null && x > 0).pop();
      if (v != null) cands.push({ v, score });
      if (v != null && (!best || score > best.score || (score === best.score && v > best.v))) best = { v, score };
      break;
    }
  });
  // Un montant retrouvé sur plusieurs lignes (total, versé, CB…) est plus sûr qu'une seule lecture.
  const seen = cands.filter(c => cands.filter(d => d.v === c.v).length > 1).sort((a, b) => b.score - a.score);
  if (seen.length) return seen[0].v;
  if (best) return best.v;
  // À défaut : le plus grand montant du ticket (souvent le total).
  const all = lines.flatMap(l => [...l.matchAll(num)].map(m => parseAmount(m[1]))).filter(x => x && x < 100000);
  return all.length ? Math.max(...all) : null;
}

// Date : formats JJ/MM/AA(AA), JJ-MM-AAAA, JJ.MM.AAAA ; on garde une date plausible (pas dans le futur, < 2 ans).
function findDate(text) {
  const re = /\b(\d{1,2})\s?[\/.\-]\s?(\d{1,2})\s?[\/.\-]\s?(\d{4}|\d{2})\b/g;
  const now = new Date();
  const out = [];
  for (const m of text.matchAll(re)) {
    let [, d, mo, y] = m; d = +d; mo = +mo; y = +y;
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1) continue;
    const age = (now - dt) / 86400000;
    if (age < -1 || age > 730) continue;
    out.push(`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }
  return out[0] || null;
}

// Fournisseur : une enseigne connue si elle apparaît, sinon la première ligne « parlante » du haut du ticket.
function findShop(lines) {
  const head = lines.slice(0, 12).map(norm).join(' ');
  for (const e of ENSEIGNES) {
    const n = norm(e).replace(/[.']/g, '.?');
    if (new RegExp('\\b' + n + '\\b').test(head)) return e === 'E.Leclerc' ? 'Leclerc' : e;
  }
  for (const line of lines.slice(0, 6)) {
    const t = line.replace(/[^A-Za-zÀ-ÿ'& -]/g, ' ').replace(/\s+/g, ' ').trim();
    const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (letters.length >= 4 && letters.length / t.length > 0.6 && !/ticket|bienvenue|facture|caisse|magasin|\btel\b|siret|www|\brue\b|\bav\b|avenue|boulevard/i.test(t)) {
      const t2 = t.replace(/^(?:(?:\S{1,2}|mag|magasin|ste|sarl|sas)\s+)+/i, '') || t; // « A.S.F Mag Copifac » → « Copifac »
      return t2.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, c => c.toUpperCase()).slice(0, 30);
    }
  }
  return null;
}

function parseReceipt(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  return { shop: findShop(lines), date: findDate(text), amount: findAmount(lines) };
}

// Prépare la photo pour la lecture : niveaux de gris et contraste renforcé
// (les tickets thermiques sont souvent pâles, photographiés avec une ombre).
async function prepare(blob) {
  const img = await createImageBitmap(blob);
  const scale = Math.min(window.OCR_UP || 1.25, 2600 / Math.max(img.width, img.height)); // assez de détail pour une facture A4 entière
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
  const im = ctx.getImageData(0, 0, c.width, c.height), d = im.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = g; hist[g]++; }
  // Étire l'histogramme entre les 2 % les plus sombres et les 2 % les plus clairs.
  const n = d.length / 4; let lo = 0, hi = 255, acc = 0;
  while (lo < 255 && (acc += hist[lo]) < n * 0.02) lo++;
  acc = 0; while (hi > 0 && (acc += hist[hi]) < n * 0.02) hi--;
  const k = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) { const v = Math.max(0, Math.min(255, (d[i] - lo) * k)); d[i] = d[i + 1] = d[i + 2] = v; }
  ctx.putImageData(im, 0, 0);
  return c;
}

let ocrWorker = null;
async function readReceipt(blob, onProgress) {
  if (!window.Tesseract) {
    await new Promise((ok, ko) => {
      const s = document.createElement('script'); s.src = 'ocr/tesseract.min.js'; s.onload = ok; s.onerror = ko;
      document.head.appendChild(s);
    });
  }
  if (!ocrWorker) {
    const base = new URL('ocr/', location.href).href;
    ocrWorker = await Tesseract.createWorker('fra', 1, {
      workerPath: base + 'worker.min.js', corePath: base, langPath: base + 'lang',
      logger: m => onProgress && m.status === 'recognizing text' && onProgress(m.progress),
    });
  }
  const { data } = await ocrWorker.recognize(await prepare(blob));
  const r = parseReceipt(data.text);
  // Fournisseur deviné (pas une enseigne connue) sur une ligne mal lue : on laisse vide plutôt qu'un nom absurde.
  if (r.shop && !ENSEIGNES.includes(r.shop) && r.shop !== 'Leclerc') {
    const words = norm(r.shop).split(/\s+/);
    const line = (data.lines || []).find(l => words.every(w => norm(l.text).includes(w)));
    if (line && line.confidence < 35) r.shop = null;
  }
  return { ...r, text: data.text };
}

if (typeof module !== 'undefined') module.exports = { parseReceipt };
