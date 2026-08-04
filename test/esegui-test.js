#!/usr/bin/env node
/**
 * Il banco di prova del kit stesso.
 *
 * Un kit di test il cui «npm test» non gira è la peggior vetrina possibile.
 * Qui si prova quello che il README promette, ESEGUENDOLO — compreso il
 * confronto fra ciò che il documento dichiara e ciò che il codice fa davvero,
 * che è il controllo che ci è mancato quattro volte.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { operatoriDisponibili } from '../src/asserzioni.js';

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = join(QUI, '..');
const CLI = join(RADICE, 'bin', 'n8n-testkit.js');
const README = readFileSync(join(RADICE, 'README.md'), 'utf8');

let falliti = 0;
function prova(nome, fn) {
  try {
    fn();
    console.log(`  ✓ ${nome}`);
  } catch (e) {
    falliti++;
    console.log(`  ✗ ${nome}\n      ${e.message}`);
  }
}
function uguale(ottenuto, atteso, cosa) {
  if (ottenuto !== atteso) throw new Error(`${cosa}: atteso ${JSON.stringify(atteso)}, ottenuto ${JSON.stringify(ottenuto)}`);
}
function contiene(testo, pezzo, cosa) {
  if (!testo.includes(pezzo)) throw new Error(`${cosa}: manca ${JSON.stringify(pezzo)}`);
}

/** Lancia la CLI e restituisce { uscita, codice } senza lanciare sul codice 1. */
function cli(argomenti, opzioni = {}) {
  try {
    const uscita = execFileSync(process.execPath, [CLI, ...argomenti], {
      encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, ...opzioni,
    });
    return { uscita, codice: 0 };
  } catch (e) {
    return { uscita: (e.stdout || '') + (e.stderr || ''), codice: e.status };
  }
}

/** Copia gli esempi in una cartella usa-e-getta, così le mutazioni non toccano il repo. */
function cartellaDiProva() {
  const dir = mkdtempSync(join(tmpdir(), 'n8n-testkit-'));
  cpSync(join(RADICE, 'esempi'), dir, { recursive: true });
  return dir;
}

console.log('\nn8n-testkit — banco di prova\n');

prova('la suite di esempio passa tutta, con codice 0', () => {
  const { uscita, codice } = cli([join(RADICE, 'esempi', 'tests-lead-intake.json')]);
  uguale(codice, 0, 'codice di uscita');
  contiene(uscita, '10 of 10 passed', 'riepilogo');
});

prova('rompendo il workflow la suite diventa rossa e il comando esce con 1', () => {
  const dir = cartellaDiProva();
  const wf = join(dir, 'lead-intake.json');
  const testo = readFileSync(wf, 'utf8');
  const mutato = testo.replace(/TOGLI_ZERO_INIZIALE\s*=\s*false/, 'TOGLI_ZERO_INIZIALE = true');
  if (mutato === testo) throw new Error('la mutazione non ha trovato il suo bersaglio: il banco non starebbe provando niente');
  writeFileSync(wf, mutato);
  const { uscita, codice } = cli([join(dir, 'tests-lead-intake.json')]);
  uguale(codice, 1, 'codice di uscita');
  contiene(uscita, '1 of 10 failed', 'riepilogo');
});

prova('quando una prova fallisce, il «why» viene stampato', () => {
  const dir = cartellaDiProva();
  const wf = join(dir, 'lead-intake.json');
  writeFileSync(wf, readFileSync(wf, 'utf8').replace(/TOGLI_ZERO_INIZIALE\s*=\s*false/, 'TOGLI_ZERO_INIZIALE = true'));
  const { uscita } = cli([join(dir, 'tests-lead-intake.json')]);
  contiene(uscita, 'in Italy the zero is part of the number', 'il why del test italiano');
});

