// Erzeugt aus dem Angebotsmodell das einseitige Angebots-PDF.
// Getreuer Nachbau von OnePagerRenderer.swift, Blatt.swift und Symbole.swift.
//
// Drei Festlegungen (wie im Original):
// - Echte Vektoren, kein Abbild. Nur die Fahrzeugbilder sind Bilder.
// - Der Renderer kennt das Quell-PDF nicht, er sieht nur das Datenmodell.
// - Fehlt ein Wert, entfällt seine Zeile. Nichts wird geschätzt.

import {
  PDFDocument, rgb, LineCapStyle, LineJoinStyle,
  pushGraphicsState, popGraphicsState, setLineWidth, setLineCap, setLineJoin,
  setStrokingRgbColor, setFillingRgbColor, moveTo, lineTo, appendBezierCurve,
  closePath, stroke, fill, rectangle, clip, endPath, setCharacterSpacing,
} from '../vendor/pdf-lib.esm.min.js';
import fontkit from '../vendor/fontkit.es.min.js';
import * as Zahlen from './zahlen.js';
import {
  highlights, addressLine, displayName, isElectric, powerText,
  isWithoutDownPayment, isDisplayable, istFinanzierung, istGebraucht,
} from './modell.js';
import { analysiere } from './bildpunkte.js';

export const SEITENGROESSE = { breite: 595.276, hoehe: 841.89 };
const RAND = 32;
const PREISBLOCK_Y = 694;

// MARK: - Farben (aus dem Referenzbild ausgemessen)

const farbe = (r, g, b) => ({ r: r / 255, g: g / 255, b: b / 255 });
const Farben = {
  dunkelblau: farbe(0x00, 0x20, 0x48),
  akzentblau: farbe(0x00, 0x70, 0xC0),
  text: farbe(0x11, 0x11, 0x11),
  grauText: farbe(0x6B, 0x6B, 0x6B),
  hellgrau: farbe(0xDD, 0xDD, 0xDD),
  blauFlaeche: farbe(0xEC, 0xF4, 0xFB),
  grauFlaeche: farbe(0xF4, 0xF4, 0xF5),
  weiss: farbe(0xFF, 0xFF, 0xFF),
};
const alsRgb = f => rgb(f.r, f.g, f.b);

// MARK: - Schriften

// Helvetica Neue darf nicht mitgeliefert werden. Inter (OFL) kommt ihr nahe.
const SCHRIFTDATEIEN = {
  normal: '../vendor/fonts/Inter-Regular.ttf',
  mittel: '../vendor/fonts/Inter-Medium.ttf',
  fett: '../vendor/fonts/Inter-Bold.ttf',
  mager: '../vendor/fonts/Inter-Light.ttf',
};

let schriftBytes = null;
function ladeSchriften() {
  schriftBytes ??= Promise.all(Object.entries(SCHRIFTDATEIEN).map(async ([name, pfad]) =>
    [name, await ladeDatei(new URL(pfad, import.meta.url))]))
    .then(Object.fromEntries)
    .catch(fehler => { schriftBytes = null; throw fehler; });
  return schriftBytes;
}

async function ladeDatei(url) {
  if (url.protocol === 'file:') {
    const fs = await import('node:fs/promises');
    return new Uint8Array(await fs.readFile(url));
  }
  const antwort = await fetch(url);
  if (!antwort.ok) throw new Error(`Schrift nicht ladbar: ${url.pathname}`);
  return new Uint8Array(await antwort.arrayBuffer());
}

// MARK: - Zeilenmaße
//
// Das Original setzt Text mit CoreText und fester Zeilenhöhe (Größe ×
// Zeilenabstand). CoreText rundet dabei die erste Grundlinie und die
// Blockhöhe nach eigenen Regeln. Damit die Seite Punkt für Punkt gleich
// steht, liegen die Werte hier als Tabelle vor — von CoreText selbst
// gemessen, für jeden Stil, den der Einseiter benutzt:
// [Abstand erste Grundlinie von oben, [Blockhöhe bei 1…8 Zeilen]]

const ZEILENMASSE = {
  'fett|12.5|1.25': [12, [16, 32, 47, 63, 79, 94, 110, 125]],
  'normal|7.5|1.25': [7, [10, 19, 29, 38, 47, 57, 66, 75]],
  'normal|8.0|1.25': [8, [10, 20, 30, 40, 50, 60, 70, 80]],
  'mittel|10.5|1.25': [11, [14, 27, 40, 53, 66, 79, 92, 105]],
  'fett|8.2|1.25': [8, [11, 21, 31, 41, 52, 62, 72, 82]],
  'normal|7.8|1.3': [8, [11, 21, 31, 41, 51, 61, 71, 82]],
  'normal|6.8|1.25': [7, [9, 17, 26, 34, 43, 51, 60, 68]],
  'fett|8.4|1.25': [8, [11, 21, 32, 42, 53, 63, 74, 84]],
  'mittel|6.4|1.25': [6, [8, 16, 24, 32, 40, 48, 56, 64]],
  'fett|10.5|1.25': [11, [14, 27, 40, 53, 66, 79, 92, 105]],
  'normal|7.0|1.25': [7, [9, 18, 27, 35, 44, 53, 62, 70]],
  'normal|7.6|1.22': [7, [10, 19, 28, 38, 47, 56, 65, 75]],
  'normal|8.4|1.25': [8, [11, 21, 32, 42, 53, 63, 74, 84]],
  'fett|15.5|1.05': [14, [17, 33, 49, 66, 82, 98, 114, 131]],
  'fett|17.0|1.05': [15, [18, 36, 54, 72, 90, 108, 125, 143]],
  'fett|13.5|1.05': [12, [15, 29, 43, 57, 71, 86, 100, 114]],
  'fett|13.0|1.05': [12, [14, 28, 41, 55, 69, 82, 96, 110]],
  'fett|6.6|1.25': [7, [9, 17, 25, 33, 42, 50, 58, 66]],
  'normal|6.2|1.25': [6, [8, 16, 24, 31, 39, 47, 55, 62]],
  'normal|5.2|1.35': [6, [8, 15, 22, 29, 36, 43, 50, 57]],
  'normal|7.4|1.25': [7, [10, 19, 28, 37, 47, 56, 65, 74]],
  'fett|10.0|1.25': [10, [13, 25, 38, 50, 63, 75, 88, 100]],
  'fett|11.5|1.25': [12, [15, 29, 44, 58, 72, 87, 101, 115]],
  'normal|5.8|1.25': [6, [8, 15, 22, 29, 37, 44, 51, 58]],
  'mittel|7.4|1.25': [7, [10, 19, 28, 37, 47, 56, 65, 74]],
  'mittel|7.8|1.25': [8, [10, 20, 30, 39, 49, 59, 69, 78]],
  'normal|6.6|1.25': [7, [9, 17, 25, 33, 42, 50, 58, 66]],
  'fett|7.0|1.25': [7, [9, 18, 27, 35, 44, 53, 62, 70]],
  'normal|6.2|1.3': [7, [9, 17, 25, 33, 41, 49, 57, 65]],
  'fett|7.4|1.25': [7, [10, 19, 28, 37, 47, 56, 65, 74]],
  'fett|6.2|1.25': [6, [8, 16, 24, 31, 39, 47, 55, 62]],
  'fett|15.0|1.1': [14, [17, 33, 50, 66, 83, 99, 116, 132]],
  'fett|16.0|1.1': [15, [18, 36, 53, 71, 88, 106, 124, 141]],
  'fett|17.0|1.1': [16, [19, 38, 57, 75, 94, 113, 131, 150]],
  'fett|18.0|1.1': [17, [20, 41, 62, 83, 103, 124, 145, 166]],
  'fett|19.0|1.1': [18, [21, 43, 65, 87, 109, 131, 153, 175]],
  'fett|20.0|1.1': [19, [22, 45, 68, 91, 114, 137, 160, 183]],
  'fett|21.0|1.1': [19, [24, 48, 72, 96, 120, 144, 168, 192]],
  'fett|22.0|1.1': [20, [25, 50, 75, 100, 126, 151, 176, 201]],
  'fett|23.0|1.1': [21, [26, 52, 78, 105, 131, 157, 184, 210]],
  'fett|24.0|1.1': [22, [27, 54, 82, 109, 137, 164, 191, 219]],
  'fett|25.0|1.1': [23, [28, 56, 85, 113, 142, 170, 199, 227]],
  'fett|26.0|1.1': [24, [29, 59, 88, 118, 147, 177, 207, 236]],
  'fett|27.0|1.1': [25, [30, 61, 92, 122, 153, 184, 214, 245]],
};

// Für Stile außerhalb der Tabelle: Helvetica-Neue-Maße, CoreText-Regel nachgebildet.
const HELVETICA = {
  normal: { asc: 0.952, desc: 0.213 }, mager: { asc: 0.967, desc: 0.213 },
  mittel: { asc: 0.975, desc: 0.217 }, fett: { asc: 0.975, desc: 0.217 },
};

const zahlText = n => (Number.isInteger(n) ? n.toFixed(1) : String(n));

