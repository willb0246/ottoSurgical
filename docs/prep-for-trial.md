# Otto Surgical — Real Patient Data Readiness Checklist

**Purpose:** what must be true before a surgeon dictates a real case, with real patients, into Otto.

**Status:** draft for founder use. Items marked 🔴 are hard blockers — no real PHI touches the system until they are done. Items marked 🟡 are required but can land in parallel with pilot setup. Items marked ⚪ are commonly assumed to be required and are not.

---

## 0. Three questions that determine everything below

Answer these first. They change the shape of the whole checklist.

**Q1. Who is the covered entity?**
Not the surgeon. If Dr. Neimat is employed by a health system, the covered entity is the institution, and *he cannot unilaterally authorize disclosure of PHI to a vendor.* "Friendly surgeon tries it out" is not a legal pathway. Either you contract with the institution, or you do not get real PHI. Getting this wrong doesn't primarily hurt you — it hurts your champion, who is the single hardest asset to replace.

**Q2. What is the minimum PHI the product actually needs?**
Otto's value is in the *narrative* — vessels cannulated, devices placed, steps performed. That content does not require the patient's name, MRN, or DOB to be useful. If the app never captures identifiers, and the surgeon joins the draft to the patient manually in Epic, the blast radius of any breach shrinks enormously. Design for this before you build the compliance stack around a larger surface than you need.

**Q3. What happens when Otto is wrong?**
The operative note is the legal record of the procedure. A fabricated step, a wrong laterality, or a wrong device size that a rushed surgeon signs is patient harm and malpractice exposure, and it is *your* output in the chain. This is why §5 is not optional polish.

---

## 1. Pick the right stage — you probably do not need real PHI yet

Real PHI is a step change in obligation. Consider whether an intermediate stage gets you the same learning at a fraction of the cost.

| Stage | What it is | Compliance burden | What it proves |
|---|---|---|---|
| **0. Mock** | Dr. Neimat narrates an imagined DBS/angio case | None | Does the pipeline work; does the note look right |
| **1. De-identified real** | Surgeon narrates a case he actually did, omitting all identifiers | Low — but see caveat | Does it handle real-case messiness, real vocabulary, real variability |
| **2. Real PHI, shadow** | Real case, real identifiers, Otto output never filed; surgeon dictates normally too | **Full stack below** | Does it work in the real OR under real time pressure |
| **3. Real PHI, primary** | Otto output is what gets signed | Full stack + clinical safety + institutional sign-off | Does it actually save time / catch gaps |

- [ ] **Decide explicitly which stage you are targeting, and write it down.** Most of the product risk (transcription accuracy in the OR, hallucination, whether the draft is good) is answerable at Stage 1.
- [ ] **Caveat on Stage 1:** a narrative op note for a rare procedure, with a date and a named surgeon, may be re-identifiable even without name/MRN. Safe Harbor de-identification of free-text surgical narrative is harder than it looks. Treat "de-identified" as *lower* risk, not *zero* risk, and still apply §3 encryption and access controls.
- [ ] **If the answer is Stage 2 or 3, everything below applies.** There is no pilot-scale exemption in HIPAA. "It's just a POC" is not a defense.

---

## 2. 🔴 Legal & contractual (longest lead time — start these first)

### Agreements you must have signed
- [ ] **BAA with the covered entity** (health system or private practice), naming Beacon Health / Otto Surgical as business associate. This is the one that requires someone other than your champion to say yes.
- [ ] **AWS BAA executed and accepted** at the account level (AWS Artifact), with the account designated as containing PHI.
- [ ] **Confirm every AWS service in the path is HIPAA-eligible** under that BAA — S3, Transcribe, Lambda, KMS, Cognito, API Gateway, and whichever database you land on. Eligibility is per-service and changes; verify against AWS's current HIPAA-eligible services list rather than memory.
- [ ] **LLM provider covered.** Two options, and this is worth a deliberate architecture decision:
  - **Route generation through Amazon Bedrock** → covered under the existing AWS BAA. One fewer subprocessor, one fewer contract, one fewer thing to explain to a hospital security reviewer.
  - **Direct Anthropic API** → confirm BAA availability and data-retention terms for your account tier before sending any PHI. Start at https://docs.claude.com/en/docs_site_map.md and https://www.anthropic.com/contact-sales.
- [ ] **Flow-down BAAs for every other subprocessor** touching PHI — error monitoring, analytics, log aggregation, any managed service. If you can't name them all from memory, that's the finding.
- [ ] **Written subprocessor inventory** maintained as a living document. Hospital security reviews ask for this by name.

