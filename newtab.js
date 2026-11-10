// NAS Speed Dial – Neuer-Tab-Seite
// Alle Gruppen + Links liegen als eine Datei "speeddial.json" auf der Synology (WebDAV).
// Eine Kopie bleibt im Browser, damit alles auch ohne NAS-Verbindung funktioniert.

const $ = (sel) => document.querySelector(sel);
const FILE_NAME = "speeddial.json";

let data = null;          // Gruppen, Links, Aussehen (wird auf dem NAS gespeichert)
let nas = {};             // Zugangsdaten (bleiben nur in diesem Browser)
let dirty = false;        // gibt es Änderungen, die noch nicht auf dem NAS sind?
let activeGroupId = null; // welche Gruppe gerade offen ist (nur lokal)
let autoCapture = true;
let workingBase = null;   // zuletzt erreichbare NAS-Adresse
let lastSync = 0;

// ---------------------------------------------------------------- Hilfen
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const today = () => new Date().toISOString().slice(0, 10);

function defaultData() {
  return {
    version: 1,
    updated: 0,
    settings: { tileSize: 370, columns: 0, showTitles: false, showAddTile: true, autoLockMin: 0 },
    groups: SAMPLE_GROUPS.map(([name, dials]) => ({
      id: uid(),
      name,
      dials: dials.map(([title, url]) => ({ id: uid(), title, url })),
    })),
  };
}

// Beispielgruppen für den ersten Start – zum Ausprobieren, können frei geändert oder gelöscht werden
const SAMPLE_GROUPS = [
  ["Nachrichten", [
    ["Tagesschau", "https://www.tagesschau.de/"],
    ["ZDFheute", "https://www.zdf.de/nachrichten"],
    ["heise online", "https://www.heise.de/"],
  ]],
  ["Rezepte", [
    ["Chefkoch", "https://www.chefkoch.de/"],
    ["Lecker", "https://www.lecker.de/"],
  ]],
  ["Urlaub", [
    ["OpenStreetMap", "https://www.openstreetmap.org/"],
    ["Deutscher Wetterdienst", "https://www.dwd.de/"],
  ]],
  ["Werkzeuge", [
    ["Wikipedia", "https://de.wikipedia.org/"],
    ["DeepL Übersetzer", "https://www.deepl.com/translator"],
    ["GitHub", "https://github.com/"],
  ]],
  ["Hobby", [
    ["YouTube", "https://www.youtube.com/"],
    ["komoot", "https://www.komoot.com/de-de"],
  ]],
];

function normalizeUrl(u) {
  u = (u || "").trim();
  if (!u) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  return u;
}
function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}
function faviconUrl(pageUrl) {
  return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=64`);
}
function tileColor(u) {
  let h = 0;
  for (const c of hostOf(u)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 30% 20%)`;
}
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (t.hidden = true), ms);
}
const groupById = (id) => data.groups.find((g) => g.id === id);
function findDial(id) {
  for (const g of data.groups) {
    const i = g.dials.findIndex((d) => d.id === id);
    if (i >= 0) return { group: g, index: i, dial: g.dials[i] };
  }
  return null;
}

// Bild-Datei auf Kachelgröße verkleinern
function fileToThumb(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = 480, h = 300;
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      const scale = Math.max(w / img.width, h / img.height);
      const sw = w / scale, sh = h / scale;
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.8));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// Berechtigung für Webseiten (NAS-Zugriff + Vorschaubilder). Muss direkt im Klick aufgerufen werden.
function requestSitePermission() {
  return chrome.permissions.request({ origins: ["<all_urls>"] });
}

// ---------------------------------------------------------------- Anzeige
function applyLook() {
  const s = data.settings;
  document.documentElement.style.setProperty("--tile", s.tileSize + "px");
  $("#grid").style.gridTemplateColumns = s.columns > 0
    ? `repeat(${s.columns}, var(--tile))` : "repeat(auto-fill, var(--tile))";
}

function render() {
  if (!groupById(activeGroupId)) activeGroupId = data.groups[0]?.id;
  applyLook();
  renderGroups();
  renderGrid();
  updateLockUI();
}

let drag = null; // { kind: "dial"|"group", id }