function zeilenmass(stil) {
  const L = stil.groesse * stil.zeilenabstand;
  const eintrag = ZEILENMASSE[`${stil.schrift}|${zahlText(stil.groesse)}|${zahlText(stil.zeilenabstand)}`];
  if (eintrag) {
    const [erste, hoehen] = eintrag;
    return { erste, vorschub: L, hoehe: n => (n <= hoehen.length ? hoehen[n - 1] : Math.ceil(n * L)) };
  }
  const m = HELVETICA[stil.schrift] ?? HELVETICA.normal;
  const s = stil.groesse;
  const gestaucht = L < (m.asc + m.desc) * s;
  const erste = gestaucht ? Math.floor(m.asc * s) : Math.floor(L - Math.round(m.desc * s));
  return { erste, vorschub: L, hoehe: n => Math.ceil(n * L) };
}

// MARK: - Textstil

function textstil(werte = {}) {
  return {
    schrift: 'normal', groesse: 9, farbe: Farben.text, laufweite: 0,
    ausrichtung: 'left', zeilenabstand: 1.25, versalien: false, ...werte,
  };
}

// MARK: - Blatt

/** Werkzeug zum Zeichnen. y wird von oben gemessen, wie im Original. */
class Blatt {
  constructor(seite, schriften) {
    this.seite = seite;
    this.schriften = schriften;
    this.H = SEITENGROESSE.hoehe;
    this.bilder = new Map();
  }

  y(vonOben) { return this.H - vonOben; }

  /** Rechteck aus von oben gemessenen Werten, als PDF-Rechteck. */
  kasten(x, vonOben, breite, hoehe) {
    return { x, y: this.H - (vonOben + hoehe), w: breite, h: hoehe };
  }

  // Flächen und Linien

  fuelle(r, f) {
    this.seite.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: alsRgb(f) });
  }

  fuelleOben(x, vonOben, breite, hoehe, f) {
    this.fuelle(this.kasten(x, vonOben, breite, hoehe), f);
  }

  rahmen(r, f, staerke = 0.5) {
    this.seite.drawRectangle({
      x: r.x, y: r.y, width: r.w, height: r.h, borderColor: alsRgb(f), borderWidth: staerke,
    });
  }

  linie(von, bis, f, staerke = 0.5) {
    this.seite.drawLine({
      start: { x: von.x, y: this.y(von.y) }, end: { x: bis.x, y: this.y(bis.y) },
      thickness: staerke, color: alsRgb(f),
    });
  }

  trennlinie(x, vonOben, breite, f, staerke = 0.5) {
    this.linie({ x, y: vonOben }, { x: x + breite, y: vonOben }, f, staerke);
  }

  // Text

  schrift(stil) { return this.schriften[stil.schrift] ?? this.schriften.normal; }

  breiteRoh(text, stil) {
    if (!text) return 0;
    return this.schrift(stil).widthOfTextAtSize(text, stil.groesse)
      + stil.laufweite * [...text].length;
  }

  /** Zeilen, wie sie in dieser Breite umbrechen. */
  umbrechen(inhalt, stil, breite) {
    const text = stil.versalien ? inhalt.toUpperCase() : inhalt;
    const zeilen = [];
    for (const absatz of text.split('\n')) {
      // Umbruchstellen: nach Leerzeichen und nach Bindestrichen zwischen Buchstaben.
      const stuecke = absatz.match(/[^\s-]*-(?=\p{L})|[^\s]*\s+|[^\s]+/gu) ?? [''];
      let zeile = '';
      for (const stueck of stuecke) {
        const versuch = zeile + stueck;
        if (zeile && this.breiteRoh(versuch.trimEnd(), stil) > breite + 0.01) {
          zeilen.push(zeile.trimEnd());
          zeile = '';
        }
        zeile += stueck;
        // Ein einzelnes Wort, breiter als die Zeile: zeichenweise brechen.
        while (this.breiteRoh(zeile.trimEnd(), stil) > breite + 0.01 && [...zeile.trimEnd()].length > 1) {
          const zeichen = [...zeile];
          let n = zeichen.length - 1;
          while (n > 1 && this.breiteRoh(zeichen.slice(0, n).join(''), stil) > breite + 0.01) n--;
          zeilen.push(zeichen.slice(0, n).join(''));
          zeile = zeichen.slice(n).join('');
        }
      }
      zeilen.push(zeile.trimEnd());
    }
    return zeilen;
  }

  /** Zeichnet einen Textblock und gibt seine Höhe zurück. */
  text(inhalt, stil, x, vonOben, breite, maxZeilen = 0) {
    if (inhalt == null || inhalt === '') return 0;
    const zeilen = this.umbrechen(String(inhalt), stil, breite);
    const mass = zeilenmass(stil);
    const hoehe = mass.hoehe(zeilen.length);
    const gezeigt = maxZeilen > 0 ? zeilen.slice(0, maxZeilen) : zeilen;
    const schrift = this.schrift(stil);

    if (stil.laufweite) this.seite.pushOperators(setCharacterSpacing(stil.laufweite));
    gezeigt.forEach((zeile, i) => {
      if (!zeile) return;
      const zeilenbreite = this.breiteRoh(zeile, stil);
      let zx = x;
      if (stil.ausrichtung === 'right') zx = x + breite - zeilenbreite;
      else if (stil.ausrichtung === 'center') zx = x + (breite - zeilenbreite) / 2;
      this.seite.drawText(zeile, {
        x: zx, y: this.y(vonOben + mass.erste + i * mass.vorschub),
        size: stil.groesse, font: schrift, color: alsRgb(stil.farbe),
      });
    });
    if (stil.laufweite) this.seite.pushOperators(setCharacterSpacing(0));
    return hoehe;
  }

  hoeheVon(inhalt, stil, breite) {
    if (inhalt == null || inhalt === '') return 0;
    return zeilenmass(stil).hoehe(this.umbrechen(String(inhalt), stil, breite).length);
  }

  /** Breite einer einzelnen Zeile. */
  breiteVon(inhalt, stil) {
    return Math.ceil(this.breiteRoh(stil.versalien ? inhalt.toUpperCase() : inhalt, stil));
  }

  // Bilder

  /**
   * Zeichnet ein Bild so groß wie möglich innerhalb des Rahmens — ohne zu
   * verzerren, ohne zu beschneiden. Weiße Ränder um das Fahrzeug sind vorher
   * abgeschnitten (siehe bildpunkte.js).
   */
  bild(eintrag, r) {
    if (!eintrag) return;
    const { pdfBild, zuschnitt } = eintrag;
    const verhaeltnis = zuschnitt.w / zuschnitt.h;
    const ziel = { ...r };
    if (r.w / r.h > verhaeltnis) {
      ziel.w = r.h * verhaeltnis;
      ziel.x = r.x + r.w / 2 - ziel.w / 2;
    } else {
      ziel.h = r.w / verhaeltnis;
      ziel.y = r.y + r.h / 2 - ziel.h / 2;
    }
    const massstab = ziel.w / zuschnitt.w;
    const ganzB = eintrag.breite * massstab;
    const ganzH = eintrag.hoehe * massstab;
    const bildX = ziel.x - zuschnitt.x * massstab;
    const bildY = ziel.y + ziel.h + zuschnitt.y * massstab - ganzH;

    const beschnitten = zuschnitt.w !== eintrag.breite || zuschnitt.h !== eintrag.hoehe;
    if (beschnitten) {
      this.seite.pushOperators(pushGraphicsState(), rectangle(ziel.x, ziel.y, ziel.w, ziel.h), clip(), endPath());
    }
    this.seite.drawImage(pdfBild, { x: bildX, y: bildY, width: ganzB, height: ganzH });
    if (beschnitten) this.seite.pushOperators(popGraphicsState());
  }
}

// MARK: - Bilder vorbereiten

async function bereiteBildVor(pdf, bild, { freistellen = true } = {}) {
  if (!bild?.data?.length) return null;
  // Immer als eigener Speicherblock: pdf-lib liest JPEG-Daten ab Offset 0 des
  // Puffers — ein Ausschnitt (subarray) würde als „SOI not found" scheitern.
  const daten = new Uint8Array(bild.data);
  const istPNG = bild.mime === 'image/png' || (daten[0] === 0x89 && daten[1] === 0x50);
  let pdfBild;
  try {
    pdfBild = istPNG ? await pdf.embedPng(daten) : await pdf.embedJpg(daten);
  } catch {
    return null;
  }
  const analyse = await analysiere(daten, istPNG ? 'image/png' : 'image/jpeg');
  const breite = analyse?.breite ?? pdfBild.width;
  const hoehe = analyse?.hoehe ?? pdfBild.height;
  // Gebrauchtwagen-Fotos haben einen echten Hintergrund. Ein Zuschnitt nach
  // „weißem Rand" könnte dort Himmel oder Hallenwand für Rand halten.
  const zuschnitt = (freistellen && analyse?.zuschnitt) || { x: 0, y: 0, w: breite, h: hoehe };
  return { pdfBild, breite, hoehe, zuschnitt, caption: bild.caption ?? null };
}

// MARK: - Einstieg

