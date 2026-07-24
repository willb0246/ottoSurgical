# PRD: Intraoperative Ambient Scribe — Prototype (v0.2)

**Status:** In build — capture path implemented; server pipeline + review/approval next
**Scope:** Capture → transcription → note generation → manual review & approval → export. **EMR *write-back* remains out of scope for this prototype**, but the export path is now designed as pluggable adapters with a defined EMR-integration strategy (§12) so it isn't a dead end.
**Goal:** A working demo the founder can test in a simulated or real OR-like setting, and hand to one trusted surgeon to try.

---

## 0. What changed since v0.1 (implementation status)

v0.1 was a pre-build draft. Several things have since been built or decided, and this revision folds them in:

- **Explicit start/stop dictation, not pause-detection.** A note is bracketed by a spoken **start phrase** ("Hey Beacon" + mishear-tolerant variants) and an explicit **stop phrase** ("stop recording", "beacon done"). We no longer rely on natural-pause end detection — the surgeon deliberately opens and closes each utterance. A **hold-to-dictate** button (on-screen / AirPods stem press) is the manual fallback. See §4, §5.1.
- **AirPods spike resolved into a shipped path.** The iOS 26 `bluetoothHighQualityRecording` route is implemented; the capture screen shows **live route telemetry** (negotiated port, sample rate, high-quality-vs-HFP, channels) so we can see at a glance whether the good link engaged or fell back to narrowband HFP. See [airpods-capture-spike.md](./airpods-capture-spike.md) and §5.1.
- **Native module `beacon-scribe-audio`.** An Expo native module (`modules/beacon-scribe-audio`, Swift) owns the capture engine, ring buffer (pre-roll), and on-device wake/stop-word detection. The app binds to it via the `useScribeAudio` hook. iOS-only; unavailable in Expo Go / Simulator (needs a device dev build). See §5.1.
- **Segment-based capture + defined wire contract.** Each utterance is recorded as a discrete **segment** (file URI, sample rate, duration, end-reason), persisted locally, and registered with the server via `POST /ingest` (audio uploaded to S3 out-of-band). The full REST contract and note schema are frozen in `app/types/scribe.ts`. See §5.2, §6.
- **EMR strategy added (§12).** Rather than leave EMR as an unqualified non-goal, we now document *why* write-back is hard, the connection model, and a phased ladder (clipboard → PDF/Direct → middleware write → direct FHIR/HL7v2) with a pluggable export-adapter architecture. Write-back is still **not built** in the prototype.

---

## 1. Summary

An iOS app paired with in-ear microphones (AirPods for the prototype) lets a surgeon dictate operative-note content hands-free using a wake word. Audio is streamed to a server-side pipeline that transcribes it, generates a structured draft operative note, and returns it to a review queue. The surgeon (or founder, during testing) reviews the draft, edits it, and approves it. On approval the note is finalized and made available for export. Nothing leaves the review gate without explicit human sign-off.

This prototype exists to answer three questions:
1. Can we get clean, surgeon-isolated audio and accurate transcription out of a noisy environment using consumer hardware?
2. Does structured, evidence-gated note generation produce a draft a surgeon considers a useful starting point rather than a liability?
3. Does the wake-word → review → approve workflow feel natural to a scrubbed surgeon?

---

## 2. Goals & non-goals

### Goals
- Hands-free capture triggered by a wake word, using AirPods + iPhone.
- Server-side transcription tuned (or post-corrected) for surgical vocabulary.
- Structured operative-note draft generation that populates only fields supported by what was said and marks everything else as "not stated."
- A review interface showing each generated field alongside the transcript span that produced it.
- Hard approval gate: draft has no finalized status until a human approves it.
- Export of the approved note (copy to clipboard / share sheet / file). No EMR write-back.

### Non-goals (this prototype)
- **EMR/EHR write-back.** No note is written into any live medical record in the prototype. The export path is designed so this can be added later without rework (§12), but building it is explicitly deferred.
- Fully passive capture (no start phrase). Prototype is start/stop-phrase / deliberate-dictation only.
- Multi-speaker attribution beyond isolating the surgeon.
- Production hardware, regulatory clearance, or scale.
- Billing/coding (CPT) automation.
- Android.

---

## 3. Users & roles (prototype)

- **Surgeon (test user):** Wears AirPods, dictates during a case, reviews and approves drafts afterward.
- **Founder / operator (you):** Configures the app, runs test cases, reviews the audio/transcript/note pipeline end to end, inspects logs.

---

## 4. Core user flow

