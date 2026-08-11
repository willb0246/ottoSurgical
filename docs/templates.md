# PRD — Surgeon-Authored Templates

*Light PRD. Extends the intraoperative ambient scribe prototype with surgeon-authored templates that supply confirmable defaults and define the fields the scribe listens for. Scoped as an increment on the existing capture → transcribe → generate → review pipeline, not a new product.*

---

## 1. Summary

Today the prototype generates an operative note from live intraoperative dictation and gates it behind a human review step. Everything the surgeon didn't say is marked "not stated." That's safe, but it makes the surgeon dictate a lot of invariant boilerplate ("prepped and draped in usual sterile fashion," "counts correct") that is identical every case — the exact tedium a dot-phrase already solves faster.

This update lets a surgeon author a **template** once per procedure: a single ordered list of fields, each optionally carrying default text. A field with no default text is case-variable (findings, laterality, devices) and must come from dictation; a field with default text is the surgeon's own boilerplate, pre-filled into every case and confirmed at review — and can itself mix in `{{placeholder}}` spans that still come from dictation, for boilerplate that's *almost* always the same. One authored object drives both the review screen (what to pre-fill and confirm) and the extraction step (what to listen for).

The single thing this update must prove: a surgeon can define their own "standard" once, then clear a routine case at review in a handful of taps instead of dictating boilerplate — without the note ever asserting something they didn't confirm.

---

## 2. Why now / problem

Three problems the current prototype leaves open:

- **Boilerplate tedium.** The surgeon must speak invariant content aloud for it to appear, which is slower than the dot-phrase it replaces. This fails the core value test: if templating is slower than Dragon, the surgeon won't switch.
- **Hardcoded defaults don't fit anyone.** Any boilerplate the app ships is generic. One surgeon's standard closure is not another's, and certainly not another specialty's. Defaults have to be authored by the person who signs the note.
- **No field vocabulary for extraction.** The scribe currently has no per-procedure notion of what fields *should* exist, so it can't tell the difference between "the surgeon didn't mention the microscope" and "this procedure has no microscope." A template supplies that vocabulary.

The reframe that makes this tractable: the note isn't one kind of content, it's three sources with different trust levels — case context (from the EMR), template defaults (authored, confirmed), and live narration (spoken, evidence-backed). The template is where the middle bucket gets defined.

---

## 3. Goals / non-goals

**Goals**
- Let a surgeon author, edit, and version a template per procedure type, via a 5-step wizard (start → details → select fields → reorder → draft defaults).
- Template defines a single ordered list of **fields** (name + optional default text, which may contain `{{placeholder}}` tokens).
- Non-empty defaults pre-fill every case and surface at review as confirmable — full confirm/record/remove, the same for every default-bearing field; there is no protected/confirm-only variant.
- Fields with no default (and the placeholder spans of a hybrid field) drive what the extractor listens for, both intraop and at review-time correction.
- Specialty is a one-time, per-surgeon, multi-select setting — not part of authoring a surgery.
- One template object is the shared contract for the author screen, the review screen, and the extraction step.

**Non-goals (this increment)**
- EMR/EHR write-back of templates or notes.
- CPT/coding automation or code suggestion (regulatory exposure — route to counsel separately).
- Multi-procedure or multi-speaker handling beyond what the base prototype already scopes.
- Template sharing/marketplace mechanics beyond the simple starter-fork model below.
- Auto-detection of section boundaries beyond the optional import assist in section 7.

---

## 4. The template object

A template is a single ordered list of **fields**. This is the contract every screen reads. Each field has:
- a name (e.g. "Positioning & prep")
- default text — optional; the surgeon's own standard wording for this field

A field's behavior is inferred entirely from its default text, not a separate kind or confirm policy:
- **empty** — never defaulted, filled only by dictation (the old "spoken slot"). Renders empty ("not stated") until dictation populates it.
- **plain text, no placeholders** — pre-filled boilerplate, confirmed at review (the old "default event"). Renders as its default text, pending confirmation.
- **text with `{{placeholder}}` tokens** — hybrid: the surrounding wording is the surgeon's own standard text, but the transcription fills in the bracketed spans from dictation, evidence-gated the same way a spoken field is. Also confirmed at review, since it still carries authored boilerplate.

Every field with any default text — plain or hybrid — is confirmed, re-recorded, or removed at review; there is no "protected" field that can't be removed. At case time the object resolves as: case context fills the identity/measurement tokens, default-bearing fields render their default text (placeholders filled where dictation supports them, pending confirmation either way), and empty fields render "not stated" until dictation populates them.

---

## 4a. Worked examples

Two real templates, decomposed into the object above. These are the reference instances the build works from — the abstract schema is only evaluable against a filled-in case. The first is the easy case (near-fully templated); the second is the hard case (mostly spoken) and shows why not every field can carry a default.

### Example A — Anterior scalenectomy (thoracic outlet decompression)

