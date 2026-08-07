/**
 * L'ambiente che n8n mette a disposizione dentro un nodo Code, ricostruito
 * abbastanza fedelmente da poter eseguire quel codice fuori da n8n.
 *
 * È il pezzo che rende possibile tutto il resto: senza questo, per provare un
 * workflow devi avere un'istanza n8n accesa, le credenziali giuste, e accetti
 * che ogni prova mandi email vere e scriva righe vere nei fogli di calcolo.
 */

import { compileFunction, runInNewContext } from 'node:vm';

// Un contesto VM vuoto contiene gli intrinseci JavaScript (Object, Array,
// Promise, …), ma non i globali aggiunti da Node. n8n ne reinserisce
// esplicitamente solo questi. Calcolare la differenza evita che un nuovo
// globale aggiunto da Node 24 passi per caso mentre su Node 18 non esisteva.
const GLOBALI_JS = new Set(runInNewContext('Object.getOwnPropertyNames(globalThis)'));
const GLOBALI_NATIVI_N8N = new Set([
  'Buffer',
  'setTimeout', 'setInterval', 'setImmediate',
  'clearTimeout', 'clearInterval', 'clearImmediate',
  'btoa', 'atob',
  'TextDecoder', 'TextDecoderStream', 'TextEncoder', 'TextEncoderStream',
  'FormData',
]);
const GLOBALI_NODE_NON_N8N = new Set(
  Object.getOwnPropertyNames(globalThis)
    .filter((nome) => !GLOBALI_JS.has(nome) && !GLOBALI_NATIVI_N8N.has(nome) && nome !== 'global')
);

function erroreGlobale(nome) {
  return new Error(
    `Global "${String(nome)}" exists in Node.js but is not exposed by n8n's default ` +
    `Code-node runtime. n8n-testkit blocked it instead of giving this test a false green.`
  );
}

/**
 * Costruisce il profilo di compatibilità dei globali. Non è isolamento di
 * sicurezza: rende indisponibili gli accessi normali, globalThis/global/this e
 * require(), ma codice ostile può cercare vie riflessive per uscire dal profilo.
 */
function creaProfiloGlobali(ambiente) {
  const ambito = Object.assign(Object.create(null), ambiente);

  for (const nome of GLOBALI_NODE_NON_N8N) {
    if (Object.prototype.hasOwnProperty.call(ambito, nome)) continue;
    Object.defineProperty(ambito, nome, {
      enumerable: true,
      configurable: false,
      get() { throw erroreGlobale(nome); },
    });
  }

  const requireN8n = (nome) => {
    throw new Error(
      `Module ${JSON.stringify(String(nome))} is not available in n8n's default Code-node ` +
      `runtime: require() is disabled unless a self-hosted instance explicitly allowlists ` +
      `that module. n8n-testkit uses the default profile and does not load modules.`
    );
  };
  Object.defineProperty(ambito, 'require', { enumerable: true, value: requireN8n });
  Object.defineProperty(ambito, 'module', { enumerable: true, value: { exports: {} } });

  let globale;
  globale = new Proxy(globalThis, {
    get(target, prop, receiver) {
      if (prop === 'globalThis' || prop === 'global') return receiver;
      if (Object.prototype.hasOwnProperty.call(ambito, prop)) return Reflect.get(ambito, prop);
      if (GLOBALI_NODE_NON_N8N.has(prop)) throw erroreGlobale(prop);
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (GLOBALI_NODE_NON_N8N.has(prop)) throw erroreGlobale(prop);
      return Object.prototype.hasOwnProperty.call(ambito, prop) || Reflect.has(target, prop);
    },
    getOwnPropertyDescriptor(target, prop) {
      if (GLOBALI_NODE_NON_N8N.has(prop)) throw erroreGlobale(prop);
      return Object.getOwnPropertyDescriptor(ambito, prop) || Reflect.getOwnPropertyDescriptor(target, prop);
    },
  });
  Object.defineProperty(ambito, 'globalThis', { enumerable: true, value: globale });
  Object.defineProperty(ambito, 'global', { enumerable: true, value: globale });
  return { ambito, globale };
}