/** Rendert den Einseiter. Liefert die fertigen PDF-Bytes. */
export async function renderEinseiter(angebot) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(displayName(angebot.vehicle) ?? 'Fahrzeugangebot');
  pdf.setProducer('Angebot in einer Seite');
  pdf.setCreator('Angebot in einer Seite');

  const bytes = await ladeSchriften();
  const schriften = {};
  for (const [name, daten] of Object.entries(bytes)) {
    schriften[name] = await pdf.embedFont(daten, { subset: true });
  }

  const seite = pdf.addPage([SEITENGROESSE.breite, SEITENGROESSE.hoehe]);
  const blatt = new Blatt(seite, schriften);
  blatt.fuelle({ x: 0, y: 0, w: SEITENGROESSE.breite, h: SEITENGROESSE.hoehe }, Farben.weiss);

  const bilder = [];
  const freistellen = !istGebraucht(angebot);
  for (const b of angebot.images ?? []) bilder.push(await bereiteBildVor(pdf, b, { freistellen }));

  zeichne(angebot, blatt, bilder);
  return pdf.save();
}

function zeichne(a, blatt, bilder) {
  const breite = SEITENGROESSE.breite - 2 * RAND;
  kopf(a, blatt, 30, breite);
  mitte(a, blatt, 104, bilder);
  bildleiste(blatt, 376, breite, bilder);
  unten(a, blatt, 476);
  preisblock(a, blatt, PREISBLOCK_Y, breite);
  fussleiste(a, blatt, 772, breite);
}

// MARK: - Kopf

function kopf(a, blatt, y, breite) {
  const rechteBreite = 200;
  const linkeBreite = breite - rechteBreite - 16;

  // Rechts: Händler
  const rechtsX = SEITENGROESSE.breite - RAND - rechteBreite;
  let rechtsY = y;
  rechtsY += blatt.text(a.dealer.name, textstil({ schrift: 'fett', groesse: 12.5, ausrichtung: 'right' }),
    rechtsX, rechtsY, rechteBreite);
  rechtsY += 2;
  rechtsY += blatt.text(a.dealer.subtitle,
    textstil({ groesse: 7.5, farbe: Farben.grauText, ausrichtung: 'right' }), rechtsX, rechtsY, rechteBreite);
  rechtsY += 3;
  blatt.text(addressLine(a.dealer),
    textstil({ groesse: 7.5, farbe: Farben.grauText, ausrichtung: 'right' }), rechtsX, rechtsY, rechteBreite);

  // Links: Angebot, Fahrzeug, Variante
  let linksY = y;
  linksY += blatt.text(istGebraucht(a) ? 'Gebrauchtwagen-Angebot' : 'Angebot',
    textstil({ groesse: 8, farbe: Farben.grauText, laufweite: 1.6, versalien: true }), RAND, linksY, linkeBreite);
  linksY += 3;

  // Lange Modellnamen verkleinern die Überschrift, statt umzubrechen.
  const titel = displayName(a.vehicle) ?? 'Fahrzeugangebot';
  let groesse = 27;
  const stil = textstil({ schrift: 'fett', groesse, zeilenabstand: 1.1 });
  while (groesse > 15 && blatt.hoeheVon(titel, stil, linkeBreite) > groesse * 1.3) {
    groesse -= 1;
    stil.groesse = groesse;
  }
  linksY += blatt.text(titel, stil, RAND, linksY, linkeBreite, 2);
  linksY += 1;

  if (a.vehicle.variant != null) {
    linksY += blatt.text(a.vehicle.variant,
      textstil({ schrift: 'mittel', groesse: 10.5, farbe: Farben.grauText, laufweite: 0.4, versalien: true }),
      RAND, linksY, linkeBreite);
  }

  linksY += 7;
  blatt.fuelleOben(RAND, linksY, 44, 2.6, Farben.akzentblau);
}

// MARK: - Mitte: Eckdaten, Angebotskasten, großes Bild

function mitte(a, blatt, y, bilder) {
  const linkeBreite = 152;

  const kastenBreite = 158;
  const kastenX = SEITENGROESSE.breite - RAND - kastenBreite;
  angebotskasten(a, blatt, kastenX, y, kastenBreite);

  let linksY = y + 6;
  for (const eintrag of eckdaten(a)) {
    zeichneSymbol(blatt.seite, eintrag.symbol, blatt.kasten(RAND, linksY + 1, 13, 13), Farben.text);
    const textX = RAND + 20;
    const textBreite = linkeBreite - 20;
    let hoehe = blatt.text(eintrag.titel, textstil({ schrift: 'fett', groesse: 8.2 }), textX, linksY, textBreite);
    hoehe += blatt.text(eintrag.werte.join('\n'),
      textstil({ groesse: 7.8, farbe: Farben.grauText, zeilenabstand: 1.3 }), textX, linksY + hoehe, textBreite);
    linksY += Math.max(hoehe, 15) + 7;
  }

  // Großes Fahrzeugbild rechts, unterhalb des Angebotskastens
  const hauptbild = bilder[0];
  if (hauptbild) {
    const bildX = RAND + linkeBreite - 4;
    const bildBreite = SEITENGROESSE.breite - RAND - bildX;
    blatt.bild(hauptbild, blatt.kasten(bildX, y + 84, bildBreite, 178));
  }
}

function angebotskasten(a, blatt, x, y, breite) {
  const zeilen = [];
  const datum = Zahlen.datumsText(a.offer.offerDate);
  if (istGebraucht(a)) {
    if (a.offer.offerNumber != null) zeilen.push(['dokument', 'Fahrzeug-Nr.', a.offer.offerNumber]);
    if (datum) zeilen.push(['kalender', 'Angebotsdatum', datum]);
    const ez = monatJahr(a.vehicle.firstRegistration);
    if (ez) zeilen.push(['auto', 'Erstzulassung', ez]);
  } else {
    if (a.offer.offerNumber != null) zeilen.push(['dokument', 'Angebot Nr.', a.offer.offerNumber]);
    if (datum) zeilen.push(['kalender', 'Angebotsdatum', datum]);
    if (a.offer.customerNumber != null) zeilen.push(['person', 'Kundennummer', a.offer.customerNumber]);
  }
  if (!zeilen.length) return;

  const zeilenhoehe = 23;
  const hoehe = zeilen.length * zeilenhoehe + 12;
  blatt.rahmen(blatt.kasten(x, y, breite, hoehe), Farben.hellgrau);

  let zeileY = y + 7;
  for (const [symbol, titel, wert] of zeilen) {
    zeichneSymbol(blatt.seite, symbol, blatt.kasten(x + 9, zeileY + 3, 11, 11), Farben.grauText);
    const textBreite = breite - 36;
    blatt.text(titel, textstil({ groesse: 6.8, farbe: Farben.grauText, ausrichtung: 'right' }),
      x + 25, zeileY, textBreite);
    blatt.text(wert, textstil({ schrift: 'fett', groesse: 8.4, ausrichtung: 'right' }),
      x + 25, zeileY + 9, textBreite);
    zeileY += zeilenhoehe;
  }
}

/** Welche vier Eckdaten gezeigt werden, hängt am Antrieb. */
/** "2023-08-24" → "08/2023" */
function monatJahr(iso) {
  const t = iso ? String(iso).match(/^(\d{4})-(\d{2})/) : null;
  return t ? `${t[2]}/${t[1]}` : null;
}

/** Gebrauchtwagen: Leistung, Antriebsart, Historie — nur Belegtes. */
function eckdatenGebraucht(a) {
  const t = a.technicalData;
  const v = a.vehicle;
  const ergebnis = [];

  const antrieb = [];
  if (t.driveDescription != null) antrieb.push(t.driveDescription);
  const leistung = powerText(t);
  if (leistung) antrieb.push(leistung);
  const art = [t.fuelType, t.transmission].filter(w => w != null);
  if (art.length) antrieb.push(art.join(' · '));
  if (antrieb.length) ergebnis.push({ symbol: isElectric(t) ? 'stecker' : 'motor', titel: 'Antrieb', werte: antrieb });

  const historie = [];
  const km = Zahlen.ganzzahlText(v.mileageKM);
  if (km) historie.push(`${km} km`);
  const zweite = [];
  const ez = monatJahr(v.firstRegistration);
  if (ez) zweite.push(`EZ ${ez}`);
  if (v.previousOwners != null) zweite.push(`${v.previousOwners} Vorbesitzer`);
  if (zweite.length) historie.push(zweite.join(' · '));
  if (v.inspection != null) historie.push(`HU ${v.inspection}`);
  if (historie.length) ergebnis.push({ symbol: 'tacho', titel: 'Laufleistung', werte: historie });

  if (isElectric(t)) {
    const reichweite = Zahlen.ganzzahlText(t.electricRangeKM);
    if (reichweite) ergebnis.push({ symbol: 'akku', titel: 'Elektrische Reichweite (WLTP)', werte: [`bis zu ${reichweite} km`] });
    const laden = [];
    if (t.chargingACkW != null) laden.push(`AC-Laden bis zu ${t.chargingACkW} kW`);
    if (t.chargingDCkW != null) laden.push(`DC-Laden bis zu ${t.chargingDCkW} kW`);
    if (laden.length) ergebnis.push({ symbol: 'stecker', titel: 'Laden', werte: laden });
  }
  const verbrauch = Zahlen.zahl(t.consumptionCombined);
  if (verbrauch) ergebnis.push({ symbol: 'tropfen', titel: 'Verbrauch (WLTP)', werte: [`${verbrauch} l/100 km`] });
  const co2 = Zahlen.ganzzahlText(t.co2Combined);
  if (co2) ergebnis.push({ symbol: 'wolke', titel: 'CO₂ (WLTP)', werte: [`${co2} g/km`] });

  const ausstattung = [v.exteriorColor, v.interior].filter(w => w != null);
  if (ergebnis.length < 4 && ausstattung.length) {
    ergebnis.push({ symbol: 'auto', titel: 'Farbe und Polster', werte: ausstattung });
  }
  return ergebnis.slice(0, 4);
}

