// Oberfläche der Web-App — Nachbau der SwiftUI-App.
// Alles bleibt auf dem Gerät: Das PDF wird im Browser gelesen, der Einseiter im
// Browser erzeugt. Die Seite baut keine Verbindung nach außen auf (siehe CSP).

import * as Zahlen from './kern/zahlen.js';
import { leeresAngebot, leereLeasingOption, highlights, displayName, isElectric, neueId } from './kern/modell.js';
import { pruefe } from './kern/validator.js';
import { MINDESTENS, HOECHSTENS } from './kern/highlights.js';

// ── Zustand ──────────────────────────────────────────────────────────────

const z = {
  phase: 'leer',          // leer | liest | fertig | fehler
  fehler: null,
  technik: null,          // technische Angabe zum Fehler, klein unter der Meldung
  angebot: leeresAngebot(),
  erkannt: true,
  seitenOhneText: [],
  ansicht: 'editor',      // editor | highlights | bilder | vorschau
  suche: '',
};

const $ = id => document.getElementById(id);
const inhalt = $('inhalt');

// ── Bibliotheken: erst laden, wenn sie gebraucht werden ─────────────────

import './kern/nachruestung.js'; // vor pdf.js — sonst scheitert Safari 26 an jedem Angebot

let libs = null;
async function bibliotheken() {
  if (libs) return libs;
  const [pdfjs, PDFLib] = await Promise.all([
    import('./vendor/pdfjs/pdf.min.mjs'),
    import('./vendor/pdf-lib.esm.min.js'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/worker.mjs', import.meta.url).href;
  libs = { pdfjs, PDFLib };
  return libs;
}

// ── Kleine DOM-Helfer ────────────────────────────────────────────────────

function el(tag, attrs = {}, ...kinder) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kinder.flat()) if (k != null && k !== false) e.append(k);
  return e;
}

const SVG = {
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  frage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.7-.8 1.2v.4M12 16.8h.01"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9a1 1 0 0 1 1 1v4a1 1 0 0 1-2 0v-4a1 1 0 0 1 1-1zm0 8.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><rect x="7" y="11" width="10" height="2" rx="1" fill="#fff"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/><path d="M11 7h2v4h4v2h-4v4h-2v-4H7v-2h4z" fill="#fff"/></svg>',
  hoch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 14l6-6 6 6"/></svg>',
  runter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 10l6 6 6-6"/></svg>',
};
function symbol(name, klasse = 'zeichen') {
  const s = el('span', { class: klasse, 'aria-hidden': 'true' });
  s.innerHTML = SVG[name];
  return s;
}
function rund(name, klasse, label, onclick, disabled = false) {
  const b = el('button', { class: `rund ${klasse}`, 'aria-label': label, onclick, disabled });
  b.innerHTML = SVG[name];
  return b;
}

function gruppe(titel, kinder, fuss = null, fussKlasse = '') {
  return el('section', { class: 'gruppe' },
    titel ? el('h3', { text: titel }) : null,
    el('div', { class: 'karte' }, kinder),
    fuss ? el('p', { class: `fuss ${fussKlasse}`, text: fuss }) : null);
}

function meldung(text) {
  const m = el('div', { class: 'meldung', role: 'status', text });
  document.body.append(m);
  setTimeout(() => m.remove(), 2600);
}

// ── Kopfleiste ───────────────────────────────────────────────────────────

function leiste(titel, links = null, rechts = null) {
  $('titel').textContent = titel;
  $('links').replaceChildren(...(links ? [links] : []));
  $('rechts').replaceChildren(...(rechts ? [rechts] : []));
  document.title = titel === 'Angebot' ? 'Angebot' : `${titel} – Angebot`;
}
const leistenknopf = (text, onclick, fett = false) =>
  el('button', { class: `leistenknopf${fett ? ' fett' : ''}`, onclick, text });
const zurueck = () => leistenknopf('‹ Zurück', () => history.back());

// ── Navigation mit Verlauf, damit die Wischgeste auf dem iPhone funktioniert ──

function gehe(ansicht) {
  z.ansicht = ansicht;
  history.pushState({ ansicht }, '');
  zeichne();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', e => {
  z.ansicht = e.state?.ansicht ?? 'editor';
  zeichne();
});

// ── Einlesen ─────────────────────────────────────────────────────────────

$('pdf-wahl').addEventListener('change', async e => {
  const datei = e.target.files?.[0];
  e.target.value = '';
  if (datei) await oeffne(datei);
});