/** Avvolge dei dati grezzi nella forma { json } che n8n usa fra un nodo e l'altro. */
export function comeItem(x) {
  if (x && typeof x === 'object' && 'json' in x) return x;
  return { json: x };
}

/**
 * Costruisce le variabili globali che il codice di un nodo si aspetta di trovare.
 *
 * @param {object} opzioni
 * @param {Array}  opzioni.input      elementi in ingresso al nodo
 * @param {object} opzioni.nodi       output di altri nodi, per nome — serve a $('Nome')
 * @param {object} opzioni.env        variabili d'ambiente viste dal workflow
 * @param {object} opzioni.vars       variabili n8n ($vars)
 * @param {Date}   opzioni.adesso     istante fisso: un test che dipende dall'orologio
 *                                    fallisce a mezzanotte e nessuno capisce perché
 */
export function creaAmbiente({ input = [], nodi = {}, env = {}, vars = {}, adesso, indice = 0 } = {}) {
  if (!Array.isArray(input)) throw new Error('"input" must be an array of items');
  const elementi = input.map(comeItem);
  const istante = adesso ? new Date(adesso) : null;

  // In n8n questi metodi accettano (branchIndex, runIndex): servono a leggere un
  // ramo o un'esecuzione diversi. Qui c'è un solo insieme di dati, quindi
  // ignorarli in silenzio darebbe verde a una prova che chiede altro.
  const senzaRami = (nome, fn) => (...argomenti) => {
    if (argomenti.length) {
      throw new Error(
        `$input.${nome}() was called with arguments (branch/run index), which this does ` +
        `not reproduce: a test supplies one set of items. Assert on the node that feeds ` +
        `the branch instead.`
      );
    }
    return fn();
  };

  const $input = {
    all: senzaRami('all', () => elementi),
    first: senzaRami('first', () => elementi[0]),
    last: senzaRami('last', () => elementi[elementi.length - 1]),
    item: elementi[0],
  };

  // $('Nome nodo') — l'accesso all'output di un nodo precedente. Se il nome non
  // esiste si lancia subito con un messaggio esplicito: in n8n l'errore reale è
  // «Referenced node is unexecuted», che a chi legge non dice quasi nulla.
  const $ = (nome) => {
    if (!(nome in nodi)) {
      throw new Error(
        `The workflow asks for output of node "${nome}", which this test does not provide. ` +
        `Add it under "nodes", or check the name: n8n is strict about case and spaces.`
      );
    }
    const dati = (nodi[nome] || []).map(comeItem);
    const senzaEsecuzioni = (metodo, fn) => (...argomenti) => {
      if (argomenti.length) {
        throw new Error(
          `$('${nome}').${metodo}() was called with arguments (branch/run index), which ` +
          `this does not reproduce: the fixture under "nodes" is a single set of items.`
        );
      }
      return fn();
    };
    return {
      all: senzaEsecuzioni('all', () => dati),
      first: senzaEsecuzioni('first', () => dati[0]),
      last: senzaEsecuzioni('last', () => dati[dati.length - 1]),
      // In n8n «.item» è l'elemento abbinato a quello che si sta elaborando, non
      // sempre il primo. Qui si usa la posizione: è l'abbinamento vero nel caso
      // normale (stesso numero di elementi), e il limite è scritto nel README.
      item: dati[indice] ?? dati[0],
      // itemMatching non significa «prendi la posizione i»: n8n attraversa la
      // catena pairedItem delle esecuzioni intermedie. Le fixture contengono
      // snapshot, non quella catena completa; indovinare dava falsi verdi appena
      // un nodo filtrava, riordinava o duplicava item.
      itemMatching: (i) => {
        throw new Error(
          `$('${nome}').itemMatching(${JSON.stringify(i)}) needs n8n's paired-item ` +
          `execution graph. Fixtures under "nodes" are output snapshots, so n8n-testkit ` +
          `cannot trace that link and will not guess by position. Use .all()[i] only if ` +
          `position is what your workflow actually means.`
        );
      },
    };
  };

  // n8n espone $now come oggetto Luxon. Riprodurre l'aritmetica senza Luxon,
  // timezone e DST darebbe risposte credibili ma sbagliate; i quattro metodi
  // indipendenti da quella semantica funzionano, ogni altro accesso si ferma con
  // un messaggio che dichiara il confine invece di «is not a function».
  const dataCompatibile = (nome, data) => new Proxy({
    toISO: () => data.toISOString(),
    toString: () => data.toISOString(),
    toMillis: () => data.getTime(),
    valueOf: () => data.getTime(),
  }, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !(prop in target)) {
        throw new Error(
          `${nome}.${prop} is a Luxon feature that n8n-testkit does not reproduce. ` +
          `Supported methods are toISO(), toMillis(), toString(), and valueOf(); ` +
          `test this node in n8n if it needs Luxon arithmetic, zones, formatting, or properties.`
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  const base = istante || new Date();
  const $now = dataCompatibile('$now', base);

  // $today in n8n è l'inizio del giorno, non «adesso». Restituire $now faceva
  // passare prove che in produzione si comportano in un altro modo.
  const mezzanotte = new Date(base);
  mezzanotte.setUTCHours(0, 0, 0, 0);
  const $today = dataCompatibile('$today', mezzanotte);

  return {
    $input, $, $env: env, $vars: vars, $now,
    $today,
    $execution: { id: 'test', mode: 'test', resumeUrl: '' },
    $workflow: { id: 'test', name: 'test', active: false },
    $runIndex: 0,
    $itemIndex: 0,
  };
}

/**
 * Esegue il codice di un nodo Code e restituisce quello che restituirebbe in n8n.
 *
 * Il codice gira in una funzione con le variabili n8n e il profilo globale di
 * compatibilità: non è una sandbox di sicurezza e non pretende di esserlo —
 * stai eseguendo un workflow che è già tuo. Serve a riprodurre il comportamento,
 * non a difendersi.
 */
export async function eseguiNodoCode(codice, ambiente, { singolo = false } = {}) {
  const { ambito, globale } = creaProfiloGlobali(ambiente);
  let fn;
  try {
    // compileFunction mantiene gli oggetti nel realm corrente (quindi i
    // confronti profondi e instanceof continuano a funzionare), ma permette un
    // ambito globale aggiuntivo con getter che fermano i globali Node-only.
    // Il wrapper async conserva await e i return al livello principale.
    fn = compileFunction(
      `return (async function () {\n${codice}\n}).call(this);`,
      [],
      { contextExtensions: [ambito] }
    );
  } catch (e) {
    throw new Error(`The node's code does not compile: ${e.message}`);
  }
  let uscita;
  try {
    uscita = await fn.call(globale);
  } catch (e) {
    if (e && e.code === 'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING') {
      throw new Error(
        `Dynamic import() is not available in n8n's default Code-node runtime. ` +
        `Modules are disabled unless a self-hosted instance explicitly allowlists them; ` +
        `n8n-testkit uses the default profile and does not load modules.`
      );
    }
    throw e;
  }

  // n8n pretende degli ITEM. Accettare null, un numero o un json che non è un
  // oggetto lasciava passare del codice che in produzione fallisce: lo stesso
  // guasto silenzioso che questo strumento esiste per smascherare.
  if (uscita === undefined || uscita === null) {
    throw new Error(
      `This node returned ${String(uscita)} instead of items. ` +
      `To emit nothing, return an empty list: return [];`
    );
  }
  // In modalità per-item n8n pretende UN elemento per esecuzione. Appiattendo un
  // array, due elementi in ingresso ne producevano quattro in uscita, tutti verdi.
  if (singolo && Array.isArray(uscita)) {
    throw new Error(
      `This node runs once for each item, so it must return a single item ` +
      `(an object), not an array of ${uscita.length}. n8n rejects this too.`
    );
  }
  // n8n accetta sia un array di item sia un singolo item.
  // Su un singolo oggetto n8n è più indulgente con le chiavi in più che sulla
  // forma canonica ad array: qui si preferisce non inventare un rosso.
  const soloUno = !Array.isArray(uscita);
  const elenco = soloUno ? [uscita] : uscita;
  return elenco.map((x, i) => validaItem(x, i, soloUno));
}

/** Un oggetto semplice: né array, né Date, né null — la nozione che usa n8n. */
const oggettoSemplice = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/** Come si chiama quello che non è un oggetto semplice, per dirlo a chi legge. */
const descrivi = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (v instanceof Date) return 'a Date';
  return `a ${typeof v}`;
};

// Le chiavi che n8n riconosce a livello di item. Una chiave in più di solito è
// un «json» dimenticato: { risultato: ... } invece di { json: { risultato: ... } }.
const CHIAVI = new Set(['json', 'binary', 'pairedItem', 'error', 'index']);

function validaItem(x, i, soloUno = false) {
  if (!oggettoSemplice(x)) {
    throw new Error(
      `Item ${i} of what this node returned is ${descrivi(x)}, not an object. ` +
      `n8n expects items like { json: { ... } }.`
    );
  }
  const item = comeItem(x);
  if (!oggettoSemplice(item.json)) {
    throw new Error(`Item ${i} has a "json" that is ${descrivi(item.json)}, not an object. ` +
                    `n8n expects { json: { ... } }.`);
  }
  if (item.binary !== undefined && !oggettoSemplice(item.binary)) {
    throw new Error(`Item ${i} has a "binary" that is ${descrivi(item.binary)}, not an object.`);
  }
  // Solo se l'item è già nella forma n8n: un oggetto nudo viene avvolto da
  // comeItem e le sue chiavi sono legittimamente dentro "json".
  if ('json' in x && !soloUno) {
    const estranee = Object.keys(x).filter((k) => !CHIAVI.has(k));
    if (estranee.length) {
      throw new Error(
        `Item ${i} has ${estranee.map((k) => `"${k}"`).join(', ')} next to "json". ` +
        `n8n only knows ${[...CHIAVI].join(', ')} here — did you mean to put it inside "json"?`
      );
    }
  }
  return item;
}

/**
 * La modalità «Run once for each item»: n8n esegue il codice una volta per
 * elemento, con $json che punta all'elemento corrente, e si aspetta un item
 * solo per volta. Senza questo, quei nodi fallivano con «$json is not defined».
 */
/**
 * n8n controlla il SORGENTE prima di eseguirlo: in modalità per-item questi
 * metodi sono vietati anche se il codice non ci passa mai. Fermarli solo a
 * runtime lasciava verde un nodo che n8n si rifiuta di far partire.
 */
export function vietatiPerItem(codice) {
  // I commenti non contano: «// $input.all()» è una nota, non una chiamata, e
  // rifiutarla sarebbe un rosso che l'utente non può spiegarsi.
  const senzaCommenti = String(codice)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const metodo of ['all', 'first', 'last', 'itemMatching']) {
    if (new RegExp(`\\$input\\s*\\.\\s*${metodo}\\s*\\(`).test(senzaCommenti)) return metodo;
  }
  return null;
}

