# De-Risking Plan: AirPods Audio Capture Spike

**Parent PRD:** [intra-op-scribe.md](./intra-op-scribe.md) §8 (Key technical spike)
**Status:** Spike plan — do this *before* any capture-path code
**Owner:** Founder / operator
**One question this answers:** *Can a third-party iOS app pull a surgeon-isolated audio stream from AirPods that is clean enough for medical ASR (esp. laterality, drug names, implant IDs) in a noisy OR — and if so, under what device/OS/mode constraints?*

---

## 1. What changed since the PRD was written (read this first)

The PRD treats AirPods capture as a hard, uncertain gate. The implicit fear was the classic iOS limitation: **recording from a Bluetooth headset mic forces the HFP/SCO profile, capping input at 8–16 kHz "telephone quality"** and simultaneously degrading playback. For surgical ASR — where sibilants and fricatives carry drug names and implant IDs — narrowband is a real liability.

**That ceiling was lifted in iOS 26 (WWDC 2025, shipped June 2025).** Apple added:

- **`AVAudioSession.CategoryOptions.bluetoothHighQualityRecording`** — opts into a high-sample-rate Bluetooth link tuned for AirPods, instead of HFP.
- **`AVCaptureSession.configuresApplicationAudioSessionForBluetoothHighQualityRecording = true`** — the capture-session equivalent.
- Automatic **fallback to HFP** when the high-quality link is unavailable (older AirPods, older iOS, contended radio).

Apple markets this as "studio-quality" AirPods recording. Requires the **H2 chip**: AirPods Pro 2/3, AirPods 4, AirPods Max (USB‑C), on **iOS 26+** with current firmware and a supported iPhone.

**Net effect on the PRD:** the *primary* risk ("is the stream even good enough?") is now largely a **known, supported path** rather than an open question — *conditional on* the device/OS matrix. The spike shifts from "does this work at all?" to "does it hold up in *our* conditions, and what's the fallback for anyone not on the happy path?"

