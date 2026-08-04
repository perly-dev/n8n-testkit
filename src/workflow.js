/**
 * Lettura di un workflow n8n esportato: trovare i nodi, il loro codice, e dire
 * cose utili quando qualcosa non torna.
 */

import { readFileSync } from 'node:fs';

const STICKY = 'n8n-nodes-base.stickyNote';
const CODE = 'n8n-nodes-base.code';

export function caricaWorkflow(percorso) {
  let grezzo;
  try {
    grezzo = readFileSync(percorso, 'utf8');
  } catch (e) {
    throw new Error(`Cannot read workflow "${percorso}": ${e.message}`);
  }
  let wf;
  try {
    wf = JSON.parse(grezzo);
  } catch (e) {
    throw new Error(`"${percorso}" is not valid JSON: ${e.message}`);
  }
  if (!wf || !Array.isArray(wf.nodes)) {
    throw new Error(
      `"${percorso}" does not look like an n8n workflow: no "nodes" array. ` +
      `Export it from n8n with Download — copying the canvas is not enough.`
    );
  }
  return wf;
}

/** I nodi veri, senza le note adesive. */
export function nodiDiLavoro(wf) {
  return wf.nodes.filter((n) => n && n.type !== STICKY);
}

/**
 * Il codice di un nodo Code, per nome.
 *
 * Quando il nome non esiste elenca quelli che esistono: nove volte su dieci è
 * un nodo rinominato dopo che la prova era stata scritta, e vedere l'elenco
 * risolve in due secondi.
 */
export function codiceDelNodo(wf, nome) {
  const trovati = wf.nodes.filter((x) => x && x.name === nome);
  // Due nodi con lo stesso nome: n8n lo permette, e prima vinceva il primo in
  // silenzio. Una prova che gira su un nodo diverso da quello che credi è
  // peggio di una prova che non gira.
  if (trovati.length > 1) {
    throw new Error(
      `This workflow has ${trovati.length} nodes called "${nome}", so there is no way ` +
      `to tell which one you mean. Rename them on the canvas — n8n allows the clash, ` +
      `this does not.`
    );
  }
  const n = trovati[0];
  if (!n) {
    const disponibili = nodiDiLavoro(wf).map((x) => `"${x.name}"`).join(', ');
    throw new Error(`No node called "${nome}" in this workflow. There is: ${disponibili}`);
  }
  if (n.type !== CODE) {
    throw new Error(
      `Node "${nome}" is a ${n.type}, not a Code node: there is no code to run. ` +
      `This tool tests the logic you wrote, not calls to external services.`
    );
  }
  const parametri = n.parameters || {};
  if (parametri.pythonCode && !parametri.jsCode) {
    throw new Error(
      `Code node "${nome}" is written in Python, which this tool does not run. ` +
      `It reproduces the JavaScript Code node only.`
    );
  }
  const codice = parametri.jsCode;
  if (!codice) throw new Error(`Code node "${nome}" is empty.`);
  return { codice, perItem: parametri.mode === 'runOnceForEachItem' };
}

/** Tutti i nodi Code: serve a suggerire cosa si può provare. */
export function nodiCode(wf) {
  return wf.nodes.filter((n) => n && n.type === CODE).map((n) => n.name);
}
