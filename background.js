// NAS Speed Dial – Hintergrund: nimmt Vorschaubilder der Seiten auf.
//
// 1) Automatisch: Wenn du eine Seite aus deinem Speed Dial besuchst und sie
//    noch kein (oder ein über 7 Tage altes) Vorschaubild hat, wird der sichtbare
//    Bereich fotografiert.
// 2) Auf Knopfdruck: Die Seite wird kurz in einem Tab geöffnet, fotografiert
//    und der Tab wieder geschlossen.
//
// Die Bilder landen in chrome.storage.local unter "pendingThumbs". Die
// Neuer-Tab-Seite übernimmt sie von dort und speichert sie mit auf dem NAS.

const THUMB_WIDTH = 480;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function normalize(url) {
  try {
    const u = new URL(url);
    return (u.host.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") + u.search).toLowerCase();
  } catch { return ""; }
}

async function hasCapturePermission() {
  return chrome.permissions.contains({ origins: ["<all_urls>"] });
}

// Großes Bildschirmfoto auf Kachelgröße verkleinern (JPEG)
async function shrink(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const w = THUMB_WIDTH;
  const h = Math.round(w * 10 / 16);
  // nur den oberen Bereich im Seitenverhältnis 16:10 nehmen
  const srcH = Math.min(bmp.height, Math.round(bmp.width * 10 / 16));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, bmp.width, srcH, 0, 0, w, h);
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
  const buf = new Uint8Array(await out.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return "data:image/jpeg;base64," + btoa(bin);
}

async function storeThumb(dialId, thumb) {
  const { pendingThumbs = {} } = await chrome.storage.local.get("pendingThumbs");
  pendingThumbs[dialId] = { thumb, at: Date.now() };
  await chrome.storage.local.set({ pendingThumbs });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForLoad(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(listener); clearTimeout(t); resolve(); };
    const listener = (id, info) => { if (id === tabId && info.status === "complete") done(); };
    const t = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// --- 1) Automatische Aufnahme beim Besuchen ---------------------------------
const recentlyCaptured = new Map();

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete" || !tab.active || !tab.url || !/^https?:/.test(tab.url)) return;
  if (!(await hasCapturePermission())) return;

  const { data, autoCapture = true } = await chrome.storage.local.get(["data", "autoCapture"]);
  if (!autoCapture || !data) return;

  const key = normalize(tab.url);
  const now = Date.now();
  const dials = data.groups.flatMap((g) => g.dials).filter((d) =>
    normalize(d.url) === key && !d.image && (!d.thumb || now - (d.thumbAt || 0) > MAX_AGE_MS));
  if (!dials.length) return;
  if (now - (recentlyCaptured.get(key) || 0) < 60000) return;
  recentlyCaptured.set(key, now);

  await wait(1500); // Seite fertig zeichnen lassen
  try {
    const current = await chrome.tabs.get(tabId);
    if (!current.active || normalize(current.url) !== key) return;
    const shot = await chrome.tabs.captureVisibleTab(current.windowId, { format: "jpeg", quality: 85 });
    const thumb = await shrink(shot);
    for (const d of dials) await storeThumb(d.id, thumb);
  } catch (e) {
    console.warn("Automatische Vorschau fehlgeschlagen:", e);
  }
});

// --- 2) Aufnahme auf Knopfdruck ---------------------------------------------
async function captureUrl(url, returnTabId) {
  const tab = await chrome.tabs.create({ url, active: true });
  try {
    await waitForLoad(tab.id);
    await wait(2000);
    const t = await chrome.tabs.get(tab.id);
    await chrome.windows.update(t.windowId, { focused: true });
    await chrome.tabs.update(tab.id, { active: true });
    const shot = await chrome.tabs.captureVisibleTab(t.windowId, { format: "jpeg", quality: 85 });
    return await shrink(shot);
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch {}
    if (returnTabId) { try { await chrome.tabs.update(returnTabId, { active: true }); } catch {} }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "capture") return;
  (async () => {
    try {
      if (!(await hasCapturePermission())) throw new Error("Keine Berechtigung für Vorschaubilder.");
      const thumb = await captureUrl(msg.url, sender.tab?.id);
      sendResponse({ ok: true, thumb });
    } catch (e) {
      sendResponse({ ok: false, error: String(e.message || e) });
    }
  })();
  return true; // Antwort kommt asynchron
});

