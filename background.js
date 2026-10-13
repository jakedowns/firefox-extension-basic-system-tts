"use strict";

/*
 * Background event page (Manifest V3).
 *
 * Its only jobs are:
 *   1. Build the "System TTS" submenu in the right-click context menu.
 *   2. Relay menu clicks to the content script running in the target tab.
 *
 * The actual speaking happens in the content script, so it keeps working
 * even if this background page is unloaded or the popup is closed.
 */

const ROOT_ID = "system-tts-root";
const START_ID = "system-tts-start";
const STOP_ID = "system-tts-stop";

function logMenuError(action) {
  return () => {
    const error = browser.runtime.lastError;
    if (error) {
      console.error(`Failed to ${action} context menu:`, error.message);
    }
  };
}

function createMenus() {
  // Menu items persist across background-page restarts for non-persistent
  // (event page) backgrounds, so we only build them on install/startup rather
  // than re-creating them on every wake. removeAll() keeps that idempotent.
  browser.menus
    .removeAll()
    .then(() => {
      browser.menus.create(
        {
          id: ROOT_ID,
          title: "System TTS",
          contexts: ["all"],
        },
        logMenuError("create")
      );

      browser.menus.create(
        {
          id: START_ID,
          parentId: ROOT_ID,
          title: "Start speaking",
          // Only offered when there is a text selection.
          contexts: ["selection"],
        },
        logMenuError("create")
      );

      browser.menus.create(
        {
          id: STOP_ID,
          parentId: ROOT_ID,
          title: "Stop speaking",
          // Kept available at all times so it can always cancel audio.
          contexts: ["all"],
        },
        logMenuError("create")
      );
    })
    .catch((error) => {
      console.error("Failed to rebuild context menus:", error);
    });
}

browser.runtime.onInstalled.addListener(createMenus);
browser.runtime.onStartup.addListener(createMenus);

function sendToTab(tabId, message) {
  if (typeof tabId !== "number") {
    return Promise.resolve(null);
  }
  return browser.tabs.sendMessage(tabId, message).catch(() => null);
}

async function stopEverywhere() {
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.map((tab) => sendToTab(tab.id, { type: "stop" })));
}

browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === START_ID) {
    const text = (info.selectionText || "").trim();
    if (tab && typeof tab.id === "number") {
      sendToTab(tab.id, { type: "speak", text });
    }
  } else if (info.menuItemId === STOP_ID) {
    stopEverywhere();
  }
});
