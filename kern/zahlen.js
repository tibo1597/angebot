// Deutsche Zahlen lesen und schreiben — Nachbau von Zahlen.swift.
// Beträge sind JS-Zahlen, beim Lesen auf Cent gerundet.

/** "115.910,00" → 115910, "- 32.998,70" → -32998.7, "2.993 cm3" → 2993, "-s" → null */
export function dezimal(text) {
  if (text == null) return null;
  let roh = '';
  let negativ = false;
  let zifferGesehen = false;
  for (const z of String(text)) {
    if (z >= '0' && z <= '9') { roh += z; zifferGesehen = true; }
    else if (z === '.' || z === ',') { if (zifferGesehen) roh += z; }
    else if (z === '-' || z === '−' || z === '–') { if (!zifferGesehen) negativ = true; }
    else if (z === ' ' || z === ' ' || z === ' ') { continue; }
    else if (zifferGesehen) break;
  }
  return abschliessen(roh, negativ);
}

function abschliessen(roh, negativ) {
  if (!/\d/.test(roh)) return null;
  let ganz = roh, bruch = '';
  const k = roh.lastIndexOf(',');
  if (k >= 0) {
    ganz = roh.slice(0, k);
    bruch = roh.slice(k + 1);
    if (bruch.includes(',') || bruch.includes('.')) return null;
  }
  ganz = ganz.replaceAll('.', '');
  if (!ganz && !bruch) return null;
  const zusammen = bruch ? `${ganz || '0'}.${bruch}` : ganz;
  const wert = Number(zusammen);
  if (!Number.isFinite(wert)) return null;
  const gerundet = Math.round(wert * 10000) / 10000;
  return negativ ? -gerundet : gerundet;
}

export function ganzzahl(text) {
  const w = dezimal(text);
  return w == null ? null : Math.trunc(w);
}

/** "…vom 23.09.2026" → "2026-09-23" (ISO, wie <input type=date> es braucht) */
export function datum(text) {
  if (text == null) return null;
  const t = String(text).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return t ? `${t[3]}-${t[2]}-${t[1]}` : null;
}

const betragsFormat = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dezimalFormat = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const ganzFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

/** 84190.3 → "84.190,30 €" */
export function betrag(wert, mitWaehrung = true) {
  if (wert == null) return null;
  const t = betragsFormat.format(wert);
  return mitWaehrung ? `${t} €` : t;
}

/** 10.3 → "10,3" */
export function zahl(wert) {
  return wert == null ? null : dezimalFormat.format(wert);
}

/** 10000 → "10.000" */
export function ganzzahlText(wert) {
  return wert == null ? null : ganzFormat.format(wert);
}

/** "2026-09-23" → "23.09.2026" */
export function datumsText(iso) {
  if (!iso) return null;
  const t = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return t ? `${t[3]}.${t[2]}.${t[1]}` : null;
}
