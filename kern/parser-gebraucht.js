// Liest Gebrauchtwagen-Exposés „BMW Premium Selection", wie Faba Autowelt sie erstellt.
//
// Aufbau (Beispiel <Fahrzeugnr>_<Datum>.pdf, BMW i4):
//   Seite 1   Kopf mit Händler, Titel, großes Foto, Eckdaten als „Bezeichner: | Wert"
//   Seite 2–3 „Serienausstattung" als Aufzählung (•), gegliedert in Unterabschnitte
//   Seite 4–6 „Ausstattung" (die gewählte Sonderausstattung), ebenso
//   Seite 7   „Technische Daten"
//   Seite 8   „Finanzierungsangebot" — KEIN Leasing
//   Seite 9   Bildergalerie (das letzte Bild kann ein eingescannter Batteriebericht sein)
//   Seite 10  „Kontakt" mit dem Verkäufer
// Der Kopfbalken mit den Markenlogos steht auf jeder Seite und ist kein Fahrzeugbild.

import * as Zahlen from './zahlen.js';
import { leeresAngebot, leereLeasingOption, isDisplayable } from './modell.js';
import { zeilenText, enthaelt, gleich } from './extraktor.js';
import { waehlen, MINDESTENS } from './highlights.js';

/** Werte stehen ab x ≈ 240, Bezeichner bei x ≈ 56. */
const WERT_SPALTE_AB = 150;

const trim = t => t.trim();

/** Bekannte Karosserieformen trennen Modell und Ausstattungslinie im Titel. */
const KAROSSERIEN = ['Gran Coupé', 'Gran Tourer', 'Active Tourer', 'Coupé', 'Cabrio', 'Touring',
  'Limousine', 'Roadster', 'Sports Activity Vehicle', 'Sports Activity Coupé'];

export const BMWPremiumSelectionParser = {
  name: 'BMW Premium Selection (Gebrauchtwagen)',

  canHandle(doc) {
    const erste = doc.pages[0];
    if (!erste) return false;
    const text = erste.text;
    return enthaelt(text, 'BMW Premium Selection') && enthaelt(text, 'Fahrzeugnummer:');
  },

  /** Seite 1 (Hauptfoto) und die Galerie. Die Bildauswahl übernimmt `bildFilter`. */
  imagePages(doc) {
    return [...Array(doc.pageCount).keys()];
  },

  /**
   * Reihenfolge wie gezeichnet (Hauptfoto, dann Galerie), nicht nach Namen:
   * Die Bildnamen sind hier Zufallskennungen.
   */
  bildReihenfolge: 'zeichnung',

  /** Der Kopfbalken (1984 × 331, auf jeder Seite) ist ein Logo-Streifen, kein Foto. */
  bildFilter: b => b.pixelWidth / b.pixelHeight < 3,

  parse(doc) {
    const a = leeresAngebot();
    const s1 = doc.pages[0];
    a.offer.kind = 'gebraucht';
    a.vehicle.condition = 'Gebrauchtwagen';

    kopf(a, s1);
    titel(a, s1);
    eckdaten(a, s1);
    a.leasingOptions = finanzierung(doc);
    kontakt(a, doc);
    a.equipment = ausstattung(doc);

    // Highlights zuerst aus der gewählten Ausstattung; die Serienausstattung
    // füllt nur auf, wenn dort zu wenig steht.
    const sonder = waehlen(a.equipment.filter(p => p.category === 'special'), { jeRang: 4 });
    const serie = sonder.length >= MINDESTENS ? []
      : waehlen(a.equipment.filter(p => p.category === 'series'), { jeRang: 4 })
        .filter(p => !sonder.some(q => q.name.toLowerCase() === p.name.toLowerCase()));
    a.highlightCodes = [...sonder, ...serie].slice(0, 14).map(p => p.code);
    return a;
  },
};

// ── Kopf: Händler links, Kontakt rechts ─────────────────────────────────

function kopf(a, seite) {
  const zeilen = seite.lines.slice(0, 4);
  const links = zeilen.map(z => z.fragments[0]?.text).filter(Boolean);
  // „Faba Autowelt GmbH" / „Krefelder Str. 570" / „41066 Mönchengladbach"
  a.dealer.name = links[0] ?? null;
  a.dealer.street = links[1] ?? null;
  const ort = links[2]?.match(/^(\d{5})\s+(.+)$/);
  if (ort) {
    a.dealer.postalCode = ort[1];
    a.dealer.city = trim(ort[2]);
  }
  for (const z of zeilen) {
    for (const f of z.fragments.slice(1)) {
      const t = f.text;
      if (/^Tel\.?:/i.test(t)) a.dealer.contactPhone = trim(t.replace(/^Tel\.?:/i, ''));
      else if (/^E-Mail:/i.test(t)) a.dealer.contactEmail = trim(t.replace(/^E-Mail:/i, ''));
      else if (/^www\./i.test(t)) a.dealer.website = trim(t);
    }
  }
}

// ── Titel: „BMW i4 eDrive40 Gran Coupé M Sport Pro HK" + „HiFi DAB" ─────

