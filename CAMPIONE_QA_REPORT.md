# QA delivery report — secure n8n lead intake

**Assessment date:** 2026-08-08  
**System under test:** `Capture and clean inbound web form leads with a secure webhook`  
**Scope:** deterministic JavaScript in the workflow's five Code nodes  
**Status:** conditional pass — the Code-node regression baseline passes; one open integration-contract defect was reproduced; the live n8n path was not executed

## What was delivered

| Item | Result |
|---|---|
| Frozen workflow export | SHA-256 `55e4f029fbbb4c03ccfa32c86016e3c62af1141727886f096ee1de1ed5bc0e61` |
| Executable suite | 21 cases: 38 output assertions plus 2 expected-error checks |
| Assertion rationale | 38 of 38 output assertions contain `why`; both expected-error cases contain a test-level rationale |
| Baseline | 21 of 21 cases passed; exit code `0` |
| Mutation checks | 3 of 3 selected mutations were killed; every mutant exited `1` |
| Open finding | The setup says to use `website` as the honeypot, but the classifier does not recognise `website` |
| Test runner | n8n-testkit `0.2.0`, executed with Node `v24.18.0` |

The selected mutation result is not a claim of complete mutation coverage. It proves that the suite fails for three concrete regressions in three separate behaviours.

## Tested path

```text
Webhook [not executed]
  -> Refuse anything unsigned [tested]
  -> Spot the junk, with a reason [tested]
  -> Junk? [not executed]
       -> rejected: Keep three fields, safely [tested]
          -> Google Sheets / rejected [not executed]
          -> webhook response [not executed]
       -> accepted: Normalise the lead [tested]
          -> Make it safe for a spreadsheet [tested]
          -> Google Sheets / leads [not executed]
          -> webhook response [not executed]
```

This boundary matters: a green result proves the selected Code-node outputs against fixtures. It does not prove routing, credentials, Google Sheets mapping, webhook behaviour, or n8n runtime compatibility.

## Open finding F-02 — documented honeypot is not connected

The workflow's setup note instructs the operator to add a hidden field named `website`. The classifier explicitly excludes `website` from its supported trap names and accepts only:

```js
const TRAPPOLE = ['_gotcha', 'hp_field', 'nickname_confirm'];
```

Consequently, a bot that fills the documented hidden field can receive `junk: false` when its other fields satisfy the acceptance rules. The workflow execution remains green and the row follows the accepted-lead path.

Reproduction against the unmodified workflow:

```bash
NO_COLOR=1 node bin/n8n-testkit.js qa-sample/findings/f02-honeypot-doc-mismatch.tests.json
```

Exact captured output:

```text
../lead-intake.workflow.json

  ✗ [OPEN F-02] the documented website honeypot rejects a filled submission
      0.json.junk  expected true (equals), got false
      the bundled setup tells the operator to use website as the hidden bot
      field, but the classifier does not recognise that field

  1 of 1 failed

EXIT_CODE=1
```

Required correction: keep `website` available as a legitimate business field and change the setup instruction and form integration to use one supported hidden field, preferably `_gotcha`. The Code node and form producer must use the same name. This report does not modify the source workflow.

## Silent-failure map

Likelihood is qualitative because no production payload samples, execution logs, or change history were supplied. “High” means the condition already exists or is a normal configuration/edit path; “medium” means a common payload or business-rule change; “low” means a less common shape or requires another transformation.

