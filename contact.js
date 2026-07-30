/* Contact / Community Hub — frontend logic.
 * Submits feedback (action:"feedback") to the Supabase `submit` Edge Function
 * defined in /config.js as window.SUPABASE_URL. (P3-5, 2026-07-30: the
 * Apps Script fallback that this used is retired.) */
(function () {
  "use strict";

  /* ---------- Theme toggle (persisted, unified key) ---------- */
  var THEME_KEY = "deputation_theme_v1";
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
  }
  /* The head bootstrap already applied the saved theme; this guard keeps the
   * page in sync if the script runs after some other code mutated the attr. */
  try {
    var savedTheme = localStorage.getItem(THEME_KEY) || "dark";
    applyTheme(savedTheme);
  } catch (e) {}
  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("ctThemeToggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    });
  });

  /* Pre-fill from the site feedback widget's "Tell us more" deep-link (?ref=&tags=) */
  document.addEventListener("DOMContentLoaded", function () {
    try {
      var q = new URLSearchParams(location.search);
      var ref = q.get("ref"); if (!ref) return;
      var tags = q.get("tags") || "";
      var subj = document.getElementById("ctSubject");
      var msg  = document.getElementById("ctMessage");
      var cat  = document.getElementById("ctCategory");
      if (cat && !cat.value) { cat.value = "General Feedback"; cat.dispatchEvent(new Event("change")); }
      if (subj && !subj.value) subj.value = "Feedback on " + ref;
      if (msg && !msg.value) {
        // The page is now captured in the dedicated selector; only fall back to a
        // "Page:" line in the message when ref doesn't match a known page.
        var parts = [];
        if (!findPageMatch(ref)) parts.push("Page: " + ref);
        if (tags) parts.push("What could be better: " + tags);
        msg.value = parts.length ? parts.join("\n") + "\n\n" : "";
      }
      var card = document.getElementById("ctFormCard");
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
      if (msg) setTimeout(function () { msg.focus(); }, 450);
    } catch (e) {}
  });

  // P3-5 (2026-07-30): removed the Apps Script fallback. The Supabase
  // `submit` Edge Function is the only form backend. If SUPABASE_READY
  // is false, the form shows "endpoint not configured" instead of
  // silently falling back to a stale Google backend.
  var SB_READY = (typeof window !== "undefined" && window.SUPABASE_READY && window.SUPABASE_READY());
  var API_URL = SB_READY
    ? (window.SUPABASE_URL + "/functions/v1/submit")
    : "";
  var SB_ANON = (typeof window !== "undefined" && window.SUPABASE_ANON_KEY) || "";

  var $  = function (s, root) { return (root || document).querySelector(s); };

  var form        = $("#ctForm");
  var formCard    = $("#ctFormCard");
  var success     = $("#ctSuccess");
  var toastEl     = $("#ctToast");
  var fillBar     = $("#ctProgressFill");
  var restEl      = $("#ctRest");
  var subEl        = document.querySelector(".ct-subscribe");
  var communityCol = document.querySelector(".ct-community");

  /* ---------- Category-driven smart helper text ---------- */
  var HINTS = {
    "General Feedback":     "Tell us what's on your mind — we read every message.",
    "Report a Bug":         "Please mention the page, your device, browser, and what went wrong.",
    "Suggest a Feature":    "What problem would this feature solve for you? Examples help us prioritise.",
    "Vacancy Correction":   "Please include the vacancy title, organisation, and the correct official source link if available.",
    "Policy Clarification": "We will get back if we can. For faster peer discussion, you may also join the WhatsApp Group above.",
    "WhatsApp Group Issue": "Tell us what happened — spam, harassment, joining problems — and we will look into it.",
    "Other":                "Tell us what we should know — keep it brief and specific.",
    "New Rule/Circular":    "Share the OM number, subject line, date, and a link to the official source (DoPT / GoI website) so we can review and add it."
  };

  /* Categories where naming a page (or "Whole site") is mandatory. */
  var PAGE_REQUIRED = { "Report a Bug": 1, "Vacancy Correction": 1, "Policy Clarification": 1, "New Rule/Circular": 1 };
  /* Page preselected per category when the user hasn't chosen one.
   * "Report a Bug" is intentionally absent so the reporter must name the page. */
  var CATEGORY_DEFAULT_PAGE = {
    "General Feedback":     "__SITE__",
    "Suggest a Feature":    "__SITE__",
    "WhatsApp Group Issue": "__SITE__",
    "Other":                "__SITE__",
    "Vacancy Correction":   "/report-vacancy.html",
    "New Rule/Circular":    "/rules.html",
    "Policy Clarification": "/Rules/faq.html"
  };
  var categoryEl = $("#ctCategory");
  var hintEl     = $("#ctHint");
  function applyHint() {
    var v = categoryEl.value;
    if (!v) {
      hintEl.textContent = "Choose a category to get started.";
      hintEl.classList.remove("is-active");
      return;
    }
    hintEl.textContent = HINTS[v] || HINTS["General Feedback"];
    hintEl.classList.toggle("is-active", v !== "General Feedback");
  }
  /* Progressive disclosure: the rest of the form (#ctRest) appears only after a
     real category is chosen. */
  function toggleRest() {
    var expanded = !!categoryEl.value;
    if (restEl) restEl.hidden = !expanded;
    placeSubscribe(expanded);
  }
  /* Employment News card: while the feedback form is collapsed it fills the
     short right column (just below the feedback card); once the form expands it
     returns to the bottom of the left community column where it normally lives. */
  function placeSubscribe(expanded) {
    if (!subEl) return;
    if (expanded) {
      if (communityCol && subEl.parentNode !== communityCol) communityCol.appendChild(subEl);
    } else if (formCard && formCard.nextElementSibling !== subEl) {
      formCard.parentNode.insertBefore(subEl, formCard.nextSibling);
    }
  }
  categoryEl.addEventListener("change", applyHint);
  applyHint();

  /* Pre-select category from URL param e.g. contact.html?category=New+Rule%2FCircular */
  (function () {
    try {
      var cat = new URLSearchParams(window.location.search).get("category");
      if (cat) {
        for (var i = 0; i < categoryEl.options.length; i++) {
          if (categoryEl.options[i].value === cat) {
            categoryEl.selectedIndex = i;
            applyHint();
            break;
          }
        }
      }
    } catch (e) {}
  }());

  /* ---------- Page / section cascading dropdowns (Add context) ---------- */
  var PAGES = [
    { value: "__SITE__",               label: "Whole site / Not page-specific",
      sections: [] },
    { value: "/index.html",            label: "Home",
      sections: [] },
    { value: "/rules.html",            label: "Rules — Deputation Rules Hub",
      sections: [
        "Search",
        "Topic Summary",
        "Essential Rules",
        "Chronology / Timeline",
        "Relationship Map",
        "Official PDF Library"
      ] },
    { value: "/Rules/faq.html",        label: "FAQs",
      sections: [
        "Understanding deputation (Basics)",
        "Eligibility & clearances",
        "Tenure & repatriation",
        "Pay & pay fixation",
        "Deputation (duty) allowance",
        "Leave, pension & benefits",
        "Special categories",
        "Procedural & miscellaneous",
        "Community-reported discrepancies"
      ] },
    { value: "/defex.html",            label: "DeFeX — Deputation Friendliness Index",
      sections: [] },
    { value: "/report-vacancy.html",   label: "Report a Vacancy",
      sections: [
        "Submit Link tab",
        "Upload PDF tab",
        "Manual Details tab",
        "Additional details section",
        "Preview / submission flow"
      ] },
    { value: "/contact.html",          label: "Contact / Community (this page)",
      sections: [
        "WhatsApp Channel card",
        "WhatsApp Group card",
        "Channel vs Group comparison",
        "Community Guidelines",
        "Feedback form",
        "Quick-route tiles"
      ] },
    { value: "/my-deputation.html",    label: "My Deputation",
      sections: [] }
  ];
  var pageSel    = $("#ctRelatedPage");
  var sectionSel = $("#ctRelatedSection");
  var sectionWrap = $("#ctSectionField");

  // Build page dropdown
  PAGES.forEach(function (p) {
    var opt = document.createElement("option");
    opt.value = p.value;
    opt.textContent = p.label;
    pageSel.appendChild(opt);
  });

  function rebuildSections() {
    var pg = PAGES.find(function (p) { return p.value === pageSel.value; });
    sectionSel.innerHTML = '<option value="">— select a section —</option>';
    if (pg && pg.sections && pg.sections.length) {
      pg.sections.forEach(function (s) {
        var o = document.createElement("option");
        o.value = s; o.textContent = s;
        sectionSel.appendChild(o);
      });
      sectionWrap.hidden = false;
    } else {
      sectionWrap.hidden = true;
    }
  }
  pageSel.addEventListener("change", rebuildSections);
  rebuildSections();

  /* ---------- "Which page is this about?" — defaults, required, prefill ---------- */
  // Track whether the current page value was set by us (a default) or chosen by
  // the user. A deliberate choice is preserved across category switches; an
  // auto-set value is replaced by the new category's default — which keeps
  // "Whole site" from sticking onto a later "Report a Bug" (that must name a page).
  var pageAutoSet = false;
  function setPage(value, auto) {
    pageSel.value = value || "";
    pageAutoSet = !!auto;
    rebuildSections();
  }
  function applyCategoryDefault() {
    if (!pageAutoSet && pageSel.value !== "") return;   // keep a deliberate choice
    setPage(CATEGORY_DEFAULT_PAGE[categoryEl.value] || "", true);
  }
  pageSel.addEventListener("change", function () { pageAutoSet = false; });
  categoryEl.addEventListener("change", function () { toggleRest(); applyCategoryDefault(); updateProgress(); });

  // Normalise a path/URL for matching: drop scheme/host, "index", ".html",
  // trailing slashes and case. The on-site feedback widget emits ?ref= paths
  // WITHOUT ".html" (e.g. /rules), while PAGES values HAVE it — normalise both.
  function normPath(s) {
    try {
      var p = s;
      if (/^https?:/i.test(p)) p = new URL(p).pathname;
      p = p.replace(/index\.html$/i, "").replace(/\.html$/i, "").replace(/\/+$/, "").toLowerCase();
      return p === "" ? "/" : p;
    } catch (e) { return ""; }
  }
  function findPageMatch(raw) {
    if (!raw) return "";
    var w = normPath(raw);
    for (var i = 0; i < PAGES.length; i++) {
      if (PAGES[i].value === "__SITE__") continue;
      if (normPath(PAGES[i].value) === w) return PAGES[i].value;
    }
    return "";
  }
  (function initPageField() {
    var qp = new URLSearchParams(location.search);
    var hit = findPageMatch(qp.get("page") || qp.get("ref")) || findPageMatch(document.referrer);
    if (hit) setPage(hit, false);     // a referred page is treated as a deliberate choice
    else applyCategoryDefault();
  }());

  /* ---------- Validation ---------- */
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
  function val(id) { var el = document.getElementById(id); return (el && el.value || "").trim(); }
  function setErr(inputId, msg) {
    var input = document.getElementById(inputId);
    var err = document.getElementById(inputId + "Err");
    if (err) err.textContent = msg || "";
    if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
  }
  function clearErrors() {
    ["ctSubject","ctMessage","ctEmail","ctConfirm","ctRelatedPage","ctCategory"].forEach(function (id) { setErr(id, ""); });
    $("#ctFormErr").textContent = "";
  }

  function validate() {
    clearErrors();
    if (!val("ctCategory")) {
      setErr("ctCategory", "Please select a category to continue.");
      return false;
    }
    var ok = true;
    if (!val("ctSubject"))                  { setErr("ctSubject", "Please add a short subject."); ok = false; }
    if (val("ctMessage").length < 8)        { setErr("ctMessage", "Please write a bit more so we can act on it."); ok = false; }
    var email = val("ctEmail");
    if (email && !isEmail(email))           { setErr("ctEmail",   "Enter a valid email, or leave it blank."); ok = false; }
    var cat = val("ctCategory");
    if (PAGE_REQUIRED[cat] && !val("ctRelatedPage")) {
      setErr("ctRelatedPage", "Please choose which page this is about (or “Whole site”).");
      ok = false;
    }
    if (!document.getElementById("ctConfirm").checked) {
      setErr("ctConfirm", "Please tick the confirmation box.");
      ok = false;
    }
    return ok;
  }

  /* ---------- Progress ---------- */
  function updateProgress() {
    var cat = categoryEl.value;
    var required = ["ctCategory", "ctSubject", "ctMessage", "ctConfirm"];
    if (cat && PAGE_REQUIRED[cat]) required.unshift("ctRelatedPage");
    var filled = required.filter(function (id) {
      if (id === "ctConfirm") return !!document.getElementById("ctConfirm").checked;
      return val(id).length > 0;
    }).length;
    fillBar.style.width = Math.round((filled / required.length) * 100) + "%";
  }

  form.addEventListener("input", function (e) {
    if (e.target.matches("input, textarea, select")) {
      if (e.target.id) setErr(e.target.id, "");
      updateProgress();
    }
  });
  $("#ctConfirm").addEventListener("change", function () {
    setErr("ctConfirm", "");
    updateProgress();
  });

  /* ---------- Submit ---------- */
  function buildPayload() {
    var pageVal = val("ctRelatedPage");
    var pageObj = PAGES.find(function (p) { return p.value === pageVal; }) || {};
    var isSite  = (pageVal === "__SITE__");
    var pageDisplay = isSite ? "Whole site" : pageVal;
    return {
      action: "feedback",
      category:     val("ctCategory") || "General Feedback",
      subject:      val("ctSubject"),
      message:      val("ctMessage"),
      name:         val("ctName"),
      email:        val("ctEmail"),
      page:         isSite ? "" : pageVal,                          // discrete machine value ("" = whole-site/unspecified)
      pageLabel:    isSite ? "Whole site" : (pageObj.label || ""),  // human label
      relatedPage:  pageDisplay + (val("ctRelatedSection") ? "  §  " + val("ctRelatedSection") : ""),
      relatedLink:  val("ctRelatedLink"),
      pageContext:  document.referrer || location.pathname,
      userAgent:    navigator.userAgent || "",
      website:      val("ctWebsite") // honeypot
    };
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validate()) {
      var firstErr = form.querySelector('[aria-invalid="true"]');
      if (firstErr && firstErr.focus) firstErr.focus();
      return;
    }
    submitNow();
  });

  function submitNow() {
    var btn   = $("#ctSubmitBtn");
    var label = $("#ctSubmitLabel");
    var spin  = $("#ctSubmitSpin");
    var formErr = $("#ctFormErr");
    formErr.textContent = "";

    if (!API_URL || API_URL.indexOf("https://") !== 0) {
      formErr.textContent = "Feedback endpoint is not configured. Please contact the site administrator directly.";
      return;
    }

    btn.disabled = true;
    label.textContent = "Sending…";
    spin.hidden = false;

    var headers = SB_READY
      ? { "Content-Type": "application/json", "apikey": SB_ANON, "Authorization": "Bearer " + SB_ANON }
      : { "Content-Type": "application/json" };
    fetch(API_URL, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(buildPayload())
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res || (!res.ok && !res.success)) {
          throw new Error((res && (res.error || res.message)) || "Server error");
        }
        showSuccess(res.feedbackId || res.reportId || "FB-PENDING");
      })
      .catch(function (err) {
        formErr.textContent = (err && err.message) || "Could not send right now. Please try again.";
        btn.disabled = false;
        label.textContent = "Send feedback";
        spin.hidden = true;
      });
  }

  function showSuccess(id) {
    $("#ctFeedbackId").textContent = id;
    // Reset the submit button visuals BEFORE hiding the form, so the next
    // time the form is shown the button isn't stuck in "Sending…" state.
    var btn   = $("#ctSubmitBtn");
    var label = $("#ctSubmitLabel");
    var spin  = $("#ctSubmitSpin");
    if (btn)   btn.disabled = false;
    if (label) label.textContent = "Send feedback";
    if (spin)  spin.hidden = true;
    form.hidden = true;
    success.hidden = false;
    // Hide the response-expect note + progress bar (they belong with the form)
    var expect = formCard.querySelector(".ct-expect"); if (expect) expect.hidden = true;
    var progress = formCard.querySelector(".ct-progress"); if (progress) progress.hidden = true;
  }

  $("#ctSendAnother").addEventListener("click", function () {
    form.reset();
    success.hidden = true;
    form.hidden = false;
    var expect = formCard.querySelector(".ct-expect"); if (expect) expect.hidden = false;
    var progress = formCard.querySelector(".ct-progress"); if (progress) progress.hidden = false;
    clearErrors();
    applyHint();
    toggleRest();
    applyCategoryDefault();
    updateProgress();
    var btn   = $("#ctSubmitBtn");
    var label = $("#ctSubmitLabel");
    var spin  = $("#ctSubmitSpin");
    btn.disabled = false;
    label.textContent = "Send feedback";
    spin.hidden = true;
  });

  $("#ctReset").addEventListener("click", function () {
    setTimeout(function () { applyHint(); toggleRest(); applyCategoryDefault(); updateProgress(); clearErrors(); }, 0);
    toast("Form cleared.");
  });

  /* ---------- Toast ---------- */
  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2000);
  }

  /* ---------- Init ---------- */
  toggleRest();
  updateProgress();
})();