function renderGroups() {
  const nav = $("#groups");
  nav.replaceChildren();
  for (const g of data.groups) {
    const tab = el("button", {
      class: "group-tab" + (g.id === activeGroupId ? " active" : ""),
      draggable: "true",
      title: `${g.dials.length} Seiten · Doppelklick oder Rechtsklick zum Bearbeiten`,
      onclick: () => { activeGroupId = g.id; chrome.storage.local.set({ activeGroupId }); render(); },
      ondblclick: () => openGroupDialog(g.id),
      oncontextmenu: (e) => { e.preventDefault(); openGroupDialog(g.id); },
      ondragstart: (e) => { drag = { kind: "group", id: g.id }; tab.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; },
      ondragend: () => { drag = null; render(); },
      ondragover: (e) => { if (drag) { e.preventDefault(); tab.classList.add("drop-target"); } },
      ondragleave: () => tab.classList.remove("drop-target"),
      ondrop: (e) => {
        e.preventDefault();
        if (!drag) return;
        if (drag.kind === "dial") {
          const f = findDial(drag.id);
          if (f && f.group.id !== g.id) {
            f.group.dials.splice(f.index, 1);
            g.dials.push(f.dial);
            save();
            toast(`„${f.dial.title}“ nach „${g.name}“ verschoben`);
          }
        } else if (drag.kind === "group" && drag.id !== g.id) {
          const from = data.groups.findIndex((x) => x.id === drag.id);
          const [moved] = data.groups.splice(from, 1);
          data.groups.splice(data.groups.indexOf(g), 0, moved);
          save();
        }
        drag = null;
      },
    }, g.name);
    nav.append(tab);
  }
}

function thumbContent(d) {
  const box = el("div", { class: "thumb", style: `--tile-color:${tileColor(d.url)}` });
  const pic = d.image || d.thumb;
  if (pic) box.append(el("img", { class: "shot", src: pic, alt: "", draggable: "false" }));
  else {
    box.append(el("img", { class: "fav", src: faviconUrl(d.url), alt: "", draggable: "false" }));
    box.append(el("div", { class: "host" }, hostOf(d.url)));
  }
  return box;
}

function renderGrid() {
  const grid = $("#grid");
  grid.replaceChildren();
  const g = groupById(activeGroupId);
  if (!g) return;

  for (const d of g.dials) {
    const tile = el("div", {
      class: "tile",
      draggable: "true",
      ondragstart: (e) => { drag = { kind: "dial", id: d.id }; tile.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; },
      ondragend: () => { drag = null; render(); },
      ondragover: (e) => { if (drag?.kind === "dial" && drag.id !== d.id) { e.preventDefault(); tile.classList.add("drop-before"); } },
      ondragleave: () => tile.classList.remove("drop-before"),
      ondrop: (e) => { e.preventDefault(); moveDialBefore(drag?.id, g.id, d.id); },
    });
    const link = el("a", { href: d.url, title: `${d.title}\n${d.url}`, draggable: "false" }, thumbContent(d));
    if (!data.settings.showTitles) link.append(el("div", { class: "hover-title" }, d.title));
    tile.append(link);
    if (data.settings.showTitles) tile.append(el("div", { class: "below-title" }, d.title));
    tile.append(el("div", { class: "tools" },
      el("button", { title: "Bearbeiten", onclick: (e) => { e.preventDefault(); openDialDialog(d.id); } }, "✎"),
      el("button", { title: "Löschen", onclick: (e) => { e.preventDefault(); deleteDial(d.id); } }, "✕"),
    ));
    grid.append(tile);
  }

  if (data.settings.showAddTile !== false) {
    grid.append(el("button", {
      class: "add-tile", title: "Seite hinzufügen",
      onclick: () => openDialDialog(null),
      ondragover: (e) => { if (drag?.kind === "dial") e.preventDefault(); },
      ondrop: (e) => { e.preventDefault(); moveDialBefore(drag?.id, g.id, null); },
    }, "＋"));
  } else if (!g.dials.length) {
    grid.append(el("p", { class: "empty-hint" },
      "Diese Gruppe ist noch leer. Seiten fügst du per Rechtsklick auf einer Webseite → „Zu Speed Dial hinzufügen“ hinzu. ",
      "Die ＋-Kachel kannst du unter ⚙ → Aussehen wieder einblenden."));
  }
}

function moveDialBefore(dialId, groupId, beforeId) {
  const f = findDial(dialId);
  const g = groupById(groupId);
  if (!f || !g) return;
  f.group.dials.splice(f.index, 1);
  const idx = beforeId ? g.dials.findIndex((x) => x.id === beforeId) : -1;
  if (idx >= 0) g.dials.splice(idx, 0, f.dial); else g.dials.push(f.dial);
  drag = null;
  save();
}