async function oeffne(datei) {
  z.phase = 'liest';
  z.ansicht = 'editor';
  zeichne();
  let schritt = 'Datei lesen';
  try {
    const bytes = new Uint8Array(await datei.arrayBuffer());
    schritt = 'Programmteile laden';
    const [{ lese }, l] = await Promise.all([import('./kern/import.js'), bibliotheken()]);
    schritt = 'Angebot auswerten';
    const e = await lese(bytes, l);
    z.angebot = e.angebot;
    z.erkannt = e.erkannt;
    z.seitenOhneText = e.seitenOhneText;
    z.phase = 'fertig';
  } catch (fehler) {
    z.fehler = 'Die Datei konnte nicht geöffnet werden.';
    // Keine Kundendaten — nur Schritt, Fehlerart und Meldung der Bibliothek.
    const ursache = fehler?.ursache ?? fehler;
    z.technik = `${schritt} · ${ursache?.name ?? 'Fehler'}: ${String(ursache?.message ?? ursache).slice(0, 200)}`
      + ` · ${datei?.type || 'ohne Typ'}, ${Math.round((datei?.size ?? 0) / 1024)} KB`;
    z.phase = 'fehler';
  }
  history.replaceState({ ansicht: 'editor' }, '');
  zeichne();
}

function manuell() {
  z.angebot = leeresAngebot();
  z.erkannt = false;
  z.seitenOhneText = [];
  z.phase = 'fertig';
  z.ansicht = 'editor';
  zeichne();
}

function neu() {
  z.angebot = leeresAngebot();
  z.phase = 'leer';
  z.ansicht = 'editor';
  history.replaceState({ ansicht: 'editor' }, '');
  zeichne();
}

// ── Zeichnen ─────────────────────────────────────────────────────────────

function zeichne() {
  if (z.phase === 'leer') return zeichneStart();
  if (z.phase === 'liest') return zeichneLaden();
  if (z.phase === 'fehler') return zeichneFehler();
  if (z.ansicht === 'highlights') return zeichneHighlights();
  if (z.ansicht === 'bilder') return zeichneBilder();
  if (z.ansicht === 'vorschau') return zeichneVorschau();
  return zeichneEditor();
}

function zeichneStart() {
  leiste('Angebot');
  inhalt.replaceChildren(el('div', { class: 'mitte' },
    symbol('doc', 'symbol'),
    el('h2', { text: 'Angebot in einer Seite' }),
    el('p', { text: 'Wähle das PDF-Angebot aus. Es wird nur auf diesem Gerät gelesen und verlässt es nicht.' }),
    el('button', { class: 'knopf', text: 'Angebot auswählen', onclick: () => $('pdf-wahl').click() }),
    el('button', { class: 'knopf zweit', text: 'Von Hand ausfüllen', onclick: manuell })));
}

function zeichneLaden() {
  leiste('Angebot');
  inhalt.replaceChildren(el('div', { class: 'mitte' },
    el('div', { class: 'lader', role: 'progressbar', 'aria-label': 'Angebot wird gelesen' }),
    el('p', { text: 'Angebot wird gelesen …' })));
}

function zeichneFehler() {
  leiste('Angebot', leistenknopf('Neu', neu));
  inhalt.replaceChildren(el('div', { class: 'mitte' },
    symbol('frage', 'symbol'),
    el('h2', { text: 'Nicht lesbar' }),
    el('p', { text: z.fehler }),
    el('button', { class: 'knopf', text: 'Anderes Angebot wählen', onclick: () => $('pdf-wahl').click() }),
    z.technik ? el('p', { class: 'technik', text: z.technik }) : null));
}

// ── Editor ───────────────────────────────────────────────────────────────

