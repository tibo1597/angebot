// Wählt die 8–14 Ausstattungspositionen für den Einseiter — Nachbau von HighlightAuswahl.swift.
// Bewusst eine Stichwortliste mit Rangfolge statt einer Formel: nachvollziehbar
// und in zwei Minuten korrigierbar.

export const MINDESTENS = 8;
export const HOECHSTENS = 14;


const RANGFOLGE = [
  [1, ['Package', 'Paket']],
  [2, ['Assistant', 'Assistent', 'Driving', 'Parking', 'Head-Up', 'Head Up']],
  [3, ['Sitzbelüftung', 'Sitzheizung', 'Komfortzugang', 'Lenkradheizung', 'Klimaautomatik',
       'Glasdach', 'Panorama', 'Standheizung', 'Komfortsitze', 'Sitzverstellung', 'Memory']],
  [4, ['Harman Kardon', 'Bowers', 'Surround', 'Sound System']],
  [5, ['LED', 'Laser', 'Scheinwerfer', 'Iconic Glow', 'Lichtteppich']],
  [6, ['Leder', 'Merino', 'Carbon', 'Interieurleisten', 'Dachhimmel', 'Alcantara',
       'CraftedClarity', 'Glasapplikation']],
  [7, ['M Sport', 'Schmiederäder', 'Compound-Bremse', 'Shadow Line', 'Sportdifferenzial',
       'M Fahrwerk', 'Sportsitze', 'Sportbremse']],
  [8, ['iDrive', 'Operating System', 'Live Cockpit', 'Passenger Screen', 'Curved Display']],
];

/** Pflichtausstattung, Wartung, Technik ohne Verkaufswert. */
const SPERRLISTE = [
  'Warndreieck', 'Verbandkasten', 'Gesetzlicher Notruf', 'Notruf', 'Teleservices',
  'Ölwartungsintervall', 'Reifendruck', 'Reifenreparatur', 'Deaktivierung Beifahrerairbag',
  'Radschraubensicherung', 'Abgastechnik', 'Steuerung EfficientDynamics', 'DAB-Tuner',
  'Personal eSIM', 'ConnectedDrive Services', 'Connected Package', 'Sonnenschutzverglasung',
  'Ablagenpaket', 'Ablage für Wireless Charging', 'Lordosenstütze', 'Galvanikapplikation',
  'Aktiver Fußgängerschutz', 'Active Guard', 'Sicherheitsgurte', 'Alarmanlage',
  'Innen- und Außenspiegelpaket', 'Innenspiegel automatisch', 'Geschwindigkeitsregelung',
  // Gebrauchtwagen-Exposés
  'Spiegel-Paket', 'Ablage-Paket', 'Reifen-Reparaturset', 'Beifahrerairbag-Deaktivierung',
  'Fussgängerschutz', 'Fußgängerschutz', 'Surround-Kamera', 'Surround View',
];

const enthaelt = (text, teil) => text.toLocaleLowerCase('de').includes(teil.toLocaleLowerCase('de'));

function rang(name) {
  for (const [r, stichworte] of RANGFOLGE) if (stichworte.some(s => enthaelt(name, s))) return r;
  return null;
}

/**
 * @param jeRang  im ersten Durchgang höchstens so viele Einträge je Themengruppe.
 *                OFCO-Angebote: unbegrenzt (wie das Swift-Original). Exposés: 4 —
 *                dort stehen Assistenten einzeln und würden sonst alles verdrängen.
 */
export function waehlen(ausstattung, { jeRang = Infinity } = {}) {
  const bewertet = [];
  for (const p of ausstattung) {
    if (p.category === 'dealerService') continue;
    if (SPERRLISTE.some(s => enthaelt(p.name, s))) continue;
    const r = rang(p.name);
    if (r == null) continue;
    bewertet.push({ p, r, preis: p.price ?? 0 });
  }
  // Innerhalb eines Rangs zuerst das Teurere.
  // Namensvergleich wie Swift `<` auf String: nach Unicode-Codepunkten, nicht locale.
  bewertet.sort((a, b) => a.r - b.r || b.preis - a.preis || (a.p.name < b.p.name ? -1 : a.p.name > b.p.name ? 1 : 0));

  // Zwei Durchgänge: erst höchstens JE_RANG Einträge pro Themengruppe, damit nicht
  // sieben Assistenten das Soundsystem verdrängen — danach der Rest nach Rang.
  const ergebnis = [];
  const gesehen = [];
  const anzahl = new Map();
  for (const durchgang of [1, 2]) {
    for (const { p, r } of bewertet) {
      if (ergebnis.length >= HOECHSTENS) break;
      if (ergebnis.includes(p)) continue;
      if (durchgang === 1 && (anzahl.get(r) ?? 0) >= jeRang) continue;
      const k = schluessel(p.name);
      // Doppelte und fast doppelte Bezeichnungen vermeiden:
      // „M Sportpaket" ⊂ „M Sportpaket Pro", „M Sport Pro Paket" = „M Sportpaket Pro" umgestellt.
      if (gesehen.some(g => g.text === k.text || g.buchstaben === k.buchstaben
        || (k.text.length >= 6 && g.text.includes(k.text))
        || (g.text.length >= 6 && k.text.includes(g.text)))) continue;
      gesehen.push(k);
      ergebnis.push(p);
      anzahl.set(r, (anzahl.get(r) ?? 0) + 1);
    }
  }
  // Anzeige in Rangfolge, nicht in Durchgangsfolge (stabil innerhalb eines Rangs).
  if (jeRang !== Infinity) {
    const pos = new Map(bewertet.map((e, i) => [e.p, i]));
    ergebnis.sort((a, b) => pos.get(a) - pos.get(b));
  }
  // Weniger als MINDESTENS heißt: weniger zeigen. Nicht auffüllen.
  return ergebnis;
}

/** Nur Buchstaben und Ziffern, klein — und dieselben Zeichen sortiert (gegen Umstellungen). */
function schluessel(name) {
  const text = name.toLocaleLowerCase('de').replace(/[^a-z0-9äöüß]/g, '');
  return { text, buchstaben: [...text].sort().join('') };
}
