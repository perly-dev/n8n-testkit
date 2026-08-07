# n8n-testkit

Run the logic inside your n8n workflows against fixtures, and **fail the build when it
regresses** — without an n8n instance and without credentials. Your Gmail, Sheets, HTTP and
AI nodes never execute: only the JavaScript you wrote in the Code nodes does.

```bash
npx n8n-testkit tests.json
```

```
lead-intake.json

  ✓ an unsigned request is refused (0ms)
  ✓ with no secret configured, nothing gets through (0ms)
  ✓ a correctly signed request passes (0ms)
  ✓ a real website field is not mistaken for a bot trap (1ms)
  ✓ "Call me" with a phone number is not junk (0ms)
  ✓ a bot submission is rejected, with the reason recorded (0ms)
  ✗ an Italian number keeps the leading zero
      0.json.phone  expected "+39021234567" (equals), got "+3921234567"
      in Italy the zero is part of the number; stripping it the way the UK
      does produces a number that does not exist
  ✓ awkward names stay readable (0ms)
  ✓ a formula never reaches the spreadsheet alive (0ms)
  ✓ the protection reaches nested fields too (0ms)

  1 of 10 failed
```

Exit code `1`. Your pipeline stops. Nobody ships a workflow that quietly mangles phone
numbers.

## Why this exists

An n8n workflow breaks quietly. Someone edits a Code node, or the payload arriving at it
changes shape — and the execution stays **green** while the data landing in your CRM is
wrong. You find out weeks later, from a customer.

n8n's evaluations exercise a path through a running workflow. This is a smaller check for
the deterministic part: the JavaScript you wrote.

Each test picks one Code node, runs it on fixtures you control, checks assertions on
selected paths of what comes out, and exits non-zero when a value drifts.

## Install

```bash
npm install --save-dev n8n-testkit    # in a project
npx n8n-testkit tests.json            # or just run it
```

Node 18 or newer. No dependencies.

## Start here

Export your workflow from n8n (**Download**, not copy-paste), then list its JavaScript
Code nodes, along with the ones that are obviously out of reach — Python, empty, or a name
shared with another node:

```bash
npx n8n-testkit --nodes my-workflow.json
```

```
Code nodes in «Capture and clean inbound web form leads with a secure webhook»:

  Refuse anything unsigned
  Spot the junk, with a reason
  Keep three fields, safely
  Normalise the lead
  Make it safe for a spreadsheet
```

Then write `tests.json` next to it:

```json
{
  "workflow": "my-workflow.json",
  "tests": [
    {
      "name": "a real website field is not mistaken for a bot trap",
      "node": "Spot the junk, with a reason",
      "input": [{ "body": { "email": "ok@company.com", "website": "https://company.com" } }],
      "expect": [
        { "path": "0.json.junk", "value": false,
          "why": "plenty of real forms have a website field — rejecting those loses customers silently" }
      ]
    }
  ]
}
```

Run it. That is the whole loop.

## Writing a test

| Field | What it is |
|---|---|
| `name` | what the test proves, in a sentence a colleague would understand |
| `node` | the Code node to run, exactly as named on the canvas |
| `input` | the items arriving at the node. Bare objects get wrapped in `{json: …}` for you |
| `nodes` | output of *other* nodes, when the code calls `$('Some node')` |
| `env` / `vars` | what `$env` and `$vars` should contain |
| `now` | a fixed timestamp for `$now` — a test that depends on the clock fails at midnight and nobody knows why |
| `expect` | the assertions |
| `throws` | expect the node to **throw**; optionally, text the message must contain |

### `throws` — when failing is the correct behaviour

An auth gate that refuses an unsigned request *must* throw. Assert that it does:

```json
{
  "name": "an unsigned request is refused",
  "node": "Refuse anything unsigned",
  "env": { "LEAD_WEBHOOK_SECRET": "test-secret" },
  "input": [{ "headers": {}, "body": {} }],
  "throws": "missing or wrong x-webhook-key"
}
```