// [Gruppe, [Pfad, Feld, Titel, Art, Einheit]]
// Arten: text | lang | betrag | dezimal | ganz | datum
const ABSCHNITTE = [
  ['Fahrzeug', [
    ['vehicle', 'manufacturer', 'Hersteller', 'text'],
    ['vehicle', 'model', 'Modell', 'text'],
    ['vehicle', 'variant', 'Variante', 'text'],
    ['vehicle', 'condition', 'Zustand', 'text'],
    ['vehicle', 'vin', 'FIN', 'text'],
    ['vehicle', 'exteriorColor', 'Farbe', 'lang'],
    ['vehicle', 'wheels', 'Räder', 'lang'],
    ['vehicle', 'interior', 'Interieur', 'lang'],
  ]],
  ['@links'],
  ['Technik', [
    ['technicalData', 'powerKW', 'Leistung', 'ganz', 'kW'],
    ['technicalData', 'powerHP', 'Leistung', 'ganz', 'PS'],
    ['technicalData', 'displacementCCM', 'Hubraum', 'ganz', 'cm³'],
    ['technicalData', 'cylinders', 'Zylinder', 'ganz'],
    ['technicalData', 'consumptionCombined', 'Verbrauch', 'dezimal', 'l/100 km'],
    ['technicalData', 'co2Combined', 'CO₂', 'ganz', 'g/km'],
    ['technicalData', 'accelerationSeconds', '0–100 km/h', 'dezimal', 's'],
    ['technicalData', 'fuelType', 'Kraftstoff', 'text'],
    ['technicalData', 'drivetrain', 'Antriebsart', 'text'],
    ['technicalData', 'transmission', 'Getriebe', 'text'],
    ['technicalData', 'electricRangeKM', 'Reichweite', 'ganz', 'km', 'elektro'],
    ['technicalData', 'chargingACkW', 'Laden AC', 'ganz', 'kW', 'elektro'],
    ['technicalData', 'chargingDCkW', 'Laden DC', 'ganz', 'kW', 'elektro'],
  ]],
  ['Preise', [
    ['pricing', 'modelPrice', 'Modell', 'betrag'],
    ['pricing', 'equipmentPrice', 'Ausstattung', 'betrag'],
    ['pricing', 'grossListPrice', 'Listenpreis brutto', 'betrag'],
    ['pricing', 'netListPrice', 'Listenpreis netto', 'betrag'],
    ['pricing', 'discount', 'Nachlass', 'betrag'],
    ['pricing', 'dealerServices', 'Händlerleistungen', 'betrag'],
    ['pricing', 'accessories', 'Zubehör', 'betrag'],
    ['pricing', 'grossTotal', 'Gesamt brutto', 'betrag'],
    ['pricing', 'netTotal', 'Gesamt netto', 'betrag'],
    ['pricing', 'vat', 'MwSt', 'betrag'],
    ['pricing', 'vatRate', 'MwSt-Satz', 'ganz', '%'],
  ]],
  ['@leasing'],
  ['Händler', [
    ['dealer', 'name', 'Name', 'text'],
    ['dealer', 'subtitle', 'Zusatz', 'text'],
    ['dealer', 'street', 'Straße', 'text'],
    ['dealer', 'postalCode', 'PLZ', 'text'],
    ['dealer', 'city', 'Ort', 'text'],
    ['dealer', 'phone', 'Telefon', 'text'],
    ['dealer', 'fax', 'Fax', 'text'],
    ['dealer', 'website', 'Web', 'text'],
  ]],
  ['Verkäufer', [
    ['dealer', 'contactPerson', 'Name', 'text'],
    ['dealer', 'contactPhone', 'Telefon', 'text'],
    ['dealer', 'contactEmail', 'E-Mail', 'text'],
  ]],
  ['Angebot', [
    ['offer', 'offerNumber', 'Nummer', 'text'],
    ['offer', 'offerDate', 'Datum', 'datum'],
    ['offer', 'customerNumber', 'Kundennummer', 'text'],
  ]],
];

const LEASING_FELDER = [
  ['durationMonths', 'Laufzeit', 'ganz', 'Monate'],
  ['annualMileage', 'Laufleistung', 'ganz', 'km/Jahr'],
  ['downPayment', 'Sonderzahlung', 'betrag'],
  ['monthlyNet', 'Rate netto', 'betrag'],
  ['monthlyGross', 'Rate brutto', 'betrag'],
  ['totalNet', 'Summe netto', 'betrag'],
  ['totalGross', 'Summe brutto', 'betrag'],
  ['extraMileageRateNet', 'Mehr-km', 'dezimal', 'ct'],
  ['reducedMileageRateNet', 'Minder-km', 'dezimal', 'ct'],
  ['provider', 'Leasinggeber', 'lang'],
];

const LESEN = { betrag: Zahlen.dezimal, dezimal: Zahlen.dezimal, ganz: Zahlen.ganzzahl };
const SCHREIBEN = {
  betrag: w => Zahlen.betrag(w, false),
  dezimal: Zahlen.zahl,
  ganz: Zahlen.ganzzahlText,
};

