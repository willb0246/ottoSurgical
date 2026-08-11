# Flanders Forest — Case Study Template & Generation Guide

> **Purpose:** This file instructs Claude (Code, Projects, or chat) how to gather the right information about a consulting project and turn it into a client-facing case study. Follow the *Information to Gather* section to interview me or extract from source material, then produce output using the *Output Template*.

---

## Positioning (read first — this frames everything)

Flanders Forest is a fractional CTO/CPO practice run by an MD-turned-physician-engineer. The core differentiator is a **rare three-in-one profile**: clinical credibility (CMO-level medical reasoning), product instinct (CPO), and hands-on technical execution (CTO). Every case study exists to make a prospective client believe this combination is real, rare, and the reason the project succeeded.

**Voice:** Warm, specific, prose-forward. Concrete technical proof points over generic claims. Declarative plain language — no filler ("genuinely useful," "I'd like to"), no evaluative padding. Impressive and optimistic, but credibility comes from *showing the hard problem*, not from adjectives.

**Non-negotiable constraints:**
- **NDA / anonymization:** Never name consulting clients. Refer to them only by stage and category (e.g., "a Series B digital health company building perioperative tooling"). Nosis Health is the only publicly referenceable client — name it only if the project is a Nosis project.
- **Honest calibration:** Do not overclaim. Sandbox-validated integrations (e.g., Epic SMART on FHIR) are described as sandbox-validated, not production. Adjacent experience is described as adjacent. Gaps surface in technical conversations, so credibility is protected by accuracy.
- **Drop "general coding skill" as a headline claim.** Let technical detail prove competence; keep positioning at the "rare combination" altitude.

---

## Information to Gather

Collect the following before drafting. If a field is missing, **flag the gap explicitly** rather than inventing detail. Ask targeted clarifying questions upfront; build the case study iteratively.

### A. Framing
- **Client descriptor (anonymized):** stage + category only.
- **Engagement type:** fractional CTO, fractional CPO, technical advisor, 0→1 build, etc.
- **Duration / timeframe.**
- **One-line outcome:** the transformation, framed by stakes (not activity).

### B. The Hard Problem (most important — do not skip)
- What specifically made this difficult? Name the real constraint: regulatory, technical ambiguity, clinical risk, a stalled team, a decision no one on staff could make.
- Why couldn't the existing team solve it alone?
- What was at risk if it went wrong (revenue, compliance, patient safety, timeline)?

### C. Why It Needed *This* Profile
- Which parts required clinical + product + engineering judgment *simultaneously*?
- Concrete example where the domains couldn't be separated (e.g., clinical eligibility criteria entangled with the data model).
- What would a generalist engineer or a non-technical clinician have gotten wrong?

### D. Approach & Judgment Calls
- The reasoning and sequence — the *decisions*, not a task list.
- Key architectural or strategic judgment calls (e.g., keeping the LLM out of deterministic logic; sandbox-validating before production; de-risking the regulatory path first).
- Trade-offs weighed.

### E. Technical Detail (proof)
- Stack: languages, frameworks, cloud services (be specific — Lambda, DynamoDB, EventBridge, API Gateway, RAG pipeline, etc.).
- Architecture pattern.
- Integration surface: EHRs (Epic/athena/Healthie), APIs, third-party systems — with production vs. sandbox status.
- Compliance context: HIPAA, FDA SaMD, CMS PRO-PM, SOC2 (adjacent vs. owned).
- AI/LLM specifics: model use, RAG, human-in-the-loop, constrained-schema generation vs. deterministic solvers.

### F. Outcome & Impact
- Quantified results: ARR, MRR, time saved, users, latency, cost reduction, valuation, funding.
- If a number is under NDA or fuzzy, use a defensible relative frame ("cut manual review effort by an order of magnitude").
- Tie the outcome back to the hard problem in section B to close the loop.

### G. Skills Tags
- 4–7 scannable tags for the skimmer. Draw from: *Regulated AI · Clinical product strategy · 0→1 execution · AWS serverless · EHR integration · Regulatory fluency (SaMD/HIPAA/PRO-PM) · Cross-domain translation · Speed under constraint.*

---

## Output Template

Populate this structure. Prose-forward; use the section headers below. Omit a section only if genuinely inapplicable, and flag it if so.

```markdown
# [Project Title — outcome-oriented]

**[One-line headline: the transformation, framed by stakes.]**

## Context
[Anonymized client by stage + category. One or two sentences on the situation that created the need — a tension the reader recognizes from their own company.]

## The Problem
[The specific difficulty. Regulatory constraint, technical ambiguity, clinical risk, stalled team, or a decision no one on staff could make. Establish why this was hard and what was at risk. This section earns the impressive outcome later — do not shortcut it.]

## Why It Needed a Physician-Engineer
[Why the project required clinical + product + engineering depth at once. A concrete example where the domains couldn't be separated. What a generalist would have gotten wrong.]

## Approach
[The reasoning and sequence in prose. The judgment calls, not a task list. Where and why key decisions were made.]

## Technical Detail
[A tight paragraph with real specifics: stack, architecture, integration surface, compliance context, AI/LLM design. Enough that a technical reader believes it was actually built. Mark sandbox vs. production accurately.]

## Outcome
[Quantified impact where possible; defensible relative framing where under NDA. Tie back to the hard problem to close the loop.]

---
**Skills demonstrated:** [Tag · Tag · Tag · Tag · Tag]
```

---

## Quality Checklist (run before delivering)

- [ ] No client named except Nosis Health (if applicable).
- [ ] Every integration/compliance claim marked accurately (sandbox vs. production, owned vs. adjacent).
- [ ] "The Problem" section is substantive — the case study reads as proof, not marketing.
- [ ] The three-in-one profile is *demonstrated* in "Why It Needed a Physician-Engineer," not just asserted.
- [ ] Technical detail is specific enough to be credible to an engineer.
- [ ] Outcomes are quantified or given a defensible relative frame; no invented numbers.
- [ ] Any missing information is flagged, not fabricated.
- [ ] Voice is declarative and filler-free.
- [ ] "General coding skill" does not appear as a headline claim.