export async function eseguiNodoPerItem(codice, opzioni = {}) {
  if (!Array.isArray(opzioni.input)) throw new Error('"input" must be an array of items');
  const vietato = vietatiPerItem(codice);
  if (vietato) {
    throw new Error(
      `Can't use $input.${vietato}() here: this node runs once for each item, ` +
      `so it only ever sees one. Use $json, or switch the node to ` +
      `"Run Once for All Items". n8n refuses this too, before it even runs.`
    );
  }
  const elementi = opzioni.input.map(comeItem);
  const uscita = [];
  for (let i = 0; i < elementi.length; i++) {
    const ambiente = creaAmbiente({ ...opzioni, input: [elementi[i]], indice: i });
    ambiente.$json = elementi[i].json;
    ambiente.$itemIndex = i;
    // n8n vieta questi metodi in modalità per-item. Accettarli renderebbe verde
    // del codice che n8n rifiuta di eseguire: un test kit che assolve un guasto
    // è peggio di nessun test kit.
    const vietato = (metodo) => () => {
      throw new Error(
        `Can't use $input.${metodo}() here: this node runs once for each item, ` +
        `so it only ever sees one. Use $json, or switch the node to ` +
        `"Run Once for All Items". n8n refuses this too.`
      );
    };
    ambiente.$input = {
      item: elementi[i],
      all: vietato('all'),
      first: vietato('first'),
      last: vietato('last'),
      itemMatching: vietato('itemMatching'),
    };
    const risultato = await eseguiNodoCode(codice, ambiente, { singolo: true });
    uscita.push(...risultato);
  }
  return uscita;
}