Near-fully invariant. Almost every field carries a default; only a few are truly case-variable. This is the template that clears review in a handful of taps.

**Fields with a default** (confirmed, re-recorded, or removed at review)

| Field | Default text (surgeon-authored) |
|---|---|
| Positioning & prep | Supine, head turned to {{laterality}} contralateral side, prepped & draped in usual sterile fashion. Local anesthetic infiltrated. SCDs applied. Antibiotics administered. |
| Exposure & plexus dissection | Platysma divided; SCM mobilized medially; omohyoid divided and tagged. Upper trunk of brachial plexus dissected circumferentially and protected. Phrenic nerve confirmed with stimulator and preserved along anterior scalene. |
| Closure | JP drain secured with 3-0 Monocryl. Omohyoid reapproximated. Platysma reapproximated with 3-0 Vicryl. Skin closed with 4-0 Monocryl subcuticular. Mastisol and Steri-Strips, sterile dressing. |
| Counts | All counts (sponge, needle, instrument) correct at end of case. |
| Disposition | Awoke at neurologic baseline. Transferred to PACU in stable condition. |

The `{{laterality}}` token in Positioning & prep is a hybrid field: the boilerplate stays fixed, but that one span is filled from dictation, evidence-gated like any spoken content.

**Fields with no default** (always dictated)

| Field | What it captures |
|---|---|
| Laterality | left / right — the operative side |
| Subclavian pulse finding | pulse quality before vs. after resection (e.g. "weak initially, improved after resection") |
| Resection extent | length of anterior scalene resected (e.g. "~1.5 cm") |
| EBL | estimated blood loss, if not pulled from the nursing record |

**Case-context tokens** (from EMR, not spoken, not defaulted): patient name, MRN, DOB, dates, attending.

### Example B — Thoracolumbar laminectomy for intradural tumor resection

The inverse. The dissection narrative is the whole note, it's different every case, and it carries the medicolegal and billing weight — so it stays spoken. Only the framing steps carry a default. This is why templating can't just freeze one case's findings into reusable text.

**Fields with a default** (confirmed, re-recorded, or removed at review)

| Field | Default text (surgeon-authored) |
|---|---|
| Positioning & neuromonitoring | After induction of general anesthesia, neuromonitoring connected (MEP, SSEP, EMG). Turned prone. Thoracolumbar spine prepped and draped in usual sterile fashion. |
| Exposure & laminectomy | Fluoroscopic localization. Midline incision; paraspinous muscles dissected off spinous processes and lamina. Laminectomies widened bilaterally. Subarticular recesses decompressed with care to protect dura. Operating microscope brought in. |
| Dural closure | Dura reapproximated with 6-0 Gore-Tex. Thecal sac filled with irrigation before final sutures. Valsalva performed — no CSF leak. Fibrin glue applied. |
| Wound closure | Wound irrigated with antibiotic solution. Hemostasis achieved. Drain placed. Closed in usual multilayer fashion. Sterile dressing. |
| Neuromonitoring status | All surrounding nerve roots maintained normal baseline stimulation. MEPs stable. |
| Disposition | Condition stable at conclusion. To PACU for recovery. |

**Fields with no default** (always dictated — this is the bulk of the note)

| Field | What it captures |
|---|---|
| Levels | operative levels for the title and localization (e.g. "T11–L2 laminectomy," "localized T12–L1") |
| Tumor dissection narrative | the case-specific findings: nerve-root involvement, feeding vessels, dissection sequence, margins achieved |
| Pathologic impression | intraoperative impression (e.g. schwannoma vs. myxopapillary ependymoma) |
| Nerve-root sacrifice decision | present only if a rootlet was sacrificed — the stimulation result, the decision rationale, and how it was handled |

**Case-context tokens**: patient name, MRN, DOB, date, surgeon, assistant.

**What the contrast shows:** Example A is ~80% default fields / 20% no-default — the template does most of the work and review is fast. Example B is roughly the reverse — the defaults are only the scaffold, and the clinically and legally load-bearing content is all dictated and evidence-gated. The same object handles both because the author decides, per field, whether it carries a default at all — and, for one that does, whether any part of it should still come from dictation via a `{{placeholder}}`. A system that hardcoded defaults would get A right and B dangerously wrong.

---

## 5. Core flows