### Institutional pathway
- [ ] **Identify who at the institution actually approves this** — privacy office, IT security, and possibly research/IRB if you intend to publish or if it's framed as a study.
- [ ] **Determine whether this is quality improvement or research.** If research, IRB is not optional and the timeline changes by months.
- [ ] **Check institutional policy on recording in the OR.** Frequently governed by policy independent of HIPAA, and frequently more restrictive.
- [ ] **Patient notice/consent.** Treatment-and-operations use by a business associate often does not require separate patient authorization, but institutional policy on recording commonly does. Confirm, don't assume.
- [ ] **State law check** for the state where the surgery occurs — recording consent, medical record custody, breach notification thresholds stricter than HIPAA.

### Coverage
- [ ] **Cyber liability + tech E&O insurance** with explicit HIPAA/breach coverage. Get this before the first real case, not after.
- [ ] **Confirm the corporate entity actually holds the contracts** and there is real separation between Beacon Health and personal liability.

### Product-specific counsel items
- [ ] **Billing advisory layer is OFF for any real-PHI pilot.** `billing_note` does not ship. Real PHI plus prompts that could be characterized as coaching billing language is the combination that creates False Claims Act exposure, and it is unnecessary risk to carry during a test whose purpose is validating documentation quality.
- [ ] **No physician-investor money from any surgeon who is also a pilot user** until AKS/Stark review is complete. A surgeon-investor generating billable documentation with your tool is the textbook fact pattern.
- [ ] **Counsel review of the `prompt_text` / `billing_note` separation** — you've been treating this as legally load-bearing. Confirm that it is, in writing, before it's tested by real claims.

---

## 3. 🔴 Technical infrastructure

### Data protection
- [ ] Encryption in transit end to end (TLS 1.2+), including device → API and every internal hop.
- [ ] Encryption at rest with **customer-managed KMS keys**, not default SSE-S3 — for audio, transcripts, generated notes, and database. (Audio bucket already SSE-KMS; confirm transcripts and DB match.)
- [ ] S3 Block Public Access enabled **at the account level**, not just per-bucket.
- [ ] Bucket policies deny non-TLS requests.
- [ ] Retention lifecycle rules **actually applied and verified by test**, not just written in a config file. Confirm the 30-day audio rule fires. Document the retention period for transcripts and notes separately — they are not the same decision.
- [ ] Deletion path exists and works: surgeon-requested deletion, and end-of-pilot bulk deletion. KMS key destruction as a crypto-shred backstop.

### Access control
- [ ] MFA required on every human account with any path to PHI — AWS console, admin tooling, the app itself.
- [ ] IAM least privilege; no wildcard resource policies on PHI-bearing buckets; no long-lived access keys.
- [ ] Unique user identity per person. No shared logins, no shared demo account.
- [ ] Session timeout / auto-logoff on the mobile app.
- [ ] Device-level protection: app requires biometric or passcode; PHI excluded from iOS backups; no plaintext PHI cached on device beyond the active session.

### Environment separation
- [ ] **Separate AWS accounts for prod and dev.** Non-negotiable given build velocity — the realistic breach here is a transcript copied into a dev environment for debugging.
- [ ] **Documented rule: real PHI never enters dev, staging, or a local machine.** Including "just to reproduce a bug."
- [ ] Synthetic fixture data good enough that nobody is tempted to violate the above.

### Logging — the item most often gotten wrong
- [ ] **No PHI in application logs.** Transcripts, note text, and identifiers must not reach CloudWatch. Use an explicit allowlist of loggable fields rather than redaction-by-blocklist.
- [ ] **No PHI in crash/error reporting** (Sentry or equivalent) — configure scrubbing or disable on PHI paths.
- [ ] **Do not log LLM prompts and completions** to any store outside the compliance boundary. If you log them for debugging, that store is PHI storage and inherits every requirement in this section.
- [ ] CloudTrail enabled in all regions, with log file validation, writing to a bucket with restricted delete.
- [ ] **Application-level audit trail**: who accessed which note, when, what they exported. Required by the Security Rule and the first thing asked for after any incident.
- [ ] Audit logs retained and tamper-resistant.

### Baseline hygiene
- [ ] Secrets in Secrets Manager/SSM. Zero secrets in the repo. Secret scanning in CI.
- [ ] Dependency vulnerability scanning with a stated patch cadence.
- [ ] Encrypted backups with a **tested** restore, and a written RPO/RTO.
- [ ] Documented network boundary — VPC endpoints for S3/Transcribe where feasible, no unnecessary public ingress.

---

## 4. 🔴 AI-specific safeguards