let feldNummer = 0;

/** Eine Eingabezeile. `ziel` ist das Objekt, `feld` der Schlüssel darin. */
function feldZeile(ziel, feld, titel, art, einheit = null) {
  const id = `f${++feldNummer}`;
  const leer = 'Nicht erkannt';

  if (art === 'lang') {
    const t = el('textarea', { id, rows: 1, placeholder: leer, autocomplete: 'off', autocapitalize: 'off' });
    t.value = ziel[feld] ?? '';
    // Mitwachsen lassen — `field-sizing: content` kann nicht jedes Safari.
    const anpassen = () => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; };
    requestAnimationFrame(anpassen);
    t.addEventListener('input', () => {
      anpassen();
      ziel[feld] = t.value.trim() ? t.value : null;
      befundeAktualisieren();
    });
    return el('div', { class: 'zeile lang' }, el('label', { for: id, text: titel }), t);
  }

  if (art === 'datum') {
    const i = el('input', { id, type: 'date' });
    i.value = ziel[feld] ?? '';
    i.addEventListener('change', () => { ziel[feld] = i.value || null; befundeAktualisieren(); });
    return el('div', { class: 'zeile' }, el('label', { for: id, text: titel }), i);
  }

  if (art === 'text') {
    const i = el('input', { id, type: 'text', placeholder: leer, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
    i.value = ziel[feld] ?? '';
    i.addEventListener('input', () => {
      ziel[feld] = i.value.trim() ? i.value : null;
      befundeAktualisieren();
      if (feld === 'manufacturer' || feld === 'model') titelAktualisieren();
    });
    return el('div', { class: 'zeile' }, el('label', { for: id, text: titel }), i);
  }

  // Zahlen: erst beim Verlassen übernehmen, sonst springt die Formatierung ins Tippen.
  const i = el('input', { id, type: 'text', inputmode: 'decimal', placeholder: leer, autocomplete: 'off', 'data-feld': titel });
  const zeigen = () => { i.value = SCHREIBEN[art](ziel[feld]) ?? ''; };
  zeigen();
  const einheitEl = el('span', { class: 'einheit', text: einheit ?? (art === 'betrag' ? '€' : '') });
  const einheitZeigen = () => { einheitEl.hidden = ziel[feld] == null; };
  einheitZeigen();
  const uebernehmen = () => {
    ziel[feld] = LESEN[art](i.value);
    zeigen();
    einheitZeigen();
    befundeAktualisieren();
  };
  i.addEventListener('change', uebernehmen);
  i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); });
  return el('div', { class: 'zeile' }, el('label', { for: id, text: titel }), i, einheitEl);
}

let befundeKnoten = null;

function befundeAbschnitt() {
  const befunde = pruefe(z.angebot);
  const zeilen = [];
  if (z.seitenOhneText.length) {
    const seiten = z.seitenOhneText.map(s => s + 1).join(', ');
    zeilen.push(el('div', { class: 'zeile befund fehlt' }, symbol('frage'),
      el('span', { text: `Seite ${seiten} enthält keinen lesbaren Text und wurde übersprungen.` })));
  }
  for (const b of befunde) {
    zeilen.push(el('div', { class: `zeile befund ${b.gewicht}` },
      symbol(b.gewicht === 'widerspruch' ? 'warn' : 'frage'), el('span', { text: b.text })));
  }
  return zeilen.length ? gruppe('Bitte prüfen', zeilen) : el('div');
}

function befundeAktualisieren() {
  if (!befundeKnoten) return;
  const neuerKnoten = befundeAbschnitt();
  befundeKnoten.replaceWith(neuerKnoten);
  befundeKnoten = neuerKnoten;
}

function titelAktualisieren() {
  $('titel').textContent = displayName(z.angebot.vehicle) ?? 'Angebot';
}