If the node stops throwing, the test fails with a message that says what that means:
*"this node was supposed to throw and it passed instead. If this is a security check, it no
longer protects anything."*

### Assertions

`path` is a path into the result: `0.json.category` means "first item, field `category`".
Dots separate the steps, so a field whose **name** contains a dot cannot be addressed —
assert on its parent object instead.

| `operator` | Passes when |
|---|---|
| `equals` *(default)* | deep-equal to `value` |
| `notEquals` | not deep-equal |
| `contains` / `notContains` | string contains / does not contain |
| `matches` / `notMatches` | matches / does not match a regular expression |
| `empty` / `notEmpty` | empty (`null`, `""`, `[]`) or not |
| `oneOf` | equals one of the values in a list |
| `between` | finite number (or numeric string), between `[min, max]` |
| `greaterThan` / `lessThan` | finite-number comparison; numeric strings are accepted |
| `length` | `.length` equals `value` |

Numeric operators deliberately do **not** use JavaScript's broad `Number()` coercion.
Numbers and non-empty numeric strings such as `"42"`, `" 4.2 "`, or `"1e3"` are accepted,
both in the result and in the expected threshold. Missing values, `null`, booleans, arrays,
objects, empty strings, `NaN`, and infinities fail with a message naming the path and the bad
value. This prevents a missing field from quietly becoming zero and satisfying a threshold.

`why` is optional and worth writing. It is printed when the test fails, and it is what
tells whoever finds a red build in six months *why* that value mattered.

## Prove your tests can fail

A test suite that cannot fail is worse than no tests: it grants confidence it has not
earned. Before trusting these, break the workflow on purpose and check that the suite goes
red — change a constant, delete a guard, swap a threshold.

If everything still passes, your assertions are decorative.

*(This is not theoretical. An earlier version of our own test workflows returned a "FAILED"
string without throwing: the run stayed green, and the failure went unread. That is the
exact silent breakage this tool exists to catch, living inside the tool.)*

## What is reproduced, exactly

This is a compatibility shim, not n8n's task runner. **A green run means the assertions
passed here — not that n8n will accept the code.** The table is the honest boundary:

| Inside a Code node | Here |
|---|---|
| `$input.all()` / `.first()` / `.last()` / `.item` | yes — but a branch or run index argument is refused, not ignored |
| `$json`, `$itemIndex` (per-item mode) | yes |
| `$('Node').all()` / `.first()` / `.last()` | yes, from the fixtures you pass under `nodes` |
| `$('Node').itemMatching(i)` | **no** — fails explicitly instead of guessing by position |
| `$('Node').item` | by **position**, not by `pairedItem` |
| `$env`, `$vars`, `$runIndex`, `$execution`, `$workflow` | yes, from the test |
| `$now`, `$today` | `toISO()`, `toMillis()`, `toString()`, `valueOf()`; other access fails as unsupported Luxon |
| `await` / async code | yes |
| Run once for all items / for each item | yes, taken from the node |
| default n8n global profile | yes for ordinary access; details below |
| `$helpers`, `this.helpers` | **no** |
| module imports | **no** — n8n's default deny-all module policy is reproduced |
| Python Code nodes | **no** — listed as untestable |
| n8n's isolation, timeouts and prototype restrictions | **no** — see below |

### Default n8n global profile

The Code node is compiled with a compatibility view of globals so Node itself cannot make a
test green merely by offering more APIs than n8n. The profile starts from the ECMAScript
globals in a blank VM context, then adds the native globals n8n currently supplies:
`Buffer`, the timeout/interval/immediate functions and their clear functions, `atob`, `btoa`,
the `TextEncoder`/`TextDecoder` families, and `FormData`.

Other globals added by the Node version running the test are blocked when code reaches them.
That includes `process`, `fetch`, and — depending on Node — APIs such as `URL`, web streams,
`structuredClone`, `performance`, and the web crypto global. Direct identifiers and access
through `globalThis`, n8n's `global` alias, or top-level `this` get the same explicit error.
Locally declared variables with those names are left alone.

