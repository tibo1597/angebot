// Liest Angebote aus dem BMW-Händlersystem OFCO (Faba Autowelt) — Nachbau von BMWFabaParser.swift.
//
// Das Dokument besteht aus drei aneinandergehängten Teilen mit eigener Seitenzählung.
// Deshalb wird NIE über Seitennummern navigiert, sondern über Abschnittsüberschriften.

import * as Zahlen from './zahlen.js';
import { leeresAngebot, leereLeasingOption, isDisplayable } from './modell.js';
import { zeilenText, enthaelt, gleich } from './extraktor.js';
import { waehlen } from './highlights.js';

// Spaltengrenzen: links Codes, Mitte Bezeichnungen, rechts Beträge.
const CODE_SPALTE_BIS = 100;
const BETRAG_SPALTE_AB = 400;
/** Bezeichnungen beginnen bei x ≈ 104; Paketinhalte sind eingerückt auf ≈ 119. */
const EINRUECKUNG_AB = 112;

const trim = t => t.trim();
const erstes = z => z.fragments[0] ?? null;
const letztes = z => z.fragments[z.fragments.length - 1] ?? null;

export const BMWFabaParser = {
  name: 'BMW Faba',

  canHandle(doc) {
    const vonOFCO = (doc.creator ?? '').toLowerCase().includes('ofco');
    const hatBMWKopf = doc.pages.slice(0, 2).some(s =>
      s.lines.slice(0, 6).some(z => enthaelt(zeilenText(z), 'BMW Vertragshändler')));
    return vonOFCO || hatBMWKopf;
  },

  /** Der Angebotsteil endet, wo Leasingbeispiel oder Energielabel beginnen. */
  imagePages(doc) {
    const schluss = ['Leasingbeispiel der BMW Bank', 'Information über den Energieverbrauch',
                     'BMW Financial Services'];
    const grenze = doc.pages.findIndex(s =>
      schluss.some(m => s.lines.some(z => enthaelt(zeilenText(z), m))));
    const bis = grenze < 0 ? doc.pageCount : grenze;
    return [...Array(bis).keys()];
  },

  parse(doc) {
    const a = leeresAngebot();
    const deckblatt = doc.pages[0];
    if (!deckblatt) return a;

    a.dealer = haendler(deckblatt, doc);
    a.offer = angebotsdaten(deckblatt);
    a.vehicle = fahrzeug(deckblatt, doc);
    a.pricing = preise(deckblatt, doc);
    a.technicalData = technik(doc);
    a.leasingOptions = leasing(doc);
    a.equipment = ausstattung(doc);

    // Farbe, Räder und Interieur stehen in der Ausstattung und gehören zugleich ins Fahrzeug.
    a.vehicle.exteriorColor = a.equipment.find(p => p.category === 'exterior' && istFarbe(p.name))?.name
      ?? a.vehicle.exteriorColor;
    a.vehicle.wheels = a.equipment.find(p => p.category === 'exterior' && istRad(p.name))?.name ?? null;
    a.vehicle.interior = a.equipment.find(p => p.category === 'interior' && istPolster(p.name))?.name ?? null;

    a.highlightCodes = waehlen(a.equipment).map(p => p.code);
    return a;
  },
};

// MARK: Händler

