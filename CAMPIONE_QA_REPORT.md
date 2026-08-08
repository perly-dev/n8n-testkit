# Lead-intake workflow — QA report

Date: 8 August 2026

Scope: deterministic JavaScript in the five n8n Code nodes in `qa-sample/lead-intake.workflow.json`.

## Delivered

- 21 named regression cases covering authentication, classification, normalisation, spreadsheet safety, and rejected-lead minimisation.
- 3 controlled mutations, each detected by the suite with one failed case and process exit code 1.
- 1 open F-02 requirement mismatch, 5 captured evidence logs, and `qa-sample/verify-evidence.mjs` to reproduce them.

## Failure map

These are data failures that can leave an n8n execution green because the Code node still returns an item. “Detected” refers to the supplied 21-case suite unless the row explicitly names the separate open-finding suite.

| Fault | What changes upstream or in the Code node | What arrives wrong downstream | Detected by this suite? |
|---|---|---|---|
| F-01 | The shared secret is missing, header casing/value handling changes, or the authentication gate is weakened. | Unauthorised submissions can become normal sheet rows; a valid submission can be dropped or its body changed at the gate. | **Yes.** Three cases cover a valid signature, a wrong signature, and no configured secret. |
| F-02 | The setup/form contract calls `website` a honeypot while the classifier deliberately treats `website` as a legitimate business field. | In the current setup, bots that fill only `website` enter the accepted branch. A contrary code-only change would silently reject legitimate leads that supply their company site. | **Conflict, not resolved.** The main suite detects the false-positive version; the separate `[OPEN F-02]` suite detects the documented-honeypot version and currently fails. |
| F-03 | Contact-route validation or the short-message rule changes, or the sender uses a phone without a usable email. | A callable phone-only lead is rejected, or an unreachable record is accepted for sales to action. | **Yes.** One case covers each direction. |
| F-04 | A supported trap field is renamed, ignored, or no longer contributes a rejection reason. | Bot traffic enters the main leads sheet, or the rejected row no longer says why it was rejected. | **Yes for `_gotcha`.** A new form-side trap name is not detected unless a fixture is added. |
| F-05 | Disposable-domain matching changes from suffix-aware matching to exact matching, or domain extraction changes. | `lead@mail.tempmail.com` is accepted, or the audit reason loses the matched domain. | **Yes for the supplied subdomain.** The suite does not establish that the provider list is current. |
| F-06 | The first-contact threshold changes from more than two links, or link recognition becomes case-sensitive. | A three-link first message reaches the main leads sheet and its rejection reason is blank. | **Yes.** The case uses three uppercase `HTTPS://` links and checks both decision and reason. |
| F-07 | The default-country trunk-zero policy changes, or the E.164 length cap is removed. | An Italian landline is stored as a different number, or a value longer than 15 digits is presented as callable. | **Yes.** Both behaviours have a case. |
| F-08 | `0039` stops being recognised as an existing international prefix. | The default country code is added again, producing an uncallable `+3939...` number. | **Yes.** The case checks the final normalised number. |
| F-09 | Name splitting or case conversion stops preserving whitespace-separated, hyphenated, or apostrophised tokens. | Sales and customer-facing replies receive visibly corrupted names; matching and duplicate review become inconsistent. | **Yes for the two supplied names.** Other scripts, particles, and naming conventions are outside the fixtures. |
| F-10 | Email trimming/casing, company-domain extraction, or the free-mail list changes. | Exact-match lookups create duplicates, Gmail is reported as a company, or business-email routing is wrong. | **Yes for one corporate address and Gmail.** Other providers and address semantics are not covered. |
| F-11 | The incoming form switches to the already-supported `comments` or `utm_source` aliases, or alias handling is removed. | The sales note is blank and campaign/partner attribution falls back to `web form`. | **Yes.** Both canonical outputs are checked. |
| F-12 | A downstream normalisation edit overwrites an earlier `received_at` value. | Response-time and ordering metrics use processing time instead of ingestion time. | **Yes.** A fixed upstream timestamp must survive unchanged. |
| F-13 | Protection for leading spreadsheet control characters is weakened or applied to the wrong fields. | User-controlled text is interpreted by Google Sheets instead of stored as text, or ordinary values are altered. | **Partly.** `=`, `+`, `-`, and `@` are exercised at the top level; tab and carriage-return prefixes are implemented but not asserted. |
| F-14 | Recursive spreadsheet neutralisation stops at the first object level or skips arrays. | A formula string inside `metadata.note` or `metadata.tags` reaches an auto-mapped column unescaped. | **Yes.** Nested object, dangerous array member, and safe array member are checked. |
| F-15 | Rejected-item projection, reason neutralisation, or the email length bound changes. | The rejected sheet retains message/phone data, evaluates a formula in the reason, or accepts unbounded attacker-controlled email text. | **Yes for the stated fields and the 200-character email cap.** Other field-specific size limits are not covered. |

