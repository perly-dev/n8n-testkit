/**
 * Le asserzioni, in forma dichiarativa.
 *
 * Chi mantiene workflow n8n per i clienti spesso non è uno sviluppatore, e non
 * vuole scrivere JavaScript per provare del JavaScript. Qui una prova si
 * dichiara: percorso del campo, operatore, valore atteso.
 */

/** Legge «0.json.category» dentro il risultato, senza esplodere sui pezzi mancanti. */
export function leggiPercorso(dati, percorso) {
  return String(percorso).split('.').reduce((acc, chiave) => {
    if (acc === undefined || acc === null) return undefined;
    return acc[chiave];
  }, dati);
}

const OPERATORI = {
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  notEquals: (a, b) => JSON.stringify(a) !== JSON.stringify(b),
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
  oneOf: (a, b) => (Array.isArray(b) ? b : [b]).some((x) => JSON.stringify(x) === JSON.stringify(a)),
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
      });
      continue;
    }
    const ottenuto = leggiPercorso(risultato, a.path);
    let passa;
    try {
      passa = fn(ottenuto, a.value);
    } catch (e) {
      fallimenti.push({ path: a.path, message: `the assertion itself threw: ${e.message}` });
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