function haendler(seite, doc) {
  const h = leeresAngebot().dealer;
  h.name = seite.lines[0] ? zeilenText(seite.lines[0]) : null;
  h.subtitle = seite.lines.slice(0, 5).map(zeilenText).find(t => enthaelt(t, 'Vertragshändler')) ?? null;

  // „Krefelder Str. 570, 41066 Mönchengladbach"
  const anschrift = seite.lines.map(zeilenText).find(t => /^.+,\s*\d{5}\s+\S/.test(t));
  if (anschrift) {
    const k = anschrift.lastIndexOf(',');
    h.street = trim(anschrift.slice(0, k));
    const ort = trim(anschrift.slice(k + 1));
    const plz = ort.match(/^\d{5}/);
    if (plz) {
      h.postalCode = plz[0];
      h.city = trim(ort.slice(5));
    }
  }

  // Fußspalte des Briefbogens: Bezeichner und Wert untereinander.
  // „Telefon" steht zweimal links — unterschieden wird über die Gestalt des Werts.
  h.phone = wertUnterBezeichner('Telefon', seite, istRufnummer);
  h.fax = wertUnterBezeichner('Fax', seite, istRufnummer);
  h.website = wertUnterBezeichner('Internet', seite, istAdresseImNetz);

  // Der Verkäufer steht im Kopf, Bezeichner links, Wert rechts daneben.
  h.contactPerson = wertNebenBezeichner('Verkäufer', seite);
  h.contactPhone = wertNebenBezeichner('Telefon', seite);
  h.contactEmail = wertNebenBezeichner('E-Mail', seite)
    ?? doc.allLines.map(z => zeilenText(z).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0])
      .find(Boolean) ?? null;
  return h;
}

// MARK: Angebotskopf

function angebotsdaten(seite) {
  const d = leeresAngebot().offer;
  const z = seite.firstLine('Angebot Nr.');
  if (z) {
    const t = zeilenText(z);
    d.offerNumber = gruppe(/Angebot\s+Nr\.\s*(\S+)/is, t);
    d.offerDate = Zahlen.datum(t);
  }
  d.customerNumber = wertNebenBezeichner('Kundennummer', seite);
  d.printDate = Zahlen.datum(wertNebenBezeichner('Druckdatum', seite));
  return d;
}

// MARK: Fahrzeug

function fahrzeug(seite, doc) {
  const f = leeresAngebot().vehicle;
  // „M4 Coupé (11HK; Neuwagen)" — der Klammerzusatz ist Baureihe und Zustand.
  const zeile = seite.lines.map(zeilenText).find(t => /^.+\s\([A-Z0-9]{3,5};\s*.+\)$/.test(t));
  if (zeile) {
    const k = zeile.match(/\s\([A-Z0-9]{3,5};[^)]+\)$/);
    if (k) {
      f.model = trim(zeile.slice(0, k.index));
      const innen = k[0].replace(/^[\s()]+|[\s()]+$/g, '');
      const teile = innen.split(';').map(trim).filter(t => t.length);
      f.seriesCode = teile[0] ?? null;
      f.condition = teile.length > 1 ? teile[1] : null;
    }
  }
  const fin = doc.firstLine('Fahrzeugidentifikationsnummer');
  const treffer = fin && zeilenText(fin).match(/[A-HJ-NPR-Z0-9]{17}/);
  if (treffer) f.vin = treffer[0];
  // Der Hersteller steht erst im Energielabel: „Marke: BMW".
  f.manufacturer = wertNachBezeichner('Marke:', doc);
  return f;
}

// MARK: Preise

function preise(seite, doc) {
  const p = leeresAngebot().pricing;
  p.modelPrice = betragZuBezeichner('Modell', seite, true);
  p.equipmentPrice = betragZuBezeichner('Ausstattung', seite, true);
  p.discount = betragZuBezeichner('Nachlass Modell und Ausstattung', seite);
  p.dealerServices = betragZuBezeichner('Händlerleistungen', seite);
  p.accessories = betragZuBezeichner('Zubehör', seite);
  p.grossTotal = betragZuBezeichner('Gesamtpreis', seite, true);
  p.netTotal = betragZuBezeichner('Netto-Gesamtsumme', seite);

  const ust = seite.firstLine('enthaltene Umsatzsteuer');
  if (ust) {
    p.vat = Zahlen.dezimal(letztes(ust)?.text);
    const satz = zeilenText(ust).match(/(\d{1,2})\s*%/);
    if (satz) p.vatRate = Zahlen.ganzzahl(satz[0]);
  }

  // Bruttolistenpreis im Fließtext; der Nettolistenpreis ist umbrochen
  // („Nettolisten-" / „preis:") mit Fremdtext der linken Spalte dazwischen.
  p.grossListPrice = Zahlen.dezimal(gruppe(/Bruttolistenpreis[\s\S]{0,120}?beträgt\s*([\d.]+,\d{2})/i, doc.text));
  p.netListPrice = Zahlen.dezimal(gruppe(/Nettolisten-?[\s\S]{0,40}?preis:\s*([\d.]+,\d{2})/i, doc.text));

  if (p.grossListPrice == null) {
    const z = doc.firstLine('Summe Modell und Ausstattung');
    if (z) {
      const betraege = z.fragments.filter(f => f.minX >= BETRAG_SPALTE_AB)
        .map(f => Zahlen.dezimal(f.text)).filter(w => w != null);
      p.grossListPrice = betraege[0] ?? null;
    }
  }
  return p;
}