function titel(a, seite) {
  // Der Titel steht unter dem Kopf und vor dem Foto; er kann umbrechen.
  const start = seite.lines.findIndex((z, i) => i >= 3 && /^BMW\s|^MINI\s/.test(zeilenText(z)));
  if (start < 0) return;
  const teile = [];
  for (const z of seite.lines.slice(start)) {
    const t = trim(zeilenText(z));
    if (/^Preis:/i.test(t) || z.fragments.length > 1) break;
    teile.push(t);
    if (teile.length >= 3) break;
  }
  const ganz = teile.join(' ');
  const [hersteller, ...rest] = ganz.split(/\s+/);
  a.vehicle.manufacturer = hersteller;
  const ohneMarke = rest.join(' ');

  // Modell bis einschließlich Karosserieform, danach die Ausstattungslinie.
  for (const k of KAROSSERIEN) {
    const i = ohneMarke.indexOf(k);
    if (i >= 0) {
      a.vehicle.model = trim(ohneMarke.slice(0, i + k.length));
      a.vehicle.variant = trim(ohneMarke.slice(i + k.length)) || null;
      return;
    }
  }
  a.vehicle.model = ohneMarke || null;
}

// ── Eckdaten auf Seite 1 ─────────────────────────────────────────────────

function wert(seite, bezeichner) {
  for (const z of seite.lines) {
    const f = z.fragments;
    if (f.length >= 2 && gleich(trim(f[0].text), bezeichner) && f[1].minX >= WERT_SPALTE_AB) {
      return trim(f.slice(1).map(x => x.text).join(' '));
    }
  }
  return null;
}

function eckdaten(a, s) {
  // „Preis: 41.790,- €" · „(MwSt. ausweisbar; Nettopreis: 35.117,65 €)"
  const preis = s.lines.find(z => /^Preis:/i.test(zeilenText(z)));
  if (preis) {
    const t = zeilenText(preis);
    a.pricing.grossTotal = Zahlen.dezimal(t.match(/Preis:\s*([\d.]+(?:,\d{2}|,-)?)/i)?.[1]?.replace(',-', ''));
    a.pricing.netTotal = Zahlen.dezimal(t.match(/Nettopreis:\s*([\d.]+,\d{2})/i)?.[1]);
    if (/MwSt\.?\s*ausweisbar/i.test(t)) a.pricing.vatDeductible = true;
  }

  const leistung = wert(s, 'Leistung:');
  if (leistung) {
    a.technicalData.powerKW = Zahlen.ganzzahl(leistung.match(/(\d+)\s*kW/)?.[1]);
    a.technicalData.powerHP = Zahlen.ganzzahl(leistung.match(/(\d+)\s*PS/)?.[1]);
  }
  a.technicalData.fuelType = wert(s, 'Kraftstoff:');
  a.technicalData.transmission = wert(s, 'Getriebe:');
  a.vehicle.exteriorColor = wert(s, 'Farbe:');
  a.vehicle.interior = wert(s, 'Sitzbezug:');
  a.vehicle.firstRegistration = Zahlen.datum(wert(s, 'Erstzulassung:'));
  a.pricing.grossListPrice = Zahlen.dezimal(wert(s, 'Ehemaliger Listenpreis:'));
  a.vehicle.mileageKM = Zahlen.ganzzahl(wert(s, 'Kilometerstand:'));
  a.vehicle.inspection = wert(s, 'HU:');
  a.vehicle.previousOwners = Zahlen.ganzzahl(wert(s, 'Vorbesitzer:'));
  a.offer.offerNumber = wert(s, 'Fahrzeugnummer:');

  // Datum steht in der Fußzeile: „TT.MM.JJJJ | Fahrzeugnr. | Seite 1/10"
  const fuss = s.lines.find(z => /Seite\s+\d+\/\d+/.test(zeilenText(z)));
  a.offer.offerDate = fuss ? Zahlen.datum(zeilenText(fuss)) : null;
}

// ── Finanzierung (Seite „Finanzierungsangebot") ─────────────────────────

