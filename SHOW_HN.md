# Show HN — testo pronto (5/08/2026)

Da pubblicare su https://news.ycombinator.com/submit
Ogni affermazione qui sotto è stata verificata eseguendo, non ricordando.

---

## TITOLO (68 caratteri, il limite è 80)

```
Show HN: n8n-testkit – unit-test the Code nodes in your n8n workflows
```

## URL

```
https://github.com/perly-dev/n8n-testkit
```

## PRIMO COMMENTO (da inserire subito dopo aver pubblicato)

I maintain a handful of n8n workflows, and the failure mode that kept getting me is that
they break *quietly*. A model returns a slightly different shape, an API adds a field, a
node gets a new version — and the execution stays green while the data landing in the CRM
turns to mush. You find out weeks later, from a customer.

n8n has evaluations, but they run the workflow, which means credentials and every
integration firing for real. That is not something I want happening on each commit.

This takes a narrower slice: it reads an exported workflow, runs its Code nodes against
fixtures you control, asserts on the shape of what comes out, and exits non-zero when it
drifts. No n8n instance, no credentials, nothing leaving the machine. A test is about ten
lines of JSON. Zero dependencies, Node 18+.

What it does not do, up front:

- It runs Code nodes, not the whole graph. Your HTTP, Gmail, Sheets and AI nodes never
  execute, so broken credentials will not be caught here.
- It does not follow connections. Each test runs one node with the input you supply.
- It is not a sandbox, and it is not n8n's runtime. Your workflow's code runs in the
  process with whatever Node can reach, so don't point it at workflow files you don't
  trust. n8n's Code node is more restricted than plain Node, so something can pass here
  and still be refused there.

The thing that made me finish it: an earlier version of my own test workflows returned a
"FAILED" string without throwing. The run stayed green and the failure went unread — the
exact silent breakage the tool exists to catch, living inside the tool. That is in the
README now, because it is the best argument for the whole idea.

Where it is still rough, so you don't have to find out the hard way: the operators coerce
the way JavaScript does (`null` compares as `0`), `$now` and `$today` are small stand-ins
rather than Luxon, and `$('Other node').item` is matched by position instead of following
`pairedItem` — so on a workflow that filters or fans out, that reference is not faithful.

Written for my own workflows first. If it handles yours wrong I would rather hear it than
guess: https://github.com/perly-dev/n8n-testkit/issues

---

## RISPOSTE PRONTE ALLE OBIEZIONI PREVEDIBILI

Su HN i commenti arrivano nella prima ora e sono duri. Queste sono già scritte: vanno
adattate a quello che chiedono davvero, non incollate a freddo.

**«Perché non scrivi i workflow in codice, invece di usare n8n?»** (la più probabile)
> Fair, and for anything I own end to end I would. The workflows I test are ones other
> people need to be able to open and change without me — that is the actual reason n8n is
> there. Given that constraint, the logic inside the Code nodes is still code, and it can
> still regress silently. This is for that case, not an argument that n8n beats code.

**«Testa solo i Code node, cioè l'unica parte già testabile.»** (obiezione più forte, legittima)
> That is a fair hit, and it is why the limits are at the top of the README rather than
> buried. The Code nodes are where the logic I wrote lives, and in my experience they are
> where the silent breakage happens — a shape changes and everything downstream keeps
> going. Testing the integrations properly means running them, which puts you back in
> "needs credentials" territory, and that is a different tool.

**«`new Function()` è eval, è pericoloso.»**
> It is, and I say so in the README rather than claiming a sandbox I have not built. The
> threat model is that this is your workflow, on your machine, in your CI — the same trust
> you already give the repository. What you should not do is run it on workflow files that
> arrive from a fork or an untrusted pull request, and that is called out next to the CI
> instructions.

**«Perché JSON invece di scrivere i test in JavaScript?»**
> Because the people maintaining these workflows for clients are often not writing
> JavaScript, and asking them to write JS to test their JS loses them. The runner is
> plain ESM, so a `.js` test file that default-exports the same object works too.

**«È scritto da un'AI?»** (possibile, vista la storia)
> Written with heavy AI assistance and reviewed hard, which is exactly why the README now
> gets checked against the program line by line in the test suite — four separate times I
> had documented behaviour the code did not have. The check that compares the README's
> output block against the real output is in test/esegui-test.js.

---

## COSA NON FARE

- **Mai chiedere voti.** Le linee guida di HN lo vietano esplicitamente
  (*«Please don't ask friends to upvote or comment»*), e su HN si vede.
- Non pubblicare e sparire: se nella prima ora nessuno risponde ai commenti, il post muore.
- Non rispondere in modo difensivo alle critiche tecniche. Su HN chi concede un punto
  guadagna credibilità, chi si difende la perde.
