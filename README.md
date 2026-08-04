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

An n8n workflow breaks quietly. A model changes its answer shape, an API adds a field, a
node gets a new version — and the execution stays **green** while the data going into your
CRM turns to mush. You find out weeks later, from a customer.

n8n's built-in evaluations compare a whole run against a dataset. Useful, but they need the
workflow to actually run, which means credentials and careful isolation of every
integration it touches. That is a lot to set up in a pipeline that runs on every change.

This runs the **Code nodes** — the logic you wrote — on fixtures you control, asserts on
the shape of what comes out, and exits non-zero when it drifts.

## Install

```bash
npm install --save-dev n8n-testkit    # in a project
npx n8n-testkit tests.json            # or just run it
```

Node 18 or newer. No dependencies.

## Start here

Export your workflow from n8n (**Download**, not copy-paste), then ask which nodes are
testable:

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

| `operator` | Passes when |
|---|---|
| `equals` *(default)* | deep-equal to `value` |
| `notEquals` | not deep-equal |
| `contains` / `notContains` | string contains / does not contain |
| `matches` / `notMatches` | matches / does not match a regular expression |
| `empty` / `notEmpty` | empty (`null`, `""`, `[]`) or not |
| `oneOf` | equals one of the values in a list |
| `between` | numeric, between `[min, max]` |
| `greaterThan` / `lessThan` | numeric comparison |
| `length` | `.length` equals `value` |

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
- **It is not a sandbox.** Your workflow's code runs in this process, with whatever it can
  reach: the network, the environment, the filesystem. It is your workflow — this reproduces
  its behaviour, it does not defend against it. See *Use it in CI* below.
- **`$now` and `$today` are small stand-ins**, not Luxon: `toISO()`, `toMillis()`,
  `toString()`. `$today` is midnight UTC of the same day. Code doing Luxon arithmetic
  (`plus`, `diff`, `startOf`) will need a real fixture instead.
- **It runs JavaScript Code nodes, in "run once for all items" style.** Python Code nodes
  and per-item mode are not reproduced.

## Use it in CI

```yaml
- run: npx n8n-testkit tests.json
```

Non-zero exit on failure is the whole point: put it in front of the step that imports the
workflow into production, and a regression stops there instead of in a customer's inbox.

⚠️ **A workflow file is executable code.** This runs the Code nodes in the current process,
so a workflow can read your CI environment — secrets included — and reach the network. Run
it on workflows you trust, the way you already treat your own repository. Do not run it on
workflow files that arrive from forks or untrusted pull requests.

## Licence

MIT.

Found a workflow it handles wrong, or an assertion that should exist and doesn't?
[Open an issue](https://github.com/perly-dev/n8n-testkit/issues) — that is the more useful
half of this project.

*Not affiliated with or endorsed by n8n GmbH.*
