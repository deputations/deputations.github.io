/* Web Push vacancy alerts — opt-in client (WEBSITE-REVIEW P1-3).
 * Injects a bell button into the header; a small modal lets an officer enable
 * alerts and pick their pay level (prefilled from dep_profile_v1). No account,
 * no email. Works where Push is supported AND the service worker is registered
 * (production; iOS after Add-to-Home-Screen). Everything else shows a hint.
 * Self-contained: injects its own styles, so no shared CSS is touched. */
(function () {
  "use strict";

  var SUPPORTED = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  var SB_URL = (window.SUPABASE_URL || "").replace(/\/+$/, "");
  var FN = SB_URL + "/functions/v1/push-subscribe";
  var HEAD = {
    "Content-Type": "application/json",
    apikey: window.SUPABASE_ANON_KEY || "",
    Authorization: "Bearer " + (window.SUPABASE_ANON_KEY || ""),
  };

  function ready() { return typeof window.PUSH_READY === "function" && window.PUSH_READY(); }

  function b64ToU8(base64) {
    var pad = "=".repeat((4 - (base64.length % 4)) % 4);
    var s = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(s), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function profileLevel() {
    try { return String((JSON.parse(localStorage.getItem("dep_profile_v1") || "{}").payLevel) || "").trim(); }
    catch (e) { return ""; }
  }

  function injectCSS() {
    if (document.getElementById("push-css")) return;
    var s = document.createElement("style");
    s.id = "push-css";
    s.textContent =
      ".push-modal{position:fixed;inset:0;z-index:3600;display:none;align-items:center;justify-content:center;" +
        "padding:16px;background:rgba(2,6,23,.6);-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}" +
      ".push-modal.open{display:flex}" +
      ".push-modal .pm-card{position:relative;width:min(420px,100%);border-radius:20px;padding:20px 20px 18px;" +
        "background:var(--bg-surface,#0f172a);color:var(--text-primary,#f8fafc);border:1px solid var(--border-color,rgba(148,163,184,.2));" +
        "box-shadow:0 24px 60px -18px rgba(0,0,0,.6)}" +
      "html[data-theme='light'] .push-modal .pm-card{background:#fff;color:#0f172a}" +
      ".push-modal .pm-x{position:absolute;top:10px;right:12px;width:34px;height:34px;border-radius:10px;border:1px solid var(--border-color,rgba(148,163,184,.2));" +
        "background:transparent;color:inherit;font-size:1.15rem;cursor:pointer}" +
      ".push-modal .pm-hd{display:flex;gap:12px;align-items:flex-start;margin-bottom:14px}" +
      ".push-modal .pm-ic{font-size:1.5rem;line-height:1}" +
      ".push-modal h3{margin:0 0 3px;font-size:1.1rem}" +
      ".push-modal .pm-sub{margin:0;font-size:.86rem;opacity:.75;line-height:1.45}" +
      ".push-modal .pm-lbl{display:block;font-size:.78rem;font-weight:700;opacity:.8;margin:0 0 5px}" +
      ".push-modal .pm-sel{width:100%;min-height:44px;padding:.55rem .7rem;border-radius:12px;font:inherit;" +
        "color:inherit;background:var(--bg-elevated,rgba(148,163,184,.1));border:1px solid var(--border-color,rgba(148,163,184,.28))}" +
      ".push-modal .pm-status{margin:.7rem 0 0;font-size:.85rem;min-height:1.1em}" +
      ".push-modal .pm-status.ok{color:var(--success-color,#34d399)}" +
      ".push-modal .pm-status.err{color:var(--danger-color,#f87171)}" +
      ".push-modal .pm-hint{margin:.5rem 0 0;font-size:.82rem;opacity:.7;line-height:1.45}" +
      ".push-modal .pm-actions{display:flex;gap:10px;margin-top:1rem}" +
      ".push-modal .pm-enable,.push-modal .pm-off{flex:1;min-height:46px;border-radius:12px;font:inherit;font-weight:700;cursor:pointer;border:0}" +
      ".push-modal .pm-enable{background:linear-gradient(135deg,#22d3ee,#a78bfa);color:#04111c}" +
      ".push-modal .pm-enable[disabled]{opacity:.6;cursor:progress}" +
      ".push-modal .pm-off{background:transparent;color:inherit;border:1px solid var(--border-color,rgba(148,163,184,.3))}";
    document.head.appendChild(s);
  }

  var modal, statusEl, levelSel, enableBtn, offBtn, hintEl;

  function buildModal() {
    if (modal) return;
    injectCSS();
    modal = document.createElement("div");
    modal.className = "push-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Vacancy alerts");
    modal.innerHTML =
      "<div class='pm-card'>" +
        "<button class='pm-x' aria-label='Close'>×</button>" +
        "<div class='pm-hd'><span class='pm-ic' aria-hidden='true'>🔔</span>" +
          "<div><h3>Vacancy alerts</h3>" +
          "<p class='pm-sub'>Get a notification when a new vacancy matches your level — no account, no email.</p></div></div>" +
        "<div class='pm-bd'>" +
          "<label class='pm-lbl' for='pmLevel'>Your pay level</label>" +
          "<select id='pmLevel' class='pm-sel'></select>" +
          "<p class='pm-status' role='status' aria-live='polite'></p>" +
          "<p class='pm-hint'></p>" +
          "<div class='pm-actions'>" +
            "<button type='button' class='pm-enable'>Enable alerts</button>" +
            "<button type='button' class='pm-off' hidden>Turn off</button>" +
          "</div>" +
        "</div>" +
      "</div>";
    document.body.appendChild(modal);
    statusEl = modal.querySelector(".pm-status");
    hintEl = modal.querySelector(".pm-hint");
    levelSel = modal.querySelector("#pmLevel");
    enableBtn = modal.querySelector(".pm-enable");
    offBtn = modal.querySelector(".pm-off");

    var opts = ["<option value=''>Any level</option>"];
    for (var l = 6; l <= 15; l++) opts.push("<option value='" + l + "'>Level " + l + "</option>");
    levelSel.innerHTML = opts.join("");
    var pref = profileLevel(); if (pref) levelSel.value = pref;

    modal.querySelector(".pm-x").addEventListener("click", close);
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
    document.addEventListener("keydown", function (e) { if (modal.classList.contains("open") && e.key === "Escape") close(); });
    enableBtn.addEventListener("click", enable);
    offBtn.addEventListener("click", disable);
  }

  function open() { modal.classList.add("open"); }
  function close() { if (modal) modal.classList.remove("open"); }
  function setStatus(msg, kind) { statusEl.textContent = msg || ""; statusEl.className = "pm-status" + (kind ? " " + kind : ""); }
  function getReg() { return navigator.serviceWorker.getRegistration(); }
  function getSub() { return getReg().then(function (r) { return r ? r.pushManager.getSubscription() : null; }).catch(function () { return null; }); }

  function post(payload) {
    return fetch(FN, { method: "POST", headers: HEAD, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); });
  }

  function openModal() {
    buildModal();
    open();
    hintEl.textContent = "";
    if (!SUPPORTED) {
      setStatus(""); enableBtn.hidden = true; offBtn.hidden = true;
      hintEl.textContent = "Your browser doesn't support notifications. On iPhone: Share → Add to Home Screen, then open the app.";
      return;
    }
    getReg().then(function (reg) {
      if (!reg) {   // SW not registered (localhost / not-yet-visited on prod)
        setStatus(""); enableBtn.hidden = true; offBtn.hidden = true;
        hintEl.textContent = "Alerts run on the live site. Open alldeputations.com (and on iPhone, add it to your Home Screen first).";
        return;
      }
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub) { setStatus("Alerts are ON for this device.", "ok"); enableBtn.hidden = true; offBtn.hidden = false; }
        else { setStatus(""); enableBtn.hidden = false; enableBtn.disabled = false; offBtn.hidden = true; }
      });
    });
  }

  function enable() {
    enableBtn.disabled = true; setStatus("Requesting permission…");
    Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") { setStatus("Permission denied. Enable it in your browser settings to get alerts.", "err"); enableBtn.disabled = false; return; }
      return getReg().then(function (reg) {
        return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(window.VAPID_PUBLIC_KEY) });
      }).then(function (sub) {
        return post({ action: "subscribe", subscription: sub.toJSON(), payLevel: levelSel.value, ministries: [], userAgent: navigator.userAgent });
      }).then(function (d) {
        if (d && (d.ok || d.success)) { setStatus("Done — alerts are ON for this device.", "ok"); enableBtn.hidden = true; offBtn.hidden = false; }
        else { setStatus((d && d.message) || "Couldn't save your subscription.", "err"); enableBtn.disabled = false; }
      });
    }).catch(function (e) { setStatus("Couldn't enable alerts. " + (e && e.message ? e.message : ""), "err"); enableBtn.disabled = false; });
  }

  function disable() {
    offBtn.disabled = true; setStatus("Turning off…");
    getSub().then(function (sub) {
      var endpoint = sub && sub.endpoint;
      return (sub ? sub.unsubscribe() : Promise.resolve()).then(function () {
        return endpoint ? post({ action: "unsubscribe", subscription: { endpoint: endpoint } }) : null;
      });
    }).then(function () {
      setStatus("Alerts turned off.", ""); offBtn.hidden = true; offBtn.disabled = false; enableBtn.hidden = false; enableBtn.disabled = false;
    }).catch(function () { setStatus("Couldn't turn off. Try again.", "err"); offBtn.disabled = false; });
  }

  function injectButton() {
    var actions = document.querySelector(".header-actions");
    if (!actions || document.getElementById("pushBtn")) return;
    var btn = document.createElement("button");
    btn.id = "pushBtn"; btn.type = "button"; btn.className = "icon-btn";
    btn.title = "Vacancy alerts"; btn.setAttribute("aria-label", "Vacancy alerts");
    btn.innerHTML = "<svg class='icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9'/><path d='M10.3 21a1.94 1.94 0 0 0 3.4 0'/></svg>";
    actions.insertBefore(btn, actions.firstChild);
    btn.addEventListener("click", openModal);
  }

  function init() { if (!ready()) return; injectButton(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
