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

const argomenti = process.argv.slice(2);

if (!argomenti.length || argomenti.includes('--help') || argomenti.includes('-h')) {
  console.log(`
${c(GRASSETTO, 'n8n-testkit')} — run your n8n workflow logic against fixtures

  n8n-testkit <tests.json>              run the tests
  n8n-testkit --nodes <workflow.json>  list the Code nodes you can test

Exits with code 1 when any test fails, so it can gate a deploy.
No n8n instance, no credentials, no side effects.

Docs: https://github.com/perly-dev/n8n-testkit
`);
  process.exit(0);
}

if (argomenti[0] === '--nodes' || argomenti[0] === '--nodi') {
  const wf = caricaWorkflow(argomenti[1]);
  const nodi = nodiCode(wf);
  if (!nodi.length) {
    console.log('Questo workflow non ha nodi Code: non c\'è logica tua da provare.');
    process.exit(0);
  }
  console.log(`\nNodi Code in «${wf.name || argomenti[1]}»:\n`);
  for (const n of nodi) console.log(`  ${n}`);
  console.log('');
  process.exit(0);
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
  esito = eseguiSuite(suite, { base });
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
      if (f.path) {
        console.log(`      ${c(GRIGIO, f.path)}  expected ${JSON.stringify(f.expected)} (${f.operator}), got ${JSON.stringify(f.got)}`);
      } else {
        console.log(`      ${f.message}`);
      }
      if (f.message && f.path) console.log(`      ${c(GRIGIO, f.message)}`);
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