## The 21 assertions

The CLI counts 21 named test cases. Those cases contain 40 individual `expect` or `throws` checks. The order below is grouped by defended fault; the captured baseline later in this report preserves execution order.

### F-01 — authentication boundary

1. **A correctly signed payload crosses the gate unchanged.** A valid lead must neither disappear nor be rewritten while its header is checked.
2. **A wrong shared secret is refused.** Otherwise an unauthorised caller can create a normal-looking lead row.
3. **No configured secret fails closed.** A deployment omission must stop ingestion rather than disable authentication.

### F-02 — `website` field semantics

4. **A legitimate website field is not treated as a honeypot.** This prevents qualified business leads from being discarded and also checks an empty rejection reason and an ISO receipt timestamp.

### F-03 — usable contact route

5. **A phone-only call request remains a usable lead.** A seven-or-more-digit phone is a valid reply route even with a short message and unusable email.
6. **A submission with no usable contact route is rejected.** Sales must not receive an ordinary row that nobody can answer, and the audit row must name the contact-data failure.

### F-04 — supported honeypot

7. **A filled supported honeypot is rejected with an auditable reason.** The `_gotcha` value must divert the item and state the cause instead of letting bot traffic blend into accepted leads.

### F-05 — disposable-email subdomains

8. **A disposable-email subdomain is rejected.** Suffix-aware matching must catch `mail.tempmail.com`, and the stored reason must identify the domain for review.

### F-06 — first-contact link limit

9. **Three uppercase-scheme links trigger the first-contact limit.** Case-insensitive counting must reject the third link and record the observed count.

### F-07 — phone validity

10. **An Italian landline keeps its trunk zero.** Removing that zero changes `+39 02...` into a different number.
11. **A number beyond the E.164 digit limit is not stored as callable.** More than 15 digits must produce an empty normalised phone, not a plausible-looking invalid value.

### F-08 — existing international prefix

12. **A `0039` international number is not prefixed twice.** It must normalise to `+39021234567`, not an uncallable `+3939...` value.

### F-09 — readable names

13. **Compound and apostrophised names remain readable.** `Anna-Maria`, `De Rossi`, and `O'Brien` verify the separators and surname tokens that would otherwise be visibly corrupted.

### F-10 — email and company classification

14. **A corporate email is normalised and classified by domain.** Trimming and lowercasing prevent duplicate lookups, while the derived domain and business flag drive account routing.
15. **Gmail is not presented as a company domain.** A free-mail address must not create a fictional company account or receive a business-email flag.

### F-11 — input aliases

16. **`comments` and `utm_source` aliases reach their canonical columns.** Common form field names must not become a blank sales note or generic attribution.

### F-12 — ingestion time

17. **An upstream receipt timestamp is preserved.** Replacing it later would change response-time and ordering metrics without causing an execution error.

### F-13 — top-level spreadsheet controls

18. **Spreadsheet control prefixes are neutralised.** Leading `=`, `+`, `-`, and `@` values must become text while an ordinary email remains unchanged.

### F-14 — recursive spreadsheet controls

19. **Spreadsheet neutralisation reaches nested objects and arrays.** Dangerous nested strings must be escaped and a safe array member must remain unchanged.

### F-15 — rejected-lead minimisation

20. **Rejected-lead logging keeps only the audit fields.** The rejected row must contain timestamp, email, and protected reason—not message and phone data.
21. **Rejected email storage is bounded.** Attacker-controlled email text must be truncated to 200 characters before it reaches the rejected sheet.

## Mutation evidence

