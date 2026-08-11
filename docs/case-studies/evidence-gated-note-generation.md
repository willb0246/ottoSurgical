# Making an LLM-Generated Operative Note Something a Surgeon Can Trust

**Turning a fabrication-prone language model into a documentation tool clinicians can rely on for a note that becomes part of the legal medical record.**

## Context

A pre-seed, founder-led digital-health venture building an AI-assisted intraoperative documentation pipeline — hands-free capture in the OR, through transcription, structured note generation, review, and approval. The core promise was a usable operative-note draft within minutes of case end. The core risk was the same technology that made that possible: a language model that can, by default, say things that aren't true.

## The Problem

An operative note isn't a summary — it's a medico-legal document, and once approved it can be discoverable in a malpractice case. A generated note that invents an implant identifier, gets a laterality wrong, or states an estimated blood loss nobody actually said isn't a minor UX bug; it's a liability the surgeon signs their name to without knowing it's there. The obvious approach — ask the model to be careful, prompt it not to hallucinate — is not a control. It's a hope. The system needed a way to guarantee, structurally, that nothing reaches a surgeon's eyes as "populated" unless it traces back to something actually said, without relying on the model's self-report of its own reliability.

## Why It Needed a Physician-Engineer

Deciding *which* fields are safe to ever leave ambiguous and which must never be inferred is a clinical judgment, not an engineering one — a wrong "left" instead of "right," or a fabricated implant ID, is categorically worse than an honest blank. A generalist engineer building this as a form-filling problem would optimize for filling in more fields, since that's what "the AI extracted more information" looks like in a demo. The right instinct here was the opposite: architect the system to *prefer* an honest "not stated" over a plausible-sounding guess, and make that preference enforceable in code, not just in a prompt. That required understanding what actually makes a clinician trust a document — provenance for every claim — as much as it required knowing how to build one.

## Approach

The generation pipeline was built with a rule from day one: the language model is never the final arbiter of whether a fact is true. It only proposes; a deterministic step downstream verifies. Concretely, that meant two layers. The first is in the prompt and the schema — the model is forced (via tool-use with a fixed tool choice) to emit exactly one entry per required note field, each with an explicit status of `populated` or `not_stated`, and, critically, an exact verbatim quote from the transcript for anything it populates. The second layer is deterministic and lives entirely outside the model: a downstream Lambda re-locates that quote in the raw transcript by exact string match. If the quote isn't found character-for-character, the field is downgraded to `not_stated`, full stop — no matter what the model claimed. The judgment call underneath this: never trust a model's self-reported character offsets for where its evidence lives, because models are unreliable at literal counting. Make it quote instead, and verify the quote independently. That trade a small amount of generation flexibility (the model must produce exact substrings, not paraphrases) for a system that structurally cannot fabricate provenance, even if it fabricates content.

## Technical Detail

Generation calls Claude via Anthropic's Messages API directly (not AWS Bedrock — a deliberate choice given an existing direct Anthropic BAA, avoiding Bedrock's separate account-level model-access gating for a single-vendor build), using forced tool-use against a JSON schema constrained to the procedure's required field keys. The field schema itself is resolved per surgeon and per procedure at generation time — not a hardcoded constant — falling back to a stable default set when a surgeon hasn't customized a procedure yet, so evidence-gating logic is identical regardless of which fields are in play. A separate Lambda (`computeProvenance`) performs the exact-match verification and, for anything that clears the gate, attributes the transcript span back to the specific captured audio segment it came from. The review screen surfaces every populated field next to its supporting transcript span, "not stated" fields are visually flagged rather than hidden, and no note carries a finalized status — clinical or otherwise — until a human explicitly approves it through a single, dedicated code path. Every edit and the approval itself are written as append-only log entries, never overwritten, forming the audit trail. Orchestration runs as a Step Functions Standard workflow: transcribe → domain post-correction → generate → verify provenance → write draft.

## Outcome

The pipeline has been verified end-to-end against synthetic orthopedic case dictations with real transcription and generation calls, including the approval-gate and edit-log paths, and the evidence gate has already caught and correctly downgraded fields where the model's proposed quote didn't literally match the transcript. The system's core guarantee — nothing reaches "populated" without a verifiable, verbatim quote — closes the loop on the original problem: a surgeon reviewing a draft is reviewing claims that are individually falsifiable against the transcript, not opaque model output. **Flagged gap:** validation to date has used clean, synthesized test dictation, not real noisy-OR audio; the evidence gate's behavior under real acoustic noise and disfluent speech is the next thing to test, not yet a proven result.

---
**Skills demonstrated:** Regulated AI · Clinical product strategy · Cross-domain translation · Human-in-the-loop safety architecture · LLM system design
