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
];

const enthaelt = (text, teil) => text.toLocaleLowerCase('de').includes(teil.toLocaleLowerCase('de'));

function rang(name) {
  for (const [r, stichworte] of RANGFOLGE) if (stichworte.some(s => enthaelt(name, s))) return r;
  return null;
}

export function waehlen(ausstattung) {
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

  const ergebnis = [];
  const gesehen = new Set();
  for (const { p } of bewertet) {
    if (ergebnis.length >= HOECHSTENS) break;
    const k = p.name.toLowerCase();
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    ergebnis.push(p);
  }
  // Weniger als MINDESTENS heißt: weniger zeigen. Nicht auffüllen.
  return ergebnis;
}
