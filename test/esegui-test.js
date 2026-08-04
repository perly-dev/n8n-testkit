#!/usr/bin/env node
/**
 * Il banco di prova del kit stesso.
 *
 * Un kit di test il cui «npm test» non gira è la peggior vetrina possibile.
 * Qui si prova quello che il README promette, ESEGUENDOLO — compreso il
 * confronto fra ciò che il documento dichiara e ciò che il codice fa davvero,
 * che è il controllo che ci è mancato quattro volte.
 */

import { spawnSync } from 'node:child_process';
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

/** Lancia la CLI e restituisce { uscita, codice }. Cattura anche stderr: le
 *  prove sugli errori devono leggerlo, non stamparlo in mezzo al rapporto. */
function cli(argomenti, opzioni = {}) {
  const r = spawnSync(process.execPath, [CLI, ...argomenti], {
    encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, ...opzioni,
  });
  return { uscita: (r.stdout || '') + (r.stderr || ''), codice: r.status };
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
  contiene(uscita, 'expected the error message to contain', 'messaggio');
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

// ── Semantica, non solo nomi ─────────────────────────────────────────────────
// Codex ha fatto notare che provare l'ESISTENZA degli operatori lascia passare
// un operatore che c'è e sbaglia. Qui si prova cosa fanno.

/** Costruisce al volo un workflow di un nodo solo e ci lancia delle prove. */
function conNodo(jsCode, tests, parametri = {}) {
  const dir = cartellaDiProva();
  writeFileSync(join(dir, 'wf.json'), JSON.stringify({
    name: 'ad hoc',
    nodes: [{ name: 'N', type: 'n8n-nodes-base.code', parameters: { jsCode, ...parametri } }],
  }));
  writeFileSync(join(dir, 't.json'), JSON.stringify({ workflow: 'wf.json', tests }));
  return cli([join(dir, 't.json')]);
}

prova('«equals» è un confronto profondo, non un confronto di testo JSON', () => {
  // Le stesse chiavi in ordine diverso sono lo stesso oggetto. In n8n l'ordine
  // dipende da come il nodo ha costruito il json: confrontarlo dava rossi a caso.
  const { codice } = conNodo('return [{json:{o:{b:2,a:1}}}];',
    [{ name: 'ordine diverso', node: 'N', input: [{}], expect: [{ path: '0.json.o', value: { a: 1, b: 2 } }] }]);
  uguale(codice, 0, 'codice di uscita');
});

prova('«equals» distingue ancora valori davvero diversi', () => {
  const { codice } = conNodo('return [{json:{n:1}}];',
    [{ name: 'numero contro testo', node: 'N', input: [{}], expect: [{ path: '0.json.n', value: '1' }] }]);
  uguale(codice, 1, 'codice di uscita');
});

prova('«throws» confronta testo letterale, non un\'espressione regolare', () => {
  // «cost [EUR] missing» come regex non corrisponde a se stesso: il rapporto
  // mostrava due stringhe identiche e la prova rossa.
  const { codice } = conNodo("throw new Error('cost [EUR] missing');",
    [{ name: 'parentesi quadre', node: 'N', input: [{}], throws: 'cost [EUR] missing' }]);
  uguale(codice, 0, 'codice di uscita');
});

prova('un «throw» di una stringa nuda mostra la stringa, non «undefined»', () => {
  const { uscita } = conNodo("throw 'stringa nuda';",
    [{ name: 'stringa nuda', node: 'N', input: [{}] }]);
  contiene(uscita, 'stringa nuda', 'messaggio');
  if (uscita.includes('undefined')) throw new Error('stampa «undefined»');
});

prova('due nodi con lo stesso nome vengono rifiutati invece di sceglierne uno', () => {
  const dir = cartellaDiProva();
  writeFileSync(join(dir, 'wf.json'), JSON.stringify({
    name: 'doppio',
    nodes: [
      { name: 'D', type: 'n8n-nodes-base.code', parameters: { jsCode: "return [{json:{q:'primo'}}];" } },
      { name: 'D', type: 'n8n-nodes-base.code', parameters: { jsCode: "return [{json:{q:'secondo'}}];" } },
    ],
  }));
  writeFileSync(join(dir, 't.json'), JSON.stringify({ workflow: 'wf.json',
    tests: [{ name: 'ambiguo', node: 'D', input: [{}], expect: [{ path: '0.json.q', value: 'primo' }] }] }));
  const { uscita, codice } = cli([join(dir, 't.json')]);
  uguale(codice, 1, 'codice di uscita');
  contiene(uscita, 'no way to tell which one you mean', 'messaggio di ambiguità');
});

prova('una prova scritta male non porta giù le altre', () => {
  const { uscita, codice } = conNodo('return [{json:{ok:1}}];', [
    { name: 'buona', node: 'N', input: [{}], expect: [{ path: '0.json.ok', value: 1 }] },
    { name: 'malformata', node: 'N', input: {} },
  ]);
  uguale(codice, 1, 'codice di uscita');
  contiene(uscita, '✓ buona', 'la prova buona deve essere stata eseguita lo stesso');
  contiene(uscita, '"input" must be an array', 'spiegazione');
});

prova('un Code node che usa «await» gira davvero', () => {
  const { codice } = conNodo('const x = await Promise.resolve(7);\nreturn [{json:{x}}];',
    [{ name: 'await', node: 'N', input: [{}], expect: [{ path: '0.json.x', value: 7 }] }]);
  uguale(codice, 0, 'codice di uscita');
});

prova('la modalità «once for each item» esegue il codice su ogni elemento', () => {
  const { codice } = conNodo('return {json:{v:$json.a*2}};',
    [{ name: 'per item', node: 'N', input: [{ a: 2 }, { a: 5 }], expect: [
      { path: '0.json.v', value: 4 }, { path: '1.json.v', value: 10 }] }],
    { mode: 'runOnceForEachItem' });
  uguale(codice, 0, 'codice di uscita');
});

prova('in modalità per-item, «$input.all()» è rifiutato come lo rifiuta n8n', () => {
  // Accettarlo dava verde a codice che n8n si rifiuta di eseguire: un test kit
  // che assolve un guasto è peggio di nessun test kit.
  const { uscita, codice } = conNodo('return {json:{n:$input.all().length}};',
    [{ name: 'all vietato', node: 'N', input: [{ a: 1 }, { a: 2 }], expect: [{ path: '0.json.n', value: 1 }] }],
    { mode: 'runOnceForEachItem' });
  uguale(codice, 1, 'codice di uscita');
  contiene(uscita, "Can't use $input.all() here", 'messaggio');
});

prova('in modalità per-item, restituire un array è rifiutato', () => {
  const { uscita, codice } = conNodo('return [{json:{a:1}},{json:{b:2}}];',
    [{ name: 'array vietato', node: 'N', input: [{ x: 1 }, { x: 2 }], expect: [{ path: '3.json.b', value: 2 }] }],
    { mode: 'runOnceForEachItem' });
  uguale(codice, 1, 'codice di uscita');
  contiene(uscita, 'must return a single item', 'messaggio');
});

prova('tutti e quattro i metodi vietati di $input lanciano in per-item', () => {
  for (const metodo of ['all()', 'first()', 'last()', 'itemMatching(0)']) {
    const { uscita, codice } = conNodo(`return {json:{v:$input.${metodo}}};`,
      [{ name: metodo, node: 'N', input: [{ a: 1 }], expect: [] }], { mode: 'runOnceForEachItem' });
    uguale(codice, 1, `codice di uscita per $input.${metodo}`);
    contiene(uscita, "Can't use $input.", `messaggio per $input.${metodo}`);
  }
});

prova('un nodo che non restituisce item viene rifiutato, come lo rifiuta n8n', () => {
  const casi = [
    ['return null;', 'instead of items'],
    ['return undefined;', 'instead of items'],
    ['return 7;', 'not an object'],
    ['return {json:7};', 'not an object'],
    ['return ["testo"];', 'not an object'],
  ];
  for (const [codiceNodo, atteso] of casi) {
    const { uscita, codice } = conNodo(codiceNodo, [{ name: codiceNodo, node: 'N', input: [{}], expect: [] }]);
    uguale(codice, 1, `codice di uscita per «${codiceNodo}»`);
    contiene(uscita, atteso, `messaggio per «${codiceNodo}»`);
  }
});

prova('«return []» resta legittimo: un filtro può non lasciar passare niente', () => {
  const { codice } = conNodo('return [];', [{ name: 'niente', node: 'N', input: [{}], expect: [] }]);
  uguale(codice, 0, 'codice di uscita');
});

prova('un nome condiviso con un nodo NON Code è escluso, non offerto', () => {
  // --nodes e l'esecuzione devono dire la stessa cosa: prima --nodes lo
  // presentava come provabile e poi l'esecuzione lo rifiutava.
  const dir = cartellaDiProva();
  writeFileSync(join(dir, 'wf.json'), JSON.stringify({
    name: 'collisione',
    nodes: [
      { name: 'X', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return [{json:{ok:1}}];' } },
      { name: 'X', type: 'n8n-nodes-base.httpRequest', parameters: {} },
    ],
  }));
  const { uscita } = cli(['--nodes', join(dir, 'wf.json')]);
  const provabili = uscita.split('Not testable here')[0];
  if (provabili.includes('X')) throw new Error('«X» presentato come provabile pur essendo ambiguo');
  contiene(uscita, 'share this name', 'motivo');
});

prova('nessun comando ignora un argomento sbagliato', () => {
  const dir = cartellaDiProva();
  const suite = join(RADICE, 'esempi', 'tests-lead-intake.json');
  const casi = [
    ['--nodes', join(dir, 'lead-intake.json'), '--bogus'],
    ['--version', '--bogus'],
    ['--help', '--bogus'],
    ['--nodes', join(dir, 'lead-intake.json'), 'in-piu.json'],
    [suite, '--bogus'],
    [suite, suite],
  ];
  for (const argomenti of casi) {
    const { codice } = cli(argomenti);
    uguale(codice, 2, `codice di uscita per «${argomenti.join(' ')}»`);
  }
});

prova('«--» permette di provare un file il cui nome comincia per trattino', () => {
  const dir = cartellaDiProva();
  const strano = join(dir, '-tests.json');
  cpSync(join(dir, 'tests-lead-intake.json'), strano);
  const { uscita, codice } = cli(['--', strano]);
  uguale(codice, 0, 'codice di uscita');
  contiene(uscita, '10 of 10 passed', 'riepilogo');
});

prova('un nodo impostato su Python non esegue il jsCode rimasto dentro', () => {
  const { uscita, codice } = conNodo("return [{json:{lingua:'javascript'}}];",
    [{ name: 'python', node: 'N', input: [{}], expect: [{ path: '0.json.lingua', value: 'javascript' }] }],
    { language: 'pythonNative', pythonCode: 'return items' });
  uguale(codice, 1, 'codice di uscita');
  contiene(uscita, 'is set to Python', 'messaggio');
});

prova('«throw undefined» non porta giù la suite', () => {
  const { uscita, codice } = conNodo('throw undefined;',
    [{ name: 'undefined', node: 'N', input: [{}], throws: 'qualcosa' },
     { name: 'la seguente gira lo stesso', node: 'N', input: [{}], throws: 'qualcosa' }]);
  uguale(codice, 1, 'codice di uscita');
  contiene(uscita, '2 of 2 failed', 'entrambe le prove devono essere state eseguite');
});

prova('«$(\'Nodo\').item» segue la posizione dell\'elemento in lavorazione', () => {
  const { codice } = conNodo('return {json:{v:$("Prima").item.json.v}};',
    [{ name: 'abbinamento', node: 'N', input: [{ a: 1 }, { a: 2 }],
       nodes: { Prima: [{ v: 'uno' }, { v: 'due' }] },
       expect: [{ path: '0.json.v', value: 'uno' }, { path: '1.json.v', value: 'due' }] }],
    { mode: 'runOnceForEachItem' });
  uguale(codice, 0, 'codice di uscita');
});

prova('«--nodes» non presenta come provabile un nodo che non si può eseguire', () => {
  const dir = cartellaDiProva();
  writeFileSync(join(dir, 'wf.json'), JSON.stringify({
    name: 'misto',
    nodes: [
      { name: 'Buono', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return [];' } },
      { name: 'Py', type: 'n8n-nodes-base.code', parameters: { language: 'pythonNative', pythonCode: 'x' } },
      { name: 'Vuoto', type: 'n8n-nodes-base.code', parameters: {} },
    ],
  }));
  const { uscita } = cli(['--nodes', join(dir, 'wf.json')]);
  const provabili = uscita.split('Not testable here')[0];
  contiene(provabili, 'Buono', 'il nodo buono');
  for (const n of ['Py', 'Vuoto']) {
    if (provabili.includes(n)) throw new Error(`«${n}» presentato come provabile`);
  }
  contiene(uscita, 'written in Python', 'il motivo dell\'esclusione');
});

prova('un\'opzione sconosciuta dopo il nome del file non viene ignorata', () => {
  const { codice } = cli([join(RADICE, 'esempi', 'tests-lead-intake.json'), '--bogus']);
  uguale(codice, 2, 'codice di uscita');
});

prova('«$today» è la mezzanotte del giorno, non l\'istante di «$now»', () => {
  const { codice } = conNodo('return [{json:{t:$today.toISO()}}];',
    [{ name: 'today', node: 'N', input: [{}], now: '2020-06-15T12:30:00.000Z',
       expect: [{ path: '0.json.t', value: '2020-06-15T00:00:00.000Z' }] }]);
  uguale(codice, 0, 'codice di uscita');
});

prova('la riga di comando non mostra mai uno stack trace a chi sbaglia un file', () => {
  for (const argomenti of [['--nodes', 'non-esiste.json'], ['non-esiste.json'], ['--nodes']]) {
    const { uscita, codice } = cli(argomenti);
    uguale(codice, 2, `codice di uscita per ${argomenti.join(' ')}`);
    if (/\bat \w+.*\(.*:\d+:\d+\)/.test(uscita) || uscita.includes('node:internal')) {
      throw new Error(`stack trace mostrato per «${argomenti.join(' ')}»: ${uscita.slice(0, 120)}`);
    }
  }
});

prova('--version stampa la versione del package.json', () => {
  const pkg = JSON.parse(readFileSync(join(RADICE, 'package.json'), 'utf8'));
  const { uscita, codice } = cli(['--version']);
  uguale(codice, 0, 'codice di uscita');
  uguale(uscita.trim(), pkg.version, 'versione');
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
  if (uscita.includes('Not testable here')) throw new Error('l\'esempio ha nodi non provabili: aggiornare README e prova');
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

prova('l\'help non promette cose che il README smentisce', () => {
  // Il banco non leggeva affatto l'help, ed era rimasta lì la promessa
  // «no side effects» mentre il README spiegava il contrario.
  const { uscita, codice } = cli(['--help']);
  uguale(codice, 0, 'codice di uscita');
  for (const promessa of ['no side effects', 'not a single real email', 'sandbox']) {
    if (uscita.toLowerCase().includes(promessa)) {
      throw new Error(`l'help promette «${promessa}», che non è vero: i Code node girano in questo processo`);
    }
  }
  contiene(uscita, 'n8n-testkit', 'intestazione');
});

prova('le frasi che il README cita fra virgolette esistono nel codice', () => {
  const citazioni = [
    'it no longer protects anything',
    'expected the error message to contain',
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

// Questa prova installa il pacchetto e ne lancia il banco. Quel banco contiene
// questa stessa prova: senza la sentinella si impacchetterebbe all'infinito.
// Nel giro annidato viene dichiarata saltata, non silenziosamente omessa.
// La sentinella viaggia negli argomenti, non nell'ambiente: una variabile
// d'ambiente si eredita per sbaglio e avrebbe fatto saltare la prova in
// silenzio, lasciando scritto «tutte le prove passate».
if (process.argv.includes('--annidato')) {
  console.log('  — il pacchetto vero, impacchettato e installato (già provato dal giro esterno)');
} else prova('il pacchetto vero, impacchettato e installato, funziona una volta installato', () => {
  // Fin qui si è provato il bin del repository. Quello che finisce agli utenti è
  // il tarball, e «files» decide cosa ci entra: una dimenticanza lì non si vede
  // in nessun'altra prova.
  const dir = mkdtempSync(join(tmpdir(), 'n8n-testkit-pack-'));
  const pack = spawnSync('npm', ['pack', '--pack-destination', dir], { cwd: RADICE, encoding: 'utf8' });
  if (pack.status !== 0) throw new Error(`npm pack non riuscito: ${pack.stderr}`);
  const tgz = join(dir, pack.stdout.trim().split('\n').pop());
  const progetto = mkdtempSync(join(tmpdir(), 'n8n-testkit-uso-'));
  writeFileSync(join(progetto, 'package.json'), '{"name":"prova","version":"1.0.0"}');
  const inst = spawnSync('npm', ['install', '--no-audit', '--no-fund', tgz], { cwd: progetto, encoding: 'utf8' });
  if (inst.status !== 0) throw new Error(`npm install non riuscito: ${inst.stderr}`);
  cpSync(join(RADICE, 'esempi'), progetto, { recursive: true });
  // Il binario installato, non «npx»: npx può fermarsi a chiedere conferma o
  // andare in rete, e una prova che aspetta un umano non è una prova.
  const eseguibile = join(progetto, 'node_modules', '.bin', 'n8n-testkit');
  const eseguito = spawnSync(eseguibile, ['tests-lead-intake.json'],
    { cwd: progetto, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  uguale(eseguito.status, 0, 'codice di uscita del pacchetto installato');
  contiene(eseguito.stdout, '10 of 10 passed', 'riepilogo');
  // e il suo «npm test» deve girare: se «files» dimentica test/ o esempi/, no.
  const suo = spawnSync(process.execPath, ['test/esegui-test.js', '--annidato'], {
    cwd: join(progetto, 'node_modules', 'n8n-testkit'), encoding: 'utf8',
  });
  uguale(suo.status, 0, `npm test dentro il pacchetto installato: ${(suo.stdout || '').slice(-300)}`);
});

console.log('');
if (falliti) {
  console.log(`  ${falliti} prove fallite\n`);
  process.exit(1);
}
console.log('  tutte le prove passate\n');
process.exit(0);