function eckdaten(a) {
  if (istGebraucht(a)) return eckdatenGebraucht(a);
  const t = a.technicalData;
  const ergebnis = [];

  const antrieb = [];
  if (t.driveDescription != null) antrieb.push(t.driveDescription);
  const leistung = powerText(t);
  if (leistung) antrieb.push(leistung);
  const motor = [];
  const hubraum = Zahlen.ganzzahlText(t.displacementCCM);
  if (hubraum) motor.push(`${hubraum} cm³`);
  if (t.cylinders != null) motor.push(`${t.cylinders} Zylinder`);
  if (motor.length) antrieb.push(motor.join(' · '));
  if (antrieb.length) ergebnis.push({ symbol: 'motor', titel: 'Antrieb', werte: antrieb });

  if (isElectric(t)) {
    const reichweite = Zahlen.ganzzahlText(t.electricRangeKM);
    if (reichweite) ergebnis.push({ symbol: 'akku', titel: 'Elektrische Reichweite (WLTP)', werte: [`bis zu ${reichweite} km`] });
    const laden = [];
    if (t.chargingACkW != null) laden.push(`AC-Laden bis zu ${t.chargingACkW} kW`);
    if (t.chargingDCkW != null) laden.push(`DC-Laden bis zu ${t.chargingDCkW} kW`);
    if (laden.length) ergebnis.push({ symbol: 'stecker', titel: 'Laden', werte: laden });
  } else {
    const verbrauch = Zahlen.zahl(t.consumptionCombined);
    if (verbrauch) ergebnis.push({ symbol: 'tropfen', titel: 'Verbrauch (WLTP)', werte: [`${verbrauch} l/100 km`] });
    const co2 = Zahlen.ganzzahlText(t.co2Combined);
    if (co2) ergebnis.push({ symbol: 'wolke', titel: 'CO₂ (WLTP)', werte: [`${co2} g/km`] });
  }

  if (t.transmission != null) ergebnis.push({ symbol: 'getriebe', titel: 'Getriebe', werte: [t.transmission] });

  // Kraftstoff und Antriebsart füllen die vierte Zeile, wenn kein Getriebe da ist.
  if (ergebnis.length < 4) {
    const angaben = [t.fuelType, t.drivetrain].filter(w => w != null);
    if (angaben.length) ergebnis.push({ symbol: 'zapfsaeule', titel: 'Kraftstoff', werte: angaben });
  }
  return ergebnis.slice(0, 4);
}

// MARK: - Bildleiste

function bildleiste(blatt, y, breite, bilder) {
  // Eingepasst, nie beschnitten — lieber etwas Weißraum in der Kachel.
  const kacheln = bilder.slice(1, 5).filter(Boolean);
  if (!kacheln.length) return;

  const abstand = 7;
  const kachelBreite = (breite - (kacheln.length - 1) * abstand) / kacheln.length;
  // Die Kachelhöhe richtet sich nach dem schmalsten Bild.
  const schmalstes = Math.min(...kacheln.map(k => k.zuschnitt.w / k.zuschnitt.h));
  const hatUnterschriften = kacheln.some(k => k.caption);
  // Abweichung vom Swift-Original: Dort ragte der 13 pt hohe Unterschriften-
  // balken bei voller Kachelhöhe (376 + 88 + 13) in die Highlights (ab 476).
  const hoechstens = hatUnterschriften ? 82 : 88;
  const bildhoehe = Math.min(Math.max(kachelBreite / schmalstes, 58), hoechstens);

  kacheln.forEach((kachel, i) => {
    const x = RAND + i * (kachelBreite + abstand);
    blatt.bild(kachel, blatt.kasten(x, y, kachelBreite, bildhoehe));
    if (hatUnterschriften) {
      blatt.fuelleOben(x, y + bildhoehe, kachelBreite, 13, Farben.dunkelblau);
      blatt.text(kachel.caption,
        textstil({ schrift: 'mittel', groesse: 6.4, farbe: Farben.weiss, laufweite: 0.8, ausrichtung: 'center', versalien: true }),
        x, y + bildhoehe + 3.6, kachelBreite);
    } else {
      blatt.rahmen(blatt.kasten(x, y, kachelBreite, bildhoehe), Farben.hellgrau, 0.4);
    }
  });
}

// MARK: - Highlights und Leasing

function unten(a, blatt, y) {
  const linkeBreite = 228;
  const rechteX = RAND + linkeBreite + 16;
  const rechteBreite = SEITENGROESSE.breite - RAND - rechteX;
  highlightsBlock(a, blatt, RAND, y, linkeBreite);
  const finanzierung = a.leasingOptions.find(l => istFinanzierung(l) && isDisplayable(l));
  if (finanzierung) finanzierungskasten(finanzierung, blatt, rechteX, y, rechteBreite);
  else leasingkasten(a, blatt, rechteX, y, rechteBreite);
}

/**
 * Finanzierung: große Monatsrate und — gleichrangig daneben — der effektive
 * Jahreszins (bei Kreditwerbung Pflichtangabe). Darunter die Eckwerte und das
 * Kleingedruckte. Das Kleingedruckte wird nie gekürzt: Reicht der Platz nicht,
 * entfallen zuerst die Eckwerte, dann wird die Schrift kleiner.
 */
function finanzierungskasten(f, blatt, x, y, breite) {
  const ohneAnzahlung = isWithoutDownPayment(f);
  const titel = ohneAnzahlung ? 'Finanzierungsangebot ohne Anzahlung' : 'Finanzierungsangebot';

  const kopfhoehe = 17;
  blatt.fuelleOben(x, y, breite, kopfhoehe, Farben.dunkelblau);
  blatt.text(titel,
    textstil({ schrift: 'fett', groesse: 8.2, farbe: Farben.weiss, laufweite: 0.6, ausrichtung: 'center', versalien: true }),
    x, y + 4.8, breite);

  let zeileY = y + kopfhoehe + 14;
  const kopfzeile = [
    f.durationMonths != null ? `${f.durationMonths} Monate` : null,
    f.annualMileage != null ? `${Zahlen.ganzzahlText(f.annualMileage)} km p.a.` : null,
  ].filter(Boolean).join(' · ');
  if (kopfzeile) {
    zeileY += blatt.text(kopfzeile, textstil({ schrift: 'fett', groesse: 8.4, ausrichtung: 'center', versalien: true }),
      x, zeileY, breite);
  }
  zeileY += 8;

  // Rate und effektiver Jahreszins — gleich groß, nebeneinander
  const rate = Zahlen.betrag(f.monthlyGross);
  // Zinssätze immer mit zwei Nachkommastellen, wie im Dokument („2,10 %").
  const prozent = w => `${Zahlen.betrag(w, false)} %`;
  const zins = f.effectiveRate != null ? prozent(f.effectiveRate) : null;
  const kaesten = [
    rate && [rate, 'Monatliche Rate', Farben.blauFlaeche, Farben.akzentblau],
    zins && [zins, 'Effektiver Jahreszins', Farben.grauFlaeche, Farben.text],
  ].filter(Boolean);
  const kastenHoehe = 40;
  const innen = 4;
  const kastenBreite = (breite - 2 * innen - (kaesten.length - 1) * 6) / kaesten.length;
  kaesten.forEach(([wert, bezeichnung, flaeche, schriftfarbe], i) => {
    const kx = x + innen + i * (kastenBreite + 6);
    blatt.fuelleOben(kx, zeileY, kastenBreite, kastenHoehe, flaeche);
    const stil = textstil({ schrift: 'fett', groesse: 15.5, farbe: schriftfarbe, ausrichtung: 'center', zeilenabstand: 1.05 });
    while (stil.groesse > 9 && blatt.breiteVon(wert, stil) > kastenBreite - 6) stil.groesse -= 0.5;
    blatt.text(wert, stil, kx, zeileY + 7 + (15.5 - stil.groesse) / 2, kastenBreite);
    blatt.text(bezeichnung,
      textstil({ schrift: 'mittel', groesse: 6.4, farbe: Farben.grauText, laufweite: 0.8, ausrichtung: 'center', versalien: true }),
      kx, zeileY + kastenHoehe - 11, kastenBreite);
  });
  if (kaesten.length) zeileY += kastenHoehe;

  // Eckwerte: Laufzeit · Anzahlung · Schlussrate (· Sollzins)
  const eckwerte = [];
  if (f.durationMonths != null) eckwerte.push(['Laufzeit', `${f.durationMonths} Monate`]);
  if (f.downPayment != null) eckwerte.push(['Anzahlung', Zahlen.betrag(f.downPayment)]);
  if (f.balloonPayment != null) eckwerte.push(['Schlussrate', Zahlen.betrag(f.balloonPayment)]);
  if (f.nominalRate != null && eckwerte.length < 4) eckwerte.push(['Sollzins p. a.', prozent(f.nominalRate)]);

  const etikettStil = textstil({ schrift: 'fett', groesse: 6.6, farbe: Farben.grauText, laufweite: 0.4, ausrichtung: 'center', versalien: true });
  const wertStil = textstil({ schrift: 'fett', groesse: 8.4, ausrichtung: 'center' });
  const eckHoehe = eckwerte.length ? 14 + zeilenmass(etikettStil).hoehe(1) + zeilenmass(wertStil).hoehe(1) : 0;

  const ende = PREISBLOCK_Y - 4;
  let kleinstil = textstil({ groesse: 5.2, farbe: Farben.grauText, zeilenabstand: 1.35 });
  const kleinHoehe = st => (f.disclaimer ? blatt.hoeheVon(f.disclaimer, st, breite) + 8 : 0);

  const mitEckwerten = zeileY + eckHoehe + kleinHoehe(kleinstil) <= ende;
  if (mitEckwerten && eckwerte.length) {
    zeileY += 12;
    const spalte = breite / eckwerte.length;
    eckwerte.forEach(([etikett, wert], i) => {
      const sx = x + i * spalte;
      if (i > 0) blatt.linie({ x: sx, y: zeileY }, { x: sx, y: zeileY + eckHoehe - 14 }, Farben.hellgrau);
      const h = blatt.text(etikett, etikettStil, sx + 2, zeileY, spalte - 4);
      blatt.text(wert, wertStil, sx + 2, zeileY + h, spalte - 4);
    });
    zeileY += eckHoehe - 12;
  }

  if (f.disclaimer) {
    // Vollständig — lieber kleiner als gekürzt.
    while (kleinstil.groesse > 4.2 && zeileY + kleinHoehe(kleinstil) > ende) {
      kleinstil = { ...kleinstil, groesse: +(kleinstil.groesse - 0.2).toFixed(1) };
    }
    blatt.text(f.disclaimer, kleinstil, x, zeileY + 8, breite);
  }
}

