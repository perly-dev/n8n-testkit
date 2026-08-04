#!/usr/bin/env node
/**
 * n8n-testkit — riga di comando.
 *
 *   n8n-testkit prove.json          esegue le prove
 *   n8n-testkit --nodi flusso.json  elenca i nodi Code che si possono provare
 *
 * Esce con 1 se anche una sola prova fallisce: è quello che serve perché possa
 * girare da solo a ogni modifica e fermare una consegna rotta.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eseguiSuite, caricaWorkflow, nodiCode } from '../src/index.js';

const ROSSO = '\x1b[31m', VERDE = '\x1b[32m', GRIGIO = '\x1b[90m', GRASSETTO = '\x1b[1m', FINE = '\x1b[0m';
const colora = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (col, t) => (colora ? col + t + FINE : t);

/** Manda a capo un testo alla larghezza data, senza spezzare le parole. */
function aCapo(testo, larghezza) {
  const righe = [];
  let riga = '';
  for (const parola of String(testo).split(/\s+/).filter(Boolean)) {
    if (riga && (riga + ' ' + parola).length > larghezza) { righe.push(riga); riga = parola; }
    else riga = riga ? riga + ' ' + parola : parola;
  }
  if (riga) righe.push(riga);
  return righe;
}

const argomenti = process.argv.slice(2);

if (!argomenti.length || argomenti.includes('--help') || argomenti.includes('-h')) {
  console.log(`
${c(GRASSETTO, 'n8n-testkit')} — run your n8n workflow logic against fixtures

  n8n-testkit <tests.json>             run the tests
  n8n-testkit --nodes <workflow.json>  list the Code nodes you can test

Exits with code 1 when any test fails, so it can gate a deploy.
No n8n instance, no credentials, no side effects.

Docs: https://github.com/perly-dev/n8n-testkit
`);
  process.exit(0);
}

if (argomenti[0] === '--version' || argomenti[0] === '-v') {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

if (argomenti[0] === '--nodes' || argomenti[0] === '--nodi') {
  if (!argomenti[1]) {
    console.error(c(ROSSO, 'Which workflow? Usage: n8n-testkit --nodes <workflow.json>'));
    process.exit(2);
  }
  let wf;
  try {
    wf = caricaWorkflow(argomenti[1]);
  } catch (e) {
    // Questo è il primo comando che il README suggerisce: qui uno stack trace
    // dice a chi arriva che il programma è rotto, non il suo file.
    console.error(c(ROSSO, e.message));
    process.exit(2);
  }
  const nodi = nodiCode(wf);
  if (!nodi.length) {
    console.log('This workflow has no Code nodes: there is no logic of yours to test.');
    process.exit(0);
  }
  console.log(`\nCode nodes in «${wf.name || argomenti[1]}»:\n`);
  for (const n of nodi) console.log(`  ${n}`);
  console.log('');
  process.exit(0);
}

if (argomenti[0].startsWith('-')) {
  console.error(c(ROSSO, `Unknown option "${argomenti[0]}". Try --help.`));
  process.exit(2);
}

const percorsoProve = resolve(argomenti[0]);
const base = dirname(percorsoProve);

let suite;
try {
  if (/\.(mjs|js)$/.test(percorsoProve)) {
    suite = (await import(pathToFileURL(percorsoProve).href)).default;
  } else {
    suite = JSON.parse(readFileSync(percorsoProve, 'utf8'));
  }
} catch (e) {
  console.error(c(ROSSO, `Cannot read the test file: ${e.message}`));
  process.exit(2);
}

let esito;
try {
  esito = await eseguiSuite(suite, { base });
} catch (e) {
  console.error(c(ROSSO, e.message));
  process.exit(2);
}

console.log(`\n${c(GRASSETTO, esito.workflow)}\n`);
for (const p of esito.esiti) {
  if (p.passed) {
    console.log(`  ${c(VERDE, '✓')} ${p.name} ${c(GRIGIO, `(${p.ms}ms)`)}`);
  } else {
    console.log(`  ${c(ROSSO, '✗')} ${c(GRASSETTO, p.name)}`);
    for (const f of p.failures) {
      if (f.path && f.operator) {
        console.log(`      ${c(GRIGIO, f.path)}  expected ${JSON.stringify(f.expected)} (${f.operator}), got ${JSON.stringify(f.got)}`);
      } else if (f.path) {
        console.log(`      ${c(GRIGIO, f.path)}  ${f.message}`);
      } else {
        console.log(`      ${f.message}`);
      }
      // Il «why» è il motivo per cui quel valore contava: è la sola riga utile a
      // chi trova la build rossa fra sei mesi. Se non si stampa, non esiste.
      if (f.why) for (const riga of aCapo(f.why, 72)) console.log(`      ${c(GRIGIO, riga)}`);
    }
  }
}

const totale = esito.esiti.length;
console.log('');
if (esito.failed) {
  console.log(c(ROSSO, `  ${esito.failed} of ${totale} failed`) + '\n');
  process.exit(1);
}
console.log(c(VERDE, `  ${esito.passed_count} of ${totale} passed`) + '\n');
process.exit(0);
