// Das eine Modell zwischen Parser und Renderer — Nachbau von VehicleOffer.swift.
// Grundregel: Jeder Wert ist optional. Nicht gefunden = null, niemals 0.
//
// Beträge: Zahl in Euro. Datum: ISO-Text "2026-09-23".
// Neuwagen (OFCO-Angebot) und Gebrauchtwagen (Exposé „BMW Premium Selection")
// teilen sich dieses Modell. offer.kind unterscheidet sie; fehlt es, gilt 'neu'.
//
// Bild: { id, data: Uint8Array, mime: 'image/jpeg'|'image/png', kind, sourcePage,
//         pixelWidth, pixelHeight, caption }

export const KATEGORIEN = ['series', 'exterior', 'interior', 'special', 'dealerService'];

export function leeresAngebot() {
  return {
    dealer: { name: null, subtitle: null, street: null, postalCode: null, city: null,
              phone: null, fax: null, website: null,
              contactPerson: null, contactPhone: null, contactEmail: null },
    offer: { kind: 'neu', offerNumber: null, offerDate: null, printDate: null, customerNumber: null },
    vehicle: { manufacturer: null, model: null, variant: null, seriesCode: null, condition: null,
               vin: null, exteriorColor: null, interior: null, wheels: null,
               // nur Gebrauchtwagen:
               firstRegistration: null,   // ISO-Datum
               mileageKM: null,
               previousOwners: null,
               inspection: null,          // „neu" oder ein Datum als Text — wie im Dokument
             },
    technicalData: { driveDescription: null, fuelType: null, drivetrain: null, transmission: null,
                     powerKW: null, powerHP: null, displacementCCM: null, cylinders: null,
                     consumptionCombined: null, co2Combined: null, accelerationSeconds: null,
                     electricRangeKM: null, chargingACkW: null, chargingDCkW: null },
    pricing: { modelPrice: null, equipmentPrice: null, grossListPrice: null, netListPrice: null,
               discount: null, dealerServices: null, accessories: null,
               grossTotal: null, netTotal: null, vat: null, vatRate: null,
               // Gebrauchtwagen: „MwSt. ausweisbar". grossListPrice ist dort der ehemalige Listenpreis.
               vatDeductible: null },
    leasingOptions: [],
    equipment: [],
    highlightCodes: [],
    images: [],
  };
}

/**
 * Leasing ODER Finanzierung (art). Die Finanzierung nutzt dieselben Grundfelder
 * (Laufzeit, Laufleistung, Anzahlung = downPayment, Rate = monthlyGross) plus eigene.
 */
export function leereLeasingOption(art = 'leasing') {
  return { id: neueId(), art, durationMonths: null, annualMileage: null, downPayment: null,
           monthlyNet: null, monthlyGross: null, totalNet: null, totalGross: null,
           extraMileageRateNet: null, reducedMileageRateNet: null, provider: null, disclaimer: null,
           // nur Finanzierung:
           balloonPayment: null,     // Schlussrate
           effectiveRate: null,      // effektiver Jahreszins in %
           nominalRate: null,        // gebundener Sollzinssatz p. a. in %
           netLoanAmount: null,      // Nettodarlehensbetrag
           totalLoanAmount: null,    // Darlehensgesamtbetrag
         };
}

export const istFinanzierung = l => l.art === 'finanzierung';
export const istGebraucht = a => a.offer.kind === 'gebraucht';

export function neueId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Die Ausstattung hinter highlightCodes, in der Reihenfolge der Auswahl. */
export function highlights(a) {
  return a.highlightCodes.map(c => a.equipment.find(p => p.code === c)).filter(Boolean);
}

/** "Krefelder Str. 570, 41066 Mönchengladbach" */
export function addressLine(d) {
  const ort = [d.postalCode, d.city].filter(x => x != null).join(' ');
  const teile = [d.street, ort || null].filter(x => x != null);
  return teile.length ? teile.join(', ') : null;
}

/** "BMW M4 Coupé" */
export function displayName(v) {
  const teile = [v.manufacturer, v.model].filter(x => x != null);
  return teile.length ? teile.join(' ') : null;
}

export function isElectric(t) {
  return t.electricRangeKM != null || t.chargingDCkW != null
    || (t.fuelType ?? '').toLowerCase().includes('elektro');
}

/** "353 kW / 480 PS" */
export function powerText(t) {
  if (t.powerKW != null && t.powerHP != null) return `${t.powerKW} kW / ${t.powerHP} PS`;
  if (t.powerKW != null) return `${t.powerKW} kW`;
  if (t.powerHP != null) return `${t.powerHP} PS`;
  return null;
}

/** Nur dann darf die Überschrift „OHNE ANZAHLUNG" lauten. */
export const isWithoutDownPayment = l => l.downPayment === 0;

/** Die Spalte ist nur zeigbar, wenn alles Wesentliche wirklich gefunden wurde. */
export const isDisplayable = l => istFinanzierung(l)
  ? l.durationMonths != null && l.monthlyGross != null
  : l.durationMonths != null && l.annualMileage != null && l.monthlyNet != null;

export const aspectRatio = b => (b.pixelHeight === 0 ? 1 : b.pixelWidth / b.pixelHeight);
