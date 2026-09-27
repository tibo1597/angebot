// Text MIT Positionen aus dem PDF — Nachbau von PDFTextExtractor.swift auf pdf.js.
//
// Warum Positionen: „Listenpreis" und „Verkaufspreis" stehen nebeneinander,
// und Paketinhalte erkennt man nur an der Einrückung. Ohne x-Wert ginge beides nicht.
//
// Aufbau wie im Swift-Kern:
//   Fragment = zusammenhängender Text mit Rechteck (Wörter mit kleinem Abstand)
//   Zeile    = alle Fragmente auf derselben Grundlinie, links → rechts
//   Seite    = Zeilen von oben nach unten

/** Wörter mit mehr Abstand als ~eine Zeilenhöhe gehören in verschiedene Spalten. */
const SPALTENFAKTOR = 0.9;
/** Zeilen, deren Grundlinien näher als das beieinander liegen, sind eine sichtbare Zeile. */
const ZEILENTOLERANZ = 3.0;

export function zeilenText(zeile) {
  return zeile.fragments.map(f => f.text).join(' ');
}

const enthaelt = (text, teil) => text.toLocaleLowerCase('de').includes(teil.toLocaleLowerCase('de'));
export const gleich = (a, b) => a.toLocaleLowerCase('de') === b.toLocaleLowerCase('de');
export { enthaelt };

/** Eine Seite mit Hilfsfunktionen, wie ExtractedPage. */
export class Seite {
  constructor(index, breite, hoehe, lines) {
    this.index = index;
    this.size = { width: breite, height: hoehe };
    this.lines = lines;
  }
  get needsOCR() { return this.lines.length === 0; }
  get text() { return this.lines.map(zeilenText).join('\n'); }
  firstLine(teil) { return this.lines.find(z => enthaelt(zeilenText(z), teil)) ?? null; }
  linesAfter(ueberschrift, ende = []) {
    const start = this.lines.findIndex(z => enthaelt(zeilenText(z), ueberschrift));
    if (start < 0) return [];
    const rest = this.lines.slice(start + 1);
    if (!ende.length) return rest;
    const stop = rest.findIndex(z => ende.some(e => enthaelt(zeilenText(z), e)));
    return stop < 0 ? rest : rest.slice(0, stop);
  }
}

export class Dokument {
  constructor(pages, producer, creator) {
    this.pages = pages;
    this.producer = producer;
    this.creator = creator;
  }
  get text() { return this.pages.map(s => s.text).join('\n'); }
  get pageCount() { return this.pages.length; }
  get pagesNeedingOCR() { return this.pages.filter(s => s.needsOCR).map(s => s.index); }
  get allLines() { return this.pages.flatMap(s => s.lines); }
  page(i) { return this.pages.find(s => s.index === i) ?? null; }
  pageWithHeading(h) { return this.pages.find(s => s.lines.some(z => enthaelt(zeilenText(z), h))) ?? null; }
  firstLine(teil) { return this.allLines.find(z => enthaelt(zeilenText(z), teil)) ?? null; }
}

/**
 * @param pdf ein geladenes pdf.js-Dokument (getDocument(...).promise)
 */
export async function extrahiere(pdf) {
  const seiten = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const seite = await pdf.getPage(i);
    const [, , breite, hoehe] = seite.view;
    const inhalt = await seite.getTextContent();
    seiten.push(new Seite(i - 1, breite, hoehe, zeilenBilden(inhalt.items, i - 1)));
  }
  let producer = null, creator = null;
  try {
    const meta = await pdf.getMetadata();
    producer = meta?.info?.Producer ?? null;
    creator = meta?.info?.Creator ?? null;
  } catch { /* ohne Metadaten geht es auch */ }
  return new Dokument(seiten, producer, creator);
}

/** pdf.js liefert Textstücke; daraus werden Wörter mit geschätzter Lage. */
function woerterAus(items) {
  const woerter = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const [a, b, c, d, x, y] = it.transform;
    const groesse = Math.hypot(c, d) || it.height || 8;
    const breite = it.width || 0;
    const zeichen = [...it.str];
    // Breite je Zeichen gleichmäßig verteilen — genau genug für Spaltengrenzen.
    const proZeichen = zeichen.length ? breite / zeichen.length : 0;
    let lauf = null;
    const schliessen = ende => {
      if (lauf == null) return;
      const text = zeichen.slice(lauf, ende).join('');
      woerter.push({ text, x0: x + lauf * proZeichen, x1: x + ende * proZeichen, y, groesse });
      lauf = null;
    };
    zeichen.forEach((z, k) => {
      const leer = z === ' ' || z === '\t' || z === ' ';
      if (leer) schliessen(k); else if (lauf == null) lauf = k;
    });
    schliessen(zeichen.length);
  }
  return hochUndTiefgestellt(woerter);
}

/**
 * „CO₂" und „cm³" liegen im PDF als zwei Textstücke: die kleine Ziffer steht
 * direkt am Wort, aber etwas höher oder tiefer. Sie gehört ohne Leerzeichen
 * an das Wort davor — sonst findet der Parser „CO2 - Emissionen" nicht.
 */
function hochUndTiefgestellt(woerter) {
  const ergebnis = [];
  for (const w of woerter) {
    const vorher = ergebnis[ergebnis.length - 1];
    const kleiner = vorher && w.groesse < vorher.groesse * 0.85;
    const direktDran = vorher && Math.abs(w.x0 - vorher.x1) < 1.0;
    const naheHoehe = vorher && Math.abs(w.y - vorher.y) < vorher.groesse * 0.6;
    if (kleiner && direktDran && naheHoehe) {
      vorher.text += w.text;
      vorher.x1 = w.x1;
    } else {
      ergebnis.push(w);
    }
  }
  return ergebnis;
}

function zeilenBilden(items, pageIndex) {
  // Nach Zeilenmitte gruppieren, nicht nach Grundlinie: Die kleinen Bezeichner
  // im Briefkopf („Verkäufer" 6,5 pt) sitzen mittig neben dem Wert (10 pt),
  // ihre Grundlinie liegt knapp 4 pt höher. PDFKit sieht beides als eine Zeile.
  const mitte = w => w.y + 0.3 * w.groesse;
  const woerter = woerterAus(items).sort((p, q) => mitte(q) - mitte(p) || p.x0 - q.x0);
  const gruppen = [];
  for (const w of woerter) {
    const g = gruppen[gruppen.length - 1];
    const toleranz = g ? Math.max(ZEILENTOLERANZ, 0.3 * Math.max(g.groesse, w.groesse)) : 0;
    if (g && Math.abs(g.mitte - mitte(w)) <= toleranz) {
      g.woerter.push(w);
      if (w.groesse > g.groesse) { g.groesse = w.groesse; g.y = w.y; }
    } else {
      gruppen.push({ y: w.y, mitte: mitte(w), groesse: w.groesse, woerter: [w] });
    }
  }
  return gruppen.map(g => {
    const ws = g.woerter.sort((p, q) => p.x0 - q.x0);
    const fragmente = [];
    let akt = null;
    for (const w of ws) {
      const schwelle = Math.max(2.0, w.groesse * SPALTENFAKTOR);
      if (akt && w.x0 - akt.maxX <= schwelle) {
        akt.text += ' ' + w.text;
        akt.maxX = Math.max(akt.maxX, w.x1);
      } else {
        akt = { text: w.text, minX: w.x0, maxX: w.x1, pageIndex };
        fragmente.push(akt);
      }
    }
    return { fragments: fragmente, pageIndex, baseline: g.y };
  });
}
