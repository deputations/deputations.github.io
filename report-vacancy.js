/* Report Vacancy — frontend logic.
 * - Three modes (link / pdf / manual) sharing a single set of core fields
 * - Field validation per mode
 * - Draft autosave (text only) in localStorage["rv:draft:v1"]
 * - Preview modal -> POST to shared Apps Script endpoint (action:"vacancy")
 * - Success state with a generated Report ID returned by the server
 */
(function () {
  "use strict";

  // Submit to the Supabase public `submit` function when configured; else fall
  // back to the legacy Apps Script endpoint.
  var SB_READY = (typeof window !== "undefined" && window.SUPABASE_READY && window.SUPABASE_READY());
  var API_URL = SB_READY
    ? (window.SUPABASE_URL + "/functions/v1/submit")
    : ((typeof window !== "undefined" && window.DEPUTATIONS_API) || "");
  var SB_ANON = (typeof window !== "undefined" && window.SUPABASE_ANON_KEY) || "";

  var DRAFT_KEY = "rv:draft:v1";
  var MAX_PDF_MB = 10;
  var MAX_PDF_BYTES = MAX_PDF_MB * 1024 * 1024;

  var $  = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) { return Array.prototype.slice.call((root || document).querySelectorAll(s)); };

  var form     = $("#rvForm");
  var card     = $("#rvCard");
  var success  = $("#rvSuccess");
  var modal    = $("#rvModal");
  var toastEl  = $("#rvToast");
  var fillBar  = $("#rvProgressFill");
  var clearDraftBtn = $("#rvClearDraft");

  // Tabs
  var tabs  = $$(".rv-tab");
  var panes = $$(".rv-pane");
  var mode  = "link";

  // PDF state
  var pdfState = null; // { name, size, mime, base64 }
  var drop      = $("#rvDrop");
  var fileInput = $("#rvFile");
  var fileEmpty = $("#rvDropEmpty");
  var fileChip  = $("#rvFileChip");
  var fileName  = $("#rvFileName");
  var fileSize  = $("#rvFileSize");

  /* ---------- Tabs ---------- */
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { setMode(t.dataset.mode); });
  });
  function setMode(m) {
    mode = m;
    tabs.forEach(function (t) {
      var active = t.dataset.mode === m;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    panes.forEach(function (p) { p.hidden = p.dataset.pane !== m; });
    clearAllErrors();
    updateProgress();
  }

  /* ---------- PDF drop zone ---------- */
  drop.addEventListener("click", function (e) {
    if (e.target.closest("#rvFileRemove")) return;
    fileInput.click();
  });
  drop.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("drag"); });
  });
  ["dragleave", "dragend", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("drag"); });
  });
  drop.addEventListener("drop", function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
  });
  $("#rvFileRemove").addEventListener("click", function (e) {
    e.stopPropagation();
    removeFile();
  });

  function handleFile(f) {
    setFieldError("rvFile", "");
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) {
      setFieldError("rvFile", "Please choose a PDF file.");
      return;
    }
    if (f.size > MAX_PDF_BYTES) {
      setFieldError("rvFile", "PDF is larger than " + MAX_PDF_MB + " MB.");
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { setFieldError("rvFile", "Could not read the file. Please try again."); };
    reader.onload = function () {
      var dataUrl = String(reader.result || "");
      var base64 = dataUrl.indexOf(",") > -1 ? dataUrl.slice(dataUrl.indexOf(",") + 1) : "";
      pdfState = { name: f.name, size: f.size, mime: f.type || "application/pdf", base64: base64 };
      fileName.textContent = f.name;
      fileSize.textContent = formatBytes(f.size);
      fileEmpty.hidden = true;
      fileChip.hidden = false;
      updateProgress();
    };
    reader.readAsDataURL(f);
  }
  function removeFile() {
    pdfState = null;
    fileInput.value = "";
    fileEmpty.hidden = false;
    fileChip.hidden = true;
    updateProgress();
  }
  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }

  /* ---------- Draft autosave ---------- */
  var DRAFT_FIELDS = [
    "rvUrl", "rvTitle", "rvMinistry", "rvMinistryOther", "rvOrg", "rvOrgOther",
    "rvDeadline", "rvDescription",
    "rvManualSource", "rvSeenAt",
    "rvPosts", "rvPay", "rvEligibility", "rvLocation",
    "rvSubmitter", "rvEmail"
  ];
  var draftTimer;
  function saveDraftDebounced() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  }
  function saveDraft() {
    try {
      var d = { mode: mode };
      DRAFT_FIELDS.forEach(function (id) { var el = document.getElementById(id); if (el) d[id] = el.value; });
      var confirm = document.getElementById("rvConfirm");
      d.confirm = !!(confirm && confirm.checked);
      localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      clearDraftBtn.hidden = false;
    } catch (e) {}
  }
  function restoreDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (d.mode) setMode(d.mode);
      DRAFT_FIELDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el && typeof d[id] === "string") el.value = d[id];
      });
      var confirmEl = document.getElementById("rvConfirm");
      if (confirmEl && d.confirm) confirmEl.checked = true;
      clearDraftBtn.hidden = false;
      return true;
    } catch (e) { return false; }
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    clearDraftBtn.hidden = true;
  }

  /* ---------- Validation ---------- */
  function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
  function isUrl(s) {
    try { var u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; }
    catch (e) { return false; }
  }
  function val(id) {
    var el = document.getElementById(id);
    if (!el) return "";
    var v = ((el.value == null ? "" : el.value) + "").trim();
    // For cascading selects: when "__other__" sentinel is picked, fall back to the sibling text input
    if (v === "__other__") {
      var other = document.getElementById(id + "Other");
      if (other) return (other.value || "").trim();
      return "";
    }
    return v;
  }
  function setFieldError(inputId, msg) {
    var input = document.getElementById(inputId);
    var err = document.getElementById(inputId + "Err");
    if (err) err.textContent = msg || "";
    if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
  }
  function clearAllErrors() {
    ["rvUrl","rvTitle","rvMinistry","rvOrg","rvFile","rvManualSource","rvEmail","rvConfirm"].forEach(function (id) {
      setFieldError(id, "");
    });
  }

  /* Required fields by mode (used for validation AND progress). */
  function requiredFieldIds() {
    var base = ["rvTitle", "rvMinistry", "rvOrg", "rvConfirm"];
    if (mode === "link")   return ["rvUrl"].concat(base);
    if (mode === "manual") return ["rvManualSource"].concat(base);
    if (mode === "pdf")    return ["rvFile"].concat(base);
    return base;
  }
  function fieldFilled(id) {
    if (id === "rvFile") return !!pdfState;
    if (id === "rvConfirm") return !!document.getElementById("rvConfirm").checked;
    return val(id).length > 0;
  }

  function validate() {
    clearAllErrors();
    var ok = true;
    if (mode === "link") {
      var u = val("rvUrl");
      if (!u) { setFieldError("rvUrl", "Please paste the vacancy URL."); ok = false; }
      else if (!isUrl(u)) { setFieldError("rvUrl", "Enter a valid http(s) URL."); ok = false; }
    } else if (mode === "pdf") {
      if (!pdfState) { setFieldError("rvFile", "Please attach the vacancy PDF."); ok = false; }
    } else if (mode === "manual") {
      if (val("rvManualSource").length < 8) {
        setFieldError("rvManualSource", "Please describe the source in a little more detail.");
        ok = false;
      }
    }
    if (!val("rvTitle"))    { setFieldError("rvTitle",    "Vacancy title is required."); ok = false; }
    if (!val("rvMinistry")) { setFieldError("rvMinistry", "Please select the ministry."); ok = false; }
    if (!val("rvOrg"))      { setFieldError("rvOrg",      "Please select the organisation / department."); ok = false; }

    var email = val("rvEmail");
    if (email && !isEmail(email)) { setFieldError("rvEmail", "Enter a valid email or leave it blank."); ok = false; }

    if (!document.getElementById("rvConfirm").checked) {
      setFieldError("rvConfirm", "Please confirm the source is official or reliable.");
      ok = false;
    }
    return ok;
  }

  function updateProgress() {
    var req = requiredFieldIds();
    var filled = req.filter(fieldFilled).length;
    var pct = req.length ? Math.round((filled / req.length) * 100) : 0;
    fillBar.style.width = pct + "%";
  }

  /* ---------- Input change listeners ---------- */
  form.addEventListener("input", function (e) {
    if (e.target.matches("input, textarea")) {
      // Clear an error on the live-edited field
      var id = e.target.id;
      if (id) setFieldError(id, "");
      updateProgress();
      saveDraftDebounced();
    }
  });
  $("#rvConfirm").addEventListener("change", function () {
    setFieldError("rvConfirm", "");
    updateProgress();
    saveDraftDebounced();
  });

  /* ---------- Preview ---------- */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validate()) {
      // focus first invalid
      var firstErr = form.querySelector('[aria-invalid="true"]');
      if (firstErr && firstErr.focus) firstErr.focus({ preventScroll: false });
      return;
    }
    openPreview();
  });

  function previewRows() {
    var rows = [];
    rows.push(["Source type", labelFor(mode)]);
    if (mode === "link")   rows.push(["Vacancy URL", val("rvUrl")]);
    if (mode === "pdf")    rows.push(["PDF", pdfState ? pdfState.name + " (" + formatBytes(pdfState.size) + ")" : ""]);
    if (mode === "manual") {
      rows.push(["Source details", val("rvManualSource")]);
      if (val("rvSeenAt")) rows.push(["Seen at", val("rvSeenAt")]);
    }
    rows.push(["Vacancy title", val("rvTitle")]);
    rows.push(["Ministry", val("rvMinistry")]);
    rows.push(["Organisation / Dept", val("rvOrg")]);
    if (val("rvDeadline"))    rows.push(["Last date", val("rvDeadline")]);
    if (val("rvDescription")) rows.push(["Description", val("rvDescription")]);
    if (val("rvPosts"))       rows.push(["Number of posts", val("rvPosts")]);
    if (val("rvPay"))         rows.push(["Pay level", val("rvPay")]);
    if (val("rvMinYears"))    rows.push(["Min experience (yrs)", val("rvMinYears")]);
    if (val("rvEligibility")) rows.push(["Eligibility", val("rvEligibility")]);
    if (val("rvLocation"))    rows.push(["Location", val("rvLocation")]);
    if (val("rvSubmitter"))   rows.push(["Submitter", val("rvSubmitter")]);
    if (val("rvEmail"))       rows.push(["Email", val("rvEmail")]);
    return rows;
  }
  function labelFor(m) { return m === "link" ? "Link" : m === "pdf" ? "PDF" : "Manual"; }

  function openPreview() {
    var list = $("#rvPreviewList");
    list.innerHTML = previewRows().map(function (r) {
      var v = r[1];
      var cls = v ? "" : " class=\"empty\"";
      return "<dt>" + escapeHtml(r[0]) + "</dt><dd" + cls + ">" + (v ? escapeHtml(v) : "—") + "</dd>";
    }).join("");
    $("#rvSubmitErr").textContent = "";
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(function () { $("#rvSubmitBtn").focus(); }, 30);
  }
  function closePreview() {
    modal.hidden = true;
    document.body.style.overflow = "";
  }
  $("#rvModalClose").addEventListener("click", closePreview);
  $("#rvEditBtn").addEventListener("click", closePreview);
  modal.addEventListener("click", function (e) { if (e.target === modal) closePreview(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !modal.hidden) closePreview();
  });

  /* ---------- Submit ---------- */
  $("#rvSubmitBtn").addEventListener("click", submitNow);

  function buildPayload() {
    var p = {
      action: "vacancy",
      sourceType: mode,
      title: val("rvTitle"),
      ministry: val("rvMinistry"),
      organization: val("rvOrg"),
      deadline: val("rvDeadline"),
      description: val("rvDescription"),
      numberOfPosts: val("rvPosts"),
      payLevel: val("rvPay"),
      minYears: val("rvMinYears"),
      eligibility: val("rvEligibility"),
      location: val("rvLocation"),
      submitterName: val("rvSubmitter"),
      submitterEmail: val("rvEmail"),
      website: val("rvWebsite") // honeypot
    };
    if (mode === "link")   p.sourceUrl = val("rvUrl");
    if (mode === "manual") { p.manualSourceDetails = val("rvManualSource"); p.seenAt = val("rvSeenAt"); }
    if (mode === "pdf" && pdfState) {
      p.pdf = {
        filename: pdfState.name,
        mimeType: pdfState.mime,
        size: pdfState.size,
        base64: pdfState.base64
      };
    }
    return p;
  }

  function submitNow() {
    var btn   = $("#rvSubmitBtn");
    var label = $("#rvSubmitLabel");
    var spin  = $("#rvSubmitSpin");
    var errEl = $("#rvSubmitErr");
    errEl.textContent = "";

    if (!API_URL || API_URL.indexOf("https://") !== 0) {
      errEl.textContent = "Submission endpoint is not configured. Please contact the site administrator.";
      return;
    }

    btn.disabled = true;
    label.textContent = "Submitting…";
    spin.hidden = false;

    // Supabase function accepts JSON (+ apikey); Apps Script uses text/plain to
    // avoid a CORS preflight.
    var headers = SB_READY
      ? { "Content-Type": "application/json", "apikey": SB_ANON, "Authorization": "Bearer " + SB_ANON }
      : { "Content-Type": "text/plain;charset=utf-8" };
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
        closePreview();
        showSuccess(res.reportId || "RV-PENDING");
        clearDraft();
      })
      .catch(function (err) {
        errEl.textContent = (err && err.message) || "Could not submit right now. Please try again.";
        btn.disabled = false;
        label.textContent = "Confirm & submit";
        spin.hidden = true;
      });
  }

  function showSuccess(reportId) {
    $("#rvReportId").textContent = reportId;
    card.hidden = true;
    success.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  $("#rvAnother").addEventListener("click", function () {
    // Reset form state
    form.reset();
    removeFile();
    setMode("link");
    clearAllErrors();
    pdfState = null;
    success.hidden = true;
    card.hidden = false;
    updateProgress();
  });

  /* ---------- Reset ---------- */
  $("#rvReset").addEventListener("click", function () {
    if (!confirm("Clear all fields in this form? Your saved draft will be removed.")) return;
    form.reset();
    removeFile();
    setMode("link");
    clearAllErrors();
    clearDraft();
    updateProgress();
    toast("Form cleared.");
  });
  clearDraftBtn.addEventListener("click", function () {
    clearDraft();
    toast("Saved draft removed.");
  });

  /* ---------- Toast ---------- */
  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2200);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- Ministry / Organisation cascading dropdowns ---------- */
  var MINISTRY_DATA = null; // { ministries: [{ name, organisations: [{name, type}] }] }

  function escapeOpt(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function setupOther(selectId) {
    var sel = document.getElementById(selectId);
    var other = document.getElementById(selectId + "Other");
    if (!sel || !other) return;
    function sync() {
      var isOther = sel.value === "__other__";
      other.hidden = !isOther;
      if (isOther) { setTimeout(function(){ other.focus(); }, 30); }
    }
    sel.addEventListener("change", function () { sync(); saveDraftDebounced(); updateProgress(); });
    other.addEventListener("input", function () { saveDraftDebounced(); updateProgress(); });
    sync();
  }

  function populateMinistrySelect() {
    var sel = document.getElementById("rvMinistry");
    if (!sel || !MINISTRY_DATA) return;
    var keep = sel.value;
    var html = '<option value="">Select ministry…</option>';
    MINISTRY_DATA.ministries.forEach(function (m) {
      html += '<option value="' + escapeOpt(m.name) + '">' + escapeOpt(m.name) + '</option>';
    });
    html += '<option value="__other__">Other / not listed…</option>';
    sel.innerHTML = html;
    if (keep) sel.value = keep;
  }

  function populateOrgSelect(ministryName) {
    var sel = document.getElementById("rvOrg");
    if (!sel) return;
    sel.innerHTML = '<option value="">Select organisation / department…</option>';
    if (!ministryName || ministryName === "__other__") {
      sel.disabled = false;
      sel.innerHTML += '<option value="__other__">Other / not listed…</option>';
      return;
    }
    var m = MINISTRY_DATA && MINISTRY_DATA.ministries.find(function (x) { return x.name === ministryName; });
    if (!m) { sel.disabled = false; sel.innerHTML += '<option value="__other__">Other / not listed…</option>'; return; }
    // Group by Organisation Type using <optgroup>
    var byType = {};
    var order = [];
    m.organisations.forEach(function (o) {
      var t = o.type || "Other";
      if (!byType[t]) { byType[t] = []; order.push(t); }
      byType[t].push(o.name);
    });
    var html = '<option value="">Select organisation / department…</option>';
    order.sort().forEach(function (t) {
      html += '<optgroup label="' + escapeOpt(t) + '">';
      byType[t].forEach(function (n) {
        html += '<option value="' + escapeOpt(n) + '">' + escapeOpt(n) + '</option>';
      });
      html += '</optgroup>';
    });
    html += '<option value="__other__">Other / not listed…</option>';
    sel.innerHTML = html;
    sel.disabled = false;
  }

  function applyDraftCascade() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      var msel = document.getElementById("rvMinistry");
      var osel = document.getElementById("rvOrg");
      if (msel && typeof d.rvMinistry === "string" && d.rvMinistry) {
        msel.value = d.rvMinistry;
        populateOrgSelect(d.rvMinistry === "__other__" ? "" : d.rvMinistry);
        if (osel && typeof d.rvOrg === "string" && d.rvOrg) {
          osel.value = d.rvOrg;
        }
      }
      var mOther = document.getElementById("rvMinistryOther");
      var oOther = document.getElementById("rvOrgOther");
      if (mOther && typeof d.rvMinistryOther === "string") mOther.value = d.rvMinistryOther;
      if (oOther && typeof d.rvOrgOther === "string") oOther.value = d.rvOrgOther;
      // sync the "Other" text input visibility
      if (msel && msel.value === "__other__" && mOther) mOther.hidden = false;
      if (osel && osel.value === "__other__" && oOther) oOther.hidden = false;
    } catch (e) {}
  }

  function bindMinistryCascade() {
    var msel = document.getElementById("rvMinistry");
    if (!msel) return;
    msel.addEventListener("change", function () {
      populateOrgSelect(msel.value === "__other__" ? "" : msel.value);
      saveDraftDebounced();
      updateProgress();
    });
    setupOther("rvMinistry");
    setupOther("rvOrg");
  }

  function loadMinistries() {
    fetch("data/ministries.json")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        MINISTRY_DATA = data;
        populateMinistrySelect();
        bindMinistryCascade();
        applyDraftCascade();
        updateProgress();
      })
      .catch(function (e) {
        // Fallback: turn the selects into plain text inputs if the JSON fails to load
        console.warn("ministries.json failed; falling back to text input", e);
        var ms = document.getElementById("rvMinistry");
        var os = document.getElementById("rvOrg");
        if (ms) ms.outerHTML = '<input type="text" id="rvMinistry" name="ministry" placeholder="Ministry name" autocomplete="off">';
        if (os) {
          os.outerHTML = '<input type="text" id="rvOrg" name="organization" placeholder="Organisation / department" autocomplete="off">';
        }
      });
  }

  /* ---------- Init ---------- */
  var restored = restoreDraft();
  setMode(mode);
  loadMinistries();
  updateProgress();
  if (restored) toast("Draft restored");
})();
