/** Spoken guidance through the browser's speech engine (plays on car speakers). */
let enabled = true

export function setVoiceEnabled(on: boolean) {
  enabled = on
  if (!on) cancelSpeech()
}

export function speak(text: string | undefined, lang: string) {
  if (!enabled || !text || typeof window === 'undefined' || !('speechSynthesis' in window)) return
  try {
    const synth = window.speechSynthesis
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()))
    if (voice) u.voice = voice
    u.rate = 1
    synth.speak(u)
  } catch {
    /* speech unavailable */
  }
}

export function cancelSpeech() {
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* ignore */
  }
}