`require` exists, as it does in n8n, but every call fails under this kit's default profile:
n8n disables built-in and external modules unless a self-hosted administrator allowlists
them. Aliasing the function (`const load = require; load('node:fs')`) is still caught, as are
dynamic `import()` calls. This kit does not accept a module allowlist, install modules, or try
to reproduce a particular self-hosted override.

This is a **compatibility check, not a security boundary**. It covers ordinary identifier and
global-object access. It does not try to defeat hostile reflective code using function
constructors, indirect evaluation, prototype tricks, or other sandbox escapes; it does not
freeze prototypes or stop infinite loops. Run only workflows you trust.

Verified against the documented behaviour of the JavaScript Code node and against the
workflow exports in `esempi/`. It is **not** verified against a running n8n instance, so
treat runtime compatibility as untested: if something passes here and n8n refuses it, that
is a bug worth [reporting](https://github.com/perly-dev/n8n-testkit/issues).

## What it does **not** do

Read this before you trust it.

- **It runs Code nodes, not the whole workflow.** HTTP calls, Gmail, Sheets, Slack, AI
  nodes: none of those execute. You are testing the logic you wrote, not the integrations.
  Broken credentials will not be caught here.
- **It does not follow the connections.** Each test runs one node with the input you supply.
  If you want to test a chain, feed one node's output into the next test yourself.
- **Tests live beside the workflow, not inside it.** Renaming a node you test fails the test
  loudly, but a field you never assert on can change under you and stay green. Same
  discipline as any test suite.
- **It is not a sandbox, and it is not n8n's runtime.** The default global profile catches
  normal access to Node-only APIs, but your workflow's code still runs in this process. It is
  not designed to contain adversarial code, and reflective JavaScript can escape a
  compatibility shim and reach the environment, network, or filesystem. See *Use it in CI*.
- **`$now` and `$today` are small stand-ins**, not Luxon: `toISO()`, `toMillis()`,
  `toString()`, and `valueOf()`. `$today` is midnight UTC of the same day. Any other property
  or method produces an explicit unsupported-Luxon error. Arithmetic (`plus`, `minus`),
  zones, `startOf`, `diff`, and formatting are not approximated: correct results depend on
  Luxon's calendar, timezone, locale, and DST semantics, which a zero-dependency Date wrapper
  cannot reproduce honestly.
- **It runs JavaScript Code nodes only.** Python Code nodes are listed as untestable rather
  than run. Both modes work — *run once for all items* and *run once for each item* — and
  the mode is taken from the node itself, not from your test.
- **Item linking is not reproduced.** `$('Other node').item` still returns the item at the
  current position, which is useful only for a one-to-one chain that preserves order.
  `itemMatching(i)` now fails explicitly: n8n resolves it by traversing `pairedItem` through
  intermediate nodes, runs, branches and inputs, while `nodes` fixtures are only output
  snapshots. A `pairedItem` number without that execution graph is not enough to identify
  the named ancestor honestly. Use `.all()[i]` only when position is the behaviour you mean;
  a node that relies on linking must be tested in n8n.

## Use it in CI

```yaml
- run: npm ci
- run: ./node_modules/.bin/n8n-testkit tests.json
```

Install it as a dev dependency and run the local binary rather than `npx`: a bare `npx`
can fetch a newer version mid-pipeline, and a test tool that changes under you is the one
thing you cannot have.

Non-zero exit on failure is the whole point: put it in front of the step that imports the
workflow into production, and a regression stops there instead of in a customer's inbox.

⚠️ **A workflow file is executable code.** This runs the Code nodes in the current process.
The compatibility profile is not containment: hostile reflective code may still read your CI
environment — secrets included — or reach the network and filesystem. Run it on workflows
you trust, the way you already treat your own repository. Do not run it on workflow files
that arrive from forks or untrusted pull requests.

## Licence

MIT.

Found a workflow it handles wrong, or an assertion that should exist and doesn't?
[Open an issue](https://github.com/perly-dev/n8n-testkit/issues) — that is the more useful
half of this project.

*Not affiliated with or endorsed by n8n GmbH.*
