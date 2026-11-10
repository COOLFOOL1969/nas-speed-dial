// NAS Speed Dial – PIN-Sperre für den ganzen Speed Dial
//
// Die PIN wird nie im Klartext gespeichert, sondern nur ein Prüfwert (PBKDF2/SHA-256 mit Salz).
// "Entsperrt" merkt sich Chrome nur im Arbeitsspeicher (chrome.storage.session):
// Nach dem Schließen von Chrome, per rotem Knopf oder nach der Auto-Sperrzeit ist wieder gesperrt.
// Hinweis: Das ist ein Sichtschutz, keine Verschlüsselung der Links.

const PIN_ITERATIONS = 150000;
let unlockedGlobal = false;
let lastActive = Date.now();

// ---------------------------------------------------------------- PIN prüfen
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pinHash(pin, saltBytes) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations: PIN_ITERATIONS, hash: "SHA-256" }, key, 256);
  return toB64(bits);
}
async function makeLock(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toB64(salt), hash: await pinHash(pin, salt), len: pin.length };
}
async function checkPin(lock, pin) {
  return (await pinHash(pin, fromB64(lock.salt))) === lock.hash;
}

// ---------------------------------------------------------------- Zustand
function isGlobalLocked() { return !!data?.lock && !unlockedGlobal; }

async function loadLockSession() {
  try {
    const s = await chrome.storage.session.get(["unlockedGlobal", "lastActive"]);
    unlockedGlobal = !!s.unlockedGlobal;
    lastActive = s.lastActive || Date.now();
  } catch {}
  checkAutoLock();
}
function persistLockSession() {
  try { chrome.storage.session.set({ unlockedGlobal, lastActive }); } catch {}
}

function closeAllDialogs() { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); }

// Roter Knopf: sofort sperren (auch in allen anderen offenen Tabs)
function lockAll() {
  unlockedGlobal = false;
  persistLockSession();
  closeAllDialogs();
  render();
}

function checkAutoLock() {
  const min = data?.settings?.autoLockMin || 0;
  if (min > 0 && unlockedGlobal && Date.now() - lastActive > min * 60000) {
    unlockedGlobal = false;
    persistLockSession();
    return true;
  }
  return false;
}
setInterval(() => { if (checkAutoLock()) { closeAllDialogs(); render(); } }, 20000);

for (const ev of ["pointerdown", "keydown"]) {
  document.addEventListener(ev, () => {
    if (Date.now() - lastActive > 15000) { lastActive = Date.now(); persistLockSession(); }
  }, true);
}

// Entsperren/Sperren in einem anderen Tab übernehmen
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  if (changes.lastActive) lastActive = changes.lastActive.newValue || lastActive;
  if (changes.unlockedGlobal && !!changes.unlockedGlobal.newValue !== unlockedGlobal) {
    unlockedGlobal = !!changes.unlockedGlobal.newValue;
    if (!unlockedGlobal && data?.lock) closeAllDialogs();
    render();
  }
});

// ---------------------------------------------------------------- Anzeige
function updateLockUI() {
  $("#lockBtn").hidden = !data?.lock;
  const locked = isGlobalLocked();
  document.body.classList.toggle("locked", locked);
  if (locked && !pad) askGlobalPin();
  else if (!locked && pad) closePinPad(true);
}

function askGlobalPin() {
  return promptPin({
    len: data.lock.len,
    verify: (pin) => checkPin(data.lock, pin),
  }).then((ok) => {
    if (ok) { unlockedGlobal = true; lastActive = Date.now(); persistLockSession(); render(); }
    return ok;
  });
}

// ---------------------------------------------------------------- PIN-Eingabe (Ziffernblock)
let pad = null;
let failedAttempts = 0;
let lockoutUntil = 0;

function promptPin(opts) {
  return new Promise((resolve) => {
    pad = { ...opts, entered: "", resolve, mode: "pin" };
    $("#lockMsg").textContent = "";
    $("#forgotBox").hidden = true;
    $("#pinArea").hidden = false;
    $("#forgotPin").hidden = false;
    $("#lockScreen").hidden = false;
    drawDots();
  });
}

function closePinPad(result) {
  if (!pad) return;
  const p = pad;
  pad = null;
  $("#lockScreen").hidden = true;
  p.resolve(result);
}

function drawDots() {
  const box = $("#pinDots");
  box.replaceChildren();
  for (let i = 0; i < pad.len; i++) box.append(el("span", { class: i < pad.entered.length ? "on" : "" }));
}

function pinKey(k) {
  if (!pad || pad.mode !== "pin") return;
  if (Date.now() < lockoutUntil) return showLockout();
  if (k === "del") pad.entered = pad.entered.slice(0, -1);
  else if (/^\d$/.test(k) && pad.entered.length < pad.len) pad.entered += k;
  drawDots();
  if (pad.entered.length === pad.len) submitPin();
}

