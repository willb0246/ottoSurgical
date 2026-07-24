# PRD: Beacon Scribe — Standalone App & Serverless Backend (v0.1)

**Status:** Draft — spec for spinning the intraoperative scribe out of the Beacon Health (OpBuddy) app into its own Ignite-based project
**Parent docs:** [intra-op-scribe.md](./intra-op-scribe.md) (product PRD — capture → transcription → note → review → export) and [airpods-capture-spike.md](./airpods-capture-spike.md) (audio de-risking, resolved GO)
**Relationship to parent docs:** This document does not replace them — §1–§8 there are still the product spec. This document covers the two things they don't: (1) how to package the scribe as its own Ignite app instead of a screen inside Beacon Health, and (2) how to build the server pipeline (§5.2, §9 steps 3–6 of the parent PRD, which were explicitly deferred) using AWS CDK instead of Amplify Gen 1.

---

## 0. Why split it out

The scribe currently lives inside the OpBuddy/Beacon Health app: five screens under `app/screens/scribe/`, reachable from the pre-op `HomeStack`, sharing a codebase with PROM surveys, RTM check-ins, protocol tracking, and a chatbot. That was fine for prototyping the audio-capture path inside an app that already had Expo/EAS/navigation wired up. It's the wrong shape going forward:

- **Different buyer, different reviewer, different app-store listing.** The scribe is sold to a surgeon/OR, not a pre-op patient. Bundling it with patient-facing PROM/RTM features means every scribe release drags along unrelated surgery-prep code (and vice versa).
- **Different data-sensitivity profile.** The scribe touches raw operative-note audio and transcript content — the highest-sensitivity PHI in the whole product. Isolating it into its own AWS account/app means the blast radius of a scribe incident doesn't touch the patient check-in data, and the BAA/compliance conversation is scoped to one small system instead of the whole platform.
- **Amplify Gen 1 is the wrong backend model for this piece regardless.** OpBuddy's existing backend (`amplify/`) is Amplify Gen 1 CLI-managed CloudFormation, edited only through the AWS console/CLI generators rather than by hand — legacy tooling Beacon Health is stuck with, not a pattern to replicate for a new pipeline. The scribe's backend (Transcribe jobs, Bedrock generation, an approval-gated data model) is a better fit for a small, explicit AWS CDK app than another Amplify `#current-cloud-backend` blob.

**What moves, what's new:**

| | OpBuddy (today) | Beacon Scribe (this doc) |
|---|---|---|
| App shell | Ignite app, shared with PROM/RTM/checklist/chatbot | Fresh Ignite app, scribe only |
| Native audio module | `modules/beacon-scribe-audio` | Same module, moved wholesale |
| Screens | `app/screens/scribe/*`, nested under `HomeStack` | Same screens, promoted to the app's root navigator |
| Wire contract | `app/types/scribe.ts` (frozen, unimplemented server side) | Same contract — becomes the real API, implemented |
| Backend | None for scribe (deferred); Amplify Gen 1 for everything else | New: AWS CDK, purpose-built for this pipeline |
| Auth | Amplify-managed Cognito (`beacon-pool`), shared across features | New, dedicated Cognito User Pool via CDK |

---

## 1. Scope of v1

Where the parent PRD's prototype build sequence (§9) stopped at the capture path and left ASR/generation/review/approval/export as "next," **this rebuild's v1 is the whole loop**, because a backend has to be designed and built from zero anyway — there's no reason to design it for only half the pipeline. Concretely, v1 ships:

1. Capture (already built — port as-is).
2. Segment upload + ingest.
3. Server-side ASR with surgical-vocabulary tuning.
4. Structured, evidence-gated note generation with provenance.
5. Review queue + field/transcript-span review UI + hard approval gate + edit log.
6. Export (clipboard / share / PDF, Rung 1 of the parent PRD's §12.5 ladder only). No EMR write-back — everything in parent PRD §12 (rungs 2–4) still applies unchanged and is still explicitly out of scope.

Non-goals are unchanged from the parent PRD §2: no EMR write-back, no passive (non-wake-word) capture, no multi-speaker attribution, no production regulatory clearance, no CPT/billing automation, no Android.

---

## 2. App layer

### 2.1 Scaffold

Generate fresh with the Ignite CLI, same major choices OpBuddy made (TypeScript, React Navigation, Expo, pnpm) so the ported code drops in with minimal changes:

```bash
npx ignite-cli@latest new BeaconScribe
cd BeaconScribe
pnpm install
```

Take the CLI's demo-removal prompt (or run the equivalent generator afterward) — none of the boilerplate's demo screens/tabs are needed. This is a single-purpose app: procedure select → capture → review → export, no tab bar.

### 2.2 Files to port verbatim

These are already correct and procedure-agnostic to the rest of Beacon Health — move them, don't rewrite them:

| Source (OpBuddy) | Notes |
|---|---|
| `modules/beacon-scribe-audio/` (whole dir) | Native module: Swift capture engine, ring buffer, wake-word detector, Expo module glue. iOS-only. Copy wholesale including `app.plugin.js`, `expo-module.config.json`, `ios/*.swift`. |
| `app/hooks/useScribeAudio.ts` | React binding for the native module. No OpBuddy-specific imports. |
| `app/types/scribe.ts` | The frozen wire contract — becomes the real API contract this backend implements. Treat every field in it as a requirement, not a suggestion. |
| `app/utils/scribe/procedures.ts` | Procedure templates (TKA/THA) + local id generator. |
| `app/utils/scribe/sessionStore.ts` | Local MMKV session store. Keep as the offline-first cache (§4.6) even once the backend exists. |
| `app/screens/scribe/*.tsx` (all 5) | Promote from "a stack nested in HomeStack" to the app's actual root stack. Strip the `HomeStackScreenProps<...>` typing in favor of the new app's own root navigator types (mechanical rename, same param shapes from `navigationTypes.ts` lines 50–54). |
| `prds/intra-op-scribe.md`, `prds/airpods-capture-spike.md` | Copy as the seed product docs for the new repo. This document becomes the third. |

### 2.3 Files to rewrite

- **Navigation:** Collapse to one native-stack navigator: `ScribeQueue → ScribeProcedureSelect → ScribeCapture → ScribeReview → ScribeExport`, plus a sign-in screen (§3.1) gating the stack. No bottom tabs, no `HomeStack`/`PreOpHomeContent` etc.
- **API client:** New `app/services/api/scribeApi.ts` implementing the six calls in §5 below, following the `beaconFetch.ts` pattern already proven in OpBuddy — plain `fetch()` + Cognito ID-token bearer header, **not** Amplify's SigV4 `get()`/`post()` (that pattern was chosen deliberately in OpBuddy for the same reason: a User Pool JWT authorizer, not SigV4, sits on the API Gateway routes). New app, new Cognito pool, same reasoning.
- **Config:** `app/config/config.dev.ts` / `config.prod.ts` carry the new stack's outputs (API base URL, User Pool ID/Client ID). No `aws-exports.js` — that's an Amplify CLI artifact; a CDK app has no equivalent file to autogenerate, so these values get written into config by hand (or by a small post-deploy script) from `cdk deploy` outputs.
- **`sessionStore.ts` evolves** once the backend lands: still the write-through local cache for reliability (parent PRD §7 — a dropout can't lose a case), but now reconciled against `GET /drafts` / `GET /draft` instead of being the only source of truth.

### 2.4 Explicitly not ported

Everything else in OpBuddy: `app/screens/{checklist,protocol,home,settings,surveys,rtm}`, `app/services/api/{consentApi,protocolApi,surveysApi,weeklyApi,patientDataService}.ts`, `app/hooks/{useConsentQuery,useProtocolQuery,useSurveyQuery,useWeeklyQuery}.ts`, all of `amplify/`, `app/config/{amplifyConfig.ts,aws-exports.js}`. None of it is a scribe dependency.

---

## 3. Backend: AWS CDK, serverless

One CDK TypeScript app (`infra/`), deployed independently per environment (dev/staging/prod), living in the new `BeaconScribe` repo. Stack boundaries:

```
infra/
  bin/beacon-scribe.ts        — app entrypoint, instantiates stacks per env
  lib/
    auth-stack.ts             — Cognito User Pool + App Client
    data-stack.ts             — DynamoDB table(s) + S3 audio bucket + KMS key
    pipeline-stack.ts         — Step Functions state machine + ASR/generation Lambdas
    api-stack.ts              — HTTP API (API Gateway) + JWT authorizer + REST Lambdas
    observability-stack.ts    — dashboards, alarms, DLQs
```

### 3.1 Auth — `auth-stack.ts`

- Cognito User Pool (`beacon-scribe-{env}`), one App Client, no Identity Pool needed (no direct AWS SDK calls from the app — everything goes through API Gateway).
- One user = one surgeon for the prototype (parent PRD §3). `surgeonId` in the wire contract is the Cognito `sub`.
- App reuses `aws-amplify/auth`'s `fetchAuthSession()` / sign-in helpers purely as a Cognito client SDK — this does **not** require Amplify Gen 1 backend tooling; it's just a JS client pointed at a User-Pool-managed CDK stack, same as OpBuddy's existing `beaconFetch.ts` already does against Amplify-provisioned pools.

### 3.2 Data — `data-stack.ts`

**Single DynamoDB table**, on-demand billing (prototype-scale traffic doesn't justify provisioned capacity math):

| PK | SK | Item |
|---|---|---|
| `SESSION#<sessionId>` | `META` | `CaseSession` (surgeonId, procedureType, status, startedAt, endedAt) |
| `SESSION#<sessionId>` | `SEGMENT#<segmentId>` | Ingested segment metadata (audioKey, sectionCue, order) |
| `SESSION#<sessionId>` | `DRAFT` | `DraftNote` (transcript, fields[], generatedAt) |
| `SESSION#<sessionId>` | `EDIT#<isoTimestamp>` | `EditLogEntry` — append-only, never overwritten |
| `SURGEON#<surgeonId>` | `SESSION#<sessionId>` | GSI-equivalent index item so `GET /drafts?surgeonId=` is a single `Query`, not a scan |

A GSI (`bySurgeon`: PK `surgeonId`, SK `startedAt`) is cleaner than a manually maintained index item — use that instead once building for real; the table above is the logical model, not a literal implementation instruction.

**S3 bucket** (`beacon-scribe-audio-{env}`): raw segment audio, uploaded by the client via presigned PUT (§3.4). SSE-KMS with a customer-managed key (not SSE-S3 — PHI). Lifecycle rule expiring objects after a short, explicit window (parent PRD §7: *"Don't persist raw audio longer than needed to generate + let the user verify"* — proposed default: 30 days, tune with the founder). Bucket policy denies public access; only pipeline Lambdas and presigned URLs can touch it.

### 3.3 Pipeline — `pipeline-stack.ts`

Triggered when the `endOfCase` segment hits `POST /ingest`. A Step Functions **Standard** workflow (this is async, minutes-scale — no need for Express):

```
StartTranscriptionJob (per segment, or one job over concatenated audio)
  → wait/poll for Transcribe completion
  → Lambda: domain post-correction (surgical lexicon pass — laterality, implant IDs, drug names)
  → Lambda: structured generation (Bedrock) — transcript + procedure template → NoteField[]
  → Lambda: compute provenance spans (match generated field values back to transcript char offsets)
  → Lambda: write DraftNote to DynamoDB, flip session status → draft_ready
```

- **ASR:** Amazon Transcribe batch jobs (`StartTranscriptionJob`) with a **custom vocabulary** seeded from the procedure's implant catalog, drug list, and anatomy/laterality terms (parent PRD §5.2, §8/airpods spike Gate C — this is exactly the "domain post-correction" the parent PRD calls for, split across Transcribe's custom vocabulary and an explicit post-correction Lambda for anything Transcribe still gets wrong). Amazon Transcribe is on AWS's HIPAA-eligible-services list — confirm current status before launch, but it's the reason to default to Transcribe over an unmanaged Whisper deployment.
- **Structured generation:** Amazon Bedrock (Claude), tool-use/structured-output call constrained to the `NoteField[]` schema (mirrors `app/types/scribe.ts` exactly — key/label/status/value/provenance/edited). Prompt enforces the evidence gate explicitly: populate a field only when the transcript supports it, else `status: "not_stated"`, and require the model to quote the supporting span verbatim so the provenance-span Lambda can locate it by string match rather than trusting model-reported offsets (models are unreliable at literal character counting).
- **Failure handling:** DLQ on the Transcribe-completion wait and on both Lambdas; a failed pipeline leaves the session in `processing` with an error surfaced in the (v1.1) queue UI rather than silently stuck — logged as a follow-up, not blocking v1.

### 3.4 API — `api-stack.ts`

HTTP API (not REST API — cheaper, sufficient) with a Cognito **JWT authorizer** on every route (User Pool from §3.1). One Lambda per route unless trivially combinable:

| Method & path | Lambda | Notes |
|---|---|---|
| `POST /uploads/presign` | `getUploadUrl` | New — not in the original wire contract because the parent PRD says audio is "uploaded to S3 out-of-band." This *is* that out-of-band step: returns a presigned PUT URL + the `audioKey` the client then passes to `/ingest`. |
| `POST /ingest` | `ingest` | Matches `IngestSegmentBody`/`IngestSegmentResponse` in `scribe.ts` exactly. On `endOfCase: true`, starts the Step Functions execution (§3.3). |
| `GET /drafts?surgeonId=` | `getDrafts` | Matches `GetDraftsResponse`. Query by the `bySurgeon` GSI. |
| `GET /draft?sessionId=` | `getDraft` | Matches `GetDraftResponse`. |
| `POST /approve` | `approve` | Matches `ApproveNoteBody`/`ApproveNoteResponse`. Writes every `EditLogEntry` in the body, then the approval entry, then flips status → `final`. This is the hard gate (parent PRD §5.3) — it's the *only* code path allowed to set `status: "final"`. |

Every Lambda authorizes against the JWT's `sub` — a surgeon can only read/approve their own sessions. No admin/founder bypass in v1 (parent PRD's founder-as-test-surgeon role just means the founder's Cognito user *is* the surgeon during testing, not a separate role).

### 3.5 Observability — `observability-stack.ts`

Minimal for a prototype: a CloudWatch dashboard (Step Functions success/failure counts, Lambda errors, API Gateway 4xx/5xx), one alarm on Step Functions execution failures. Full production-grade observability is explicitly deferred — this is enough to know when a demo case silently failed to generate.

---

## 4. Non-functional requirements

Carrying parent PRD §7 forward, made concrete for this backend:

- **PHI / privacy:** Test/synthetic patient data only (unchanged from parent PRD). All data at rest encrypted with a customer-managed KMS key (DynamoDB + S3). All data in transit over TLS (API Gateway default + enforced HTTPS-only S3 bucket policy). Short, explicit audio retention (§3.2). **A real deployment needs an AWS BAA and a full privacy review before any real patient data touches this stack** — unchanged from the parent PRD, restated because a fresh AWS account for this app means the BAA has to be set up again, not inherited from OpBuddy's account.
- **Latency:** Draft within a minute or two of case end (parent PRD §7) — Transcribe batch + Bedrock generation comfortably fits this at prototype volume.
- **Reliability:** A Bluetooth dropout must not lose a case — already solved on-device (ring buffer + local segment persistence in `sessionStore.ts`); the backend adds nothing that weakens this. If `/ingest` fails mid-case, the client retries from its local queue; segments already have stable IDs so retries are idempotent (dedupe on `segmentId`).
- **Auditability:** Every approval and edit logged — the append-only `EDIT#<timestamp>` items in §3.2 are that log, never overwritten or deleted.
- **Safety labeling:** `SAFETY_LABEL` (already centralized in `app/types/scribe.ts`) stays the single source of truth for the disclaimer string, ported unchanged.

---

## 5. Build sequence

1. **Repo + app scaffold** (§2.1–2.2) — get the ported capture path running standalone, unchanged behavior from OpBuddy, before touching the backend.
2. **`auth-stack.ts` + sign-in screen** — needed before any authenticated API call exists to test against.
3. **`data-stack.ts`** — table + bucket, no Lambdas yet; sanity-check with the AWS CLI/console.
4. **`api-stack.ts` ingest path only** (`/uploads/presign`, `/ingest`) — wire the app's capture screen to really upload segments. Verify end-to-end: capture on-device → S3 → DynamoDB row.
5. **`pipeline-stack.ts`** — Transcribe → post-correction → Bedrock generation → provenance → draft write. Validate against the AirPods-spike test recordings (noisy OR bed, laterality/implant/drug hard cases) before trusting it on live capture.
6. **`api-stack.ts` review path** (`/drafts`, `/draft`, `/approve`) — wire `ScribeReviewScreen` to real drafts instead of the local-segments placeholder it currently shows; build the field/transcript-span review UI called for in parent PRD §5.3 (not yet built anywhere).
7. **Export** — wire `ScribeExportScreen` to the approved note (clipboard/share/PDF), gated on `status === "final"`.
8. **Observability stack**, then a full dry-run demo case end-to-end (parent PRD §10 success criteria, now testable for real instead of stubbed).

---

## 6. Open questions

- **App/repo name.** "Beacon Scribe" used throughout this doc as a placeholder (matches the existing `beacon-scribe-audio` module name) — confirm before scaffolding, since it becomes the bundle ID / Cognito pool names / etc.
- **AWS account strategy.** New dedicated AWS account for this app (cleanest BAA/blast-radius story per §0) vs. a new isolated stack set inside the existing Beacon Health account. Recommend a new account given §0's reasoning, but that's a cost/ops tradeoff the founder should make explicitly.
- **Bedrock model + region HIPAA eligibility.** Confirm the specific Claude model and region combination is on AWS's current HIPAA-eligible-services list at build time (this list changes).
- **Transcribe custom vocabulary vs. Transcribe Medical.** Standard Transcribe + a hand-built surgical custom vocabulary (assumed above) vs. Amazon Transcribe Medical, which has clinical vocabulary built in but different pricing/latency/availability characteristics — worth a short bake-off using the AirPods-spike recordings before committing.
- **Audio retention window.** Proposed 30 days (§3.2) is a placeholder — confirm with the founder against the parent PRD §7 "don't persist longer than needed" intent.
- **Single-table vs. multi-table DynamoDB.** §3.2 proposes single-table for simplicity at this scale; revisit if the pipeline's access patterns turn out to need it.
