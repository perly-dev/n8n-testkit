/**
 * n8n-testkit — esegue la logica di un workflow n8n contro dati di prova e
 * fallisce quando cambia in peggio.
 */

import { caricaWorkflow, codiceDelNodo, nodiCode } from './workflow.js';
import { creaAmbiente, eseguiNodoCode, eseguiNodoPerItem } from './ambiente.js';
import { verifica, motivo } from './asserzioni.js';

export { caricaWorkflow, codiceDelNodo, nodiCode, creaAmbiente, eseguiNodoCode, verifica };

/**
 * Esegue una singola prova.
 *
 * @param {object} wf     workflow già caricato
 * @param {object} prova  { nome, nodo, input, nodi, env, vars, adesso, attende, lancia }
 */
export async function eseguiProva(wf, prova) {
  const inizio = Date.now();
  const esito = { name: prova.name || prova.node, node: prova.node, passed: false, failures: [] };

  const chiudi = (messaggio) => {
    esito.failures.push({ message: messaggio });
    esito.ms = Date.now() - inizio;
    return esito;
  };

  // Una prova scritta male deve far fallire QUELLA prova, non buttare giù
  // l'intera suite lasciando le altre non eseguite.
  if (prova.input !== undefined && !Array.isArray(prova.input)) {
    return chiudi(`"input" must be an array of items, got ${typeof prova.input}. ` +
                  `A single item goes in a list of one: "input": [{ ... }]`);
  }
  if (prova.expect !== undefined && !Array.isArray(prova.expect)) {
    return chiudi(`"expect" must be an array of assertions, got ${typeof prova.expect}.`);
  }

  let nodo;
  try {
    nodo = codiceDelNodo(wf, prova.node);
  } catch (e) {
    return chiudi(motivo(e));
  }

  const opzioni = {
    input: prova.input || [],
    nodi: prova.nodes || {},
    env: prova.env || {},
    vars: prova.vars || {},
    adesso: prova.now,
  };

  let risultato;
  try {
    risultato = nodo.perItem
      ? await eseguiNodoPerItem(nodo.codice, opzioni)
      : await eseguiNodoCode(nodo.codice, creaAmbiente(opzioni));
  } catch (e) {
    // Un errore può essere il comportamento GIUSTO: un cancello che rifiuta una
    // richiesta non firmata DEVE lanciare. Si dichiara con "throws".
    if (prova.throws) {
      const atteso = typeof prova.throws === 'string' ? prova.throws : null;
      // Testo letterale, non espressione regolare: con la regex un messaggio
      // come «cost [EUR] missing» non corrispondeva a se stesso, e il rapporto
      // mostrava due stringhe identiche con la prova rossa.
      if (!atteso || motivo(e).includes(atteso)) {
        esito.passed = true;
        esito.ms = Date.now() - inizio;
        return esito;
      }
      return chiudi(`expected the error message to contain "${atteso}", got: ${motivo(e)}`);
    }
    return chiudi(`the node threw: ${motivo(e)}`);
  }

  if (prova.throws) {
    esito.failures.push({
      message: `this node was supposed to throw and it passed instead. ` +
               `If this is a security check, it no longer protects anything.`,
    });
    esito.ms = Date.now() - inizio;
    return esito;
  }

  esito.result = risultato;
  esito.failures = verifica(risultato, prova.expect || []);
  esito.passed = esito.failures.length === 0;
  esito.ms = Date.now() - inizio;
  return esito;
}

/** Esegue tutte le prove di un file di prove già caricato. */
export async function eseguiSuite(suite, { base = '' } = {}) {
  const assoluto = suite.workflow.startsWith('/') || /^[A-Za-z]:[\\/]/.test(suite.workflow);
  const percorso = (base && !assoluto) ? `${base}/${suite.workflow}` : suite.workflow;
  const wf = caricaWorkflow(percorso);
  const esiti = [];
  for (const p of suite.tests || []) esiti.push(await eseguiProva(wf, p));
  return {
    workflow: suite.workflow,
    nodiCode: nodiCode(wf),
    esiti,
    passed_count: esiti.filter((e) => e.passed).length,
    failed: esiti.filter((e) => !e.passed).length,
  };
}