function zeichneEditor() {
  const a = z.angebot;
  leiste(displayName(a.vehicle) ?? 'Angebot',
    leistenknopf('Neu', neu),
    leistenknopf('Einseiter', () => gehe('vorschau'), true));

  const teile = [];
  if (!z.erkannt) {
    teile.push(gruppe(null, el('div', { class: 'zeile hinweis-kopf' }, symbol('warn'),
      el('div', {},
        el('span', { text: 'Das Angebot konnte nicht vollständig erkannt werden.' }),
        el('small', { text: 'Du kannst die erkannten Daten überprüfen und fehlende Angaben manuell ergänzen.' })))));
  }
  befundeKnoten = befundeAbschnitt();
  teile.push(befundeKnoten);

  for (const [titel, felder] of ABSCHNITTE) {
    if (titel === '@links') {
      teile.push(gruppe(null, [
        el('button', { class: 'zeile pfeil', onclick: () => gehe('highlights') },
          el('span', { class: 'titel', text: 'Highlights' }),
          el('span', { class: 'wert', text: String(a.highlightCodes.length) })),
        el('button', { class: 'zeile pfeil', onclick: () => gehe('bilder') },
          el('span', { class: 'titel', text: 'Bilder' }),
          el('span', { class: 'wert', text: String(a.images.length) })),
      ]));
      continue;
    }
    if (titel === '@leasing') {
      a.leasingOptions.forEach((o, n) => {
        teile.push(gruppe(a.leasingOptions.length > 1 ? `Leasing ${n + 1}` : 'Leasing',
          LEASING_FELDER.map(([f, t, art, e]) => feldZeile(o, f, t, art, e))));
      });
      const knoepfe = [el('button', { class: 'zeile aktion', text: 'Leasingangebot hinzufügen',
        onclick: () => { a.leasingOptions.push(leereLeasingOption()); zeichne(); } })];
      if (a.leasingOptions.length) {
        knoepfe.push(el('button', { class: 'zeile gefahr', text: 'Letztes Leasingangebot entfernen',
          onclick: () => { a.leasingOptions.pop(); zeichne(); } }));
      }
      teile.push(gruppe(null, knoepfe));
      continue;
    }
    const elektro = isElectric(a.technicalData);
    const zeilen = felder
      .filter(([, , , , , nur]) => nur !== 'elektro' || elektro)
      .map(([pfad, feld, t, art, e]) => feldZeile(a[pfad], feld, t, art, e));
    teile.push(gruppe(titel, zeilen));
  }
  inhalt.replaceChildren(...teile);
}

// ── Highlights ───────────────────────────────────────────────────────────

function zeichneHighlights() {
  const a = z.angebot;
  leiste('Highlights', zurueck());

  const gewaehlt = highlights(a);
  const codes = new Set(a.highlightCodes);
  const verschiebe = (i, d) => {
    const c = a.highlightCodes;
    [c[i], c[i + d]] = [c[i + d], c[i]];
    zeichneHighlights();
  };

  const auswahl = gewaehlt.map((p, i) => el('div', { class: 'zeile' },
    rund('minus', 'weg', `${p.name} entfernen`, () => {
      a.highlightCodes = a.highlightCodes.filter(c => c !== p.code);
      zeichneHighlights();
    }),
    postenText(p),
    rund('hoch', '', `${p.name} nach oben`, () => verschiebe(i, -1), i === 0),
    rund('runter', '', `${p.name} nach unten`, () => verschiebe(i, 1), i === gewaehlt.length - 1)));

  const n = gewaehlt.length;
  const fuss = n < MINDESTENS || n > HOECHSTENS
    ? `Empfohlen sind ${MINDESTENS} bis ${HOECHSTENS} Highlights.` : null;

  const eingabe = el('input', { type: 'text', placeholder: 'Eigene Position, z. B. Anhängerkupplung', autocomplete: 'off' });
  const dazuKnopf = el('button', { text: 'Hinzufügen', disabled: true });
  const eigeneDazu = () => {
    const name = eingabe.value.trim();
    if (!name) return;
    const code = `EIGEN-${neueId()}`;
    a.equipment.push({ code, name, price: null, category: 'special', isPackageContent: false,
                       parentCode: null, sourcePage: null });
    a.highlightCodes.push(code);
    zeichneHighlights();
  };
  eingabe.addEventListener('input', () => { dazuKnopf.disabled = !eingabe.value.trim(); });
  eingabe.addEventListener('keydown', e => { if (e.key === 'Enter') eigeneDazu(); });
  dazuKnopf.addEventListener('click', eigeneDazu);

  const suche = el('input', { class: 'suche', type: 'search', placeholder: 'Ausstattung suchen', value: z.suche });
  const weitereKarte = el('div', { class: 'karte' });
  const weitereFuellen = () => {
    const q = z.suche.toLocaleLowerCase('de');
    const uebrige = a.equipment.filter(p => !codes.has(p.code) && (!q || p.name.toLocaleLowerCase('de').includes(q)));
    weitereKarte.replaceChildren(...uebrige.map(p => el('div', { class: 'zeile' },
      postenText(p),
      rund('plus', 'dazu', `${p.name} hinzufügen`, () => {
        a.highlightCodes.push(p.code);
        zeichneHighlights();
      }))));
    if (!uebrige.length) {
      weitereKarte.append(el('div', { class: 'zeile' },
        el('span', { class: 'posten', text: a.equipment.length ? 'Keine Treffer.' : 'Keine Ausstattung im Angebot.' })));
    }
  };
  suche.addEventListener('input', () => { z.suche = suche.value; weitereFuellen(); });
  weitereFuellen();

  inhalt.replaceChildren(
    gruppe(`Auf dem Einseiter (${n})`, auswahl.length ? auswahl
      : [el('div', { class: 'zeile' }, el('span', { class: 'posten', text: 'Noch keine Highlights gewählt.' }))],
      fuss, 'warnung'),
    gruppe(null, el('div', { class: 'zeile eigene' }, eingabe, dazuKnopf),
      'Für Ausstattung, die im Angebot fehlt oder nicht erkannt wurde.'),
    el('section', { class: 'gruppe' }, el('h3', { text: 'Weitere Ausstattung' }), suche, weitereKarte));
}

