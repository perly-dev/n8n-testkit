/**
 * Le asserzioni, in forma dichiarativa.
 *
 * Chi mantiene workflow n8n per i clienti spesso non è uno sviluppatore, e non
 * vuole scrivere JavaScript per provare del JavaScript. Qui una prova si
 * dichiara: percorso del campo, operatore, valore atteso.
 */

import { isDeepStrictEqual } from 'node:util';

/**
 * Il messaggio di una cosa lanciata. In JavaScript si può lanciare qualunque
 * cosa: `throw 'testo'` non ha `.message`, e leggerlo dava «undefined» — che è
 * il modo peggiore di raccontare un guasto a chi sta cercando di capirlo.
 */
export function motivo(e) {
  if (e instanceof Error) return e.message || String(e);
  if (typeof e === 'string') return e;
  // Deve SEMPRE restituire una stringa: chi la riceve ci chiama .includes(),
  // e un undefined qui faceva morire l'intera suite con un TypeError.
  try {
    const s = JSON.stringify(e);
    return s === undefined ? String(e) : s;
  } catch {
    return String(e);
  }
}

/** Legge «0.json.category» dentro il risultato, senza esplodere sui pezzi mancanti. */
export function leggiPercorso(dati, percorso) {
  return String(percorso).split('.').reduce((acc, chiave) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[chiave];
  }, dati);
}

// Confronto profondo vero. Con JSON.stringify due oggetti identici ma con le
// chiavi in ordine diverso risultavano diversi — e in n8n l'ordine delle chiavi
// dipende da come il nodo le ha costruite, quindi era un rosso a caso.
const uguali = (a, b) => isDeepStrictEqual(a, b);

const OPERATORI = {
  equals: (a, b) => uguali(a, b),
  notEquals: (a, b) => !uguali(a, b),
  contains: (a, b) => String(a ?? '').includes(String(b)),
  notContains: (a, b) => !String(a ?? '').includes(String(b)),
  matches: (a, b) => new RegExp(b).test(String(a ?? '')),
  notMatches: (a, b) => !new RegExp(b).test(String(a ?? '')),
  empty: (a) => a === undefined || a === null || a === '' ||
                (Array.isArray(a) && a.length === 0),
  notEmpty: (a) => !(a === undefined || a === null || a === '' ||
                    (Array.isArray(a) && a.length === 0)),
  between: (a, [min, max]) => Number(a) >= min && Number(a) <= max,
  greaterThan: (a, b) => Number(a) > Number(b),
  lessThan: (a, b) => Number(a) < Number(b),
  oneOf: (a, b) => (Array.isArray(b) ? b : [b]).some((x) => uguali(x, a)),
  length: (a, b) => (a?.length ?? -1) === b,
};

export const operatoriDisponibili = Object.keys(OPERATORI);

/**
 * Verifica un elenco di asserzioni contro il risultato di un nodo.
 * Restituisce i fallimenti, non lancia: chi chiama decide cosa farne.
 */
export function verifica(risultato, asserzioni = []) {
  const fallimenti = [];
  for (const a of asserzioni) {
    const op = a.operator || 'equals';
    const fn = OPERATORI[op];
    if (!fn) {
      fallimenti.push({
        path: a.path,
        message: `unknown operator "${op}". Available: ${operatoriDisponibili.join(', ')}`,
        why: a.why || null,
      });
      continue;
    }
    const ottenuto = leggiPercorso(risultato, a.path);
    let passa;
    try {
      passa = fn(ottenuto, a.value);
    } catch (e) {
      fallimenti.push({
        path: a.path,
        message: `the assertion itself threw: ${motivo(e)}`,
        why: a.why || null,
      });
      continue;
    }
    if (!passa) {
      fallimenti.push({
        path: a.path,
        operator: op,
        expected: a.value,
        got: ottenuto,
        why: a.why || null,
      });
    }
  }
  return fallimenti;
}