The three mutations are generated by `qa-sample/mutations/build-mutations.mjs`. The unmodified workflow is the common “before” state for all three mutations. The following baseline is copied from `qa-sample/evidence/baseline.txt`:

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

### M-01 — remove the Italian trunk zero

Injected change: `TOGLI_ZERO_INIZIALE` changes from `false` to `true`.

Exact failing section and summary copied from `qa-sample/evidence/m01-leading-zero.txt` (passing lines omitted):

```text
  ✗ [F-07] an Italian landline keeps its trunk zero
      0.json.phone  expected "+39021234567" (equals), got "+3921234567"
      for Italian landlines the zero is part of the callable international
      number; removing it stores a different number

  1 of 21 failed

EXIT_CODE=1
```

Result: the mutation is detected by F-07 and the process exits non-zero.

### M-02 — raise the accepted-link threshold

Injected change: `MAX_LINK` changes from `2` to `3`.

Exact failing section and summary copied from `qa-sample/evidence/m02-link-threshold.txt` (passing lines omitted):

```text
  ✗ [F-06] three uppercase-scheme links trigger the first-contact limit
      0.json.junk  expected true (equals), got false
      the first-contact contract allows at most two links; accepting three
      sends a link wall to the main leads sheet
      0.json.junk_reason  expected "3 links in a first message" (contains), got ""
      the stored reason must state the observed count so the rejection can be
      reviewed

  1 of 21 failed

EXIT_CODE=1
```

Result: the mutation is detected by F-06 and the process exits non-zero.

### M-03 — stop sanitising array members

Injected change: array handling changes from `return v.map(ripulisci)` to `return v`.

Exact failing section and summary copied from `qa-sample/evidence/m03-nested-array.txt` (passing lines omitted):

```text
  ✗ [F-14] spreadsheet neutralisation reaches nested objects and arrays
      0.json.metadata.tags.1  expected "'=CMD()" (equals), got "=CMD()"
      array members require the same recursive protection as top-level strings

  1 of 21 failed

EXIT_CODE=1
```

Result: the mutation is detected by F-14 and the process exits non-zero.

These checks show that the unmodified suite can go green and that three independent, relevant regressions make it go red with exit code 1. They do not establish mutation coverage for every assertion or every possible edit.

## Open finding: F-02 honeypot documentation mismatch

### What it is

The workflow’s setup note tells the operator to add an empty hidden field named `website`. The classifier’s Code node explicitly excludes `website` from its trap list because many forms use it as a legitimate company-site field. It recognises `_gotcha`, `hp_field`, and `nickname_confirm` instead.

The result is a contract mismatch: a bot that fills the documented `website` trap is not rejected for that field. The separate finding suite proves the current behaviour. This output is copied from `qa-sample/evidence/f02-open-honeypot-mismatch.txt`:

```text
../lead-intake.workflow.json

  ✗ [OPEN F-02] the documented website honeypot rejects a filled submission
      0.json.junk  expected true (equals), got false
      the bundled setup tells the operator to use website as the hidden bot
      field, but the classifier does not recognise that field

  1 of 1 failed

EXIT_CODE=1
```

### Why it matters

The workflow can be deployed exactly as documented and still accept submissions that the operator believes the honeypot will reject. n8n will show a green execution because the classifier returns a valid item; the defect is only in the classification result. Treating `website` as a trap without changing the form contract creates the opposite failure: real leads with a company website are silently rejected.

### Required client action

Choose one meaning for `website` and make the form, setup note, classifier, and tests agree before relying on the honeypot:

- Recommended when the form has a legitimate website field: change the hidden field in the setup instructions and form to `_gotcha` (or another name already in `TRAPPOLE`), keep the baseline F-02 case, and change the open finding into a passing contract test for that chosen field.
- If `website` is guaranteed to be hidden and never a customer field: add it to `TRAPPOLE`, replace the baseline F-02 expectation, and document that the public form must not expose a legitimate field with the same name.

The current report does not mark F-02 resolved.

## Declared limits