function postenText(p) {
  let klein = null;
  if (p.isPackageContent) klein = 'Paketinhalt';
  else if (p.price) klein = Zahlen.betrag(p.price);
  return el('div', { class: 'posten' }, el('span', { text: p.name }), klein ? el('small', { text: klein }) : null);
}

// ── Bilder ───────────────────────────────────────────────────────────────

const bildAdressen = new Map(); // id → blob-URL, damit nicht bei jedem Zeichnen neu erzeugt

function bildAdresse(b) {
  if (!bildAdressen.has(b.id)) {
    bildAdressen.set(b.id, URL.createObjectURL(new Blob([b.data], { type: b.mime })));
  }
  return bildAdressen.get(b.id);
}

$('bild-wahl').addEventListener('change', async e => {
  const dateien = [...(e.target.files ?? [])];
  e.target.value = '';
  let fehlgeschlagen = 0;
  for (const d of dateien) {
    try { z.angebot.images.push(await alsJpeg(d)); }
    catch { fehlgeschlagen++; }
  }
  if (fehlgeschlagen) meldung(`${fehlgeschlagen} Bild(er) konnten nicht gelesen werden.`);
  zeichneBilder();
});

/**
 * Fotos vom iPhone kommen oft als HEIC. Der Einseiter bekommt JPEG — und nur die
 * Bildpunkte, also keine Ortsdaten aus den Metadaten.
 */
async function alsJpeg(datei) {
  const bild = await createImageBitmap(datei);
  const max = 2000;
  const f = Math.min(1, max / Math.max(bild.width, bild.height));
  const w = Math.round(bild.width * f), h = Math.round(bild.height * f);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(bild, 0, 0, w, h);
  bild.close?.();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('kein Bild');
  return { id: neueId(), data: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg',
           kind: 'unknown', sourcePage: null, pixelWidth: w, pixelHeight: h, caption: null };
}

function zeichneBilder() {
  const a = z.angebot;
  leiste('Bilder', zurueck());
  const bilder = a.images;
  const verschiebe = (i, d) => { [bilder[i], bilder[i + d]] = [bilder[i + d], bilder[i]]; zeichneBilder(); };

  const liste = bilder.map((b, i) => {
    const eingabe = el('input', { type: 'text', placeholder: 'Bildunterschrift (optional)', value: b.caption ?? '' });
    eingabe.addEventListener('input', () => { b.caption = eingabe.value || null; });
    return el('div', { class: 'zeile bild' },
      el('img', { src: bildAdresse(b), alt: `Bild ${i + 1}` }),
      el('div', { class: 'bildzeile' },
        eingabe,
        rund('hoch', '', `Bild ${i + 1} nach vorn`, () => verschiebe(i, -1), i === 0),
        rund('runter', '', `Bild ${i + 1} nach hinten`, () => verschiebe(i, 1), i === bilder.length - 1),
        rund('minus', 'weg', `Bild ${i + 1} entfernen`, () => {
          URL.revokeObjectURL(bildAdressen.get(b.id));
          bildAdressen.delete(b.id);
          bilder.splice(i, 1);
          zeichneBilder();
        })));
  });

  inhalt.replaceChildren(
    gruppe(null, el('button', { class: 'zeile aktion', text: 'Bilder hinzufügen', onclick: () => $('bild-wahl').click() }),
      bilder.length ? 'Das erste Bild wird groß gezeigt, die nächsten drei in der Leiste darunter.'
        : 'Im Angebot wurden keine Bilder gefunden.'),
    liste.length ? gruppe(null, liste) : el('div'));
}