1. **Setup (pre-scrub):** Surgeon connects AirPods, opens app, selects the procedure type (e.g., TKA, THA), starts a case session. Done before scrubbing since hands go sterile.
2. **Dictation (intraop):** At any point the surgeon says a **start phrase** ("Hey Beacon"), speaks the content ("...findings: medial compartment fully worn, ACL intact..."), then says a **stop phrase** ("stop recording" / "beacon done") to close that utterance. Each start→stop pair is one **note segment**. A **hold-to-dictate** control (on-screen button / AirPods stem press) is the manual alternative — press to start, release to stop. Optional lightweight **section cues** ("findings", "implants", "estimated blood loss", "closure") let the surgeon pre-tag a segment.
3. **Capture:** App detects the start phrase on-device, opens capture (prepending a short pre-roll buffer so the first word isn't clipped), records the segment to a local file, and closes it on the **stop phrase** (or button release). The segment is registered with the server (`POST /ingest`; audio uploaded to S3). The surgeon controls exactly what is and isn't recorded.
4. **Generation:** On the end-of-case segment, the server transcribes all segments, runs surgical post-correction, and produces a structured draft note mapped to the procedure template.
5. **Review (post-case, async):** Draft lands in a review queue. Surgeon opens it (from the phone, likely end-of-day), sees each field with its supporting transcript span, edits as needed.
6. **Approval:** Surgeon approves. Note is marked final. Edit log captured.
7. **Export:** Approved note can be copied / shared / saved. (EMR send is a future stub.)

---

## 5. Functional requirements

Implemented in the `beacon-scribe-audio` native module (`modules/beacon-scribe-audio`, Swift: capture engine, ring buffer, wake-word detector) and bound to the app via the `useScribeAudio` hook. iOS-only; `available` is false on Simulator / Expo Go, so a physical-device dev build is required.

- **AirPods capture (iOS 26 high-quality path):** Pull the mic stream from connected AirPods using `bluetoothHighQualityRecording`, with automatic fallback to HFP when the high-quality link is unavailable. *(De-risked by the AirPods spike — see [airpods-capture-spike.md](./airpods-capture-spike.md).)*
- **Live route telemetry:** Surface the negotiated route on the capture screen — port name/type, sample rate, channel count, and whether the link is **high-quality (iOS 26)**, **Bluetooth HFP (narrowband)**, or **wired/built-in** — so a bad fallback is visible immediately rather than discovered later as poor ASR.
- **On-device start/stop detection:** A local speech recognizer detects **start phrases** (wake) and **stop phrases** (end), biased toward our vocabulary via `contextualStrings`. Start phrases include mishear-tolerant variants of "beacon"; stop phrases are kept specific ("stop recording", "beacon done") to avoid false-triggering inside normal dictation. Audio is only recorded/streamed between a start and its stop — limiting bandwidth and PHI exposure.
- **Manual trigger (sterile fallback):** A hold-to-dictate control (on-screen button / AirPods stem press) arms and ends capture without voice, for when the recognizer is unreliable or the surgeon prefers deliberate control.
- **Rolling pre-roll buffer (~6 s):** A ring buffer retains the last few seconds locally so an utterance already underway at start-phrase time isn't clipped.
- **Procedure selection:** Surgeon picks the procedure type at case start (drives the note template).
- **Section cues (optional):** Recognize a small vocabulary of section keywords to pre-tag a segment (carried on `IngestSegmentBody.sectionCue`).
- **Session management:** Start/stop case; sessions survive backgrounding and brief Bluetooth dropouts (buffer + reconcile). Segments are persisted locally as they land so nothing is lost before upload.
- **Status affordances:** Clear, glanceable big-status indication that capture is live plus a live input-level meter (surgeon can't study a screen — an audio confirmation tone on start/stop is desirable).

### 5.2 Server-side pipeline
- **Ingest:** Accept per-segment registrations tied to a case session (`POST /ingest` — `sessionId`, `segmentId`, `audioKey` for the S3-uploaded audio, optional `sectionCue`, `endOfCase`). Audio is uploaded to S3 out-of-band; the ingest call carries the metadata. The `endOfCase` segment triggers transcription + generation.
- **ASR:** Transcribe with a model tuned or post-corrected for surgical terminology — procedure names, anatomy, laterality, implant identifiers, drug names.
- **Domain post-correction:** Correct ASR output against domain lexicons (implant catalogs, drug lists, anatomy, laterality). Prioritize laterality and implant IDs.
- **Structured generation:** Map transcript → operative-note schema (§6). **Populate only fields with transcript evidence; emit "not stated" otherwise. No inferred boilerplate.**
- **Provenance:** For every populated field, retain the transcript span(s) that produced it, surfaced in review.
- **Return:** Draft note + provenance to the review queue.

### 5.3 Review & approval
- **Review UI:** Field-by-field draft with the supporting transcript span shown for each. Raw transcript viewable.
- **Edit:** Any field editable. "Not stated" fields flagged for attention.
- **Approval gate (hard):** Draft carries no finalized clinical/billing status until a human approves. Nothing auto-exports.
- **Async by default:** Review designed for end-of-day / from-phone, with drafts queued — not in-OR sign-off.
- **Edit log:** Capture who approved, when, and every change from draft to final (medicolegal record + training signal).

### 5.4 Export (in scope; EMR *write-back* is not — see §12)
- Approved note exportable via copy / share sheet / file (`ExportFormat` = `plaintext` | `pdf`).
- Every draft and export carries the mandatory safety label (`SAFETY_LABEL`): *"AI-generated draft, human-reviewed. Prototype — not for clinical use."*
- Export is modeled as **pluggable adapters** behind one canonical internal note, so adding a destination is adding an adapter, not rewriting the pipeline (§12). The prototype ships the clipboard / share / file adapters only; EMR adapters are stubbed.

---

## 6. Operative-note schema (starter)

Structured fields, each independently populated or marked "not stated":

- Patient / case identifiers (test data only in prototype)
- Procedure name & laterality
- Preoperative diagnosis
- Postoperative diagnosis
- Surgeon(s)
- Findings
- Implants / hardware (with identifiers)
- Estimated blood loss
- Specimens
- Complications
- Counts (sponge/instrument, as stated)
- Closure technique
- Disposition

Templates per procedure type (start with one or two — e.g., TKA and THA — since those match the target ortho use case).

---

## 7. Non-functional requirements (prototype-level)

- **Privacy / PHI:** Use synthetic/test patient data for the demo. Stream audio only after wake word. Don't persist raw audio longer than needed to generate + let the user verify; make retention explicit and short. A real deployment needs a BAA and a full privacy review — out of scope here but note it.
- **Latency:** Draft available for review within a minute or two of case end is fine; real-time is not required.
- **Reliability:** A Bluetooth dropout must not lose the case. Buffer locally and reconcile.
- **Auditability:** Every approval and edit logged.
- **Safety labeling:** Every draft and export clearly marked as AI-generated, human-review-required, prototype, not for clinical use.

---

## 8. Key technical spike (do this first)

**iOS AirPods audio-capture spike.** Before building around the phone-app path, confirm in a throwaway test app:
- You can access the AirPods mic stream from a third-party app.
- The sample rate / quality is adequate for medical ASR.
- Whether Apple's voice-isolation is exposed, forced, or bypassable, and how that affects the raw stream.
- Behavior on backgrounding and simultaneous Bluetooth audio routes.

If the stream quality is inadequate, revisit hardware before writing more app code.

---

## 9. Prototype build sequence

1. ✅ **AirPods audio spike** (§8) — resolved: iOS 26 high-quality path with HFP fallback (see spike doc).
2. ✅ **Capture path:** `beacon-scribe-audio` native module — on-device start/stop-phrase detection + manual hold-to-dictate + pre-roll buffer + route telemetry + segment persistence + `POST /ingest`.
3. **ASR + surgical post-correction:** get a clean, surgeon-isolated transcript out of a realistic (noisy) recording. *(Next.)*
4. **Structured generation:** schema + evidence-gated population + provenance (contract frozen in `app/types/scribe.ts`).
5. **Review & approval UI:** field/transcript pairing, edit, hard approval gate (`POST /approve`), edit log. *(Screens scaffolded; wire to generated drafts.)*
6. **Export:** copy/share/file with safety labeling via the export-adapter interface (§12).
7. *(Future, out of scope for the prototype: EMR write-back adapters — see §12 for the designed path.)*

---

## 10. Success criteria for the demo

- Founder can run a simulated case end to end: dictate → get a draft → review → approve → export.
- Transcript is legible and surgical terms (esp. laterality, implants) are mostly correct out of a noisy recording.
- Generated draft populates real fields from what was said and does **not** invent content — "not stated" appears where it should.
- The surgeon test user finds the wake-word capture usable and the draft a useful starting point.
- Approval gate demonstrably blocks any export until sign-off.

---

## 11. Open questions

- Wake word choice — distinctive enough to avoid false triggers in OR chatter, easy to say.
- Passive-context capture: retain non-triggered audio as weak context, or discard entirely? (Prototype default: discard, for privacy simplicity.)
- Sterile-field control: with start/stop phrases + AirPods stem-press hold-to-dictate now implemented, is a foot pedal still wanted, or do voice + stem cover it for the prototype?
- Review timing: confirm with the test surgeon whether any in-OR/between-case review is wanted, or purely end-of-day.
- Which one or two procedure templates to build first.

---

## 12. EMR export & write-back strategy (design; not built in prototype)

Write-back is deferred, but we're designing the export path now so it isn't a dead end. This section captures the strategy so the prototype's export interface anticipates it.

### 12.1 Why write is hard (and read isn't)

- **Read is federally mandated.** US regs (21st Century Cures / ONC) force EMRs to expose patient data via FHIR, so reading is a fairly standardized, solved path.
- **Write has no such mandate.** Putting a note *into* the legal medical record carries liability, so health systems gate it hard: security reviews, contracts, a signing/attribution workflow, a real EMR user the note is attributed to, and often per-site IT enablement. The bottleneck is compliance and workflow, not the API call.

### 12.2 The connection model is worse than "one per EMR"

It is not one connection per EMR *vendor* — it is effectively **one per health-system customer**. Every Epic site is its own endpoint, app registration, go-live, and interface team. "We support Epic" can still mean months of work at each new hospital. That per-site multiplication is the real scaling wall, and the reason we won't build direct connections ourselves.

### 12.3 Technical pathways for writing a note

An operative note is essentially an unstructured document, so it lands as a FHIR `DocumentReference` (note as a base64 attachment) or an HL7v2 `MDM^T02` message — often into the media/documents tab, sometimes as an unsigned draft the surgeon signs inside the EMR.

| Path | What it is | Reality for notes |
|---|---|---|
| **SMART on FHIR** (`DocumentReference`) | Note as attachment in a FHIR resource | Cleanest *if* the site enabled write. Epic/Oracle support it but it's app-registration + per-site gated; coverage is patchy. |
| **HL7v2 MDM** (`MDM^T02`) | The workhorse for getting documents into EMRs | How most documents really land. Needs an interface engine (Mirth/Rhapsody/Cloverleaf) at the site; point-to-point per customer. |
| **C-CDA / Direct messaging** | Secure document exchange | Fine for "send a document," clunky for structured integration. |
| **Vendor APIs** (Epic Vendor Services, Oracle Code Console) | Proprietary | Deeper integration, heavier onboarding. |

### 12.4 Use integration middleware, not N direct connections

For a startup the answer is a middleware vendor that gives us **one API** and absorbs the per-site N connections:

- **Redox** — incumbent, broadest write support, enterprise pricing.
- **Metriport** — open-source, cheaper, startup-friendly.
- **Health Gorilla / Particle Health** — strong on networks/read, growing write.

We integrate once; they handle the interface engines and HL7v2/FHIR translation.

### 12.5 Phased ladder — the plan

Deep write integration is a late-stage feature. Early scribe products (early Nuance DAX, Abridge, Nabla) shipped human-in-the-loop export first and layered write-back in later. We do the same: **climb one rung only when the current rung's exit trigger is met** — each rung is independently shippable and none is thrown away, because they all sit behind the same export-adapter interface (§12.6). Do **not** skip ahead; a rung's cost is mostly the compliance/contract work it unlocks, and pulling that forward before there's a customer to justify it is the classic way to burn a runway on integrations nobody is using yet.

**Guiding rule:** the note pipeline never changes between rungs. Climbing a rung = adding an adapter + the org/compliance work that adapter's destination requires. If a rung ever needs a change to the canonical note or the review/approval gate, stop — that's an §12.6 architecture violation, not a rung.

---

#### Rung 1 — Copy-to-clipboard / formatted export  ·  *status: prototype (now)*

- **What it is:** Surgeon approves the note; app puts a cleanly formatted plaintext/PDF version on the clipboard / share sheet / file. Surgeon pastes into the EMR themselves.
- **Why first:** Zero integration, ships immediately, sidesteps write-back liability entirely (the human is the write path). Genuinely how most scribe products start.
- **Build:** clipboard + share/file export adapters behind the export interface; `plaintext` and `pdf` formatters; `SAFETY_LABEL` on every artifact. *(This is §5.4 — largely the prototype's existing export surface.)*
- **Dependencies / compliance:** none beyond the prototype's own PHI handling. No EMR contract, no BAA-with-a-vendor, no site IT.
- **Effort:** days (mostly formatting polish).
- **Exit trigger → Rung 2:** a pilot surgeon is using the note regularly and copy-paste friction (or paste fidelity into their EMR) is the top complaint.

#### Rung 2 — PDF + Direct secure message  ·  *status: near-term, first real "send"*

- **What it is:** Approved note rendered to a clean clinical PDF and delivered to the surgeon's / site's **Direct** address (Direct secure messaging — the same rails as summary-of-care exchange). Semi-automated: no more manual paste, but not yet writing into a chart.
- **Why here:** Low integration burden, no per-EMR API work, and it establishes the "note leaves our system to a clinical destination" pathway (and its audit trail) before we take on true write-back.
- **Build:** PDF-render adapter (branding + safety label + structured layout of §6 fields); a Direct-messaging adapter (via a HISP — Direct isn't something we host). Delivery receipts logged to the edit/audit log.
- **Dependencies / compliance:** a HISP relationship + Direct address provisioning; **BAA with the HISP**; confirm the receiving site accepts Direct into their workflow.
- **Effort:** 1–2 weeks integration + HISP onboarding lead time.
- **Exit trigger → Rung 3:** a pilot site commits to a real integration and wants the note to land *in the chart* (media/documents tab), not an inbox.

#### Rung 3 — Middleware write (Redox / Metriport)  ·  *status: first pilot site(s)*

- **What it is:** Write the approved note into the EMR at one or two pilot sites via an integration middleware vendor, as a FHIR `DocumentReference` (note as attachment) or HL7v2 `MDM^T02` — whichever the site's interface accepts. One vendor API; the middleware absorbs the per-site interface-engine work.
- **Why here:** This is the first true write-back, and it's where compliance/liability gets real — so we take it on only with a committed pilot and behind a vendor who has already solved the N-site plumbing (§12.4). **Deliberately scoped to 1–2 sites**; do not attempt breadth here.
- **Build:** a middleware export adapter that maps the canonical note → `DocumentReference`/`MDM`; delivery + ack handling; surface write status (accepted / rejected / signed-in-EMR) back into the session and audit log.
- **Dependencies / compliance:** **BAA with the middleware vendor**; per-site enablement (app registration / interface config on the site's side); resolve the §12.7 questions for the pilot — unsigned-draft vs signed, attribution/auth identity, target tab/resource; the site's security review.
- **Effort:** weeks of engineering **+ months of site/contract lead time** (the lead time, not the code, is the critical path).
- **Exit trigger → Rung 4:** an anchor customer refuses middleware (procurement, data-residency, or existing direct-interface policy) and will only integrate against their own endpoint.

#### Rung 4 — Direct FHIR / HL7v2  ·  *status: only on demand, per anchor customer*

- **What it is:** Point-to-point integration straight against a specific health system's FHIR write API or HL7v2 interface (their interface engine), no middleware in between.
- **Why last / rarely:** Highest cost per connection and it doesn't amortize — every site is its own build, go-live, and interface team (§12.2). Only worth it for an anchor customer whose contract justifies a bespoke integration.
- **Build:** a per-customer direct adapter (still behind the same interface); their app registration / interface spec; their interface-engine coordination (Mirth/Rhapsody/Cloverleaf on their side).
- **Dependencies / compliance:** full enterprise security review, dedicated integration engagement, likely their vendor-program membership (Epic Vendor Services / Oracle Code Console).
- **Effort:** months per site; treat as a funded, customer-specific project — never speculative.
- **Exit:** terminal rung. Additional anchor customers each repeat Rung 4 in parallel; the middleware rung remains the default for everyone else.

**One-line summary of the climb:** paste it → send it → write it (via a vendor) → write it (direct, only if forced). Money and liability rise at every rung; only climb when a real user or customer pulls you up.

### 12.6 Architecture implication for the prototype

Model export as: **approved note → one canonical internal document → pluggable export-target adapters** (clipboard, PDF/share, later: Direct, Redox, direct-FHIR). Keep the internal note format EMR-agnostic and push EMR-specific mapping to the adapter edge, so "add an EMR" is "add an adapter," never a note-pipeline rewrite. The prototype ships adapters 1 only; the interface is what we're committing to now.

### 12.7 Open questions (EMR)

- Which middleware vendor to standardize on (Redox vs Metriport) once we have a pilot site.
- Does the anchor site accept notes as unsigned drafts (surgeon signs in-EMR) or require a signed document + attributed EMR user?
- Attribution/auth: system service account vs per-surgeon EMR identity mapping.
- Which resource/tab the note should target (media/documents vs a structured op-note slot) at the pilot site.