- The suite executes JavaScript Code nodes in isolation. It does not execute the Webhook, If, Google Sheets, or Respond to Webhook nodes and does not follow workflow connections.
- There is no live n8n run. Runtime compatibility, node-version behaviour, webhook activation, proxy/header handling, routing, response status/body, and item-linking are not verified here.
- Google Sheets credentials, spreadsheet ID, tab names, column mappings, permissions, append behaviour, and `USER_ENTERED` behaviour are not exercised against Google Sheets.
- A passing case proves only the supplied fixture and asserted paths. Unasserted fields can change while the suite stays green.
- F-02 remains an unresolved form/documentation/code contract mismatch; the 21-case baseline is green because it protects the legitimate-website interpretation.
- Authentication coverage checks Code-node decisions, not transport security, secret strength/rotation, replay protection, rate limiting, timing behaviour, or webhook URL exposure.
- Spam checks are examples, not a complete spam model. The disposable-domain list can become stale, new honeypot names are not discovered automatically, and link/message heuristics can have untested false positives and false negatives.
- Email syntax is checked only by the workflow’s regular expression. Deliverability, MX records, mailbox existence, aliases, and deduplication are not tested.
- Phone coverage is centred on the declared Italian `+39` default, `0039`, and the 15-digit E.164 ceiling. Other national trunk rules, extensions, emergency/service numbers, and number validity are not established.
- Name coverage is limited to the supplied Latin-script examples. International naming conventions, Unicode normalisation, mononyms, and locale-specific casing are not established.
- Spreadsheet-prefix tests cover `=`, `+`, `-`, and `@` at the top level and `=` in nested data. The implemented tab and carriage-return guards are not separately asserted, and no spreadsheet application is opened to confirm final cell interpretation.
- Rejected rows are checked for three fields and a 200-character email cap. Retention periods, access controls, deletion, regulatory basis, and bounds on other strings are outside this suite.
- Performance, load, concurrency, retries, duplicate delivery, partial integration failure, observability, alerts, rollback, and recovery are not tested.
- The test runner is a compatibility shim, not an n8n security sandbox. Only trusted workflow files should be executed with it.

## Reproduce the evidence

Requirement: Node.js 18 or newer. From the repository root:

```bash
cd '/Users/stefano/Documents/Lavoro/ENTRATE AUTOMATICHE/Prodotti/n8n-testkit'
node qa-sample/verify-evidence.mjs
```

The verifier rebuilds the three mutation workflows, runs the baseline, the open F-02 finding, and all three mutations, rewrites the five files under `qa-sample/evidence/`, and stops if any exit code differs from the expected result. A successful verifier run means:

- baseline suite: exit 0;
- open F-02 finding: exit 1;
- M-01, M-02, and M-03: exit 1 each;
- baseline evidence contains `21 of 21 passed`.

To run each component directly:

```bash
# Expected exit: 0
NO_COLOR=1 node bin/n8n-testkit.js qa-sample/lead-intake.qa.tests.json

# Expected exit: 1 (open finding)
NO_COLOR=1 node bin/n8n-testkit.js qa-sample/findings/f02-honeypot-doc-mismatch.tests.json

# Rebuild mutation workflow files before mutation runs
node qa-sample/mutations/build-mutations.mjs

# Expected exit: 1 for each mutation
NO_COLOR=1 node bin/n8n-testkit.js qa-sample/mutations/m01-leading-zero.tests.mjs
NO_COLOR=1 node bin/n8n-testkit.js qa-sample/mutations/m02-link-threshold.tests.mjs
NO_COLOR=1 node bin/n8n-testkit.js qa-sample/mutations/m03-nested-array.tests.mjs
```

An exit code of 1 is the expected success condition for the open finding and mutation demonstrations: those runs contain a deliberately unmet expectation or a deliberately broken workflow. The all-in-one verifier returns 0 only when every component produces its expected exit code.

---

## NOTE INTERNE — non consegnare

**Verdict: yes, it is worth $149 if it is sold as regression testing for the Code nodes, not as end-to-end workflow certification.** The value is in the workflow-specific work: 21 cases with operational reasons, 40 individual checks, three mutations proving a non-zero failure exit, reproducible evidence, and one contract defect actually found.

It is not worth $149 if the commercial promise is “the workflow is tested” without the node-level qualification. That claim requires at least: resolving F-02; importing into a compatible n8n instance; calling the real webhook; exercising both If branches; appending to a temporary sheet with real credentials and columns; checking HTTP responses; and testing credential errors, retries, and duplicate delivery. That would be a separate integration assessment.