// ── Vorschau und Teilen ──────────────────────────────────────────────────

function dateiname() {
  const teile = ['Angebot', displayName(z.angebot.vehicle), z.angebot.offer.offerNumber].filter(Boolean);
  return teile.join(' ').replace(/[/:\\]/g, '-') + '.pdf';
}

async function zeichneVorschau() {
  leiste('Einseiter', zurueck());
  inhalt.replaceChildren(el('div', { class: 'mitte' }, el('div', { class: 'lader' }), el('p', { text: 'Einseiter wird erstellt …' })));

  let bytes;
  try {
    const { renderEinseiter } = await import('./kern/renderer.js');
    bytes = await renderEinseiter(z.angebot);
  } catch {
    if (z.ansicht !== 'vorschau') return;
    inhalt.replaceChildren(el('div', { class: 'mitte' }, symbol('frage', 'symbol'),
      el('h2', { text: 'Einseiter nicht erstellt' }),
      el('p', { text: 'Beim Erstellen ist ein Fehler aufgetreten. Bitte prüfe die Angaben und versuche es erneut.' })));
    return;
  }
  if (z.ansicht !== 'vorschau') return;

  const datei = new File([bytes], dateiname(), { type: 'application/pdf' });
  const adresse = URL.createObjectURL(datei);

  const blatt = el('div', { class: 'blatt' });
  const knoepfe = el('div', { class: 'vorschau-knoepfe' });
  const kannTeilen = navigator.canShare?.({ files: [datei] });
  if (kannTeilen) {
    knoepfe.append(el('button', { class: 'knopf', text: 'Teilen', onclick: async () => {
      try { await navigator.share({ files: [datei], title: datei.name }); }
      catch (e) { if (e?.name !== 'AbortError') meldung('Teilen hat nicht geklappt.'); }
    } }));
  }
  knoepfe.append(el('a', { class: `knopf${kannTeilen ? ' zweit' : ''}`, href: adresse, download: datei.name,
                           text: 'Als PDF sichern' }));
  leiste('Einseiter', zurueck());
  inhalt.replaceChildren(blatt, knoepfe);

  // Vorschau mit pdf.js zeichnen — ein <iframe> zeigt PDFs auf dem iPhone unzuverlässig.
  try {
    const { pdfjs } = await bibliotheken();
    const pdf = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, isEvalSupported: false }).promise;
    const seite = await pdf.getPage(1);
    const breite = Math.min(inhalt.clientWidth || 360, 720);
    const skala = (breite / seite.getViewport({ scale: 1 }).width) * Math.min(window.devicePixelRatio || 1, 3);
    const vp = seite.getViewport({ scale: skala });
    const c = el('canvas', { width: Math.round(vp.width), height: Math.round(vp.height), 'aria-label': 'Vorschau des Einseiters', role: 'img' });
    await seite.render({ canvasContext: c.getContext('2d'), viewport: vp, canvas: c }).promise;
    blatt.append(c);
  } catch {
    blatt.append(el('p', { class: 'fuss', text: 'Die Vorschau kann nicht angezeigt werden – das PDF ist trotzdem fertig.' }));
  }
}

// ── Start ────────────────────────────────────────────────────────────────

history.replaceState({ ansicht: 'editor' }, '');
zeichne();

// Offline-Fähigkeit. Nur über https bzw. localhost verfügbar.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Nur für automatische Tests im lokalen Browser: ?test lädt eine Datei per Auswahl-Hook.
// ?pdf=<Datei> lädt ein Angebot vom selben Server, ?ansicht=<name> springt direkt hin.
if (location.hostname === 'localhost' && new URLSearchParams(location.search).has('test')) {
  window.__oeffne = oeffne;
  window.__zustand = z;
  const p = new URLSearchParams(location.search);
  if (p.get('pdf')) {
    fetch(p.get('pdf')).then(r => r.blob()).then(b => oeffne(b)).then(() => {
      if (p.get('ansicht')) gehe(p.get('ansicht'));
    });
  }
}