// MARK: Technik

function technik(doc) {
  const t = leeresAngebot().technicalData;
  const seite = doc.pageWithHeading('SONSTIGE ANGABEN ZUM FAHRZEUG');
  if (!seite) return t;

  const werte = seite.lines.find(z => /\d+\s*kW\s*\/\s*\d+\s*PS/.test(zeilenText(z)));
  if (werte) {
    for (const f of werte.fragments) {
      const kw = f.text.match(/(\d+)\s*kW/);
      if (kw) t.powerKW = Zahlen.ganzzahl(kw[0]);
      const ps = f.text.match(/(\d+)\s*PS/);
      if (ps) t.powerHP = Zahlen.ganzzahl(ps[0].replace('PS', ''));
    }
  }
  t.displacementCCM = Zahlen.ganzzahl(wertRechts('Hubraum', seite));
  t.cylinders = Zahlen.ganzzahl(wertRechts('Zylinder', seite));

  // Im Faba-Angebot steht oft „Sonstiges" — ein Platzhalter, kein Getriebe.
  const getriebe = wertRechts('Getriebe', seite);
  if (getriebe && !enthaelt(getriebe, 'sonstige')) t.transmission = getriebe;

  const verbrauch = seite.firstLine('Kraftstoffverbrauch kombiniert');
  if (verbrauch) t.consumptionCombined = Zahlen.dezimal(letztes(verbrauch)?.text);
  const co2 = seite.firstLine('CO2 - Emissionen kombiniert');
  if (co2) t.co2Combined = Zahlen.ganzzahl(letztes(co2)?.text);

  t.fuelType = wertNachBezeichner('Kraftstoff:', doc);
  t.drivetrain = wertNachBezeichner('Antriebsart:', doc);
  return t;
}

// MARK: Leasing

function leasing(doc) {
  const seite = doc.pageWithHeading('Leasingbeispiel der BMW Bank');
  if (!seite) return [];

  const o = leereLeasingOption();
  o.annualMileage = Zahlen.ganzzahl(wertRechts('Laufleistung p.a.', seite));
  o.durationMonths = Zahlen.ganzzahl(wertRechts('Laufzeit', seite));

  // Zwei Wertspalten: links ohne, rechts inklusive Umsatzsteuer.
  const spalten = bezeichner => {
    const z = seite.firstLine(bezeichner);
    if (!z) return { netto: null, brutto: null };
    const b = z.fragments.filter(f => f.minX >= BETRAG_SPALTE_AB)
      .map(f => Zahlen.dezimal(f.text)).filter(w => w != null);
    if (b.length < 2) return { netto: b[0] ?? null, brutto: null };
    return { netto: b[b.length - 2], brutto: b[b.length - 1] };
  };

  const sz = spalten('Leasingsonderzahlung');
  o.downPayment = sz.brutto ?? sz.netto;
  const rate = spalten('monatliche Leasingraten');
  o.monthlyNet = rate.netto;
  o.monthlyGross = rate.brutto;
  const summe = spalten('Gesamtpreis');
  o.totalNet = summe.netto;
  o.totalGross = summe.brutto;
  o.reducedMileageRateNet = spalten('Minder-km-Satz').netto;
  o.extraMileageRateNet = spalten('Mehr-km-Satz').netto;

  // Das Kleingedruckte läuft über mehrere Zeilen und endet vor der Fußnotenziffer.
  const anfang = seite.lines.findIndex(z => enthaelt(zeilenText(z), 'Ein unverbindliches Leasingbeispiel'));
  if (anfang >= 0) {
    const teile = [];
    for (const z of seite.lines.slice(anfang)) {
      const t = trim(zeilenText(z));
      if ([...t].length < 12) break;
      teile.push(t);
      if (teile.length >= 4) break;
    }
    o.disclaimer = teile.join(' ');
    const bank = o.disclaimer.match(/BMW Bank GmbH[^.]*/);
    if (bank) o.provider = bank[0];
  }
  // Eine Laufzeit ohne Rate ist kein Leasingangebot.
  return isDisplayable(o) ? [o] : [];
}