function deleteDial(id) {
  const f = findDial(id);
  if (!f || !confirm(`„${f.dial.title}“ wirklich löschen?`)) return;
  f.group.dials.splice(f.index, 1);
  save();
}

// ---------------------------------------------------------------- Kachel-Dialog
let editing = null; // { id, image, thumb, thumbAt }

function updateDialPreview() {
  const box = $("#dialPreview");
  box.replaceChildren();
  const url = normalizeUrl($("#dialForm").url.value);
  const pic = editing.image || editing.thumb;
  if (pic) box.append(el("img", { class: "shot", src: pic, alt: "" }));
  else if (url) box.append(el("img", { class: "fav", src: faviconUrl(url), alt: "" }));
  $("#removeImgBtn").hidden = !editing.image;
}

function openDialDialog(id) {
  const f = id ? findDial(id) : null;
  const form = $("#dialForm");
  form.reset();
  editing = { id, image: f?.dial.image || null, thumb: f?.dial.thumb || null, thumbAt: f?.dial.thumbAt || 0 };
  $("#dialDialogTitle").textContent = f ? "Seite bearbeiten" : "Seite hinzufügen";
  form.url.value = f?.dial.url || "";
  form.title.value = f?.dial.title || "";
  form.group.replaceChildren(...data.groups.map((g) => el("option", { value: g.id }, g.name)));
  form.group.value = f?.group.id || activeGroupId;
  $("#deleteDialBtn").hidden = !f;
  updateDialPreview();
  $("#dialDialog").showModal();
}

$("#dialForm").url.addEventListener("change", updateDialPreview);
$("#dialForm").image.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try { editing.image = await fileToThumb(file); updateDialPreview(); }
  catch { toast("Das Bild konnte nicht gelesen werden."); }
});
$("#removeImgBtn").addEventListener("click", () => { editing.image = null; updateDialPreview(); });
$("#deleteDialBtn").addEventListener("click", () => {
  $("#dialDialog").close();
  deleteDial(editing.id);
});
$("#captureBtn").addEventListener("click", async () => {
  const url = normalizeUrl($("#dialForm").url.value);
  if (!url) { toast("Bitte zuerst eine Adresse eintragen."); return; }
  if (!(await requestSitePermission())) { toast("Ohne Berechtigung können keine Vorschaubilder aufgenommen werden."); return; }
  const btn = $("#captureBtn");
  btn.disabled = true; btn.textContent = "⏳ Wird aufgenommen…";
  const res = await chrome.runtime.sendMessage({ type: "capture", url });
  btn.disabled = false; btn.textContent = "📷 Vorschau aufnehmen";
  if (res?.ok) { editing.thumb = res.thumb; editing.thumbAt = Date.now(); updateDialPreview(); }
  else toast("Vorschau fehlgeschlagen: " + (res?.error || "unbekannter Fehler"));
});

$("#dialForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const dlg = $("#dialDialog");
  if (e.submitter?.value !== "ok") { dlg.close(); return; }
  const form = e.target;
  const url = normalizeUrl(form.url.value);
  if (!url) return;
  const fields = {
    url,
    title: form.title.value.trim() || hostOf(url),
    image: editing.image || undefined,
    thumb: editing.thumb || undefined,
    thumbAt: editing.thumbAt || undefined,
  };
  const target = groupById(form.group.value);
  const f = editing.id ? findDial(editing.id) : null;
  if (f) {
    if (f.dial.url !== url && editing.thumb === f.dial.thumb) { fields.thumb = undefined; fields.thumbAt = undefined; }
    Object.assign(f.dial, fields);
    if (f.group !== target) { f.group.dials.splice(f.index, 1); target.dials.push(f.dial); }
  } else {
    target.dials.push({ id: uid(), ...fields });
  }
  for (const d of target.dials) for (const k of Object.keys(d)) if (d[k] === undefined) delete d[k];
  dlg.close();
  save();
});

// ---------------------------------------------------------------- Gruppen-Dialog
let editingGroupId = null;

function openGroupDialog(id) {
  editingGroupId = id;
  const g = id ? groupById(id) : null;
  const form = $("#groupForm");
  form.reset();
  form.name.value = g?.name || "";
  $("#groupDialogTitle").textContent = g ? "Gruppe bearbeiten" : "Neue Gruppe";
  $("#deleteGroupBtn").hidden = !g || data.groups.length < 2;
  $("#takeTabsRow").hidden = true;
  openWebTabs().then((tabs) => {
    if (!tabs.length) return;
    $("#takeTabsLabel").textContent = g
      ? `Alle ${tabs.length} offenen Tabs dieses Fensters zu dieser Gruppe hinzufügen`
      : `Alle ${tabs.length} offenen Tabs dieses Fensters übernehmen`;
    $("#takeTabsRow").hidden = false;
  });
  $("#groupDialog").showModal();
}