function finanzierung(doc) {
  const s = doc.pageWithHeading('Finanzierungsangebot');
  if (!s) return [];
  const o = leereLeasingOption('finanzierung');
  const betrag = b => Zahlen.dezimal(wert(s, b));

  o.downPayment = betrag('Anzahlung:');
  o.durationMonths = Zahlen.ganzzahl(wert(s, 'Laufzeit:'));
  o.annualMileage = Zahlen.ganzzahl(wert(s, 'Laufleistung / Jahr:'));
  o.effectiveRate = betrag('Effektiver Jahreszins:');
  o.balloonPayment = betrag('Zielrate:');
  o.netLoanAmount = betrag('Nettodarlehensbetrag:');
  // „Sollzinssatz p.a.**:" — der Bezeichner trägt Fußnotensterne.
  const soll = s.lines.find(z => /^Sollzinssatz/i.test(z.fragments[0]?.text ?? '') && z.fragments.length > 1);
  o.nominalRate = soll ? Zahlen.dezimal(soll.fragments[soll.fragments.length - 1].text) : null;
  o.totalLoanAmount = betrag('Darlehensgesamtbetrag:');

  // „Monatliche Finanzierungsrate: € 419,00" — eine Zeile, Wert im Text.
  const rate = s.lines.map(zeilenText).find(t => /Monatliche Finanzierungsrate/i.test(t));
  o.monthlyGross = rate ? Zahlen.dezimal(rate.replace(/^.*?:/, '')) : null;

  // Die Bank steht allein in einer Zeile unter der Rate.
  o.provider = s.lines.map(zeilenText).find(t => /Bank\b.*GmbH|Bank AG/i.test(t) && !/Versicherung/i.test(t)) ?? null;

  // Pflichtangaben für das Kleingedruckte — nur, was wirklich im Dokument steht.
  const teile = [];
  const z = Zahlen;
  if (o.nominalRate != null) teile.push(`Gebundener Sollzinssatz p. a. ${z.betrag(o.nominalRate, false)} %`);
  if (o.effectiveRate != null) teile.push(`effektiver Jahreszins ${z.betrag(o.effectiveRate, false)} %`);
  if (o.netLoanAmount != null) teile.push(`Nettodarlehensbetrag ${z.betrag(o.netLoanAmount)}`);
  if (o.totalLoanAmount != null) teile.push(`Darlehensgesamtbetrag ${z.betrag(o.totalLoanAmount)}`);
  if (o.downPayment != null) teile.push(`Anzahlung ${z.betrag(o.downPayment)}`);
  if (o.balloonPayment != null) teile.push(`Schlussrate ${z.betrag(o.balloonPayment)}`);
  if (o.durationMonths != null) teile.push(`Laufzeit ${o.durationMonths} Monate`);
  const gap = wert(s, 'Shortfall GAP Versicherung*:');
  let text = teile.length ? `Finanzierungsbeispiel: ${teile.join(', ')}.` : '';
  if (gap) text += ` Im Darlehensbetrag enthalten: optionale Shortfall GAP Versicherung ${gap}.`;
  if (o.provider) text += ` Ein Angebot der ${o.provider}.`;
  o.disclaimer = trim(text) || null;

  return isDisplayable(o) ? [o] : [];
}

// ── Kontakt (letzte Seite) ──────────────────────────────────────────────

function kontakt(a, doc) {
  const s = doc.pageWithHeading('Ihr Ansprechpartner');
  if (!s) return;
  const i = s.lines.findIndex(z => enthaelt(zeilenText(z), 'Ihr Ansprechpartner'));
  const name = s.lines[i + 1] ? trim(zeilenText(s.lines[i + 1])) : null;
  if (name && !name.includes('@') && !/:/.test(name)) a.dealer.contactPerson = name;
  for (const z of s.lines.slice(i + 1, i + 6)) {
    const t = trim(zeilenText(z));
    if (!a.dealer.contactEmail && /@/.test(t)) a.dealer.contactEmail = t;
    const tel = t.match(/^Telefon:\s*(.+)$/i);
    if (tel) a.dealer.contactPhone = trim(tel[1]);
  }
}

// ── Ausstattung: Aufzählungen unter „Serienausstattung" und „Ausstattung" ──

function ausstattung(doc) {
  const posten = [];
  let kategorie = null;
  let nr = 0;
  for (const s of doc.pages) {
    for (const z of s.lines) {
      const t = trim(zeilenText(z));
      if (/^Serienausstattung/i.test(t)) { kategorie = 'series'; continue; }
      if (/^Ausstattung(\s|\(|$)/i.test(t)) { kategorie = 'special'; continue; }
      if (/^Technische Daten|^Finanzierungsangebot|^Kontakt$|^Irrtum und Zwischenverkauf/i.test(t)) {
        kategorie = null;
        continue;
      }
      if (!kategorie) continue;
      const aufzaehlung = t.match(/^[•·▪-]\s*(.+)$/);
      if (!aufzaehlung) continue; // Unterüberschriften („Komfort/Innenausstattung") überspringen
      nr++;
      posten.push({
        code: `P${String(nr).padStart(3, '0')}`,
        name: kurzname(aufzaehlung[1]),
        price: null,
        category: kategorie,
        isPackageContent: false,
        parentCode: null,
        sourcePage: s.index,
      });
    }
  }
  return posten;
}

/**
 * „Fahrassistenz-System: Kreuzungs-Assistent" → „Kreuzungs-Assistent",
 * „Connected Package Professional (laufzeitgebundener Dienst)" → „Connected Package Professional".
 * Nur Gliederungsvorsätze fallen weg; der eigentliche Name bleibt unverändert.
 */
function kurzname(roh) {
  let n = trim(roh).replace(/\s*\(laufzeitgebundener Dienst\)\s*$/i, '');
  const vorsatz = n.match(/^(Fahrassistenz-System|Innenausstattung|Außenausstattung|Bremsanlage|Service-System|Sitzbezug \/ Polsterung|Karosserie):\s+(.{4,})$/i);
  if (vorsatz) n = vorsatz[2];
  return n;
}