| ID | What changes upstream | Concrete downstream result while execution can remain green | Likelihood and reason | Does this suite catch it? |
|---|---|---|---|---|
| F-01 | The shared-secret guard is weakened, the header name/case changes, or the deployment variable disappears | An unauthorised payload reaches the lead sheet, or a valid payload never reaches classification | Medium: proxy/header and deployment-variable changes occur during moves between Cloud, self-hosted, and gateways | **Partly.** Correct title-case header, wrong secret, and missing secret are checked. It does not exercise the Webhook node or proxy. |
| F-02 | The form follows the bundled instruction and uses hidden `website` | A bot-filled `website` field is ignored; the row reaches the accepted `leads` branch | **Certain when the supplied setup is followed:** documentation and code disagree now | **No.** The open reproduction proves the mismatch. The passing suite separately protects legitimate visible `website` values from false rejection. |
| F-03 | Contact fields become nested, are renamed, or a brief phone-only request arrives | The accepted row has no usable email/phone, or a valid “Call me” lead is written to `rejected` | Medium: form builders commonly change field names; phone-only forms are normal | **Partly.** Existing `phone`/`telephone` rules, phone-only acceptance, and no-contact rejection are checked. New names and nested objects are not. |
| F-04 | A supported honeypot is removed from the list or stops contributing a rejection reason | Bot rows enter `leads`, or rejected rows lose the reason needed for review | Medium: trap names are configuration, not a protocol | **Yes** for `_gotcha` and the exact reason. It does not inspect the actual form field configuration. |
| F-05 | A disposable provider uses a subdomain, or a new disposable provider appears | A throwaway address receives `junk: false` and is presented as an accepted lead | Medium: provider lists age continuously | **Partly.** A known provider subdomain is checked. Providers absent from the hard-coded list are not detectable without updating fixtures/data. |
| F-06 | URL case handling or the maximum-link constant changes; senders use `www.`, Markdown links, or shorteners | A link wall is written to the main leads sheet with no rejection reason | Medium: thresholds are edited manually and URL representations vary | **Partly.** Three `HTTPS://` links must be rejected and the count recorded. `www.`, Markdown, redirects, and reputation are not checked. |
| F-07 | The local-number trunk-zero policy changes, the default country is wrong, or the form serialises a phone as a number | `02 1234567` becomes `+3921234567`; a non-Italian local number gains `+39`; a leading zero lost before this node cannot be recovered | High for international deployments; medium for numeric serialisation | **Partly.** Italian trunk-zero retention and the E.164 length ceiling are checked. The suite cannot recover digits already lost upstream or infer a caller's country. |
| F-08 | `0039` is treated as a local prefix instead of an existing international prefix | The sheet stores an uncallable `+3939...` number | Medium: prefix-cleaning edits are compact and easy to regress | **Yes** for the supplied Italian fixture. Other country-prefix semantics are not covered. |
| F-09 | Name casing/splitting logic changes, or a name does not follow “first token / remaining surname” | CRM columns contain corrupted compound names or semantically swapped names; personalisation uses the wrong name | High for an international customer base | **Partly.** Hyphen, apostrophe, whitespace, and `de rossi` casing are checked. The suite cannot determine a person's culturally correct given/family-name boundary. |
| F-10 | The free-mail list changes or omits an alias/provider | `business_email` becomes true and `company_domain` is populated for a free-mail address, altering qualification/account reports | Medium: a static provider list becomes stale | **Partly.** Gmail and one corporate domain are checked. `googlemail.com`, regional aliases, and future providers are not. |
| F-11 | `comments`/`utm_source` is renamed, nested, or becomes an object/array | The sheet receives a blank message/source or the literal string `[object Object]`; attribution becomes `web form` | Medium: marketing forms and tag-manager payloads change shape | **Partly.** `comments`, `utm_source`, and whitespace normalisation are checked. No schema guard rejects objects, arrays, or new field names. |
| F-12 | Receipt time is dropped, replaced later in the chain, invalid, or generated from a wrong host clock | Lead ordering and response-time metrics use the wrong instant while the row still appends | Low to medium: clock faults are uncommon; field overwrites are easy | **Partly.** ISO shape at classification and preservation in normalisation are checked. Clock correctness and timezone semantics are not. |
| F-13 | Formula-prefix protection is removed or narrowed | A value beginning with `=`, `+`, `-`, or `@` reaches the Sheets node as active input instead of plain text | Medium: the source is public, attacker-controlled form data | **Yes** at Code-node output for the four prefixes and a safe control value. Whether Google Sheets interprets the final value is not executed. |
| F-14 | Recursive cleaning stops traversing objects or arrays | A nested formula survives and can become active if a later mapper flattens or serialises that value into a user-entered cell | Low to medium: nested payload expansion is less common but easy during enrichment | **Yes** for one object and one array member. Downstream flattening behaviour is not tested. |
| F-15 | Rejected-row projection is broadened, formula protection is removed, or attacker-controlled email length becomes unbounded | Phone/message data leaks into the audit sheet, a reason becomes active input, or a single row contains oversized text | Medium: auto-mapped payloads tend to expand when fields are added | **Yes** for the exact three-field object, protected reason, and 200-character email bound. The Sheets node is not executed. |
| F-16 | The IF branches are swapped, a connection is rewired, a sheet tab/mapping changes, or the response is taken from the wrong branch | Good leads land in `rejected`, junk lands in `leads`, or columns receive the wrong values even though Code-node tests stay green | High during canvas edits; these nodes are outside this runner | **No.** n8n-testkit does not follow connections or execute IF, Sheets, Webhook, or Respond nodes. |
| F-17 | The form, proxy, or n8n retries the same delivery | Identical rows are appended more than once and sales sees duplicate leads | Medium: webhook retries are a normal delivery behaviour | **No.** The workflow contains no idempotency key or deduplication stage; the runner does not model repeated end-to-end executions. |
| F-18 | Email syntax remains superficially valid but the domain/mailbox is not reachable | An unreachable contact is accepted and appears actionable | Medium: regex syntax is not mailbox validation | **No.** The workflow intentionally performs no DNS, MX, or mailbox check, and the test runner makes no network calls. |

