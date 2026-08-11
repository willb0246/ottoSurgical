# Isolating the Highest-Risk Data Before Building the Rest of the Product

**Split the most PHI-sensitive component of a health-tech product into its own app, AWS account, and purpose-built backend — before an incident forced the question — to keep a future compliance failure's blast radius small by design.**

## Context

A pre-seed, founder-led digital-health venture. The intraoperative documentation product started as one screen inside a broader perioperative app that already handled pre-op patient surveys, remote check-ins, and a chatbot — a reasonable way to prototype the audio-capture experience quickly inside a codebase that already had the app-store and navigation scaffolding solved.

## The Problem

That arrangement was fine for prototyping and wrong for what came next. The scribe's actual payload — raw operative-note audio and transcript content — sits in a categorically different sensitivity tier than pre-op patient check-in data, and its buyer is different too: the scribe is sold to a surgeon or an OR, not to a pre-op patient, meaning every release of one dragged unrelated code from the other through the same app-store listing and review process. The parent app's backend, inherited Amplify Gen 1 tooling edited only through console generators, was legacy scaffolding to carry forward, not a foundation to build a compliance-sensitive pipeline on top of. None of this was broken yet. That was exactly the point at which it needed to be addressed.

## Why It Needed a Physician-Engineer

Nothing forced this decision — no incident, no auditor, no customer complaint. Making the call anyway required recognizing, ahead of any pressure, that raw operative audio is the highest-sensitivity PHI category in the entire product and reasoning simultaneously about incident blast radius, BAA scope, and buyer/app-store separation — three considerations that live in compliance, product, and engineering respectively, and that only cohere into a single "split it out now" decision when held together. An engineer without the compliance context sees a working feature and no reason to touch it. A non-technical operator sees a compliance concern but not the accompanying decision about backend architecture (Amplify vs. a purpose-built CDK app) that makes the split actually pay off technically, not just organizationally. This is precisely the decision that's cheap to make correctly before any code depends on the old structure, and expensive to unwind after it does.

## Approach

Rather than porting only the capture screens into a new app and building the rest later, the decision was that v1 of the standalone product had to be the *entire* loop — capture through export — on the reasoning that a backend was being built from zero either way, and designing it for only half the pipeline would just mean redesigning it again immediately afterward. The genuinely procedure-agnostic pieces — the native audio-capture module, the frozen client/server wire contract, the local offline-first session cache — were ported verbatim rather than rewritten, since they were already correct and owed nothing to the old app's structure. Everything actually coupled to the old app — navigation, the API client, configuration — was rewritten deliberately rather than patched around. The backend itself moved to AWS CDK instead of continuing with Amplify Gen 1, specifically because the new pipeline's real shape — asynchronous Step Functions orchestration, an approval-gated data model, custom ASR vocabularies — doesn't fit Amplify's generator model, and a fresh CDK app produces explicit, reviewable infrastructure instead of another opaque managed-backend artifact.

## Technical Detail

The new backend is five independently deployed CDK stacks — auth, data, pipeline, API, and observability — per environment. A dedicated Cognito User Pool backs a JWT authorizer on every API Gateway route, with no Identity Pool and no direct AWS SDK access from the client at all. A single on-demand DynamoDB table (with a surgeon-scoped GSI for querying a surgeon's own sessions) and the raw-audio S3 bucket both sit under one customer-managed KMS key; the bucket blocks all public access, enforces HTTPS, and carries an explicit short-lived retention lifecycle rule rather than indefinite storage — flagged in the design as needing explicit founder sign-off rather than treated as a settled default. Every Lambda authorizes against the JWT's own subject claim, so a surgeon can only ever read or approve their own sessions — there is no admin or founder bypass path in the deployed system.

## Outcome

The documentation product's backend now lives in its own isolated blast radius — separate account-naming boundary, separate identity pool, separate data store — with the complete capture → ingest → transcribe → generate → review → approve → export loop live end-to-end in a development environment, verified twice against synthetic orthopedic cases including the hard approval-gate and audit-log paths. **Flagged gap:** a production deployment still requires its own AWS Business Associate Agreement and a full privacy review before any real patient data touches the stack — stated explicitly as an open dependency, consistent with the system's current test-and-synthetic-data-only status, not glossed over as already handled.

---
**Skills demonstrated:** Regulatory fluency (HIPAA/BAA scoping) · Compliance-driven system design · 0→1 execution · AWS serverless architecture · Clinical product strategy
