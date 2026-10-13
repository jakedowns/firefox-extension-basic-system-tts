"use strict";

const DEFAULTS = {
  voiceURI: "",
  rate: 1,
  pitch: 1,
  volume: 1,
};

const els = {
  start: document.getElementById("start"),
  stop: document.getElementById("stop"),
  status: document.getElementById("status"),
  voice: document.getElementById("voice"),
  rate: document.getElementById("rate"),
  rateVal: document.getElementById("rate-val"),
  pitch: document.getElementById("pitch"),
  pitchVal: document.getElementById("pitch-val"),
  volume: document.getElementById("volume"),
  volumeVal: document.getElementById("volume-val"),
};

function setStatus(message) {
  els.status.textContent = message;
}

async function activeTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function broadcast(message) {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map((tab) => browser.tabs.sendMessage(tab.id, message).catch(() => null))
  );
}

async function saveSettings() {
  await browser.storage.local.set({
    voiceURI: els.voice.value,
    rate: Number(els.rate.value),
    pitch: Number(els.pitch.value),
    volume: Number(els.volume.value),
  });
}

function applyToControls(settings) {
  els.rate.value = settings.rate;
  els.pitch.value = settings.pitch;
  els.volume.value = settings.volume;
  els.rateVal.textContent = Number(settings.rate).toFixed(2);
  els.pitchVal.textContent = Number(settings.pitch).toFixed(2);
  els.volumeVal.textContent = Number(settings.volume).toFixed(2);
}

async function populateVoices(selectedURI) {
  const synth = window.speechSynthesis;
  let voices = synth ? synth.getVoices() : [];

  // The voice list is frequently populated asynchronously.
  if (!voices.length && synth) {
    voices = await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        synth.removeEventListener("voiceschanged", finish);
        resolve(synth.getVoices());
      };
      synth.addEventListener("voiceschanged", finish);
      setTimeout(finish, 1500);
    });
  }

  // Last resort: ask the page's content script (rarely needed).
  if (!voices.length) {
    try {
      const tab = await activeTab();
      if (tab) {
        const response = await browser.tabs.sendMessage(tab.id, {
          type: "getVoices",
        });
        if (response && response.voices) voices = response.voices;
      }
    } catch (error) {
      /* ignore */
    }
  }

  els.voice.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "System default";
  els.voice.appendChild(defaultOption);

  for (const voice of voices) {
    const option = document.createElement("option");
    option.value = voice.voiceURI || voice.name;
    option.textContent = voice.lang
      ? `${voice.name} (${voice.lang})`
      : voice.name;
    els.voice.appendChild(option);
  }

  els.voice.value = selectedURI || "";
  // If the previously selected voice is gone, fall back to the default.
  if (els.voice.value !== (selectedURI || "")) {
    els.voice.value = "";
  }
}

async function onStart() {
  await saveSettings();

  const tab = await activeTab();
  if (!tab) {
    setStatus("No active tab.");
    return;
  }

  try {
    const response = await browser.tabs.sendMessage(tab.id, {
      type: "speakSelection",
    });
    if (response && response.ok) {
      setStatus("Speaking\u2026");
    } else if (response && response.reason === "no-selection") {
      setStatus("No text is selected on this page.");
    } else if (response && response.reason === "unsupported") {
      setStatus("This browser page does not support speech.");
    } else {
      setStatus("Nothing to speak.");
    }
  } catch (error) {
    setStatus("This page doesn't allow speech (try a normal web page).");
  }
}

async function onStop() {
  await broadcast({ type: "stop" });
  setStatus("Stopped.");
}

async function init() {
  const settings = await browser.storage.local.get(DEFAULTS);
  applyToControls(settings);
  await populateVoices(settings.voiceURI);

  els.rate.addEventListener("input", () => {
    els.rateVal.textContent = Number(els.rate.value).toFixed(2);
    saveSettings();
  });
  els.pitch.addEventListener("input", () => {
    els.pitchVal.textContent = Number(els.pitch.value).toFixed(2);
    saveSettings();
  });
  els.volume.addEventListener("input", () => {
    els.volumeVal.textContent = Number(els.volume.value).toFixed(2);
    saveSettings();
  });
  els.voice.addEventListener("change", saveSettings);

  els.start.addEventListener("click", onStart);
  els.stop.addEventListener("click", onStop);
}

init();