// Offene Webseiten-Tabs im aktuellen Fenster (ohne Doppelte)
async function openWebTabs() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const seen = new Set();
    return tabs.filter((t) => /^https?:/.test(t.url || "") && !seen.has(t.url) && seen.add(t.url));
  } catch { return []; }
}
$("#addGroupBtn").addEventListener("click", () => openGroupDialog(null));
$("#deleteGroupBtn").addEventListener("click", () => {
  const g = groupById(editingGroupId);
  if (!g) return;
  const msg = g.dials.length
    ? `Gruppe „${g.name}“ mit ${g.dials.length} Seiten wirklich löschen?`
    : `Gruppe „${g.name}“ löschen?`;
  if (!confirm(msg)) return;
  data.groups = data.groups.filter((x) => x.id !== g.id);
  $("#groupDialog").close();
  save();
});
$("#groupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dlg = $("#groupDialog");
  if (e.submitter?.value !== "ok") { dlg.close(); return; }
  const name = e.target.name.value.trim();
  if (!name) return;
  const takeTabs = e.target.takeTabs.checked && !$("#takeTabsRow").hidden;
  dlg.close();
  let g = groupById(editingGroupId);
  if (g) g.name = name;
  else {
    g = { id: uid(), name, dials: [] };
    data.groups.push(g);
  }
  activeGroupId = g.id;
  chrome.storage.local.set({ activeGroupId });
  if (takeTabs) {
    const tabs = await openWebTabs();
    const existing = new Set(g.dials.map((d) => d.url));
    const added = tabs.filter((t) => !existing.has(t.url));
    for (const t of added) g.dials.push({ id: uid(), url: t.url, title: (t.title || hostOf(t.url)).slice(0, 80) });
    toast(`${added.length} Seiten übernommen. Die Vorschaubilder entstehen beim nächsten Besuch – oder über ⚙ „Alle fehlenden Vorschauen jetzt aufnehmen“.`, 7000);
  }
  save();
});

// ---------------------------------------------------------------- NAS (WebDAV)
function nasConfigured() { return !!((nas.url || nas.urlRemote) && nas.user); }
function folderPath(extra = "") {
  const p = ("/" + (nas.path || "/SpeedDial") + "/" + extra).replace(/\/+/g, "/").replace(/\/$/, "");
  return p.split("/").map(encodeURIComponent).join("/");
}
function cleanBase(b) { return (b || "").trim().replace(/\/+$/, ""); }
function authHeader() {
  const bytes = new TextEncoder().encode(`${nas.user}:${nas.pass || ""}`);
  return "Basic " + btoa(String.fromCharCode(...bytes));
}
function candidates() {
  const list = [nas.url, nas.urlRemote].map(cleanBase).filter(Boolean);
  if (workingBase && list.includes(workingBase)) {
    return [workingBase, ...list.filter((b) => b !== workingBase)];
  }
  return list;
}
function dav(base, method, path, body, timeout = 30000) {
  const headers = { Authorization: authHeader() };
  if (body) headers["Content-Type"] = "application/json; charset=utf-8";
  return fetch(base + path, {
    method, headers, body, cache: "no-store", credentials: "omit",
    signal: AbortSignal.timeout(timeout),
  });
}

// Liest die Datei vom NAS. Probiert Heim- und Unterwegs-Adresse nacheinander.
async function nasRead() {
  let lastError = "NAS nicht erreichbar";
  for (const base of candidates()) {
    try {
      const r = await dav(base, "GET", folderPath(FILE_NAME), null, 20000);
      if (r.status === 401 || r.status === 403) return { base, error: "Anmeldung am NAS fehlgeschlagen (Benutzer/Passwort/Rechte prüfen)" };
      if (r.status === 404) { workingBase = base; return { base, missing: true }; }
      if (!r.ok) { lastError = `NAS meldet Fehler ${r.status}`; continue; }
      workingBase = base;
      return { base, json: await r.json() };
    } catch (e) {
      lastError = e.name === "TimeoutError" ? "NAS antwortet nicht" : "NAS nicht erreichbar";
    }
  }
  return { error: lastError, offline: true };
}