> Sources: [Apple Newsroom — AirPods studio-quality recording](https://www.apple.com/newsroom/2025/06/airpods-now-more-versatile-with-studio-quality-audio-recording-and-camera-remote/) · [WWDC25 "Enhance your app's audio recording capabilities"](https://developer.apple.com/videos/play/wwdc2025/251/) · [`bluetoothHighQualityRecording` docs](https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/bluetoothhighqualityrecording)

---

## 2. Risk register (ranked, post-iOS-26)

| # | Risk | Likelihood | Impact | Notes |
|---|------|-----------|--------|-------|
| R1 | **"Media tuning" preserves background sound** — the high-quality mode is tuned for content creators (LAV-mic feel, *balances* voice + ambience). That's the **opposite** of surgeon-isolation in a loud OR. | High | High | The biggest *new* risk. Must A/B media-tuning vs Voice-Isolation mode on noisy recordings. |
| R2 | **Device/OS matrix dependency** — high-quality path needs iOS 26 + H2 AirPods. Anything older silently falls back to 16 kHz HFP. | Med | High | Pins the test surgeon's hardware. A demo on the wrong AirPods looks like a product failure. |
| R3 | **Background + wake-word coexistence** — continuous on-device wake-word listening + a high-quality capture link + backgrounding + screen-locked, for a multi-hour case. Power, thermal, session interruראtions. | Med | High | Not covered by Apple's demo, which is foreground content capture. |
| R4 | **Bluetooth dropout / reconnect** — sterile surgeon can't re-pair. Case must survive dropouts (PRD §7 Reliability). | Med | Med | Buffer-and-reconcile; measure real dropout frequency at OR distances. |
| R5 | **Voice-isolation controllability** — is mic mode (Voice Isolation / Wide Spectrum / Standard) app-settable, or Control-Center-only / user-forced? | Med | Med | Determines whether we can *guarantee* isolation or must instruct the user. |
| R6 | **ASR fitness of the actual stream** — even at high sample rate, does surgical vocab survive OR noise? | Med | High | This is really the ASR spike (PRD §9.3), but the audio spike must hand it a representative file. |
| R7 | **Latency / stem-control conflict** — AirPods stem now starts/stops recording; could collide with wake-word UX. | Low | Low | Note and design around; not a gate. |

---

## 3. The spike build (throwaway — do not reuse in the app)

A single-screen SwiftUI test app. **No** wake word, **no** server, **no** UI polish. Its only job is to capture and dump audio + telemetry so we can judge quality and constraints.

**Capabilities:**
- Configure `AVAudioSession` with `.record` (or `.playAndRecord`), toggling `bluetoothHighQualityRecording` on/off at runtime.
- Log the **negotiated route**: input port, whether the high-quality link engaged or fell back to HFP, actual **sample rate**, channel count.
- Record to a WAV/CAF file at whatever rate is negotiated (no resampling — capture ground truth).
- Toggle between recording with the OS mic mode set to **Voice Isolation vs Standard/Wide Spectrum** (or document that it's Control-Center-only).
- Background-audio entitlement enabled; a mode that keeps recording with the app backgrounded and the screen locked.
- On-screen live readout: elapsed time, current route, sample rate, dropout count, whether backgrounded.
- A "simulate dropout" affordance (walk out of range) and a reconnect log.

**Effort:** ~1–2 days of iOS work for someone comfortable with AVFoundation. If no in-house iOS skill, this is the thing to contract out first — it's small and self-contained.

---

## 4. Test matrix & measurements

Run every recording **against a realistic OR noise bed** — don't test in a quiet room. Play back an OR-ambience recording (bovie, suction, bone saw, monitor beeps, staff chatter) through a speaker at working volume, and dictate a **fixed scripted passage** loaded with the hard cases: **laterality** ("left" vs "right"), **implant IDs** (alphanumeric strings), **drug names**, numbers/EBL.

| Axis | Values to test |
|------|----------------|
| AirPods model | Target H2 model (e.g. AirPods Pro 2) **+ at least one older pair** (to see the fallback failure mode) |
| iOS version | 26+ (primary). Note behavior if the surgeon's phone isn't on 26. |
| Capture mode | `bluetoothHighQualityRecording` ON vs OFF (HFP baseline) |
| Mic/tuning mode | Media tuning vs Voice Isolation (per R1/R5) |
| App state | Foreground · backgrounded · screen-locked · during an incoming phone call |
| Distance / obstruction | At the sterile field · surgeon turned away · body between phone and AirPods |
| Duration | A sustained 30–60 min run for thermal/power/session-stability, not just short clips |

**Record for each run:** negotiated sample rate, high-quality-vs-HFP, dropout count + recovery behavior, subjective intelligibility, and — the real test — **feed the file to the candidate ASR** (Whisper-class at 16 kHz, or the tuned model) and score the hard tokens. Audio that "sounds fine" but botches laterality fails the spike.

---

## 5. Decision gates

```
GATE A — Stream acquisition
  Can a 3rd-party app get the high-quality AirPods stream at all?
  ├─ YES → Gate B
  └─ NO  → fall back to HFP baseline; if HFP ASR is unusable, escalate to §6 alt hardware
GATE B — Isolation in noise
  Does Voice-Isolation mode give surgeon-isolated audio in the OR noise bed?
  ├─ YES → Gate C
  └─ NO  → media tuning too permissive; test if any mode isolates; else §6
GATE C — ASR fitness
  Does the ASR get laterality/implants/drugs "mostly right" (PRD §10) on these files?
  ├─ YES → Gate D
  └─ NO  → hand to ASR spike (post-correction) before blaming hardware
GATE D — Endurance & resilience
  Does it survive backgrounding, lock, a multi-hour case, and dropouts w/o losing the case?
  ├─ YES → GO: build the capture path (PRD §9.2) on AirPods
  └─ NO  → GO with mitigations (local buffering, foreground-keepalive) OR §6
```

**GO = all four gates pass** on the target hardware. Partial passes are acceptable to proceed *with documented mitigations*, except **Gate C**, which is the whole point.

---

## 6. Fallbacks if AirPods don't clear the gates

Line these up now so a "no" doesn't stall the prototype:

1. **Pin the hardware.** Simplest de-risk: require the test surgeon to use a specific H2 AirPods model on iOS 26. The prototype only needs *one* surgeon on *one* rig. Don't generalize.
2. **Wired / dedicated mic.** A wired lav or a near-field clip mic on the gown removes Bluetooth entirely — best raw quality, worst ergonomics/sterility. Good ASR-quality baseline to benchmark AirPods *against*.
3. **Non-Apple BT mic with a real high-quality input profile**, if one exists in the ecosystem.
4. **iPhone built-in mic**, phone bagged near the field — 48 kHz, no isolation. Likely too noisy, but a zero-cost control recording.
5. **Reframe capture:** if hands-free intraop proves too hard, the *review/generation* pipeline (the differentiated part) can still be demo'd from held-out dictation recorded any way that works, while the AirPods ergonomics question is parked.

The point: **the AirPods question should never block validating the note-generation product.** Decouple them — record test dictation by whatever means clears ASR, and let the AirPods spike run in parallel.

---

## 7. Sequencing & effort

| Step | Effort | Blocks |
|------|--------|--------|
| Acquire target + fallback AirPods, phone on iOS 26 | procurement | everything |
| Record an OR noise bed + freeze the scripted test passage | 0.5 day | Gate B/C validity |
| Build throwaway capture app (§3) | 1–2 days | Gates A–D |
| Run test matrix (§4), collect files | 0.5–1 day | Gates |
| Score files through candidate ASR | 0.5 day | Gate C |
| Write up: negotiated rates, isolation verdict, GO/NO-GO + constraints | 0.5 day | build decision |

**Total: ~4–5 focused days**, most of it the throwaway app. This is a genuine gate — if Gate C fails on all hardware, stop and rethink capture before writing PRD §9.2+ code, exactly as the PRD instructs.

---

## 8. Open questions to close during the spike

- Exact **device + firmware matrix** for `bluetoothHighQualityRecording` (confirm empirically, don't trust marketing).
- Is **mic mode (Voice Isolation) app-settable**, or must we instruct the surgeon to set it in Control Center? (Feeds PRD §11 and setup UX.)
- Does high-quality capture **coexist with continuous on-device wake-word listening**, or does engaging the link interrupt the low-power listen loop? (Affects PRD §5.1 architecture.)
- Measured **dropout rate** at real OR geometry, and whether buffer-and-reconcile is enough (PRD §7 Reliability).
- Does the **AirPods stem record control** help (a deliberate sterile-safe trigger) or fight the wake word (PRD §11 sterile-field control)?
