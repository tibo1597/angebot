// Holt die EINGEBETTETEN Fahrzeugbilder — Nachbau von PDFImageExtractor.swift.
//
// Keine Seiten-Screenshots: Im Faba-Angebot liegen echte, freigestellte BMW-Renderings
// als Bildobjekte vor. JPEG-Daten werden unverändert übernommen.
// Aussortiert: Bilder unter 300 px Breite (QR-Code, Symbole), Masken, und die
// Dublette — die Außenansicht steht als dasselbe Objekt auf Seite 1 und 4.

import { neueId } from './modell.js';

/**
 * @param PDFLib  der pdf-lib-Namensraum
 * @param bytes   die PDF-Datei
 * @param seiten  erlaubte Seitenindizes (Angebotsteil), oder null für alle
 */
/**
 * @param optionen.reihenfolge  'name'      — nach XObject-Namen (wie CoreGraphics; OFCO-Angebote)
 *                              'zeichnung' — in der Reihenfolge, in der die Seite sie zeichnet
 */
export async function extrahiereBilder(PDFLib, bytes, seiten = null, { reihenfolge = 'name', mindestBreite = 300 } = {}) {
  const { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFArray, decodePDFRawStream } = PDFLib;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const bilder = [];
  const gesehen = new Set();
  const erlaubt = seiten ? new Set(seiten) : null;

  const name = (dict, key) => dict.get(PDFName.of(key))?.toString?.() ?? null;
  const zahl = (dict, key) => {
    const w = dict.lookup(PDFName.of(key));
    return w && typeof w.asNumber === 'function' ? w.asNumber() : null;
  };

  /** Namen der XObjects in der Reihenfolge der `Do`-Befehle im Seiteninhalt. */
  function zeichenfolge(seite) {
    try {
      const inhalt = seite.node.Contents();
      const stroeme = inhalt instanceof PDFArray
        ? inhalt.asArray().map(r => doc.context.lookup(r)) : [inhalt];
      const text = stroeme.map(st => new TextDecoder('latin1').decode(decodePDFRawStream(st).decode())).join('\n');
      return [...text.matchAll(/\/([^\s/<>\[\]()]+)\s+Do\b/g)].map(m => `/${m[1]}`);
    } catch {
      return [];
    }
  }

  function durchsuche(ressourcen, seitenIndex, tiefe, folge = []) {
    if (!(ressourcen instanceof PDFDict) || tiefe > 4) return;
    const xobjekte = ressourcen.lookup(PDFName.of('XObject'));
    if (!(xobjekte instanceof PDFDict)) return;
    // 'name': sortiert wie CoreGraphics (img0, img2, img3 …) — so steht beim OFCO-Angebot
    // die Heckansicht vor den Innenraumbildern. 'zeichnung': wie auf der Seite gezeichnet.
    const rang = n => { const i = folge.indexOf(n); return i < 0 ? Infinity : i; };
    const eintraege = xobjekte.entries().sort(([a], [b]) => reihenfolge === 'zeichnung'
      ? rang(a.toString()) - rang(b.toString())
      : a.toString().localeCompare(b.toString(), 'en', { numeric: true }));
    for (const [, ref] of eintraege) {
      const stream = doc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;
      const d = stream.dict;
      const art = name(d, 'Subtype');
      if (art === '/Form') {
        durchsuche(d.lookup(PDFName.of('Resources')), seitenIndex, tiefe + 1);
        continue;
      }
      if (art !== '/Image') continue;
      const breite = zahl(d, 'Width'), hoehe = zahl(d, 'Height');
      if (!breite || !hoehe || breite < mindestBreite) continue;
      if (d.lookup(PDFName.of('ImageMask'))?.toString() === 'true') continue;

      // Nur fertige JPEGs werden übernommen. Rohdaten (Flate) bräuchten eine
      // Umwandlung; im Faba-Angebot kommen sie nicht vor.
      let filter = d.lookup(PDFName.of('Filter'));
      if (filter instanceof PDFArray) filter = filter.size() === 1 ? filter.lookup(0) : null;
      if (filter?.toString() !== '/DCTDecode') continue;

      // Dublette: dasselbe Objekt oder dieselben Bytes (wie im Swift-Kern).
      const schluessel = ref.toString();
      const daten = stream.contents;
      if (gesehen.has(schluessel) || bilder.some(b => gleicheBytes(b.data, daten))) continue;
      gesehen.add(schluessel);
      bilder.push({
        id: neueId(), data: stream.contents, mime: 'image/jpeg', kind: 'unknown',
        sourcePage: seitenIndex, pixelWidth: breite, pixelHeight: hoehe, caption: null,
      });
    }
  }

  doc.getPages().forEach((seite, i) => {
    if (erlaubt && !erlaubt.has(i)) return;
    durchsuche(seite.node.Resources(), i, 0, reihenfolge === 'zeichnung' ? zeichenfolge(seite) : []);
  });
  return bilder;
}

function gleicheBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
