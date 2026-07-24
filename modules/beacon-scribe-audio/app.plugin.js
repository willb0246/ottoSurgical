const { withInfoPlist } = require("@expo/config-plugins")

/**
 * Config plugin for beacon-scribe-audio.
 *
 * Injects the iOS entries the native capture engine needs:
 *   - NSMicrophoneUsageDescription     (mic capture)
 *   - NSSpeechRecognitionUsageDescription (on-device wake word)
 *   - UIBackgroundModes: ["audio"]     (capture survives backgrounding —
 *     the surgeon can't hold the phone; PRD §5.1 session management)
 *
 * Add to app.json plugins:  "beacon-scribe-audio"
 * Optionally with custom copy:
 *   ["beacon-scribe-audio", { "microphonePermission": "…", "speechPermission": "…" }]
 */
const DEFAULT_MIC =
  "OttoSurgical uses the microphone to capture dictated operative-note content from your AirPods."
const DEFAULT_SPEECH =
  "OttoSurgical uses on-device speech recognition to detect the wake word that starts dictation."

module.exports = function withBeaconScribeAudio(config, props = {}) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSMicrophoneUsageDescription =
      props.microphonePermission || cfg.modResults.NSMicrophoneUsageDescription || DEFAULT_MIC
    cfg.modResults.NSSpeechRecognitionUsageDescription =
      props.speechPermission || cfg.modResults.NSSpeechRecognitionUsageDescription || DEFAULT_SPEECH

    const modes = new Set(cfg.modResults.UIBackgroundModes || [])
    modes.add("audio")
    cfg.modResults.UIBackgroundModes = Array.from(modes)

    return cfg
  })
}