async function ensureFolder(base, sub = "") {
  const parts = folderPath(sub).split("/").filter(Boolean);
  let p = "";
  for (const part of parts) {
    p += "/" + part;
    const r = await dav(base, "MKCOL", p);
    if (![201, 405, 301].includes(r.status) && !r.ok) {
      if (r.status === 403 && p.split("/").length <= 2) {
        throw new Error(`Der freigegebene Ordner „${decodeURIComponent(part)}“ existiert nicht oder dein Benutzer hat keine Schreibrechte.`);
      }
    }
  }
}

// Synology antwortet manchmal kurz mit 500/423/503, wenn die Datei gerade vom NAS selbst
// benutzt wird (z. B. Indexierung). Dann einfach kurz warten und noch einmal versuchen.
const TRANSIENT = [423, 500, 502, 503, 504];

async function putFile(base, path, sub, body) {
  let r;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((res) => setTimeout(res, attempt * 1500));
    r = await dav(base, "PUT", path, body);
    if ((r.status === 404 || r.status === 409) && attempt === 0) {
      await ensureFolder(base, sub);
      r = await dav(base, "PUT", path, body);
    }
    if (!TRANSIENT.includes(r.status)) break;
  }
  if (r.status === 401 || r.status === 403) throw new Error("Anmeldung am NAS fehlgeschlagen oder keine Schreibrechte");
  if (!r.ok) throw new Error(`NAS meldet Fehler ${r.status}`);
}

async function nasWrite() {
  const body = JSON.stringify(data);
  let lastErr;
  for (const base of candidates()) {
    try {
      await putFile(base, folderPath(FILE_NAME), "", body);
      workingBase = base;
      dailyBackup(base, body); // läuft nebenher und hält das Speichern nicht auf
      return;
    } catch (e) {
      lastErr = e;
      if (e.name !== "TimeoutError" && e.name !== "TypeError") break; // echter Fehler, nicht "nicht erreichbar"
    }
  }
  throw lastErr || new Error("NAS nicht erreichbar");
}

// Einmal am Tag eine Kopie: bevorzugt im Unterordner "backups", sonst direkt im Ordner.
// Pro Tag wird es nur einmal versucht, damit ein Fehler das Speichern nicht jedes Mal bremst.
async function dailyBackup(base, body) {
  const day = today();
  const { lastBackupTry } = await chrome.storage.local.get("lastBackupTry");
  if (lastBackupTry === day) return;
  await chrome.storage.local.set({ lastBackupTry: day });
  try {
    await putFile(base, folderPath(`backups/speeddial-${day}.json`), "backups", body);
  } catch {
    try { await putFile(base, folderPath(`speeddial-backup-${day}.json`), "", body); }
    catch (e) { console.log("Tägliche Sicherung nicht möglich:", e.message); }
  }
}

function setStatus(kind, text, detail = "") {
  const s = $("#syncStatus");
  if (kind === "warn") {
    const entry = { text, detail, at: new Date().toLocaleString("de-DE") };
    chrome.storage.local.set({ lastSyncError: entry });
  }
  s.className = "sync " + kind;
  s.querySelector(".label").textContent = text;
  s.title = detail || text;
}

function showIdleStatus() {
  if (!nasConfigured()) setStatus("", "Nur lokal", "NAS noch nicht eingerichtet – siehe Einstellungen (⚙)");
  else if (dirty) setStatus("warn", "Nicht synchron", "Änderungen sind lokal gespeichert und werden übertragen, sobald das NAS erreichbar ist.");
  else {
    const where = workingBase && cleanBase(nas.urlRemote) === workingBase ? " (unterwegs)" : "";
    setStatus("ok", "NAS" + where, "Mit der Synology synchron – " + (workingBase || ""));
  }
}

// Nur eine Neuer-Tab-Seite gleichzeitig darf mit dem NAS sprechen (verhindert, dass sich
// mehrere offene Tabs gegenseitig in die Quere kommen).
function withNasLock(fn) {
  return navigator.locks ? navigator.locks.request("nas-sync", fn) : fn();
}

