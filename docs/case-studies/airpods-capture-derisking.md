# De-Risking Hands-Free OR Audio Capture Before Writing a Line of Product Code

**Resolved the single riskiest unknown behind a hands-free surgical documentation product — clean, surgeon-isolated audio from consumer AirPods in a noisy operating room — with a focused, four-day spike, before committing any engineering to the capture path.**

## Context

A pre-seed, founder-led digital-health venture building a hands-free intraoperative documentation product: a surgeon dictates via a wake word while wearing AirPods, and the audio flows into a transcription and note-generation pipeline. The entire hands-free premise depended on one unproven assumption — that consumer earbuds, never designed for this, could deliver a clean enough, surgeon-isolated signal in a loud OR to support medical-grade transcription.

## The Problem

The default assumption going in was the well-known iOS limitation: recording from a Bluetooth headset mic forces the HFP profile, capping input at 8–16 kHz "telephone quality." For surgical dictation, that's disqualifying — the acoustic detail that distinguishes drug names and implant identifiers lives in exactly the frequency range narrowband strips out. A newly shipped iOS API promised to lift that ceiling with a high-quality Bluetooth recording mode, but it was built and marketed for content creators — tuned to *preserve* ambient sound for a natural "in the room" feel, which is the opposite of what a surgeon dictating over a bone saw and monitor beeps needs. Nothing about the new API's existence guaranteed it would actually isolate a voice in OR noise, and building the entire capture architecture around an assumption that turned out wrong would have meant weeks of wasted engineering discovered only after the fact.

## Why It Needed a Physician-Engineer

The test that mattered wasn't "is the audio audible" — it was whether specific clinically catastrophic failure modes survived transcription: a mistaken laterality, a garbled implant identifier, a misheard drug name. Those are the failures that turn a documentation tool into a safety problem, and they're not the failures a generic audio-quality test surfaces. Designing a test protocol scored against exactly those hard cases — rather than generic intelligibility — required knowing, clinically, which mistranscriptions are catastrophic and which are merely annoying, and building the entire spike around that distinction from the outset.

## Approach

Before any capture-path code was written, the risks were ranked explicitly — likelihood and impact, seven identified risks, the highest being that the new "high-quality" mode's media-tuning would preserve exactly the ambient noise it needed to suppress. A single-screen, throwaway iOS test app was built with one job: capture audio and route telemetry against a fixed test matrix — AirPods model, iOS version, capture mode, mic-tuning mode, app state (foreground/backgrounded/locked), distance, and a sustained 30–60 minute run for thermal and session stability. Every recording was made against a realistic OR noise bed (bovie, suction, bone saw, monitor beeps, staff chatter), not a quiet room, and scored against a fixed scripted passage loaded with the hard cases. Four sequential decision gates were defined up front — stream acquisition, isolation in noise, ASR fitness, endurance — with an explicit rule that a partial pass was acceptable everywhere *except* ASR fitness on the hard tokens, which was non-negotiable because it was the whole point of the exercise. Just as important as the gates themselves: a deliberate decision to decouple the AirPods ergonomics question entirely from validating the note-generation pipeline, so a "no" on hardware would never block proving out the differentiated part of the product.

## Technical Detail

The spike exercised `AVAudioSession.CategoryOptions.bluetoothHighQualityRecording`, which requires an H2-chip AirPods model (Pro 2/3, 4, or Max USB-C) on a current iOS release, with automatic fallback to standard HFP when the high-quality link isn't available. It tested Voice Isolation against media/wide-spectrum tuning directly, since the two modes behave very differently in noise and the app-level controllability of that setting was itself an open question. The outcome fed directly into the shipped product: a live route-telemetry readout (negotiated port, sample rate, high-quality-vs-HFP status, channel count) built into the real capture screen, so a silent fallback to narrowband audio is visible immediately as a UI signal rather than discovered later as unexplained poor transcription. On a GO decision, the validated capture path was implemented as a native Swift module — on-device wake/stop-word detection, a several-second pre-roll ring buffer so an utterance already underway isn't clipped, and a hold-to-dictate manual fallback for when the sterile field makes voice control impractical.

## Outcome

The spike reached a GO decision in roughly four to five focused days, with the exact device/OS constraint (a specific AirPods generation on a specific iOS version) and a documented fallback plan (wired mic, non-Apple Bluetooth options, or reframing to validate generation independently of live capture) already in hand before the production capture module's first line was written. That meant the riskiest, least controllable variable in the product — third-party hardware behavior — was resolved on a known timeline instead of discovered mid-build. **Flagged gap:** the spike and the shipped capture module have both been validated against synthesized and controlled test recordings; real-world noisy-OR robustness at case scale remains the next validation step, not yet a demonstrated result.

---
**Skills demonstrated:** Systematic technical risk de-risking · Hands-on iOS/AVFoundation execution · Clinical risk prioritization · Product sequencing under uncertainty · Speed under constraint