function highlightsBlock(a, blatt, x, y, breite) {
  const posten = highlights(a);
  if (!posten.length) return;

  let zeileY = y;
  const titelstil = textstil({ schrift: 'fett', groesse: 10.5, laufweite: 0.5, versalien: true });
  zeichneSymbol(blatt.seite, 'stern', blatt.kasten(x, zeileY + 1.5, 9.5, 9.5), Farben.akzentblau);
  const titelX = x + 13;
  const ueberschrift = blatt.text('Highlights', titelstil, titelX, zeileY, breite - 13);
  blatt.text('(Auswahl)', textstil({ groesse: 7, farbe: Farben.grauText }),
    titelX + blatt.breiteVon('HIGHLIGHTS', titelstil) + 5, zeileY + 3.4, 60);
  zeileY += ueberschrift + 7;

  const textX = x + 12;
  const textBreite = breite - 12;
  const stil = textstil({ groesse: 7.6, zeilenabstand: 1.22 });
  for (const p of posten) {
    const hoehe = blatt.text(p.name, stil, textX, zeileY, textBreite, 2);
    zeichneSymbol(blatt.seite, 'haken', blatt.kasten(x, zeileY + 1.4, 7.2, 7.2), Farben.akzentblau);
    zeileY += Math.max(hoehe, 9) + 2.6;
  }
}

function leasingkasten(a, blatt, x, y, breite) {
  const spalten = a.leasingOptions.filter(l => !istFinanzierung(l) && isDisplayable(l));
  if (!spalten.length) return;

  // „Ohne Anzahlung" nur, wenn die Sonderzahlung wirklich 0,00 € ist.
  const ohneAnzahlung = spalten.every(isWithoutDownPayment);
  const titel = ohneAnzahlung ? 'Leasingangebot ohne Anzahlung' : 'Leasingangebot';

  const kopfhoehe = 17;
  blatt.fuelleOben(x, y, breite, kopfhoehe, Farben.dunkelblau);
  blatt.text(titel,
    textstil({ schrift: 'fett', groesse: 8.2, farbe: Farben.weiss, laufweite: 0.6, ausrichtung: 'center', versalien: true }),
    x, y + 4.8, breite);

  // Abweichung vom Swift-Original: Dort begann jede Spalte dort, wo die
  // vorige endete — bei mehreren Varianten entstand eine Treppe, die in den
  // Preisblock lief. Hier starten alle Spalten auf derselben Höhe.
  const startY = y + kopfhoehe + 14;
  let inhaltY = startY;
  const spaltenBreite = breite / spalten.length;

  spalten.forEach((option, i) => {
    const spaltenX = x + i * spaltenBreite;
    let zeileY = startY;

    if (option.durationMonths != null) {
      zeileY += blatt.text(`${option.durationMonths} Monate`,
        textstil({ schrift: 'fett', groesse: 8.4, ausrichtung: 'center', versalien: true }),
        spaltenX, zeileY, spaltenBreite);
    }
    const km = Zahlen.ganzzahlText(option.annualMileage);
    if (km) {
      zeileY += blatt.text(`${km} km p.a.`,
        textstil({ groesse: 8.4, farbe: Farben.grauText, ausrichtung: 'center', versalien: true }),
        spaltenX, zeileY, spaltenBreite);
    }
    zeileY += 8;

    zeileY += ratenkaesten(blatt, spaltenX + 4, zeileY, spaltenBreite - 8, option.monthlyNet, option.monthlyGross);

    if (i > 0) {
      blatt.linie({ x: spaltenX, y: startY - 6 }, { x: spaltenX, y: zeileY + 4 }, Farben.hellgrau);
    }
    inhaltY = Math.max(inhaltY, zeileY);
  });

  let untenY = inhaltY + 18;
  const kleingedrucktes = spalten[0]?.disclaimer;
  const kleinstil = textstil({ groesse: 5.2, farbe: Farben.grauText, zeilenabstand: 1.35 });
  const kleinZeilen = kleingedrucktes
    ? Math.min(6, blatt.umbrechen(kleingedrucktes, kleinstil, breite).length) : 0;
  const kleinHoehe = kleinZeilen ? zeilenmass(kleinstil).hoehe(kleinZeilen) : 0;

  // Abweichung vom Swift-Original: Pflichtangaben vor Werbung. Reicht der
  // Platz bis zum Preisblock nicht für das vollständige Kleingedruckte (etwa
  // bei drei Varianten), entfallen die drei Merkposten — nicht der Rechtstext.
  const merkposten = vorteile(blatt, x, untenY, breite, spalten, false);
  const passtAlles = untenY + merkposten + 8 + kleinHoehe <= PREISBLOCK_Y - 4;
  if (passtAlles || !kleingedrucktes) {
    untenY += vorteile(blatt, x, untenY, breite, spalten, true);
  }

  if (kleingedrucktes) {
    const platz = PREISBLOCK_Y - 4 - (untenY + 8);
    const zeilen = Math.min(6, Math.floor(platz / (kleinstil.groesse * kleinstil.zeilenabstand)));
    if (zeilen > 0) blatt.text(kleingedrucktes, kleinstil, x, untenY + 8, breite, zeilen);
  }
}

/** Netto und brutto als Kästchen nebeneinander; zu schmal → untereinander. */
function ratenkaesten(blatt, x, y, breite, netto, brutto) {
  const nettoText = Zahlen.betrag(netto);
  const bruttoText = Zahlen.betrag(brutto);
  const vorhanden = [nettoText, bruttoText].filter(Boolean);
  if (!vorhanden.length) return 0;

  const nebeneinander = breite >= 130 && vorhanden.length === 2;
  const kastenBreite = nebeneinander ? (breite - 6) / 2 : breite;
  // Abweichung vom Swift-Original: In schmalen Spalten (mehrere Varianten)
  // berührte der 17-pt-Betrag die Beschriftung darunter.
  const schmal = breite < 130;
  const kastenHoehe = nebeneinander ? 40 : schmal ? 36 : 34;

  const kaestchen = (betrag, bezeichnung, kx, ky, flaeche, schriftfarbe, groesse) => {
    blatt.fuelleOben(kx, ky, kastenBreite, kastenHoehe, flaeche);
    // Abweichung vom Swift-Original: Passt der Betrag nicht in die Breite
    // (drei Varianten, vierstellige Rate), wird er kleiner statt umzubrechen.
    const stil = textstil({ schrift: 'fett', groesse, farbe: schriftfarbe, ausrichtung: 'center', zeilenabstand: 1.05 });
    while (stil.groesse > 9 && blatt.breiteVon(betrag, stil) > kastenBreite - 6) stil.groesse -= 0.5;
    blatt.text(betrag, stil, kx, ky + 7 + (groesse - stil.groesse) / 2, kastenBreite);
    blatt.text(bezeichnung,
      textstil({ schrift: 'mittel', groesse: 6.4, farbe: Farben.grauText, laufweite: 0.8, ausrichtung: 'center', versalien: true }),
      kx, ky + kastenHoehe - 11, kastenBreite);
  };

  let hoehe = 0;
  if (nettoText) {
    kaestchen(nettoText, 'Netto', x, y, Farben.blauFlaeche, Farben.akzentblau, nebeneinander ? 15.5 : schmal ? 15 : 17);
    hoehe = kastenHoehe;
  }
  if (bruttoText) {
    const zweiterX = nebeneinander ? x + kastenBreite + 6 : x;
    const zweiterY = nebeneinander ? y : y + hoehe + 5;
    kaestchen(bruttoText, 'Brutto', zweiterX, zweiterY, Farben.grauFlaeche, Farben.text, nebeneinander ? 13.5 : 13);
    hoehe = nebeneinander ? kastenHoehe : hoehe + 5 + kastenHoehe;
  }
  return hoehe;
}

