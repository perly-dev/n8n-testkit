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
  // La lingua la decide «language», come fa n8n: un nodo passato a Python può
  // conservare il vecchio jsCode, e fidarsi di quello significherebbe eseguire
  // codice che in produzione non gira più.
  if (inPython(n)) {
    throw new Error(
      `Code node "${nome}" is set to Python, which this tool does not run. ` +
      `It reproduces the JavaScript Code node only.`
    );
  }
  const codice = parametri.jsCode;
  if (!codice) throw new Error(`Code node "${nome}" is empty.`);
  return { codice, perItem: parametri.mode === 'runOnceForEachItem' };
}

/** Un nodo Code impostato su Python: c'è, ma questo strumento non lo esegue. */
function inPython(n) {
  const lingua = (n.parameters || {}).language;
  return typeof lingua === 'string' && lingua.toLowerCase().includes('python');
}

/**
 * I nodi Code che si possono davvero provare, e quelli che no col loro motivo.
 *
 * Elencare fra i «testabili» un nodo Python, uno vuoto o un nome duplicato
 * manda l'utente a scrivere una prova che non potrà mai girare.
 */
export function nodiCode(wf) {
  const code = wf.nodes.filter((n) => n && n.type === CODE);
  // I duplicati si contano su TUTTI i nodi, come fa codiceDelNodo: un Code node
  // e un nodo HTTP con lo stesso nome venivano elencati come provabili e poi
  // rifiutati all'esecuzione.
  const conteggio = new Map();
  for (const n of wf.nodes) {
    if (n && n.name) conteggio.set(n.name, (conteggio.get(n.name) || 0) + 1);
  }

  const provabili = [];
  const esclusi = [];
  const visti = new Set();
  for (const n of code) {
    if (conteggio.get(n.name) > 1) {
      if (!visti.has(n.name)) {
        visti.add(n.name);
        esclusi.push({ nome: n.name, perche: `${conteggio.get(n.name)} nodes in this workflow share this name` });
      }
      continue;
    }
    if (inPython(n)) esclusi.push({ nome: n.name, perche: 'written in Python' });
    else if (!(n.parameters || {}).jsCode) esclusi.push({ nome: n.name, perche: 'empty' });
    else provabili.push(n.name);
  }
  return { provabili, esclusi };
}