// Beim Öffnen: neuesten Stand vom NAS holen
let syncing = false;
async function syncFromNas() {
  if (!nasConfigured()) { showIdleStatus(); return; }
  if (syncing) return;
  syncing = true;
  setStatus("busy", "Verbinde…");
  try {
    await withNasLock(async () => {
      const res = await nasRead();
      lastSync = Date.now();
      if (res.error) { setStatus("warn", res.offline ? "NAS offline" : "Fehler", res.error + " – Änderungen bleiben lokal gespeichert."); scheduleRetry(); return; }
      const st = await chrome.storage.local.get(["data", "dirty"]);
      if (st.data) data = st.data;
      dirty = !!st.dirty;
      if (res.missing) { await chrome.storage.local.set({ dirty: true }); await pushLocked(); return; }
      const remote = res.json;
      if (!remote?.groups) { setStatus("warn", "Fehler", "Die Datei auf dem NAS ist beschädigt."); return; }
      if (dirty && (data.updated || 0) >= (remote.updated || 0)) {
        await pushLocked(); // lokale Änderungen sind neuer
      } else {
        data = remote;
        dirty = false;
        await chrome.storage.local.set({ data, dirty });
        render();
        showIdleStatus();
      }
    });
  } finally { syncing = false; }
}

let pushTimer = null, retryTimer = null, retryDelay = 5000;
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 900);
}
// Klappt das Speichern nicht, wird es automatisch wiederholt (5 s, 10 s, 20 s … bis 1 Minute)
function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (dirty) pushNow(); else syncFromNas(); }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 60000);
}

async function pushNow() {
  if (!nasConfigured()) { showIdleStatus(); return; }
  await withNasLock(pushLocked);
}

// wird nur innerhalb der Sperre aufgerufen
async function pushLocked() {
  // immer den neuesten gespeicherten Stand nehmen – vielleicht hat ein anderer Tab schon gespeichert
  const st = await chrome.storage.local.get(["data", "dirty"]);
  if (st.data) data = st.data;
  dirty = !!st.dirty;
  if (!dirty) { showIdleStatus(); return; }
  setStatus("busy", "Speichere…");
  const sentUpdated = data.updated;
  try {
    await nasWrite();
    // nur als erledigt markieren, wenn in der Zwischenzeit nichts Neues dazukam
    const now = await chrome.storage.local.get("data");
    if ((now.data?.updated || 0) === sentUpdated) {
      dirty = false;
      await chrome.storage.local.set({ dirty });
    } else schedulePush();
    retryDelay = 5000;
    clearTimeout(retryTimer);
    lastSync = Date.now();
    showIdleStatus();
  } catch (e) {
    setStatus("warn", "Nicht synchron", `${e.message || e} – Änderungen sind lokal gespeichert, neuer Versuch läuft automatisch.`);
    scheduleRetry();
  }
}

// Jede Änderung: lokal sichern, neu zeichnen, kurz danach aufs NAS schreiben
async function save() {
  for (const g of data.groups) delete g.lock; // Gruppen-PINs gibt es nicht mehr
  data.updated = Date.now();
  dirty = true;
  render();
  await chrome.storage.local.set({ data, dirty });
  schedulePush();
}

// ---------------------------------------------------------------- Vorschaubilder aus dem Hintergrund übernehmen
async function absorbPendingThumbs() {
  const { pendingThumbs } = await chrome.storage.local.get("pendingThumbs");
  if (!pendingThumbs || !Object.keys(pendingThumbs).length) return;
  let changed = false;
  for (const [id, { thumb, at }] of Object.entries(pendingThumbs)) {
    const f = findDial(id);
    if (f && !f.dial.image) { f.dial.thumb = thumb; f.dial.thumbAt = at; changed = true; }
  }
  await chrome.storage.local.remove("pendingThumbs");
  if (changed) save();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.pendingThumbs?.newValue) absorbPendingThumbs();
  // andere geöffnete Neuer-Tab-Seiten oder das Rechtsklick-Menü haben etwas geändert
  if (changes.data?.newValue && (changes.data.newValue.updated || 0) > (data.updated || 0)) {
    data = changes.data.newValue;
    render();
  }
  // Synchron-Status mit den anderen Tabs abgleichen
  if (changes.dirty) {
    dirty = !!changes.dirty.newValue;
    if (dirty) schedulePush();
    else { retryDelay = 5000; clearTimeout(retryTimer); showIdleStatus(); }
  }
});

// Klick auf den Status-Punkt: Grund anzeigen und sofort neu versuchen
$("#syncStatus").addEventListener("click", () => {
  const s = $("#syncStatus");
  if (s.classList.contains("warn")) toast(s.title + " – versuche es jetzt erneut …", 8000);
  retryDelay = 5000;
  if (dirty) pushNow(); else syncFromNas();
});

