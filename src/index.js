/**
 * n8n-testkit — esegue la logica di un workflow n8n contro dati di prova e
 * fallisce quando cambia in peggio.
 */

import { caricaWorkflow, codiceDelNodo, nodiCode } from './workflow.js';
import { creaAmbiente, eseguiNodoCode } from './ambiente.js';
import { verifica } from './asserzioni.js';

export { caricaWorkflow, codiceDelNodo, nodiCode, creaAmbiente, eseguiNodoCode, verifica };

/**
 * Esegue una singola prova.
 *
 * @param {object} wf     workflow già caricato
 * @param {object} prova  { nome, nodo, input, nodi, env, vars, adesso, attende, lancia }
 */
export function eseguiProva(wf, prova) {
  const inizio = Date.now();
  const esito = { name: prova.name || prova.node, node: prova.node, passed: false, failures: [] };

  let codice;
  try {
    codice = codiceDelNodo(wf, prova.node);
  } catch (e) {
    esito.failures.push({ message: e.message });
    esito.ms = Date.now() - inizio;
    return esito;
  }

  const ambiente = creaAmbiente({
    input: prova.input || [],
    nodi: prova.nodes || {},
    env: prova.env || {},
    vars: prova.vars || {},
    adesso: prova.now,
  });

  let risultato;
  try {
    risultato = eseguiNodoCode(codice, ambiente);
  } catch (e) {
    // Un errore può essere il comportamento GIUSTO: un cancello che rifiuta una
    // richiesta non firmata DEVE lanciare. Si dichiara con "lancia".
    if (prova.throws) {
      const atteso = typeof prova.throws === 'string' ? prova.throws : null;
      if (!atteso || new RegExp(atteso).test(e.message)) {
        esito.passed = true;
        esito.ms = Date.now() - inizio;
        return esito;
      }
      esito.failures.push({
        message: `expected a thrown error matching "${atteso}", got: ${e.message}`,
      });
      esito.ms = Date.now() - inizio;
      return esito;
    }
    esito.failures.push({ message: `the node threw: ${e.message}` });
    esito.ms = Date.now() - inizio;
    return esito;
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
export function eseguiSuite(suite, { base = '' } = {}) {
  const assoluto = suite.workflow.startsWith('/') || /^[A-Za-z]:[\\/]/.test(suite.workflow);
  const percorso = (base && !assoluto) ? `${base}/${suite.workflow}` : suite.workflow;
  const wf = caricaWorkflow(percorso);
  const esiti = (suite.tests || []).map((p) => eseguiProva(wf, p));
  return {
    workflow: suite.workflow,
    nodiCode: nodiCode(wf),
    esiti,
    passed_count: esiti.filter((e) => e.passed).length,
    failed: esiti.filter((e) => !e.passed).length,
  };
}