prova('un «throws» che non corrisponde dice cosa è successo, non «undefined»', () => {
  const dir = cartellaDiProva();
  writeFileSync(join(dir, 'wf.json'), JSON.stringify({
    name: 'gate',
    nodes: [{ name: 'Gate', type: 'n8n-nodes-base.code', parameters: { jsCode: "throw new Error('boom');" } }],
  }));
  writeFileSync(join(dir, 't.json'), JSON.stringify({
    workflow: 'wf.json',
    tests: [{ name: 'wrong message', node: 'Gate', input: [{}], throws: 'x-webhook-key' }],
  }));
  const { uscita, codice } = cli([join(dir, 't.json')]);
  uguale(codice, 1, 'codice di uscita');
  contiene(uscita, 'expected a thrown error matching', 'messaggio');
  if (uscita.includes('undefined')) throw new Error('stampa «undefined» al posto del messaggio');
});

prova('un nodo che smette di lanciare fa fallire la prova con la frase del README', () => {
  const dir = cartellaDiProva();
  writeFileSync(join(dir, 'wf.json'), JSON.stringify({
    name: 'gate',
    nodes: [{ name: 'Gate', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return [{json:{ok:true}}];' } }],
  }));
  writeFileSync(join(dir, 't.json'), JSON.stringify({
    workflow: 'wf.json',
    tests: [{ name: 'no longer refuses', node: 'Gate', input: [{}], throws: 'anything' }],
  }));
  const { uscita, codice } = cli([join(dir, 't.json')]);
  uguale(codice, 1, 'codice di uscita');
  contiene(uscita, 'it no longer protects anything', 'messaggio del cancello');
});

prova('--nodes elenca i nodi Code del workflow di esempio', () => {
  const { uscita, codice } = cli(['--nodes', join(RADICE, 'esempi', 'lead-intake.json')]);
  uguale(codice, 0, 'codice di uscita');
  contiene(uscita, 'Code nodes in', 'intestazione');
  contiene(uscita, 'Refuse anything unsigned', 'primo nodo');
});

// ── Documento contro codice ──────────────────────────────────────────────────
// Il difetto che si ripete: il README descrive il programma come lo vorrei,
// non come è. Queste prove confrontano le due cose riga per riga.

prova('ogni operatore documentato nel README esiste nel codice', () => {
  // Solo la prima colonna delle righe di tabella: fuori dalla tabella il README
  // usa `value` e `why`, che sono campi, non operatori.
  const tabella = README.split('| `operator` | Passes when |')[1] || '';
  const documentati = tabella.split('\n')
    .filter((r) => r.startsWith('|') && !/^\|\s*-+/.test(r))
    .map((r) => (r.split('|')[1] || '').match(/`([a-zA-Z]+)`/))
    .filter(Boolean).map((m) => m[1]);
  if (!documentati.length) throw new Error('nessun operatore letto dal README: il parser non sta provando niente');
  const mancanti = [...new Set(documentati)].filter((o) => !operatoriDisponibili.includes(o));
  uguale(mancanti.join(', '), '', 'operatori documentati ma inesistenti');
});

prova('ogni operatore del codice è documentato nel README', () => {
  const nonDocumentati = operatoriDisponibili.filter((o) => !README.includes(`\`${o}\``));
  uguale(nonDocumentati.join(', '), '', 'operatori esistenti ma non documentati');
});

prova('l\'elenco di nodi mostrato nel README è quello che il programma stampa', () => {
  const { uscita } = cli(['--nodes', join(RADICE, 'esempi', 'lead-intake.json')]);
  const veri = uscita.split('\n').map((r) => r.trim()).filter((r) => r && !r.includes('Code nodes in'));
  const blocco = README.split('```\nCode nodes in')[1];
  if (!blocco) throw new Error('il README non mostra più il blocco --nodes: aggiornare questa prova');
  const mostrati = blocco.split('```')[0].split('\n').map((r) => r.trim()).filter(Boolean).slice(1);
  for (const n of mostrati) contiene(veri.join('\n'), n, `nodo mostrato nel README ma non stampato: «${n}»`);
  uguale(mostrati.length, veri.length, 'numero di nodi elencati nel README');
});

prova('il riquadro di output in cima al README è, riga per riga, quello che il programma stampa', () => {
  const dir = cartellaDiProva();
  const wf = join(dir, 'lead-intake.json');
  writeFileSync(wf, readFileSync(wf, 'utf8').replace(/TOGLI_ZERO_INIZIALE\s*=\s*false/, 'TOGLI_ZERO_INIZIALE = true'));
  const { uscita } = cli([join(dir, 'tests-lead-intake.json')]);
  // I millisecondi cambiano a ogni giro: confrontarli renderebbe rossa la build
  // a caso — proprio il difetto che il README rimprovera ai test sull'orologio.
  const senzaTempi = (r) => r.trimEnd().replace(/\(\d+ms\)$/, '(Nms)');
  const vere = uscita.split('\n').map(senzaTempi).filter((r) => r.trim());
  const blocco = README.split('```\nlead-intake.json')[1];
  if (!blocco) throw new Error('il README non mostra più il riquadro di esempio: aggiornare questa prova');
  const mostrate = blocco.split('```')[0].split('\n').map(senzaTempi).filter((r) => r.trim());
  // la prima riga vera è il nome del file di workflow, che nel README fa da titolo del riquadro
  const attese = vere.slice(1);
  uguale(mostrate.length, attese.length, 'numero di righe del riquadro');
  mostrate.forEach((riga, i) => uguale(riga, attese[i], `riga ${i + 1} del riquadro`));
});

prova('il nome del workflow citato nel README è quello vero', () => {
  const wf = JSON.parse(readFileSync(join(RADICE, 'esempi', 'lead-intake.json'), 'utf8'));
  contiene(README, wf.name, 'nome del workflow di esempio');
});

prova('le frasi che il README cita fra virgolette esistono nel codice', () => {
  const citazioni = [
    'it no longer protects anything',
    'expected a thrown error matching',
  ];
  const sorgente = ['src/index.js', 'src/asserzioni.js', 'src/ambiente.js', 'bin/n8n-testkit.js']
    .map((f) => readFileSync(join(RADICE, f), 'utf8')).join('\n');
  for (const q of citazioni) contiene(sorgente, q, 'frase citata dal README');
});

prova('il pacchetto non ha dipendenze, come dichiara il README', () => {
  const pkg = JSON.parse(readFileSync(join(RADICE, 'package.json'), 'utf8'));
  uguale(Object.keys(pkg.dependencies || {}).length, 0, 'dipendenze');
  contiene(README, 'No dependencies', 'dichiarazione nel README');
});

prova('$now espone esattamente i metodi che il README dichiara', () => {
  const dir = cartellaDiProva();
  writeFileSync(join(dir, 'wf.json'), JSON.stringify({
    name: 'clock',
    nodes: [{ name: 'Clock', type: 'n8n-nodes-base.code', parameters: {
      jsCode: 'return [{json:{iso:$now.toISO(), ms:$now.toMillis(), s:$now.toString()}}];' } }],
  }));
  writeFileSync(join(dir, 't.json'), JSON.stringify({
    workflow: 'wf.json',
    tests: [{ name: 'clock', node: 'Clock', input: [{}], now: '2020-01-02T03:04:05.000Z', expect: [
      { path: '0.json.iso', value: '2020-01-02T03:04:05.000Z' },
      { path: '0.json.ms', value: 1577934245000 },
      { path: '0.json.s', value: '2020-01-02T03:04:05.000Z' },
    ] }],
  }));
  const { codice } = cli([join(dir, 't.json')]);
  uguale(codice, 0, 'codice di uscita');
});

console.log('');
if (falliti) {
  console.log(`  ${falliti} prove fallite\n`);
  process.exit(1);
}
console.log('  tutte le prove passate\n');
process.exit(0);