// Wieder online (z. B. WireGuard verbunden) → sofort nachholen
window.addEventListener("online", () => { retryDelay = 5000; dirty ? pushNow() : syncFromNas(); });

// Wenn der Tab wieder sichtbar wird: auf Änderungen von anderen Geräten prüfen
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - lastSync > 30000) syncFromNas();
});

// ---------------------------------------------------------------- Einstellungen
function openSettings() {
  const f = $("#settingsForm");
  f.nasUrl.value = nas.url || "";
  f.nasUrlRemote.value = nas.urlRemote || "";
  f.nasPath.value = nas.path || "/SpeedDial";
  f.nasUser.value = nas.user || "";
  f.nasPass.value = nas.pass || "";
  f.tileSize.value = data.settings.tileSize;
  f.columns.value = data.settings.columns;
  f.showTitles.checked = !!data.settings.showTitles;
  f.showAddTile.checked = data.settings.showAddTile !== false;
  f.autoCapture.checked = autoCapture;
  $("#tileSizeVal").textContent = data.settings.tileSize + " px";
  $("#testResult").textContent = "";
  chrome.storage.local.get("lastSyncError").then(({ lastSyncError: le }) => {
    $("#lastError").textContent = le ? `Letzter Sync-Fehler (${le.at}): ${le.text} – ${le.detail}` : "";
  });
  fillGlobalPin();
  $("#settingsDialog").showModal();
}
$("#settingsBtn").addEventListener("click", openSettings);
$("#settingsForm").tileSize.addEventListener("input", (e) => {
  $("#tileSizeVal").textContent = e.target.value + " px";
  document.documentElement.style.setProperty("--tile", e.target.value + "px");
});