// MARK: Ausstattung

const ABSCHNITTE = [
  ['SERIENAUSSTATTUNG.', 'series'],
  ['EXTERIEUR.', 'exterior'],
  ['INTERIEUR.', 'interior'],
  ['SONDERAUSSTATTUNG.', 'special'],
  ['HÄNDLERLEISTUNGEN.', 'dealerService'],
];

function ausstattung(doc) {
  let ergebnis = [];
  for (const [ueberschrift, kategorie] of ABSCHNITTE) {
    for (const seite of doc.pages) {
      if (!seite.lines.some(z => gleich(trim(zeilenText(z)), ueberschrift))) continue;
      ergebnis = ergebnis.concat(posten(seite, ueberschrift, kategorie));
    }
  }
  // Das zuletzt genannte Paket trägt die eingerückten Posten darunter.
  let letztesPaket = null;
  for (const p of ergebnis) {
    if (p.isPackageContent) p.parentCode = letztesPaket;
    else if ((p.price ?? 0) > 0) letztesPaket = p.code;
  }
  return ergebnis;
}

function posten(seite, ueberschrift, kategorie) {
  const ende = ['SERIENAUSSTATTUNG.', 'EXTERIEUR.', 'INTERIEUR.', 'SONDERAUSSTATTUNG.',
    'HÄNDLERLEISTUNGEN.', 'Die gewählte Ausstattung', 'Nachlass auf Modell',
    'Summe Modell und Ausstattung', 'Seite '].filter(e => !gleich(e, ueberschrift));

  const liste = [];
  for (const z of seite.linesAfter(ueberschrift, ende)) {
    const f0 = erstes(z);
    const code = f0 && f0.minX < CODE_SPALTE_BIS && /^[A-Z0-9]{4,6}$/.test(f0.text) ? f0.text : null;

    const bezeichnung = trim(z.fragments
      .filter(f => f.minX >= CODE_SPALTE_BIS && f.minX < BETRAG_SPALTE_AB)
      .map(f => f.text).join(' '));

    const rechts = z.fragments.filter(f => f.minX >= BETRAG_SPALTE_AB);
    const betrag = rechts.length ? Zahlen.dezimal(rechts[rechts.length - 1].text) : null;

    // Spaltenköpfe überspringen. Eine Zeile mit nur einem Betrag bleibt drin:
    // bei umbrochenen Bezeichnungen rutscht der Preis eine Zeile tiefer.
    if (!bezeichnung && betrag == null) continue;

    if (!code) {
      if (!liste.length) continue;
      const letzter = liste[liste.length - 1];
      if (bezeichnung && !istSpaltenkopf(bezeichnung)) letzter.name += ' ' + bezeichnung;
      if (letzter.price == null) letzter.price = betrag;
      continue;
    }
    if (!bezeichnung) continue;

    const ersteBez = z.fragments.find(f => f.minX >= CODE_SPALTE_BIS);
    liste.push({
      code, name: bezeichnung, price: betrag, category: kategorie,
      isPackageContent: ersteBez ? ersteBez.minX >= EINRUECKUNG_AB : false,
      parentCode: null, sourcePage: seite.index,
    });
  }
  return liste;
}

