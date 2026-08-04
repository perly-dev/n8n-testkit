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

function aiuto() {
  console.log(`
${c(GRASSETTO, 'n8n-testkit')} — run your n8n workflow logic against fixtures

  n8n-testkit <tests.json>             run the tests
  n8n-testkit --nodes <workflow.json>  list the Code nodes, testable or not

Exits with code 1 when any test fails, so it can gate a deploy.
No n8n instance and no credentials: your integration nodes never run.
Your Code nodes do run, in this process — see "Use it in CI" in the README.

Docs: https://github.com/perly-dev/n8n-testkit
`);
  process.exit(0);
}

const vuoleAiuto = argomenti.includes('--help') || argomenti.includes('-h');
if (!argomenti.length) aiuto();

// Gli argomenti si controllano PRIMA di scegliere il comando: prima
// «--nodes flusso.json --bogus» e «--version --bogus» uscivano con 0, e chi
// aveva sbagliato a scrivere pensava che l'opzione avesse fatto qualcosa.
// L'aiuto si stampa DOPO il controllo: «--help --bogus» usciva con 0, cioè
// diceva che andava tutto bene a chi aveva appena sbagliato a scrivere.
const CONOSCIUTE = new Set(['--help', '-h', '--version', '-v', '--nodes', '--nodi']);
const attese = { '--help': 0, '-h': 0, '--version': 0, '-v': 0, '--nodes': 1, '--nodi': 1 };
{
  const comando = CONOSCIUTE.has(argomenti[0]) ? argomenti[0] : null;
  const resto = comando ? argomenti.slice(1) : argomenti;
  // «--» separa le opzioni dai percorsi, per il file che comincia per trattino.
  const separatore = resto.indexOf('--');
  const prima = separatore === -1 ? resto : resto.slice(0, separatore);
  const dopo = separatore === -1 ? [] : resto.slice(separatore + 1);
  const opzioni = prima.filter((a) => a.startsWith('-'));
  const percorsi = [...prima.filter((a) => !a.startsWith('-')), ...dopo];

  const ignota = opzioni.find((a) => !CONOSCIUTE.has(a));
  if (ignota) {
    console.error(c(ROSSO, `Unknown option "${ignota}". Try --help.`));
    process.exit(2);
  }
  const quanti = comando ? attese[comando] : 1;
  if (percorsi.length > quanti) {
    console.error(c(ROSSO,
      `${comando || 'n8n-testkit'} takes ${quanti} file${quanti === 1 ? '' : 's'}, got ${percorsi.length}. Try --help.`));
    process.exit(2);
  }
  argomenti.splice(comando ? 1 : 0, argomenti.length, ...percorsi);
}

if (vuoleAiuto) aiuto();

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
  const { provabili, esclusi } = nodiCode(wf);
  if (!provabili.length && !esclusi.length) {
    console.log('This workflow has no Code nodes: there is no logic of yours to test.');
    process.exit(0);
  }
  if (provabili.length) {
    console.log(`\nCode nodes in «${wf.name || argomenti[1]}»:\n`);
    for (const n of provabili) console.log(`  ${n}`);
  }
  // Dire «testabile» a un nodo che non si può eseguire manda a scrivere una
  // prova destinata a non girare. Meglio dirlo qui, col motivo.
  if (esclusi.length) {
    if (!provabili.length) console.log(`\nNo Code node in «${wf.name || argomenti[1]}» can be tested.`);
    console.log('\nNot testable here:\n');
    for (const n of esclusi) console.log(`  ${n.nome} ${c(GRIGIO, `— ${n.perche}`)}`);
  }
  console.log('');
  process.exit(0);
}

if (!argomenti.length) {
  console.error(c(ROSSO, 'Which test file? Usage: n8n-testkit <tests.json>'));
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
