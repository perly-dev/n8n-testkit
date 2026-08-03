/**
 * L'ambiente che n8n mette a disposizione dentro un nodo Code, ricostruito
 * abbastanza fedelmente da poter eseguire quel codice fuori da n8n.
 *
 * È il pezzo che rende possibile tutto il resto: senza questo, per provare un
 * workflow devi avere un'istanza n8n accesa, le credenziali giuste, e accetti
 * che ogni prova mandi email vere e scriva righe vere nei fogli di calcolo.
 */

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
export function creaAmbiente({ input = [], nodi = {}, env = {}, vars = {}, adesso } = {}) {
  const elementi = input.map(comeItem);
  const istante = adesso ? new Date(adesso) : null;

  const $input = {
    all: () => elementi,
    first: () => elementi[0],
    last: () => elementi[elementi.length - 1],
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
    return {
      all: () => dati,
      first: () => dati[0],
      last: () => dati[dati.length - 1],
      item: dati[0],
      itemMatching: (i) => dati[i],
    };
  };

  // n8n espone $now come oggetto Luxon. Qui basta qualcosa che risponda a
  // toISO() e toString(): sono gli usi che si incontrano davvero nei Code node.
  const base = istante || new Date();
  const $now = {
    toISO: () => base.toISOString(),
    toString: () => base.toISOString(),
    toMillis: () => base.getTime(),
    valueOf: () => base.getTime(),
  };

  return {
    $input, $, $env: env, $vars: vars, $now,
    $today: $now,
    $execution: { id: 'test', mode: 'test', resumeUrl: '' },
    $workflow: { id: 'test', name: 'test', active: false },
    $runIndex: 0,
    $itemIndex: 0,
  };
}

/**
 * Esegue il codice di un nodo Code e restituisce quello che restituirebbe in n8n.
 *
 * Il codice gira in una funzione con le variabili di n8n come parametri: non è
 * una sandbox di sicurezza e non pretende di esserlo — stai eseguendo un
 * workflow che è già tuo. Serve a riprodurre il comportamento, non a difendersi.
 */
export function eseguiNodoCode(codice, ambiente) {
  const nomi = Object.keys(ambiente);
  const valori = nomi.map((n) => ambiente[n]);
  let fn;
  try {
    fn = new Function(...nomi, codice);
  } catch (e) {
    throw new Error(`The node's code does not compile: ${e.message}`);
  }
  const uscita = fn(...valori);
  // n8n accetta sia un array di item sia un singolo item.
  if (uscita === undefined || uscita === null) return [];
  return (Array.isArray(uscita) ? uscita : [uscita]).map(comeItem);
}
