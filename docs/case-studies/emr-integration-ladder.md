# Designing an EMR Integration Strategy Before Building Any of It

**Mapped a four-rung EMR write-back strategy and deliberately shipped only the first rung — sidestepping the integration trap that quietly burns runway at most early health-tech companies.**

## Context

A pre-seed, founder-led digital-health venture building an AI-assisted intraoperative documentation product. Every clinical documentation tool eventually has to answer the same question: how does the finished note actually get into the electronic medical record? That question was live from the earliest design conversations, well before there was a pilot customer to ask it of.

## The Problem

"Add EMR integration" sounds like one line item. It isn't. Writing into an EMR is not one connection per vendor — it's effectively one connection per health-system *customer*, because every Epic site is its own app registration, security review, and go-live process, run by its own interface team. Early-stage teams tend to fail this in one of two directions: they ignore it entirely until a pilot customer asks and then scramble under a deadline they don't control, or they over-invest early in a direct FHIR/HL7v2 build against an EMR nobody has actually committed to receiving data from, burning months of engineering on integration work that may never be used. Neither failure mode is visible until it's expensive.

## Why It Needed a Physician-Engineer

The reason write-back is structurally harder than read is regulatory, not technical: federal rules (21st Century Cures/ONC) force EMRs to expose patient data for *reading* via FHIR, so read access is comparatively solved. There is no equivalent mandate for *writing* a note into the legal record, so every health system gates it behind security review, contracting, and a real, attributed EMR user identity — the bottleneck is compliance and workflow, not the API call. Knowing that distinction is regulatory fluency. Turning it into a product sequencing decision — and into a system architecture that wouldn't need to be rewritten as that sequence played out — required holding the regulatory reality, the product roadmap, and the code structure in the same frame at once, rather than treating them as three separate conversations to have later.

## Approach

The strategy took the shape of a four-rung ladder, each rung independently shippable and none of them thrown away as the next was built: copy-to-clipboard / formatted export first, then a rendered PDF delivered via Direct secure messaging, then a true EMR write through an integration middleware vendor (Redox or Metriport, absorbing the per-site interface-engine complexity behind one API), and only as a last resort, a direct point-to-point FHIR or HL7v2 integration built for a single anchor customer whose contract justifies the bespoke cost. Each rung carries an explicit exit trigger — climb to rung two only once a real pilot surgeon's top complaint is copy-paste friction, not before; climb to rung three only once a pilot site commits to wanting the note to land in the chart itself. The governing rule, stated as a hard constraint rather than a suggestion: the note-generation pipeline itself never changes between rungs. If reaching a rung would require touching the canonical note format or the human approval gate, that isn't a rung — it's a sign the architecture is wrong. The prototype deliberately built and shipped only rung one, resisting the pull to start building toward a direct Epic integration before any customer existed to justify it.

## Technical Detail

Export is modeled as one canonical, EMR-agnostic internal note document sitting behind a pluggable adapter interface — clipboard, share-sheet, and PDF adapters shipped in the prototype; Direct-messaging, middleware-write, and direct-FHIR/HL7v2 adapters designed against the same interface but intentionally left stubbed. Every exported artifact, at every rung, carries a mandatory safety label identifying it as an AI-generated, human-reviewed draft not cleared for clinical use. The technical pathways for the later rungs are already documented at the level needed to scope real engineering work when the time comes: an operative note lands in an EMR either as a FHIR `DocumentReference` (the note as an attachment) or an HL7v2 `MDM^T02` message — the latter is how most clinical documents actually arrive in practice, via an interface engine like Mirth or Rhapsody at the receiving site — and the middleware vendor landscape (Redox as the broad, enterprise-priced incumbent; Metriport as the cheaper, startup-friendly alternative) is shortlisted rather than open-ended.

## Outcome

A pilot-ready export path shipped in days at rung one, with rungs two through four already scoped to the point where the next dollar of EMR-integration engineering has a defined target instead of an open-ended research problem. The BAA and compliance dependency for each rung — a HISP relationship for Direct messaging, a middleware vendor BAA for rung three, a full enterprise security review only for rung four — is documented ahead of need, so a future integration conversation starts from "which rung does this pilot's exit trigger point to" rather than from zero. **Flagged gap:** this is a designed and internally reviewed strategy, not one tested against a live pilot site's actual EMR; rungs two and beyond will get their first real-world test once a pilot customer is engaged, and the ladder's assumptions should be treated as provisional until then.

---
**Skills demonstrated:** Regulatory fluency (EHR/FHIR/HL7v2) · Clinical product strategy · EHR integration architecture · Cross-domain translation · Runway-conscious sequencing
