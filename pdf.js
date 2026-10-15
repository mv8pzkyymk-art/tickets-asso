'use strict';
// Transforme la photo JPEG en PDF d'une page (largeur A4), sans bibliothèque :
// le JPEG est inséré tel quel dans le PDF, donc aucune perte de qualité.

async function jpegToPdf(jpeg) {
  const img = await createImageBitmap(jpeg);
  const w = 595.28, h = +(w * img.height / img.width).toFixed(2); // points ; 595 pt = largeur A4
  const data = new Uint8Array(await jpeg.arrayBuffer());
  const enc = s => new TextEncoder().encode(s);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const parts = [], offsets = [];
  let pos = 0;
  const push = p => { const b = typeof p === 'string' ? enc(p) : p; parts.push(b); pos += b.length; };
  const obj = (n, body) => { offsets[n] = pos; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${data.length} >>\nstream\n`);
    push(data); push('\nendstream');
  });
  obj(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const xref = pos;
  push('xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join(''));
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
