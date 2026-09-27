// Prüft ein Angebot auf Lücken und Widersprüche — Nachbau von OfferValidator.swift.
// Grundsatz: keine stillen Korrekturen. Er sagt nur, wo hingeschaut werden muss.

import { betrag } from './zahlen.js';
import { highlights } from './modell.js';
import { MINDESTENS } from './highlights.js';

const SPIELRAUM = 0.01;
const fehlt = (feld, text) => ({ gewicht: 'fehlt', feld, text });
const widerspruch = (feld, text) => ({ gewicht: 'widerspruch', feld, text });
/** Auf Cent runden, damit 0,1 + 0,2 nicht zum Befund wird. */
const cent = w => Math.round(w * 100) / 100;

export function pruefe(a) {
  const b = [
    ...lueckenImKopf(a), ...preisproben(a.pricing), ...listenpreisprobe(a.pricing),
    ...leasingproben(a), ...bilderUndHighlights(a),
  ];
  // Widersprüche zuerst, sonst stabile Reihenfolge.
  return b.map((x, i) => [x, i])
    .sort(([x, i], [y, j]) => (x.gewicht === y.gewicht ? i - j : x.gewicht === 'widerspruch' ? -1 : 1))
    .map(([x]) => x);
}

function lueckenImKopf(a) {
  const b = [];
  const f = (bed, feld) => { if (bed) b.push(fehlt(feld, `${feld} wurde nicht erkannt.`)); };
  f(a.vehicle.model == null, 'Modell');
  f(a.vehicle.manufacturer == null, 'Hersteller');
  f(a.offer.offerNumber == null, 'Angebotsnummer');
  f(a.offer.offerDate == null, 'Angebotsdatum');
  f(a.pricing.grossTotal == null, 'Gesamtpreis');
  f(a.dealer.name == null, 'Händler');
  return b;
}

function preisproben(p) {
  const b = [];
  // Das Minus steht mit Leerzeichen („- 32.998,70"). Verschluckt → Nachlass positiv.
  if (p.discount != null && p.discount > 0) {
    b.push(widerspruch('Nachlass', 'Der Nachlass ist positiv. Üblicherweise mindert er den Preis — '
      + 'bitte das Vorzeichen prüfen.'));
  }
  if (p.netTotal != null && p.vat != null && p.grossTotal != null) {
    const summe = cent(p.netTotal + p.vat);
    if (Math.abs(summe - p.grossTotal) > SPIELRAUM + 1e-9) {
      b.push(widerspruch('Gesamtpreis', `Netto und Umsatzsteuer ergeben zusammen ${betrag(summe)}, `
        + `der Gesamtpreis lautet aber ${betrag(p.grossTotal)}.`));
    }
  }
  // Modell + Ausstattung + Nachlass + Händlerleistungen + Zubehör = Gesamtpreis
  if (p.modelPrice != null && p.equipmentPrice != null && p.grossTotal != null) {
    const summe = cent(p.modelPrice + p.equipmentPrice + (p.discount ?? 0)
      + (p.dealerServices ?? 0) + (p.accessories ?? 0));
    if (Math.abs(summe - p.grossTotal) > SPIELRAUM + 1e-9) {
      b.push(widerspruch('Gesamtpreis',
        `Die Einzelposten ergeben ${betrag(summe)}, als Gesamtpreis steht ${betrag(p.grossTotal)}.`));
    }
  }
  return b;
}

/** Drei Wege zum selben Wert — laufen sie auseinander, wurde eine Spalte verwechselt. */
function listenpreisprobe(p) {
  if (p.grossListPrice == null || p.modelPrice == null || p.equipmentPrice == null) return [];
  const summe = cent(p.modelPrice + p.equipmentPrice);
  if (Math.abs(summe - p.grossListPrice) <= SPIELRAUM + 1e-9) return [];
  return [widerspruch('Bruttolistenpreis', `Modell und Ausstattung ergeben ${betrag(summe)}, `
    + `als Bruttolistenpreis steht ${betrag(p.grossListPrice)}. `
    + 'Möglicherweise wurde die falsche Preisspalte gelesen.')];
}

function leasingproben(a) {
  const b = [];
  if (!a.leasingOptions.length) {
    b.push(fehlt('Leasing', 'Im Dokument steht kein vollständiges Leasingbeispiel. '
      + 'Der Leasingkasten bleibt im Angebot leer.'));
    return b;
  }
  a.leasingOptions.forEach((o, n) => {
    const feld = a.leasingOptions.length > 1 ? `Leasing ${n + 1}` : 'Leasing';
    if (o.downPayment == null) {
      b.push(fehlt(feld, 'Die Sonderzahlung wurde nicht gefunden. Die Überschrift '
        + '„ohne Anzahlung“ wird deshalb nicht gesetzt.'));
    }
    if (o.monthlyNet != null && o.monthlyGross != null) {
      if (o.monthlyGross <= o.monthlyNet) {
        b.push(widerspruch(feld, 'Die Bruttorate ist nicht höher als die Nettorate.'));
      } else {
        const v = o.monthlyGross / o.monthlyNet;
        if (v < 1.15 || v > 1.23) b.push(widerspruch(feld, 'Netto- und Bruttorate passen nicht zum Umsatzsteuersatz.'));
      }
    }
    // „Gesamtpreis" heißt im Leasingteil die Summe aller Raten.
    if (o.totalGross != null && a.pricing.grossTotal != null && o.totalGross === a.pricing.grossTotal) {
      b.push(widerspruch(feld, 'Die Ratensumme entspricht genau dem Fahrzeugpreis. '
        + 'Vermutlich wurde derselbe Wert zweimal gelesen.'));
    }
    if (o.durationMonths != null && o.monthlyNet != null && o.totalNet != null) {
      const erwartet = cent(o.monthlyNet * o.durationMonths);
      if (Math.abs(erwartet - o.totalNet) > o.durationMonths * SPIELRAUM + 1e-9) {
        b.push(widerspruch(feld, `${o.durationMonths} × ${betrag(o.monthlyNet)} ergibt `
          + `${betrag(erwartet)}, im Dokument steht ${betrag(o.totalNet)}.`));
      }
    }
  });
  return b;
}

function bilderUndHighlights(a) {
  const b = [];
  if (!a.images.length) {
    b.push(fehlt('Bilder', 'Im Dokument sind keine Fahrzeugbilder eingebettet. '
      + 'Du kannst eigene aus Fotos oder Dateien hinzufügen.'));
  }
  const n = highlights(a).length;
  if (n < MINDESTENS) {
    b.push(fehlt('Highlights', `Es wurden nur ${n} Highlights gefunden. `
      + 'Du kannst weitere aus der Ausstattungsliste auswählen.'));
  }
  const vorhanden = new Set(a.equipment.map(p => p.code));
  const erfunden = a.highlightCodes.filter(c => !vorhanden.has(c));
  if (erfunden.length) {
    b.push(widerspruch('Highlights', `${erfunden.length} Highlight(s) stehen nicht in der Ausstattungsliste.`));
  }
  return b;
}