/** Die drei Merkposten unter den Raten — nur, was im Dokument steht. */
function vorteile(blatt, x, y, breite, spalten, zeichnen = true) {
  const eintraege = [];
  if (spalten.every(isWithoutDownPayment)) {
    eintraege.push(['schild', 'Ohne Anzahlung', 'Sofort starten,\nohne Eigenkapital']);
  }
  const laufzeit = spalten[0]?.durationMonths;
  if (laufzeit != null) eintraege.push(['kalender', 'Laufzeit', `${laufzeit} Monate\nplanbare Monatsraten`]);
  if (spalten.length > 1) {
    eintraege.push(['tacho', 'Kilometerpakete', 'Wähle das passende\nkm-Paket für Deinen Bedarf']);
  } else {
    const km = Zahlen.ganzzahlText(spalten[0]?.annualMileage);
    if (km) eintraege.push(['tacho', 'Laufleistung', `${km} km pro Jahr\nvereinbart`]);
  }
  if (!eintraege.length) return 0;

  const spaltenBreite = breite / eintraege.length;
  let maximum = 0;
  const titelstil = textstil({ schrift: 'fett', groesse: 6.6, laufweite: 0.4, ausrichtung: 'center', versalien: true });
  const textstilGrau = textstil({ groesse: 6.2, farbe: Farben.grauText, ausrichtung: 'center', zeilenabstand: 1.25 });
  eintraege.forEach(([symbol, titel, text], i) => {
    const spaltenX = x + i * spaltenBreite;
    let hoehe = 19;
    if (!zeichnen) {
      hoehe += blatt.hoeheVon(titel, titelstil, spaltenBreite - 8);
      hoehe += blatt.hoeheVon(text, textstilGrau, spaltenBreite - 8);
      maximum = Math.max(maximum, hoehe);
      return;
    }
    zeichneSymbol(blatt.seite, symbol, blatt.kasten(spaltenX + spaltenBreite / 2 - 7, y, 14, 14), Farben.dunkelblau);
    hoehe += blatt.text(titel, titelstil, spaltenX + 4, y + hoehe, spaltenBreite - 8);
    hoehe += blatt.text(text, textstilGrau, spaltenX + 4, y + hoehe + 1, spaltenBreite - 8);
    maximum = Math.max(maximum, hoehe);
  });
  return maximum;
}

// MARK: - Preisblock

/** Gebrauchtwagen: ehemaliger Listenpreis, Preis groß, rechts der Nettopreis. */
function preisblockGebraucht(a, blatt, y, breite) {
  const p = a.pricing;
  const hoehe = 66;
  blatt.rahmen(blatt.kasten(RAND, y, breite, hoehe), Farben.hellgrau);

  const netto = Zahlen.betrag(p.netTotal);
  const ust = Zahlen.betrag(p.vat);
  const rechtsDa = Boolean(netto || ust);
  const linkeBreite = rechtsDa ? breite * 0.58 : breite;
  const innen = 10;
  const spaltenBreite = linkeBreite - 2 * innen;
  if (rechtsDa) {
    blatt.linie({ x: RAND + linkeBreite, y: y + 8 }, { x: RAND + linkeBreite, y: y + hoehe - 8 }, Farben.hellgrau);
  }

  let zeileY = y + 10;
  const listenpreis = Zahlen.betrag(p.grossListPrice);
  if (listenpreis) {
    blatt.text('Ehemaliger Listenpreis (Neuwagen)', textstil({ groesse: 7.4, farbe: Farben.grauText, laufweite: 0.3, versalien: true }),
      RAND + innen, zeileY, spaltenBreite);
    zeileY += blatt.text(listenpreis, textstil({ groesse: 7.4, farbe: Farben.grauText, ausrichtung: 'right' }),
      RAND + innen, zeileY, spaltenBreite) + 2.4;
  }

  const gesamt = Zahlen.betrag(p.grossTotal);
  if (gesamt) {
    zeileY = Math.max(zeileY + 2, y + 26);
    blatt.trennlinie(RAND + innen, zeileY, spaltenBreite, Farben.text, 0.9);
    zeileY += 5;
    zeichneSymbol(blatt.seite, 'euro', blatt.kasten(RAND + innen, zeileY + 2.2, 12, 12), Farben.akzentblau);
    blatt.text('Preis', textstil({ schrift: 'fett', groesse: 12, laufweite: 0.4, versalien: true }),
      RAND + innen + 17, zeileY, spaltenBreite - 17);
    const h = blatt.text(gesamt, textstil({ schrift: 'fett', groesse: 16, ausrichtung: 'right' }),
      RAND + innen, zeileY - 2, spaltenBreite);
    blatt.text('inkl. MwSt.', textstil({ groesse: 5.8, farbe: Farben.grauText, ausrichtung: 'right' }),
      RAND + innen, zeileY + h - 3, spaltenBreite);
  }

  if (!rechtsDa) return;
  const rechteX = RAND + linkeBreite + innen;
  const rechteSpalte = breite - linkeBreite - 2 * innen;
  let rechtsY = y + 14;
  if (netto) {
    blatt.text('Nettopreis', textstil({ schrift: 'mittel', groesse: 7.4, laufweite: 0.3, versalien: true }),
      rechteX, rechtsY, rechteSpalte);
    rechtsY += blatt.text(netto, textstil({ schrift: 'mittel', groesse: 7.8, ausrichtung: 'right' }),
      rechteX, rechtsY, rechteSpalte) + 7;
  }
  if (ust) {
    const satz = p.vatRate != null ? `Enthaltene Umsatzsteuer (${p.vatRate} %)` : 'Enthaltene Umsatzsteuer';
    blatt.text(satz, textstil({ groesse: 6.6, farbe: Farben.grauText }), rechteX, rechtsY, rechteSpalte);
    rechtsY += blatt.text(ust, textstil({ groesse: 6.8, ausrichtung: 'right' }), rechteX, rechtsY, rechteSpalte) + 7;
  } else if (p.vatDeductible) {
    blatt.text('MwSt. ausweisbar', textstil({ groesse: 6.6, farbe: Farben.grauText }), rechteX, rechtsY, rechteSpalte);
  }
}

function preisblock(a, blatt, y, breite) {
  if (istGebraucht(a)) return preisblockGebraucht(a, blatt, y, breite);
  const p = a.pricing;
  const hoehe = 66;
  blatt.rahmen(blatt.kasten(RAND, y, breite, hoehe), Farben.hellgrau);

  const linkeBreite = breite * 0.58;
  const rechteX = RAND + linkeBreite;
  blatt.linie({ x: rechteX, y: y + 8 }, { x: rechteX, y: y + hoehe - 8 }, Farben.hellgrau);

  const bezeichnungsstil = textstil({ groesse: 7.4, laufweite: 0.3, versalien: true });
  const betragsstil = textstil({ groesse: 7.4, ausrichtung: 'right' });
  const innen = 10;
  const spaltenBreite = linkeBreite - 2 * innen;

  let zeileY = y + 8;
  const zeile = (bezeichnung, betrag) => {
    const text = Zahlen.betrag(betrag);
    if (!text) return;
    blatt.text(bezeichnung, bezeichnungsstil, RAND + innen, zeileY, spaltenBreite);
    const h = blatt.text(text, betragsstil, RAND + innen, zeileY, spaltenBreite);
    zeileY += h + 2.4;
  };

  zeile('Bruttolistenpreis (BLP)', p.grossListPrice);
  zeile('Nachlass Modell und Ausstattung', p.discount);
  zeile('Zubehör', p.accessories);
  zeile('Händlerleistungen', p.dealerServices);

  const gesamt = Zahlen.betrag(p.grossTotal);
  if (gesamt) {
    zeileY += 2;
    blatt.trennlinie(RAND + innen, zeileY, spaltenBreite, Farben.text, 0.9);
    zeileY += 4;
    zeichneSymbol(blatt.seite, 'euro', blatt.kasten(RAND + innen, zeileY + 1.2, 10.5, 10.5), Farben.akzentblau);
    blatt.text('Gesamtpreis', textstil({ schrift: 'fett', groesse: 10, laufweite: 0.3, versalien: true }),
      RAND + innen + 14, zeileY, spaltenBreite - 14);
    const h = blatt.text(gesamt, textstil({ schrift: 'fett', groesse: 11.5, ausrichtung: 'right' }),
      RAND + innen, zeileY - 1, spaltenBreite);
    blatt.text('inkl. MwSt.', textstil({ groesse: 5.8, farbe: Farben.grauText, ausrichtung: 'right' }),
      RAND + innen, zeileY + h - 1, spaltenBreite);
  }

  // Rechte Spalte: netto und Steuer
  const rechteInnenX = rechteX + innen;
  const rechteSpalte = breite - linkeBreite - 2 * innen;
  let rechtsY = y + 14;

  const nettoZeile = (bezeichnung, betrag, fett) => {
    const text = Zahlen.betrag(betrag);
    if (!text) return;
    blatt.text(bezeichnung, textstil({
      schrift: fett ? 'mittel' : 'normal', groesse: fett ? 7.4 : 6.6,
      farbe: fett ? Farben.text : Farben.grauText, laufweite: fett ? 0.3 : 0, versalien: fett,
    }), rechteInnenX, rechtsY, rechteSpalte);
    const h = blatt.text(text, textstil({
      schrift: fett ? 'mittel' : 'normal', groesse: fett ? 7.8 : 6.8, ausrichtung: 'right',
    }), rechteInnenX, rechtsY, rechteSpalte);
    rechtsY += h + 7;
  };

  nettoZeile('Netto-Gesamtsumme', p.netTotal, true);
  const satz = p.vatRate != null ? `Enthaltene Umsatzsteuer (${p.vatRate} %)` : 'Enthaltene Umsatzsteuer';
  nettoZeile(satz, p.vat, false);
}