**Authoring (pre-op, a 5-step wizard the first time a surgeon creates a surgery)**
1. **Start.** Start from scratch, or fork one of the surgeon's own existing surgeries — forking pre-populates steps 3-5 below with that surgery's fields, still fully editable, rather than a fixed generic starting point.
2. **Details.** Surgery name, plus an optional description (useful when a surgeon wants two templates for what's nominally the same surgery). Specialty is *not* set here — see below.
3. **Select fields.** A multi-select checklist of common note fields (drawn from examples like §4a's), regardless of how they'll later be filled — plus a free-text option for anything not on the list.
4. **Reorder.** Drag-and-drop the selected fields into the order they should appear in the note.
5. **Draft defaults.** For any field, optionally pre-write its default text — leave it blank to always dictate that field, write it in full to make it a confirmable default, or write it with `{{placeholder}}` tokens to make it a hybrid. Save and version; the template is now the surgeon's own.

Editing an existing surgery's template skips the wizard — it's a single screen combining field selection, reordering, and defaults, since there's no first-run ordering to walk through.

**Specialty is a one-time, per-surgeon setting, not part of authoring a surgery.** A surgeon picks every specialty they practice once (multi-select — a surgeon can be both endovascular and open vascular), and it applies to every surgery they create. Combining multiple specialties' vocabularies within one case is future work; today the pipeline uses the surgeon's first selected specialty.

**Review (post-case, per case)**
1. Findings (fields with no default) appear first, evidence-backed from the dictation.
2. Each default-bearing field appears in an unconfirmed state, showing exactly what the template asserts on the surgeon's behalf — with any `{{placeholder}}` already filled in where dictation supported it.
3. For each one the surgeon picks one of:
   - **Confirm default** — text stays, marked confirmed.
   - **No — record** — default text is discarded and replaced by a fresh dictation, which becomes evidence-backed spoken content at the same trust level as findings.
   - **No — remove** — the field drops from the note, leaving a visible "omitted" trace. Every default-bearing field is removable this way — there is no protected field that can only be confirmed.
4. Signing is disabled until every default-bearing field is resolved. The gate is a hard state machine, not a dismissible nag.

---

## 6. Trust model (unchanged, now template-driven)

The safety property carries over from the base prototype and this update must not weaken it: the failure mode is not an incomplete note (the surgeon catches that) — it's a note confidently asserting something that didn't happen.

Three provenance states, now sourced from the template:
- **Spoken** — from dictation, evidence-backed. Includes any "No — record" replacement.
- **Default-confirmed** — template default text the surgeon actively confirmed, including a hybrid field whose `{{placeholder}}` got filled from dictation.
- **Default-unconfirmed** — template default nobody has touched; rendered visibly and blocks signing.

A field with no default text can *only* ever be spoken — it is never defaulted, because that's where fabrication risk is highest. The template defines which content is eligible to carry a default (non-empty `defaultText`) and which is not (empty); it cannot promote a finding to a default, and a hybrid field's placeholder can only be filled from an actual dictated quote, never inferred.

---

## 7. Onboarding: import assist (recommended, can be cut)

**Fork-vs-scratch — now core, not onboarding.** The choice in §5 step 1 is a permanent part of authoring, not a cuttable first-run nicety. A brand-new surgeon has no surgeries of their own yet to fork from, so they start from the two seeded defaults (TKA/THA — §4's field shape) like everyone always has; once they've built up a few of their own, "fork one of your existing surgeries" becomes the faster path for a new-but-similar procedure. A richer, specialty-differentiated library of seeded starters is future work, not required for this increment.

A blank authoring screen is intimidating, and target surgeons already have Epic dot-phrases. The remaining, still-optional onboarding idea: the surgeon pastes an existing dot-phrase or a prior op note, and the system parses it into a first-draft template — fields with a default detected from the invariant sections, fields with no default suggested from the variable ones — which the surgeon then edits instead of starting from scratch or a seeded default.

This turns "author a template from scratch" into "review the template we extracted from your note," a materially easier ask. Existing op notes already carry this structure; the field boundaries just need detecting. Treat as fast-follow if it slows the core build.

---

## 8. Open questions

- **Confirmation timing.** Confirm at scrub-out (best recall, but surgeon wants to move on) vs. batch at end-of-day (fits the "operated yesterday, haven't dictated" reality, but recall degrades and a stack of cases is its own friction). The grouped design helps either way; leans mildly toward scrub-out since three taps is trivial in the moment.
- **Record-at-review plumbing.** The "No — record" path needs the same capture → ASR → evidence-tag pipeline as intraop dictation, triggered from the review screen. Confirm it's the same pipeline pointed at a different trigger, not a second capture system.
- **Field authoring guidance.** A field's only extraction guidance today is its own label (and, for a hybrid field, its default text/placeholders) — there's no separate free-text hint field like the old spoken-slot "instructions." Is a label alone enough to route dictation reliably for less obvious field names, or does authoring need a lightweight hint back?
- **Multi-specialty vocabulary.** A surgeon can now select more than one specialty; the pipeline currently only ever uses the first one. Combining Transcribe custom vocabularies (or picking per-case) for a genuinely multi-specialty surgeon is deferred — needs a design pass when it's no longer hypothetical.

---

## 9. Success criteria

- A surgeon authors a usable template for one procedure in a single sitting without help.
- A routine case clears review in a handful of taps, with zero boilerplate re-dictation.
- No signed note in testing contains an unconfirmed default or an auto-filled spoken slot.
- Surgeon reports the authored defaults read in their own voice — not generic template language.