## Executable test suite

The complete suite is `qa-sample/lead-intake.qa.tests.json`. It is delivered as executable JSON rather than duplicated into this report, so the reviewed assertions and the rerun assertions cannot drift apart.

| Failure IDs | Cases | Output assertions | Behaviour fixed by the contract |
|---|---:|---:|---|
| F-01 | 3 | 2 plus 2 `throws` checks | Valid signed payload is unchanged; wrong or absent secret fails closed |
| F-02 | 1 | 3 | Legitimate `website` is accepted; reason is empty; receipt time has ISO shape |
| F-03 | 2 | 3 | Phone-only lead is accepted; unreachable submission is rejected with cause |
| F-04 | 1 | 2 | `_gotcha` rejects and records the honeypot cause |
| F-05 | 1 | 2 | Disposable subdomain rejects and records the matched domain |
| F-06 | 1 | 2 | Three uppercase-scheme links reject and record the count |
| F-07 | 2 | 2 | Italian trunk zero survives; over-15-digit phone is not stored as callable |
| F-08 | 1 | 1 | `0039` becomes one `+39`, not `+3939` |
| F-09 | 1 | 3 | Compound/apostrophised names retain the defined readable casing |
| F-10 | 2 | 5 | Corporate/free-mail classification and normalised domain remain stable |
| F-11 | 1 | 2 | `comments` and `utm_source` populate canonical columns |
| F-12 | 1 | 1 | Existing receipt timestamp is preserved |
| F-13 | 1 | 5 | Four spreadsheet control prefixes are neutralised; safe input is unchanged |
| F-14 | 1 | 3 | Nested object and array strings are neutralised recursively |
| F-15 | 2 | 2 | Rejected log has exactly three fields and a bounded email |
| **Total** | **21** | **38 plus 2 `throws` checks** | |

All 38 objects under `expect` contain a human-readable `why`. n8n-testkit 0.2.0 does not print a custom `why` for `throws` tests; it prints its built-in explanation when a node stops throwing. The two `throws` cases retain a test-level rationale in the JSON, but that field is not rendered by the current CLI. This is a reporting gap in the product.

The suite is compatible with the 0.2.0 boundaries named in the brief:

- it makes no numeric comparison against missing/non-numeric data;
- it does not use blocked Node-only globals;
- it does not use `itemMatching()` or assume positional item linkage;
- it uses `length` only for the explicit 200-character rejected-email bound;
- it runs the five discoverable JavaScript Code nodes and no Python node.

Baseline command:

```bash
NO_COLOR=1 node bin/n8n-testkit.js qa-sample/lead-intake.qa.tests.json
```

Exact captured output:

```text
lead-intake.workflow.json

  ✓ [F-01] a correctly signed payload crosses the gate unchanged (0ms)
  ✓ [F-01] a wrong shared secret is refused (1ms)
  ✓ [F-01] no configured secret fails closed (0ms)
  ✓ [F-02] a legitimate website field is not treated as a honeypot (0ms)
  ✓ [F-03] a phone-only call request remains a usable lead (0ms)
  ✓ [F-04] a filled supported honeypot is rejected with an auditable reason (1ms)
  ✓ [F-05] a disposable-email subdomain is rejected (0ms)
  ✓ [F-06] three uppercase-scheme links trigger the first-contact limit (0ms)
  ✓ [F-03] a submission with no usable contact route is rejected (0ms)
  ✓ [F-07] an Italian landline keeps its trunk zero (0ms)
  ✓ [F-08] a 0039 international number is not prefixed twice (0ms)
  ✓ [F-09] compound and apostrophised names remain readable (0ms)
  ✓ [F-10] a corporate email is normalised and classified by domain (0ms)
  ✓ [F-10] Gmail is not presented as a company domain (0ms)
  ✓ [F-11] comments and utm_source aliases reach their canonical columns (0ms)
  ✓ [F-12] an upstream receipt timestamp is preserved (0ms)
  ✓ [F-07] a number beyond the E.164 digit limit is not stored as callable (0ms)
  ✓ [F-13] spreadsheet control prefixes are neutralised (0ms)
  ✓ [F-14] spreadsheet neutralisation reaches nested objects and arrays (1ms)
  ✓ [F-15] rejected-lead logging keeps only the audit fields (0ms)
  ✓ [F-15] rejected email storage is bounded (0ms)

  21 of 21 passed

EXIT_CODE=0
```

## Mutation evidence

The generator `qa-sample/mutations/build-mutations.mjs` refuses to write a mutant unless its target occurs exactly once. The mutation workflows are derived from the frozen workflow at rerun time.

### M-01 — remove the Italian trunk zero

Exact edit:

```diff
-const TOGLI_ZERO_INIZIALE = false;
+const TOGLI_ZERO_INIZIALE = true;
```

Command:

```bash
NO_COLOR=1 node bin/n8n-testkit.js qa-sample/mutations/m01-leading-zero.tests.mjs
```

Exact failure block:

```text
  ✗ [F-07] an Italian landline keeps its trunk zero
      0.json.phone  expected "+39021234567" (equals), got "+3921234567"
      for Italian landlines the zero is part of the callable international
      number; removing it stores a different number
```

Exact end-of-run summary:

```text
  1 of 21 failed

EXIT_CODE=1
```

The other 20 test cases passed; the complete unedited output is in `qa-sample/evidence/m01-leading-zero.txt`.

### M-02 — allow three links instead of two

Exact edit:

```diff
-const MAX_LINK = 2;
+const MAX_LINK = 3;
```

Command:

```bash
NO_COLOR=1 node bin/n8n-testkit.js qa-sample/mutations/m02-link-threshold.tests.mjs
```

Exact failure block:

```text
  ✗ [F-06] three uppercase-scheme links trigger the first-contact limit
      0.json.junk  expected true (equals), got false
      the first-contact contract allows at most two links; accepting three
      sends a link wall to the main leads sheet
      0.json.junk_reason  expected "3 links in a first message" (contains), got ""
      the stored reason must state the observed count so the rejection can be
      reviewed
```

Exact end-of-run summary:

```text
  1 of 21 failed

EXIT_CODE=1
```

The other 20 test cases passed; the complete unedited output is in `qa-sample/evidence/m02-link-threshold.txt`.

### M-03 — stop sanitising array members

Exact edit:

```diff
-if (Array.isArray(v)) return v.map(ripulisci);
+if (Array.isArray(v)) return v;
```

Command:

```bash
NO_COLOR=1 node bin/n8n-testkit.js qa-sample/mutations/m03-nested-array.tests.mjs
```

Exact failure block:

```text
  ✗ [F-14] spreadsheet neutralisation reaches nested objects and arrays
      0.json.metadata.tags.1  expected "'=CMD()" (equals), got "=CMD()"
      array members require the same recursive protection as top-level strings
```

