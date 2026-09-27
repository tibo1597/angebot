// Bildpunkte lesen — für den Zuschnitt der weißen Ränder (Nachbau von Bildzuschnitt.swift).
//
// Im Browser dekodiert der Browser selbst (createImageBitmap + Canvas).
// In Node (nur für Tests) übernimmt jpeg-js; PNGs werden dort nicht zugeschnitten.

/** Ab diesem Helligkeitswert gilt ein Bildpunkt als Hintergrund. */
const SCHWELLE = 244;
/** Etwas Luft, damit der Wagen nicht am Rand klebt. */
const LUFT = 0.015;
/** Für die Suche reicht eine kleine Fassung. */
const SUCHBREITE = 200;

/**
 * Maße und Inhaltsbereich eines Bildes.
 * @returns {Promise<{breite:number, hoehe:number, zuschnitt:{x:number,y:number,w:number,h:number}|null}|null>}
 *          `zuschnitt` in Bildpunkten, Ursprung oben links; `null`, wenn sich
 *          ein Zuschnitt nicht lohnt. Gesamtergebnis `null`, wenn das Bild
 *          nicht lesbar ist.
 */
export async function analysiere(daten, mime) {
  const verkleinert = await grauwerte(daten, mime);
  if (!verkleinert) return null;
  const { breite, hoehe } = verkleinert;
  if (!verkleinert.punkte) return { breite, hoehe, zuschnitt: null };
  return { breite, hoehe, zuschnitt: inhaltsbereich(verkleinert) };
}

function inhaltsbereich({ breite: B, hoehe: H, punkte, sb, sh }) {
  let links = sb, rechts = -1, oben = sh, unten = -1;
  for (let zeile = 0; zeile < sh; zeile++) {
    for (let spalte = 0; spalte < sb; spalte++) {
      if (punkte[zeile * sb + spalte] < SCHWELLE) {
        if (spalte < links) links = spalte;
        if (spalte > rechts) rechts = spalte;
        if (zeile < oben) oben = zeile;
        if (zeile > unten) unten = zeile;
      }
    }
  }
  if (rechts < links || unten < oben) return null;

  const faktor = B / sb;
  const luftX = B * LUFT;
  const luftY = H * LUFT;
  let x0 = links * faktor - luftX;
  let y0 = oben * faktor - luftY;
  let x1 = x0 + (rechts - links + 1) * faktor + 2 * luftX;
  let y1 = y0 + (unten - oben + 1) * faktor + 2 * luftY;
  // Schnitt mit dem Bild
  x0 = Math.max(0, x0); y0 = Math.max(0, y0);
  x1 = Math.min(B, x1); y1 = Math.min(H, y1);
  if (x1 <= x0 || y1 <= y0) return null;

  // Ein Zuschnitt, der fast das ganze Bild behält, lohnt sich nicht.
  const anteil = ((x1 - x0) * (y1 - y0)) / (B * H);
  if (anteil >= 0.97) return null;

  // .integral: nach außen auf ganze Bildpunkte
  const x = Math.floor(x0), y = Math.floor(y0);
  return { x, y, w: Math.ceil(x1) - x, h: Math.ceil(y1) - y };
}

/** Graustufen in Suchgröße (weiß hinterlegt), dazu die Originalmaße. */
async function grauwerte(daten, mime) {
  const imBrowser = typeof createImageBitmap === 'function'
    && (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined');
  return imBrowser ? grauImBrowser(daten, mime) : grauInNode(daten, mime);
}

async function grauImBrowser(daten, mime) {
  let bild;
  try {
    bild = await createImageBitmap(new Blob([daten], { type: mime || 'image/jpeg' }));
  } catch {
    return null;
  }
  const B = bild.width, H = bild.height;
  const sb = Math.min(SUCHBREITE, B);
  const sh = Math.max(1, Math.floor(sb * H / B));
  const flaeche = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(sb, sh)
    : Object.assign(document.createElement('canvas'), { width: sb, height: sh });
  const ctx = flaeche.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, sb, sh);
  ctx.drawImage(bild, 0, 0, sb, sh);
  bild.close?.();
  const rgba = ctx.getImageData(0, 0, sb, sh).data;
  const punkte = new Uint8Array(sb * sh);
  for (let i = 0; i < punkte.length; i++) {
    punkte[i] = grau(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  }
  return { breite: B, hoehe: H, punkte, sb, sh };
}

async function grauInNode(daten, mime) {
  const istPNG = mime === 'image/png' || (daten[0] === 0x89 && daten[1] === 0x50);
  if (istPNG) {
    // Maße aus dem IHDR-Block; kein Zuschnitt.
    if (daten.length < 24) return null;
    const dv = new DataView(daten.buffer, daten.byteOffset, daten.byteLength);
    return { breite: dv.getUint32(16), hoehe: dv.getUint32(20), punkte: null };
  }
  const { createRequire } = await import('node:module');
  const jpeg = createRequire(import.meta.url)('jpeg-js');
  let bild;
  try {
    bild = jpeg.decode(daten, { useTArray: true, formatAsRGBA: true });
  } catch {
    return null;
  }
  const B = bild.width, H = bild.height;
  const sb = Math.min(SUCHBREITE, B);
  const sh = Math.max(1, Math.floor(sb * H / B));
  // Flächenmittel je Zielpunkt — entspricht der geglätteten Verkleinerung.
  const punkte = new Uint8Array(sb * sh);
  for (let zy = 0; zy < sh; zy++) {
    const qy0 = Math.floor(zy * H / sh), qy1 = Math.max(qy0 + 1, Math.floor((zy + 1) * H / sh));
    for (let zx = 0; zx < sb; zx++) {
      const qx0 = Math.floor(zx * B / sb), qx1 = Math.max(qx0 + 1, Math.floor((zx + 1) * B / sb));
      let summe = 0, anzahl = 0;
      for (let qy = qy0; qy < qy1; qy++) {
        for (let qx = qx0; qx < qx1; qx++) {
          const i = (qy * B + qx) * 4;
          summe += grau(bild.data[i], bild.data[i + 1], bild.data[i + 2]);
          anzahl++;
        }
      }
      punkte[zy * sb + zx] = Math.round(summe / anzahl);
    }
  }
  return { breite: B, hoehe: H, punkte, sb, sh };
}

const grau = (r, g, b) => Math.round(0.299 * r + 0.587 * g + 0.114 * b);
