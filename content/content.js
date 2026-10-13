"use strict";

/*
 * Content script: does the actual speaking with the Web Speech API,
 * which on macOS is backed by the system text-to-speech voices.
 *
 * It runs once per page and listens for messages from the background
 * page and the toolbar popup.
 */

const DEFAULTS = {
  voiceURI: "",
  rate: 1,
  pitch: 1,
  volume: 1,
};

// Kept at module scope so the utterance object stays referenced (some
// browsers garbage-collect otherwise-lost utterances and stop the speech).
let currentUtterance = null;

// Remembers the most recent non-empty selection, so the popup can still
// speak something if the selection is lost when focus moves to the popup.
let lastSelection = "";

function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.min(max, Math.max(min, num));
}

function getSettings() {
  return browser.storage.local.get(DEFAULTS);
}

function getSelectionText() {
  let text = "";

  const selection = window.getSelection();
  if (selection) {
    text = selection.toString();
  }

  // window.getSelection() is empty inside inputs/textareas; read them directly.
  if (!text) {
    const el = document.activeElement;
    const isTextInput =
      el &&
      (el.tagName === "TEXTAREA" ||
        (el.tagName === "INPUT" &&
          /^(text|search|url|tel|email|password|number)$/i.test(el.type)));
    if (isTextInput) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (typeof start === "number" && typeof end === "number" && end > start) {
        text = el.value.substring(start, end);
      }
    }
  }

  return text.replace(/\s+/g, " ").trim();
}

function rememberSelection() {
  const text = getSelectionText();
  if (text) {
    lastSelection = text;
  }
}

document.addEventListener("selectionchange", rememberSelection, true);
document.addEventListener("contextmenu", rememberSelection, true);
document.addEventListener("select", rememberSelection, true);

/* ------------------------------------------------------------------ */
/* Voices                                                             */
/* ------------------------------------------------------------------ */

function loadVoices() {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve([]);

  const existing = synth.getVoices();
  if (existing.length) {
    return Promise.resolve(existing);
  }

  // Voice lists are often populated asynchronously.
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      synth.removeEventListener("voiceschanged", finish);
      resolve(synth.getVoices());
    };
    synth.addEventListener("voiceschanged", finish);
    setTimeout(finish, 2000);
  });
}

/* ------------------------------------------------------------------ */
/* Speaking                                                           */
/* ------------------------------------------------------------------ */

function notifyState(speaking) {
  browser.runtime.sendMessage({ type: "state", speaking }).catch(() => {
    /* no receiver; harmless */
  });
}

async function speakText(text, { fallbackToLast = false } = {}) {
  const synth = window.speechSynthesis;
  if (!synth) {
    return { ok: false, reason: "unsupported" };
  }

  let content = (text || "").replace(/\s+/g, " ").trim();
  if (!content && fallbackToLast) {
    content = lastSelection;
  }
  if (!content) {
    return { ok: false, reason: "no-selection" };
  }

  const settings = await getSettings();

  // Cancel anything already in flight before starting the new utterance.
  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(content);

  if (settings.voiceURI) {
    const voices = await loadVoices();
    const match = voices.find((voice) => voice.voiceURI === settings.voiceURI);
    if (match) utterance.voice = match;
  }

  utterance.rate = clamp(settings.rate, 0.1, 10);
  utterance.pitch = clamp(settings.pitch, 0, 2);
  utterance.volume = clamp(settings.volume, 0, 1);

  currentUtterance = utterance;

  utterance.onstart = () => notifyState(true);
  utterance.onend = () => {
    if (currentUtterance === utterance) currentUtterance = null;
    notifyState(false);
  };
  utterance.onerror = (event) => {
    if (currentUtterance === utterance) currentUtterance = null;
    // "interrupted" is the normal result of a cancel/stop; not a real error.
    if (event && event.error && event.error !== "interrupted") {
      console.warn("System TTS error:", event.error);
    }
    notifyState(false);
  };

  synth.speak(utterance);
  return { ok: true };
}

function stopSpeaking() {
  const synth = window.speechSynthesis;
  if (synth) synth.cancel();
  currentUtterance = null;
  notifyState(false);
}

/* ------------------------------------------------------------------ */
/* Messaging                                                          */
/* ------------------------------------------------------------------ */

browser.runtime.onMessage.addListener((message) => {
  switch (message && message.type) {
    case "speak":
      return speakText(message.text, { fallbackToLast: false });

    case "speakSelection":
      return speakText(getSelectionText(), { fallbackToLast: true });

    case "stop":
      stopSpeaking();
      return Promise.resolve({ ok: true });

    case "getSelection":
      return Promise.resolve({ text: getSelectionText() || lastSelection });

    case "getVoices":
      return loadVoices().then((voices) => ({
        voices: voices.map((voice) => ({
          voiceURI: voice.voiceURI,
          name: voice.name,
          lang: voice.lang,
        })),
      }));

    case "getStatus":
      return Promise.resolve({
        speaking: Boolean(window.speechSynthesis && window.speechSynthesis.speaking),
      });

    default:
      return undefined;
  }
});