const istSpaltenkopf = t =>
  ['Verkaufspreis', 'inkl. MwSt. in EUR', 'Listenpreis', 'Preis'].some(k => gleich(t, k));

// MARK: Helfer

/** Bezeichner links, Wert rechts daneben in derselben Zeile. */
function wertNebenBezeichner(bezeichner, seite) {
  for (const z of seite.lines) {
    const f = erstes(z);
    if (!f || !gleich(f.text, bezeichner) || z.fragments.length < 2) continue;
    return z.fragments.slice(1).map(x => x.text).join(' ');
  }
  return null;
}

/** Bezeichner oben, Wert in der Zeile darunter. */
function wertUnterBezeichner(bezeichner, seite, passt) {
  const zs = seite.lines;
  for (let i = 0; i < zs.length; i++) {
    const f = erstes(zs[i]);
    if (!f || !gleich(f.text, bezeichner) || f.minX >= CODE_SPALTE_BIS || i + 1 >= zs.length) continue;
    const w = erstes(zs[i + 1]);
    if (!w || w.minX >= CODE_SPALTE_BIS || !passt(w.text)) continue;
    return w.text;
  }
  return null;
}

const istRufnummer = t => /^\+?\d[\d \-/()]{5,}$/.test(t);
const istAdresseImNetz = t => t.includes('.') && !t.includes(' ') && !t.includes('@') && !/^[\d,.]+$/.test(t);

function gruppe(muster, text) {
  const m = text.match(muster);
  return m && m.length > 1 ? m[1] : null;
}

/** Bezeichner links, Wert am rechten Rand. */
function wertRechts(bezeichner, seite) {
  const z = seite.lines.find(z => { const f = erstes(z); return f && gleich(f.text, bezeichner); });
  return z ? letztes(z)?.text ?? null : null;
}

function betragZuBezeichner(bezeichner, seite, exakt = false) {
  for (const z of seite.lines) {
    const f = erstes(z);
    if (!f) continue;
    const passt = exakt ? gleich(f.text, bezeichner) : enthaelt(f.text, bezeichner);
    if (!passt) continue;
    const b = letztes(z);
    if (!b || b.minX < BETRAG_SPALTE_AB) continue;
    return Zahlen.dezimal(b.text);
  }
  return null;
}

/** „Marke:" → „BMW" — auf dem Energielabel stehen zwei Paare in einer Zeile. */
function wertNachBezeichner(bezeichner, doc) {
  for (const z of doc.allLines) {
    const i = z.fragments.findIndex(f => gleich(trim(f.text), bezeichner));
    if (i < 0 || i + 1 >= z.fragments.length) continue;
    const w = trim(z.fragments[i + 1].text);
    return w || null;
  }
  return null;
}

const istFarbe = n =>
  ['metallic', 'uni', 'Individual', 'Frozen', 'Grau', 'Schwarz', 'Weiß', 'Blau', 'Rot', 'Grün', 'Silber']
    .some(h => enthaelt(n, h)) && !istRad(n);
const istRad = n =>
  ['Räder', 'Rad', 'Felge', 'Schmiederäder', 'Doppelspeiche', 'Speiche', 'Bereifung'].some(h => enthaelt(n, h));
const istPolster = n =>
  ['Leder', 'Stoff', 'Alcantara', 'Vernasca', 'Merino', 'Sensatec'].some(h => enthaelt(n, h));

export const ALLE_PARSER = [BMWFabaParser];
export const parserFuer = doc => ALLE_PARSER.find(p => p.canHandle(doc)) ?? null;