// MARK: - Fußleiste

function fussleiste(a, blatt, y, breite) {
  const hoehe = 36;
  blatt.fuelleOben(RAND, y, breite, hoehe, Farben.dunkelblau);

  const spalten = breite / 3;
  const titelstil = textstil({ schrift: 'fett', groesse: 7, farbe: Farben.weiss, laufweite: 0.5, versalien: true });
  const textstilWeiss = textstil({ groesse: 6.2, farbe: Farben.weiss, zeilenabstand: 1.3 });

  // Links
  zeichneSymbol(blatt.seite, 'person', blatt.kasten(RAND + 10, y + 11, 14, 14), Farben.weiss);
  blatt.text('Ihr Ansprechpartner', titelstil, RAND + 30, y + 9, spalten - 40);
  blatt.text('Für Rückfragen zu diesem Angebot', textstilWeiss, RAND + 30, y + 18, spalten - 36);

  // Mitte: Verkäufer
  const mitteX = RAND + spalten;
  if (a.dealer.contactPerson != null) {
    blatt.text(a.dealer.contactPerson, textstil({ schrift: 'fett', groesse: 7.4, farbe: Farben.weiss }),
      mitteX + 20, y + 8, spalten - 26);
    let zeileY = y + 17;
    if (a.dealer.contactPhone != null) {
      zeichneSymbol(blatt.seite, 'telefon', blatt.kasten(mitteX + 20, zeileY + 0.5, 6.5, 6.5), Farben.weiss);
      zeileY += blatt.text(a.dealer.contactPhone, textstilWeiss, mitteX + 30, zeileY, spalten - 36);
    }
    if (a.dealer.contactEmail != null) {
      zeichneSymbol(blatt.seite, 'brief', blatt.kasten(mitteX + 20, zeileY + 1, 6.5, 6.5), Farben.weiss);
      blatt.text(a.dealer.contactEmail, textstilWeiss, mitteX + 30, zeileY, spalten - 36);
    }
  }

  // Rechts: belegte Fahrzeugdaten statt eines erfundenen Slogans
  const rechtsX = RAND + 2 * spalten;
  zeichneSymbol(blatt.seite, 'auto', blatt.kasten(rechtsX + 6, y + 12, 16, 12), Farben.weiss);
  blatt.text('Fahrzeug', titelstil, rechtsX + 28, y + 9, spalten - 34);
  const kennung = a.vehicle.vin != null ? `FIN ${a.vehicle.vin}`
    : istGebraucht(a) && a.offer.offerNumber != null ? `Fahrzeug-Nr. ${a.offer.offerNumber}` : null;
  const fahrzeugzeilen = [kennung, a.vehicle.exteriorColor].filter(w => w != null);
  if (fahrzeugzeilen.length) {
    blatt.text(fahrzeugzeilen.join('\n'), textstilWeiss, rechtsX + 28, y + 18, spalten - 32);
  }

  abschlusszeile(a, blatt, y + hoehe + 7, breite);
}

/** Die Zeile ganz unten: je Angabe ein Symbol, alles mittig. */
function abschlusszeile(a, blatt, y, breite) {
  const teile = [];
  if (a.dealer.name != null) teile.push([null, a.dealer.name]);
  const anschrift = addressLine(a.dealer);
  if (anschrift) teile.push(['ort', anschrift]);
  if (a.dealer.phone != null) teile.push(['telefon', a.dealer.phone]);
  if (a.dealer.fax != null) teile.push(['drucker', a.dealer.fax]);
  if (a.dealer.website != null) teile.push(['netz', a.dealer.website]);
  if (!teile.length) return;

  const namensstil = textstil({ schrift: 'fett', groesse: 6.2, farbe: Farben.grauText });
  const stil = textstil({ groesse: 6.2, farbe: Farben.grauText });
  const symbolbreite = 6, symbolabstand = 3, zwischenraum = 11;

  let gesamt = 0;
  teile.forEach(([symbol, text], i) => {
    if (symbol) gesamt += symbolbreite + symbolabstand;
    gesamt += blatt.breiteVon(text, i === 0 ? namensstil : stil);
    if (i < teile.length - 1) gesamt += zwischenraum;
  });

  let x = RAND + (breite - gesamt) / 2;
  teile.forEach(([symbol, text], i) => {
    if (symbol) {
      zeichneSymbol(blatt.seite, symbol, blatt.kasten(x, y + 0.4, symbolbreite, symbolbreite), Farben.grauText);
      x += symbolbreite + symbolabstand;
    }
    const eigenerStil = i === 0 ? namensstil : stil;
    const textbreite = blatt.breiteVon(text, eigenerStil);
    blatt.text(text, eigenerStil, x, y, textbreite + 2);
    x += textbreite + zwischenraum;
  });
}

// MARK: - Symbole
//
// Als Vektoren gezeichnet, in PDF-Koordinaten (y nach oben) — wie Symbole.swift.

const K = 0.5522847498; // Bézier-Näherung für Viertelkreise

class Pfad {
  constructor() { this.ops = []; this.offen = false; }
  zu(x, y) { this.ops.push(moveTo(x, y)); this.offen = true; return this; }
  linie(x, y) { this.ops.push(this.offen ? lineTo(x, y) : moveTo(x, y)); this.offen = true; return this; }
  kurve(c1x, c1y, c2x, c2y, x, y) { this.ops.push(appendBezierCurve(c1x, c1y, c2x, c2y, x, y)); return this; }
  schliessen() { this.ops.push(closePath()); return this; }

  /** Ellipse gegen den Uhrzeigersinn, als eigener Teilpfad. */
  ellipse(r) {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2;
    this.zu(cx + rx, cy);
    this.kurve(cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry);
    this.kurve(cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy);
    this.kurve(cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry);
    this.kurve(cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy);
    this.schliessen();
    return this;
  }

  /** Rechteck gegen den Uhrzeigersinn, als eigener Teilpfad. */
  rechteck(x, y, w, h) {
    this.zu(x, y).linie(x + w, y).linie(x + w, y + h).linie(x, y + h).schliessen();
    return this;
  }

  /** Bogen wie CGContext.addArc(clockwise: false): Winkel steigen. */
  bogen(cx, cy, radius, start, ende) {
    while (ende < start) ende += 2 * Math.PI;
    const schritte = Math.max(1, Math.ceil((ende - start) / (Math.PI / 2)));
    const d = (ende - start) / schritte;
    const k = (4 / 3) * Math.tan(d / 4);
    this.linie(cx + radius * Math.cos(start), cy + radius * Math.sin(start));
    for (let i = 0; i < schritte; i++) {
      const a = start + i * d, b = a + d;
      const x0 = cx + radius * Math.cos(a), y0 = cy + radius * Math.sin(a);
      const x3 = cx + radius * Math.cos(b), y3 = cy + radius * Math.sin(b);
      this.kurve(x0 - k * radius * Math.sin(a), y0 + k * radius * Math.cos(a),
        x3 + k * radius * Math.sin(b), y3 - k * radius * Math.cos(b), x3, y3);
    }
    return this;
  }
}