// --- 3) Rechtsklick: „Zu Speed Dial hinzufügen“ ------------------------------
// Untermenü mit allen Gruppen; wird neu gebaut, sobald sich die Gruppen ändern.
let lastMenuKey = "";
async function buildMenus() {
  const { data } = await chrome.storage.local.get("data");
  const groups = data?.groups || [];
  const key = JSON.stringify(groups.map((g) => [g.id, g.name]));
  if (key === lastMenuKey) return;
  lastMenuKey = key;
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: "sd-root", title: "Zu Speed Dial hinzufügen", contexts: ["page", "link"] });
  if (!groups.length) {
    chrome.contextMenus.create({ id: "sd-none", parentId: "sd-root", title: "Erst einen neuen Tab öffnen", enabled: false, contexts: ["page", "link"] });
  }
  for (const g of groups) {
    chrome.contextMenus.create({ id: "sd-add-" + g.id, parentId: "sd-root", title: g.name, contexts: ["page", "link"] });
  }
}
chrome.runtime.onInstalled.addListener(() => { lastMenuKey = ""; buildMenus(); });
chrome.runtime.onStartup.addListener(() => { lastMenuKey = ""; buildMenus(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.data) buildMenus();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!String(info.menuItemId).startsWith("sd-add-")) return;
  const groupId = String(info.menuItemId).slice(7);
  const isLink = !!info.linkUrl;
  const url = info.linkUrl || info.pageUrl || tab?.url;
  if (!url || !/^https?:/.test(url)) return;

  const { data } = await chrome.storage.local.get("data");
  const group = data?.groups?.find((g) => g.id === groupId);
  if (!group) return;

  let title;
  if (isLink) title = (info.selectionText || "").trim() || new URL(url).hostname.replace(/^www\./, "");
  else title = (tab?.title || new URL(url).hostname).trim();

  const dial = { id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4), url, title: title.slice(0, 80) };

  // Bei der aktuellen Seite gleich das Vorschaubild mitnehmen
  if (!isLink && tab && (await hasCapturePermission())) {
    try {
      const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 85 });
      dial.thumb = await shrink(shot);
      dial.thumbAt = Date.now();
    } catch (e) { console.warn("Vorschau beim Hinzufügen fehlgeschlagen:", e); }
  }

  // frisch lesen, falls sich in der Zwischenzeit etwas geändert hat
  const fresh = (await chrome.storage.local.get("data")).data;
  const g2 = fresh.groups.find((g) => g.id === groupId);
  if (!g2) return;
  if (g2.dials.some((d) => d.url === url)) {
    flashBadge(tab, "=", "#777");
    return;
  }
  g2.dials.push(dial);
  fresh.updated = Date.now();
  await chrome.storage.local.set({ data: fresh, dirty: true });
  flashBadge(tab, "✓", "#4b7a3c");
});

// kurze Bestätigung am Erweiterungs-Symbol
function flashBadge(tab, text, color) {
  const opts = tab?.id ? { tabId: tab.id } : {};
  chrome.action?.setBadgeBackgroundColor?.({ color, ...opts });
  chrome.action?.setBadgeText?.({ text, ...opts });
  setTimeout(() => chrome.action?.setBadgeText?.({ text: "", ...opts }), 2500);
}

// Klick auf das Erweiterungs-Symbol öffnet den Speed Dial
chrome.action.onClicked.addListener(() => chrome.tabs.create({}));
