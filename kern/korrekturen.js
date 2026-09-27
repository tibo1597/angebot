// Bekannte Schreibweisen, die das Händlersystem falsch ausgibt.
//
// Das Faba-System schreibt Umlaute im Namen des Verkäufers aus („… Mueller"),
// richtig ist „Müller". Bewusst KEINE allgemeine Regel „ue → ü": Manuel, Samuel oder echte
// Mueller würden dabei verfälscht. Korrigiert wird nur der Name des Ansprechpartners —
// die E-Mail-Adresse bleibt, wie sie ist (…mueller@…).

/** Nachnamen, die im Namen des Ansprechpartners mit Umlaut geschrieben werden. */
const NACHNAMEN = [
  ['Mueller', 'Müller'],
];

export function korrigiere(angebot) {
  let name = angebot.dealer.contactPerson;
  if (!name) return angebot;
  for (const [falsch, richtig] of NACHNAMEN) {
    // Nur als ganzes Wort — „Muellerstraße" oder eine E-Mail bleiben unberührt.
    name = name.replace(new RegExp(`(^|\\s)${falsch}(?=$|\\s)`, 'g'), `$1${richtig}`);
  }
  angebot.dealer.contactPerson = name;
  return angebot;
}