Exact end-of-run summary:

```text
  1 of 21 failed

EXIT_CODE=1
```

The other 20 test cases passed; the complete unedited output is in `qa-sample/evidence/m03-nested-array.txt`.

## Limits of this delivery

This suite does **not** establish any of the following:

1. **End-to-end execution.** It does not call the Webhook, IF, Google Sheets, or Respond to Webhook nodes and does not traverse workflow connections.
2. **Live credentials or destination correctness.** It cannot show that the credential works, the spreadsheet ID is correct, the `leads` and `rejected` tabs exist, or auto-mapped columns match the sheet.
3. **Branch wiring.** A canvas edit can swap the true/false IF outputs while every Code-node test remains green.
4. **n8n runtime equivalence.** n8n-testkit is a compatibility shim. Passing here is not proof that the installed n8n version accepts and executes the code identically.
5. **Production payload coverage.** Fixtures were derived from the exported workflow's stated contract, not sampled from real webhook traffic. Unknown aliases, nested fields, objects, arrays, and producer-specific nulls remain open.
6. **Phone-number truth.** The suite protects the declared Italian default; it cannot infer country, validate reachability, retain a zero already lost before JSON serialisation, or split extensions safely.
7. **Identity semantics.** Formatting checks do not prove that a person's first and last names were split according to their culture or preference.
8. **Email reachability and provider freshness.** Regex shape, DNS/MX, mailbox existence, disposable-domain freshness, and the complete free-mail-provider set are outside the suite.
9. **Idempotency, retries, ordering, and concurrency.** Repeated webhook delivery can append duplicates; concurrent executions and rate limits are not simulated.
10. **Clock correctness.** The workflow uses `new Date()`, not fixture-controlled `$now`. The suite checks ISO shape and timestamp preservation, not host-clock accuracy.
11. **Actual spreadsheet interpretation.** The suite verifies the apostrophe-prefixed output. It does not send the value to Google Sheets and inspect the resulting cell type/formula state.
12. **Exhaustive mutation coverage.** Three selected mutations prove three failure paths. They do not measure every conditional, operator, branch, or possible edit.
13. **Security containment.** The runner executes trusted workflow JavaScript in its own process. This review is not a sandbox or an adversarial-code audit.
14. **Custom rationale rendering for expected errors.** n8n-testkit 0.2.0 does not render a custom `why` for a `throws` expectation.

## Re-run from a clean checkout

Run from the `n8n-testkit` repository root:

```bash
node --version
node bin/n8n-testkit.js --version
shasum -a 256 qa-sample/lead-intake.workflow.json qa-sample/lead-intake.qa.tests.json
node qa-sample/verify-evidence.mjs
NPM_CONFIG_CACHE=/tmp/n8n-testkit-npm-cache npm test
```

`verify-evidence.mjs` rebuilds all three mutation workflows, executes the baseline, executes the open-finding reproduction, executes all three mutation suites, writes the raw outputs under `qa-sample/evidence/`, and fails if any exit code differs from the expected result.

The isolated npm cache in the final command avoids relying on the machine's user-level npm cache. It does not alter test semantics.

## Artifact manifest

| Path | Purpose |
|---|---|
| `qa-sample/lead-intake.workflow.json` | Frozen workflow under review |
| `qa-sample/lead-intake.qa.tests.json` | Executable 21-case suite |
| `qa-sample/findings/f02-honeypot-doc-mismatch.tests.json` | Reproduction for the open setup/code mismatch |
| `qa-sample/mutations/build-mutations.mjs` | Deterministic mutation generator |
| `qa-sample/mutations/*.tests.mjs` | The same suite pointed at each mutant |
| `qa-sample/evidence/*.txt` | Complete raw CLI outputs including exit codes |
| `qa-sample/verify-evidence.mjs` | One-command evidence verifier |

## Release decision

Do not present this workflow as fully QA-approved until F-02 is corrected and a live n8n smoke test confirms both IF branches, both sheet destinations, their column mappings, and both webhook responses. The deterministic Code-node baseline is protected by the delivered suite.