async function submitPin() {
  const p = pad;
  $("#lockMsg").textContent = "";
  const ok = await p.verify(p.entered);
  if (pad !== p) return;
  if (ok) { failedAttempts = 0; closePinPad(true); return; }
  failedAttempts++;
  p.entered = "";
  const dots = $("#pinDots");
  dots.classList.remove("shake"); void dots.offsetWidth; dots.classList.add("shake");
  drawDots();
  if (failedAttempts >= 5) { lockoutUntil = Date.now() + 30000; failedAttempts = 0; showLockout(); }
  else $("#lockMsg").textContent = "Falsche PIN";
}

function showLockout() {
  const tick = () => {
    const s = Math.ceil((lockoutUntil - Date.now()) / 1000);
    if (s <= 0 || !pad) { if (pad) $("#lockMsg").textContent = ""; return; }
    $("#lockMsg").textContent = `Zu viele Fehlversuche – bitte ${s} s warten`;
    setTimeout(tick, 500);
  };
  tick();
}

// Ziffernblock-Knöpfe und Tastatur
document.querySelectorAll("#pinpad button").forEach((b) => b.addEventListener("click", () => pinKey(b.dataset.k)));
document.addEventListener("keydown", (e) => {
  if (!pad) return;
  if (pad.mode === "forgot") { if (e.key === "Escape") backToPin(); return; }
  if (/^\d$/.test(e.key)) { pinKey(e.key); e.preventDefault(); }
  else if (e.key === "Backspace") { pinKey("del"); e.preventDefault(); }
});

// PIN vergessen → mit dem NAS-Passwort zurücksetzen
$("#forgotPin").addEventListener("click", () => {
  if (!pad) return;
  pad.mode = "forgot";
  $("#pinArea").hidden = true;
  $("#forgotPin").hidden = true;
  $("#forgotBox").hidden = false;
  $("#lockMsg").textContent = "";
  $("#forgotPass").value = "";
  $("#forgotHint").textContent = nas?.pass
    ? "Gib das Passwort deines NAS-Benutzers ein (aus den Einstellungen). Die PIN wird dann entfernt."
    : "Zurücksetzen ist nur möglich, wenn das NAS in den Einstellungen eingerichtet ist.";
  $("#forgotPass").focus();
});
function backToPin() {
  if (!pad) return;
  pad.mode = "pin";
  $("#forgotBox").hidden = true;
  $("#pinArea").hidden = false;
  $("#forgotPin").hidden = false;
}
$("#forgotBack").addEventListener("click", backToPin);
$("#forgotForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!pad) return;
  if (nas?.pass && $("#forgotPass").value === nas.pass) {
    delete data.lock;
    unlockedGlobal = true;
    persistLockSession();
    save();
    closePinPad(true);
    toast("Die PIN wurde entfernt. Eine neue kannst du jederzeit unter ⚙ vergeben.", 6000);
  } else {
    $("#lockMsg").textContent = "Das Passwort stimmt nicht.";
  }
});

$("#lockBtn").addEventListener("click", lockAll);

// ---------------------------------------------------------------- PIN-Felder in den Einstellungen
const pinForm = $("#settingsForm");
const syncPinFields = () => ($("#globalPinFields").hidden = !pinForm.globalPinOn.checked);
pinForm.globalPinOn.addEventListener("change", syncPinFields);

function fillGlobalPin() {
  pinForm.globalPinOn.checked = !!data.lock;
  pinForm.globalPin1.value = "";
  pinForm.globalPin2.value = "";
  $("#globalPinHint").textContent = data.lock ? "Leer lassen, um die bisherige PIN zu behalten." : "4 bis 6 Ziffern";
  pinForm.autoLockMin.value = String(data.settings.autoLockMin || 0);
  syncPinFields();
}

// Liefert, was mit der PIN passieren soll – oder eine Fehlermeldung
function readGlobalPin(form) {
  const on = form.globalPinOn.checked, p1 = form.globalPin1.value, p2 = form.globalPin2.value, has = !!data.lock;
  if (!on) return { action: has ? "remove" : "none" };
  if (!p1 && !p2) return has ? { action: "keep" } : { error: "Bitte eine PIN mit 4–6 Ziffern eingeben." };
  if (!/^\d{4,6}$/.test(p1)) return { error: "Die PIN muss aus 4 bis 6 Ziffern bestehen." };
  if (p1 !== p2) return { error: "Die beiden PINs stimmen nicht überein." };
  return { action: "set", pin: p1 };
}

async function applyGlobalPin(res) {
  if (res.action === "set") { data.lock = await makeLock(res.pin); unlockedGlobal = true; persistLockSession(); }
  else if (res.action === "remove") delete data.lock;
}
