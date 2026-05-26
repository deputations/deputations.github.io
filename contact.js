/* Contact / Community Hub — frontend logic.
 * Submits feedback (action:"feedback") to the shared Apps Script endpoint
 * defined in /config.js as window.DEPUTATIONS_API. */
(function () {
  "use strict";

  var API_URL = (typeof window !== "undefined" && window.DEPUTATIONS_API) || "";

  var $  = function (s, root) { return (root || document).querySelector(s); };

  var form        = $("#ctForm");
  var formCard    = $("#ctFormCard");
  var success     = $("#ctSuccess");
  var toastEl     = $("#ctToast");
  var fillBar     = $("#ctProgressFill");

  /* ---------- Category-driven smart helper text ---------- */
  var HINTS = {
    "General Feedback":     "Tell us what's on your mind — we read every message.",
    "Report a Bug":         "Please mention the page, your device, browser, and what went wrong.",
    "Suggest a Feature":    "What problem would this feature solve for you? Examples help us prioritise.",
    "Vacancy Correction":   "Please include the vacancy title, organisation, and the correct official source link if available.",
    "Policy Clarification": "We will get back if we can. For faster peer discussion, you may also join the WhatsApp Group above.",
    "WhatsApp Group Issue": "Tell us what happened — spam, harassment, joining problems — and we will look into it.",
    "Other":                "Tell us what we should know — keep it brief and specific."
  };
  var categoryEl = $("#ctCategory");
  var hintEl     = $("#ctHint");
  function applyHint() {
    var v = categoryEl.value || "General Feedback";
    hintEl.textContent = HINTS[v] || HINTS["General Feedback"];
    hintEl.classList.toggle("is-active", v !== "General Feedback");
  }
  categoryEl.addEventListener("change", applyHint);
  applyHint();

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
    ["ctSubject","ctMessage","ctEmail","ctConfirm"].forEach(function (id) { setErr(id, ""); });
    $("#ctFormErr").textContent = "";
  }

  function validate() {
    clearErrors();
    var ok = true;
    if (!val("ctSubject"))                  { setErr("ctSubject", "Please add a short subject."); ok = false; }
    if (val("ctMessage").length < 8)        { setErr("ctMessage", "Please write a bit more so we can act on it."); ok = false; }
    var email = val("ctEmail");
    if (email && !isEmail(email))           { setErr("ctEmail",   "Enter a valid email, or leave it blank."); ok = false; }
    if (!document.getElementById("ctConfirm").checked) {
      setErr("ctConfirm", "Please tick the confirmation box.");
      ok = false;
    }
    return ok;
  }

  /* ---------- Progress ---------- */
  function updateProgress() {
    var required = ["ctSubject", "ctMessage", "ctConfirm"];
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
    return {
      action: "feedback",
      category:     val("ctCategory") || "General Feedback",
      subject:      val("ctSubject"),
      message:      val("ctMessage"),
      name:         val("ctName"),
      email:        val("ctEmail"),
      relatedPage:  val("ctRelatedPage"),
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

    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
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
    updateProgress();
    var btn   = $("#ctSubmitBtn");
    var label = $("#ctSubmitLabel");
    var spin  = $("#ctSubmitSpin");
    btn.disabled = false;
    label.textContent = "Send feedback";
    spin.hidden = true;
  });

  $("#ctReset").addEventListener("click", function () {
    setTimeout(function () { applyHint(); updateProgress(); clearErrors(); }, 0);
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
  updateProgress();
})();