function readNasForm() {
  const f = $("#settingsForm");
  return {
    url: normalizeHttp(f.nasUrl.value),
    urlRemote: normalizeHttp(f.nasUrlRemote.value),
    path: f.nasPath.value.trim() || "/SpeedDial",
    user: f.nasUser.value.trim(),
    pass: f.nasPass.value,
  };
}
function normalizeHttp(u) {
  u = cleanBase(u);
  if (u && !/^https?:\/\//i.test(u)) u = "http://" + u;
  return u;
}

// Echter Test: kleine Datei schreiben, wieder lesen, wieder löschen – genau wie beim Speichern.
// Kurzbericht der Server-Antworten, falls etwas schiefgeht (hilft bei der Fehlersuche)
async function diagnose(base, putStatus) {
  const parts = [`PUT ${putStatus}`];
  try {
    const o = await dav(base, "OPTIONS", folderPath() + "/", null, 5000);
    parts.push(`OPTIONS ${o.status}`, `DAV=${o.headers.get("DAV") || "-"}`, `Allow=${o.headers.get("Allow") || "-"}`);
  } catch { parts.push("OPTIONS fehlgeschlagen"); }
  try {
    const p = await fetch(base + folderPath() + "/", {
      method: "PROPFIND", headers: { Authorization: authHeader(), Depth: "0" },
      credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    parts.push(`PROPFIND ${p.status}`);
  } catch { parts.push("PROPFIND fehlgeschlagen"); }
  try {
    const n = await fetch(base + folderPath() + "/", { method: "PROPFIND", headers: { Depth: "0" }, credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(5000) });
    parts.push(`ohne Login ${n.status}`);
  } catch {}
  return parts.join(" · ");
}

async function testBase(base) {
  const probe = folderPath("verbindungstest.txt");
  try {
    let r = await dav(base, "PUT", probe, "ok", 6000);
    if (r.status === 404 || r.status === 409) {
      try { await ensureFolder(base, ""); } catch (e) { return e.message; }
      r = await dav(base, "PUT", probe, "ok", 6000);
    }
    if (r.status === 401) return "Benutzername oder Passwort falsch";
    if (!r.ok) {
      const msg = r.status === 403 ? "Zugriff verweigert – Ordnerrechte bzw. „Erweiterte Freigabeberechtigungen“ prüfen"
        : (r.status === 404 || r.status === 409) ? "Ordner nicht gefunden – Namen prüfen (Groß-/Kleinschreibung)"
        : r.status === 405 ? "Schreiben wird vom NAS abgelehnt"
        : `Fehler ${r.status} beim Schreiben`;
      return `${msg}  [Diagnose: ${await diagnose(base, r.status)}]`;
    }
    const g = await dav(base, "GET", probe, null, 6000);
    await dav(base, "DELETE", probe, null, 6000).catch(() => {});
    return g.ok ? "verbunden ✓ (Lesen und Schreiben klappt)" : `geschrieben, aber Lesen ergibt Fehler ${g.status}`;
  } catch (e) {
    return e.name === "TimeoutError" ? "NAS antwortet nicht" : "nicht erreichbar – IP und Port prüfen";
  }
}

$("#testNasBtn").addEventListener("click", async () => {
  const out = $("#testResult");
  const permP = requestSitePermission();
  const saved = nas;
  nas = readNasForm();
  if (!nasConfigured()) { out.className = "err-text"; out.textContent = "Bitte Adresse und Benutzer eintragen."; nas = saved; return; }
  if (!(await permP)) { out.className = "err-text"; out.textContent = "Ohne Berechtigung kann die Erweiterung das NAS nicht erreichen."; nas = saved; return; }
  out.className = "muted"; out.textContent = "Teste…";
  const results = [];
  for (const [label, base] of [["Zuhause", nas.url], ["Unterwegs", nas.urlRemote]]) {
    if (!base) continue;
    results.push(`${label}: ${await testBase(cleanBase(base))}`);
  }
  nas = saved;
  out.className = results.some((r) => r.includes("✓")) ? "ok-text" : "err-text";
  out.textContent = results.join(" · ");
});

$("#settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const dlg = $("#settingsDialog");
  if (e.submitter?.value !== "ok") { dlg.close(); applyLook(); return; }
  const f = e.target;
  const pinRes = readGlobalPin(f);
  if (pinRes.error) { toast(pinRes.error); return; }
  const newNas = readNasForm();
  const permP = (newNas.url || newNas.urlRemote || f.autoCapture.checked) ? requestSitePermission() : Promise.resolve(true);
  nas = newNas;
  autoCapture = f.autoCapture.checked;
  data.settings.tileSize = +f.tileSize.value;
  data.settings.columns = Math.max(0, +f.columns.value || 0);
  data.settings.showTitles = f.showTitles.checked;
  data.settings.showAddTile = f.showAddTile.checked;
  data.settings.autoLockMin = +f.autoLockMin.value || 0;
  dlg.close();
  await applyGlobalPin(pinRes);
  const granted = await permP;
  await chrome.storage.local.set({ nas, autoCapture });
  workingBase = null;
  await save();
  if (!granted && nasConfigured()) toast("Ohne die Berechtigung kann die Erweiterung dein NAS nicht erreichen.", 6000);
  else if (nasConfigured()) syncFromNas();
});

$("#captureAllBtn").addEventListener("click", async () => {
  if (!(await requestSitePermission())) { toast("Ohne Berechtigung keine Vorschaubilder."); return; }
  const todo = data.groups.flatMap((g) => g.dials).filter((d) => !d.image && !d.thumb);
  if (!todo.length) { toast("Alle Seiten haben schon ein Vorschaubild."); return; }
  $("#settingsDialog").close();
  let n = 0;
  for (const d of todo) {
    n++;
    toast(`Vorschau ${n} von ${todo.length}: ${d.title}`, 0);
    const res = await chrome.runtime.sendMessage({ type: "capture", url: d.url });
    if (res?.ok) { d.thumb = res.thumb; d.thumbAt = Date.now(); }
  }
  toast("Vorschaubilder fertig.");
  save();
});

$("#exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `speeddial-${today()}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$("#importBtn").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported.groups)) throw new Error();
    if (!confirm(`${imported.groups.length} Gruppen importieren? Deine aktuellen Gruppen werden dabei ersetzt.`)) return;
    imported.settings = { ...defaultData().settings, ...(imported.settings || {}) };
    data = imported;
    $("#settingsDialog").close();
    save();
    toast("Import erfolgreich.");
  } catch { toast("Die Datei konnte nicht gelesen werden."); }
});

// ---------------------------------------------------------------- Start
window.addEventListener("DOMContentLoaded", async function init() {
  const stored = await chrome.storage.local.get(["data", "nas", "dirty", "activeGroupId", "autoCapture"]);
  data = stored.data || defaultData();
  data.settings = { ...defaultData().settings, ...(data.settings || {}) };
  nas = stored.nas || {};
  dirty = !!stored.dirty;
  activeGroupId = stored.activeGroupId || null;
  autoCapture = stored.autoCapture !== false;
  if (!stored.data) await chrome.storage.local.set({ data });
  await loadLockSession();
  render();
  showIdleStatus();
  await absorbPendingThumbs();
  syncFromNas();
});
