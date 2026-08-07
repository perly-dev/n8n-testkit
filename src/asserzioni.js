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

/**
 * I confronti numerici accettano numeri veri e stringhe numeriche non vuote.
 * Tutto il resto è un errore di prova, non uno zero implicito: Number(null),
 * Number(''), Number([]) e Number(true) sono conversioni JavaScript valide ma
 * pessime per un test, perché possono trasformare un campo assente in un verde.
 */
class ErroreNumerico extends Error {}

function descriviValore(v) {
  if (v === undefined) return 'undefined (the path is missing)';
  if (typeof v === 'number' && Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return 'Infinity';
  if (v === -Infinity) return '-Infinity';
  try {
    const json = JSON.stringify(v);
    return json === undefined ? String(v) : json;
  } catch {
    return String(v);
  }
}

function numeroFinito(v, ruolo) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const convertito = Number(v);
    if (Number.isFinite(convertito)) return convertito;
  }
  throw new ErroreNumerico(
    `${ruolo} must be a finite number or a non-empty numeric string; got ${descriviValore(v)}.`
  );
}

const valoreNumerico = (v, a) => numeroFinito(v, `Value at path "${a.path}"`);
const attesoNumerico = (v, op) => numeroFinito(v, `Expected value for "${op}"`);

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
  between: (a, intervallo, asserzione) => {
    if (!Array.isArray(intervallo) || intervallo.length !== 2) {
      throw new ErroreNumerico(
        `Expected value for "between" must be a two-value list [min, max]; ` +
        `got ${descriviValore(intervallo)}.`
      );
    }
    const valore = valoreNumerico(a, asserzione);
    const min = numeroFinito(intervallo[0], 'Minimum for "between"');
    const max = numeroFinito(intervallo[1], 'Maximum for "between"');
    return valore >= min && valore <= max;
  },
  greaterThan: (a, b, asserzione) =>
    valoreNumerico(a, asserzione) > attesoNumerico(b, 'greaterThan'),
  lessThan: (a, b, asserzione) =>
    valoreNumerico(a, asserzione) < attesoNumerico(b, 'lessThan'),
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
      passa = fn(ottenuto, a.value, a);
    } catch (e) {
      fallimenti.push({
        path: a.path,
        message: e instanceof ErroreNumerico
          ? motivo(e)
          : `the assertion itself threw: ${motivo(e)}`,
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
