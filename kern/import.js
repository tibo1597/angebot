// Der eine Weg vom PDF zum fertigen Angebot — Nachbau von AngebotsImport.swift.
// Reihenfolge: Text lesen → Parser bestimmen → Werte ziehen → Bilder holen.
// Die Bilder kommen zum Schluss, weil erst der Parser weiß, welche Seiten
// zum Angebotsteil gehören.

import { extrahiere } from './extraktor.js';
import { parserFuer } from './parser.js';
import { extrahiereBilder } from './bilder.js';
import { leeresAngebot } from './modell.js';
import { korrigiere } from './korrekturen.js';

export class ImportFehler extends Error {
  constructor(text, ursache) {
    super(text);
    this.ursache = ursache;
  }
}

/**
 * @param bytes  Uint8Array der PDF-Datei
 * @param libs   { pdfjs, PDFLib } — im Browser aus vendor/, im Test aus node_modules
 * @returns { angebot, seitenOhneText, seitenzahl, erkannt }
 */
export async function lese(bytes, { pdfjs, PDFLib }) {
  let pdf;
  try {
    // pdf.js übernimmt den Puffer — deshalb eine Kopie, pdf-lib braucht ihn danach noch.
    pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false }).promise;
  } catch (e) {
    throw new ImportFehler('Die Datei konnte nicht geöffnet werden.', e);
  }
  try {
    const text = await extrahiere(pdf);
    const parser = parserFuer(text);
    if (!parser) {
      return { angebot: leeresAngebot(), seitenOhneText: text.pagesNeedingOCR,
               seitenzahl: text.pageCount, erkannt: false };
    }
    const angebot = korrigiere(parser.parse(text));
    try {
      const bilder = await extrahiereBilder(PDFLib, bytes, parser.imagePages(text), {
        reihenfolge: parser.bildReihenfolge ?? 'name',
      });
      angebot.images = parser.bildFilter ? bilder.filter(parser.bildFilter) : bilder;
    } catch {
      angebot.images = []; // Ohne Bilder geht es weiter; der Validator meldet es.
    }
    return { angebot, seitenOhneText: text.pagesNeedingOCR, seitenzahl: text.pageCount, erkannt: true };
  } finally {
    await pdf.cleanup?.();
  }
}