- [ ] **Zero training on your data**, contractually confirmed for whichever inference path you choose.
- [ ] **Phase B hallucination testing passed** before any real case, against your existing hard-fail standard: a single instance of auto-filled clinical content that wasn't stated stops the pilot.
- [ ] **Evidence-gated generation enforced in the prompt and verified by test.** Unstated fields render as "not stated" — never as plausible filler.
- [ ] **Transcript visible alongside the draft** at review time. You cut provenance pairing for the POC; with real PHI and a real chart, the surgeon needs at minimum the full transcript on screen next to the draft to verify.
- [ ] **Laterality and device specifics get explicit treatment** — highlighted, and never inferred. These are the fields where a wrong answer is worse than a blank one.
- [ ] **Hard human approval gate.** No auto-export, no EMR write-back, no background filing.
- [ ] **Every export labeled** as an unverified draft with the surgeon as author of record.
- [ ] **Model version and prompt version recorded with every generated note.** If a note is ever disputed, you need to reconstruct exactly what produced it.
- [ ] **Fail closed.** Low transcription confidence, truncated audio, or a pipeline error produces *nothing* and an explicit error — never a partial draft that looks complete.

---

## 5. 🟡 Clinical safety for the pilot itself

- [ ] **Shadow mode for the first N cases** (suggest ≥10): the surgeon completes their normal documentation workflow regardless. Otto's output is compared, not filed.
- [ ] **Written failure protocol** the surgeon has read: what to do if the app crashes mid-case, if audio drops, if the draft never arrives. The answer is always "dictate normally" — make sure they know that before they need it.
- [ ] **Otto is never the only record** during the pilot.
- [ ] **Defined stop conditions**, agreed in advance and in writing: one fabrication event, one laterality error, one PHI mishandling event → pilot pauses. Decide this while it's hypothetical.
- [ ] **A named person the surgeon contacts immediately** if something looks wrong, with a response-time commitment.

---

## 6. 🟡 HIPAA administrative — the paperwork that must exist

The Security Rule requires documented policy, not just working technology. This is what a hospital security questionnaire actually asks for, and it's where most early-stage vendors stall for weeks.

- [ ] **Security Risk Analysis** completed and documented. Explicitly required, and specifically enumerated in enforcement actions.
- [ ] **Named Security Officer and Privacy Officer** (can be you, must be written down).
- [ ] **Written policies and procedures**: access management, workforce clearance and termination, device and media controls, contingency plan, sanction policy.
- [ ] **Workforce training completed and documented** for everyone with PHI access — including contractors.
- [ ] **Incident response and breach notification plan**, including the 60-day notification clock and who notifies whom (you notify the covered entity; they notify patients).
- [ ] **Minimum necessary policy** — written statement of what data Otto collects and why each element is needed. Forces the §0/Q2 discipline.

---

## 7. ⚪ Not required for this — don't let scope creep here

- **SOC 2 Type II** — a *sales* requirement for enterprise deals, not a legal requirement for a pilot. Some institutions will ask anyway; find out before you spend six figures preemptively.
- **HITRUST** — same, and more expensive.
- **FDA clearance** — a scribe producing a draft for physician review and editing generally sits outside device regulation, but confirm with counsel, especially as gap-detection prompts get more clinically directive. The line to watch is prompting *about clinical reality* versus suggesting *clinical action*.
- **EMR integration / Epic write-back** — actively undesirable for a pilot. Clipboard export keeps the surgeon as the gate and keeps you out of Epic's certification process.
- **Full multi-tenancy, SSO, org management** — one surgeon does not need it.

---

## 8. Suggested sequence

1. **Now:** answer §0. Decide the stage. Start the AWS BAA and identify the institutional approver — both have multi-week lead times and neither depends on code.
2. **In parallel:** build to Stage 1 (de-identified) and get real product signal while legal grinds. Most of your open product questions are answerable here.
3. **Before Stage 2:** §3 and §4 complete and verified by test, not by intent. §6 drafted.
4. **Before the first real case:** BAAs signed, insurance bound, stop conditions agreed, failure protocol read.
5. **Throughout:** billing advisory layer off, no surgeon-investor money from a pilot user.

---

## Open items to resolve

- Who is the covered entity for the intended pilot surgeon, and who at that institution approves vendor PHI access?
- Bedrock vs. direct Anthropic API for generation — decide before building more of the generation path.
- Can the app avoid capturing identifiers entirely? If yes, revisit how much of §3 scales down.
- Is the pilot QI or research? Determines whether IRB is on the critical path.
- What retention period for transcripts and generated notes (separate decision from the 30-day audio rule)?

*Not legal advice. Every item in §2 and §6 needs a healthcare regulatory attorney before it is relied on.*