function zeichneSymbol(seite, art, rahmen, f) {
  const ops = [
    pushGraphicsState(),
    setStrokingRgbColor(f.r, f.g, f.b),
    setFillingRgbColor(f.r, f.g, f.b),
    setLineWidth(Math.max(0.7, rahmen.w * 0.075)),
    setLineJoin(LineJoinStyle.Round),
    setLineCap(LineCapStyle.Round),
  ];
  const r = {
    x: rahmen.x + rahmen.w * 0.1, y: rahmen.y + rahmen.h * 0.1,
    w: rahmen.w * 0.8, h: rahmen.h * 0.8,
  };
  const minX = r.x, minY = r.y, maxX = r.x + r.w, maxY = r.y + r.h;
  const midX = r.x + r.w / 2, midY = r.y + r.h / 2;
  const W = r.w, H = r.h;

  const zieh = pfad => ops.push(...pfad.ops, stroke());
  const fuell = pfad => ops.push(...pfad.ops, fill());
  const rahmenRechteck = (x, y, w, h) => zieh(new Pfad().rechteck(x, y, w, h));
  const flaeche = (x, y, w, h) => fuell(new Pfad().rechteck(x, y, w, h));
  const strich = (x0, y0, x1, y1) => zieh(new Pfad().zu(x0, y0).linie(x1, y1));
  const weiss = breite => ops.push(setStrokingRgbColor(1, 1, 1), setLineWidth(breite));

  switch (art) {
    case 'motor': {
      rahmenRechteck(minX, minY, W * 0.62, H * 0.62);
      rahmenRechteck(minX + W * 0.14, minY + H * 0.62, W * 0.34, H * 0.2);
      zieh(new Pfad().zu(minX + W * 0.62, minY + H * 0.2).linie(maxX, minY + H * 0.2)
        .linie(maxX, minY + H * 0.46).linie(minX + W * 0.62, minY + H * 0.46));
      for (let i = 0; i < 3; i++) {
        const x = minX + W * (0.2 + i * 0.14);
        strich(x, minY + H * 0.82, x, maxY);
      }
      break;
    }
    case 'akku':
      rahmenRechteck(minX, minY + H * 0.18, W * 0.9, H * 0.64);
      flaeche(minX + W * 0.9, minY + H * 0.38, W * 0.1, H * 0.24);
      flaeche(minX + W * 0.12, minY + H * 0.3, W * 0.42, H * 0.4);
      break;
    case 'getriebe': {
      const radius = Math.min(W, H) * 0.3;
      zieh(new Pfad().ellipse({ x: midX - radius, y: midY - radius, w: radius * 2, h: radius * 2 }));
      for (let i = 0; i < 4; i++) {
        const w = i * Math.PI / 2 + Math.PI / 4;
        strich(midX + Math.cos(w) * radius, midY + Math.sin(w) * radius,
          midX + Math.cos(w) * radius * 1.55, midY + Math.sin(w) * radius * 1.55);
      }
      break;
    }
    case 'stecker':
      zieh(new Pfad().zu(minX + W * 0.28, maxY).linie(minX + W * 0.28, midY + H * 0.1)
        .zu(minX + W * 0.62, maxY).linie(minX + W * 0.62, midY + H * 0.1));
      rahmenRechteck(minX + W * 0.12, minY + H * 0.28, W * 0.66, H * 0.34);
      strich(midX - W * 0.05, minY + H * 0.28, midX - W * 0.05, minY);
      break;
    case 'tropfen':
      zieh(new Pfad().zu(midX, maxY)
        .kurve(maxX, midY + H * 0.15, maxX - W * 0.1, minY, midX, minY)
        .kurve(minX + W * 0.1, minY, minX, midY + H * 0.15, midX, maxY));
      break;
    case 'wolke': {
      // Eine gefüllte Fläche aus überlappenden Kreisen plus Sockel.
      const sockel = minY + H * 0.3;
      fuell(new Pfad()
        .ellipse({ x: minX, y: sockel - H * 0.06, w: W * 0.44, h: H * 0.44 })
        .ellipse({ x: minX + W * 0.24, y: sockel + H * 0.02, w: W * 0.5, h: H * 0.5 })
        .ellipse({ x: maxX - W * 0.42, y: sockel - H * 0.04, w: W * 0.42, h: H * 0.42 })
        .rechteck(minX + W * 0.1, sockel, W * 0.8, H * 0.2));
      break;
    }
    case 'haken':
      // Gefüllter Kreis mit weißem Haken
      fuell(new Pfad().ellipse(r));
      weiss(Math.max(0.9, W * 0.13));
      zieh(new Pfad().zu(minX + W * 0.26, minY + H * 0.52).linie(minX + W * 0.44, minY + H * 0.32)
        .linie(minX + W * 0.76, minY + H * 0.68));
      break;
    case 'dokument':
      rahmenRechteck(minX + W * 0.15, minY, W * 0.7, H);
      for (let i = 0; i < 3; i++) {
        const h = minY + H * (0.28 + i * 0.2);
        strich(minX + W * 0.3, h, minX + W * 0.7, h);
      }
      break;
    case 'kalender':
      rahmenRechteck(minX, minY, W, H * 0.82);
      zieh(new Pfad().zu(minX, minY + H * 0.6).linie(maxX, minY + H * 0.6)
        .zu(minX + W * 0.25, minY + H * 0.72).linie(minX + W * 0.25, maxY)
        .zu(minX + W * 0.75, minY + H * 0.72).linie(minX + W * 0.75, maxY));
      break;
    case 'person': {
      const kopf = Math.min(W, H) * 0.28;
      zieh(new Pfad().ellipse({ x: midX - kopf, y: maxY - kopf * 2, w: kopf * 2, h: kopf * 2 }));
      zieh(new Pfad().bogen(midX, minY + H * 0.05, W * 0.42, 0, Math.PI));
      break;
    }
    case 'schild':
      zieh(new Pfad().zu(midX, maxY).linie(maxX, maxY - H * 0.25).linie(maxX, minY + H * 0.3)
        .linie(midX, minY).linie(minX, minY + H * 0.3).linie(minX, maxY - H * 0.25).schliessen());
      break;
    case 'tacho':
      zieh(new Pfad().ellipse(r));
      strich(midX, midY, midX + W * 0.28, midY + H * 0.24);
      break;
    case 'zapfsaeule':
      rahmenRechteck(minX, minY, W * 0.56, H);
      strich(minX + W * 0.1, minY + H * 0.6, minX + W * 0.46, minY + H * 0.6);
      zieh(new Pfad().zu(minX + W * 0.56, minY + H * 0.5).linie(maxX, minY + H * 0.5)
        .linie(maxX, minY + H * 0.18));
      break;
    case 'telefon':
      zieh(new Pfad().zu(minX + W * 0.1, maxY - H * 0.12).linie(minX + W * 0.34, maxY - H * 0.34)
        .linie(minX + W * 0.5, midY - H * 0.06).linie(maxX - W * 0.16, minY + H * 0.22).linie(maxX, minY));
      break;
    case 'brief':
      rahmenRechteck(minX, minY + H * 0.18, W, H * 0.64);
      zieh(new Pfad().zu(minX, minY + H * 0.82).linie(midX, midY).linie(maxX, minY + H * 0.82));
      break;
    case 'netz':
      zieh(new Pfad().ellipse(r));
      strich(minX, midY, maxX, midY);
      zieh(new Pfad().ellipse({ x: midX - W * 0.22, y: minY, w: W * 0.44, h: H }));
      break;
    case 'stern': {
      const aussen = Math.min(W, H) * 0.5;
      const innen = aussen * 0.42;
      const p = new Pfad();
      for (let i = 0; i < 10; i++) {
        const w = -Math.PI / 2 + i * Math.PI / 5;
        const rad = i % 2 === 0 ? aussen : innen;
        const x = midX + Math.cos(w) * rad, y = midY + Math.sin(w) * rad;
        if (i === 0) p.zu(x, y); else p.linie(x, y);
      }
      fuell(p.schliessen());
      break;
    }
    case 'etikett': {
      const spitze = W * 0.34;
      zieh(new Pfad().zu(minX, midY).linie(minX + spitze, maxY).linie(maxX, maxY).linie(maxX, minY)
        .linie(minX + spitze, minY).schliessen());
      fuell(new Pfad().ellipse({ x: minX + spitze + W * 0.06, y: midY - H * 0.11, w: W * 0.22, h: H * 0.22 }));
      break;
    }
    case 'euro':
      // Gefüllte Münze mit weißem €
      fuell(new Pfad().ellipse(r));
      weiss(Math.max(0.8, W * 0.1));
      zieh(new Pfad().bogen(midX + W * 0.07, midY, W * 0.25, Math.PI / 3, Math.PI * 5 / 3));
      for (const versatz of [-0.08, 0.08]) {
        strich(minX + W * 0.16, midY + H * versatz, midX + W * 0.2, midY + H * versatz);
      }
      break;
    case 'ort':
      zieh(new Pfad().bogen(midX, minY + H * 0.66, W * 0.36, Math.PI * 1.75, Math.PI * 1.25)
        .linie(midX, minY).schliessen());
      zieh(new Pfad().ellipse({ x: midX - W * 0.12, y: minY + H * 0.56, w: W * 0.24, h: H * 0.24 }));
      break;
    case 'drucker':
      rahmenRechteck(minX, minY + H * 0.28, W, H * 0.38);
      rahmenRechteck(minX + W * 0.2, minY + H * 0.66, W * 0.6, H * 0.28);
      rahmenRechteck(minX + W * 0.2, minY, W * 0.6, H * 0.28);
      break;
    case 'auto':
      zieh(new Pfad().zu(minX, minY + H * 0.32).linie(minX + W * 0.16, minY + H * 0.32)
        .linie(minX + W * 0.3, minY + H * 0.66).linie(maxX - W * 0.22, minY + H * 0.66)
        .linie(maxX, minY + H * 0.32).linie(maxX, minY + H * 0.18).linie(minX, minY + H * 0.18).schliessen());
      for (const x of [minX + W * 0.26, maxX - W * 0.26]) {
        zieh(new Pfad().ellipse({ x: x - W * 0.09, y: minY + H * 0.06, w: W * 0.18, h: H * 0.18 }));
      }
      break;
    default:
      break;
  }

  ops.push(popGraphicsState());
  seite.pushOperators(...ops);
}
