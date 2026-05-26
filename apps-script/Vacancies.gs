/**
 * Vacancies.gs — additive Apps Script module.
 *
 * HOW TO INSTALL (one-time, ~2 minutes):
 *  1. Open the existing Apps Script project that hosts the FAQ discrepancy API.
 *  2. File > New > Script — name it "Vacancies".
 *  3. Paste the contents of this file.
 *  4. Edit the CONFIG block below — set DRIVE_FOLDER_ID and ADMIN_EMAIL.
 *  5. In your existing `Code.gs`, INSIDE the `doPost(e)` function, add ONE LINE
 *     right after the existing JSON.parse / try-catch and before the other
 *     `if (data.action === ...)` branches:
 *
 *            if (data && data.action === 'vacancy') return handleVacancyPost_(data);
 *
 *     IMPORTANT: this line must sit inside doPost. Pasting it at the top level
 *     of Code.gs (between doGet and doPost) causes
 *     "SyntaxError: Illegal return statement" because `return` is only legal
 *     inside a function body.
 *
 *  6. Deploy > Manage deployments > pencil icon on the active deployment
 *     > "New version" > Deploy. Same /exec URL keeps working.
 *
 * The new "Vacancies" sheet/tab is auto-created on first POST.
 * PDFs land in the Drive folder you configure below.
 */

// =================== CONFIG ===================
var VACANCY_CONFIG = {
  // Same Spreadsheet that holds your FAQ discrepancies. Leave empty to use the
  // active spreadsheet bound to this script.
  SHEET_ID:        '',
  // Tab name for vacancy reports. Auto-created if missing.
  VACANCIES_TAB:   'Vacancies',
  // Drive folder for uploaded PDFs.
  // From the URL https://drive.google.com/drive/folders/<ID>?usp=sharing
  DRIVE_FOLDER_ID: '1Nt7m5IyLHhsNIjjs5KrWObkexvFk6Bkb',
  // Admin notification email. Leave empty to skip.
  ADMIN_EMAIL:     '',
  // Hard cap on uploaded PDFs.
  MAX_FILE_SIZE_MB: 10,
  // Rate limit: max submissions per email in the trailing window (minutes).
  RATE_LIMIT_PER_EMAIL:  5,
  RATE_LIMIT_WINDOW_MIN: 10
};
// ==============================================

var VACANCY_HEADERS = [
  'Report ID', 'Submitted At', 'Status', 'Source Type',
  'Vacancy Title', 'Organization', 'Department / Ministry', 'Location',
  'Last Date', 'Number of Posts', 'Pay Level', 'Eligibility',
  'Source URL', 'PDF Drive URL', 'Manual Source Details',
  'Submitter Name', 'Submitter Email', 'Reviewer Notes',
  'Duplicate Flag', 'Published URL'
];

/**
 * Main entry point for the "vacancy" action. Returns a TextOutput JSON response.
 */
function handleVacancyPost_(payload) {
  try {
    // -------- Honeypot --------
    if (payload && payload.website) {
      // Pretend success so bots stop trying.
      return jsonOut_({ ok: true, success: true, reportId: 'RV-IGNORED', message: 'OK' });
    }

    // -------- Basic field validation --------
    var srcType = String(payload.sourceType || '').toLowerCase();
    if (['link', 'pdf', 'manual'].indexOf(srcType) === -1) {
      return jsonOut_({ ok: false, success: false, message: 'Unknown sourceType.' });
    }
    var title = (payload.title || '').trim();
    var org   = (payload.organization || '').trim();
    if (!title || !org) {
      return jsonOut_({ ok: false, success: false, message: 'Title and organization are required.' });
    }
    if (srcType === 'link' && !/^https?:\/\//i.test(payload.sourceUrl || '')) {
      return jsonOut_({ ok: false, success: false, message: 'A valid http(s) source URL is required.' });
    }
    if (srcType === 'manual' && (payload.manualSourceDetails || '').trim().length < 8) {
      return jsonOut_({ ok: false, success: false, message: 'Please describe the manual source in a little more detail.' });
    }
    if (srcType === 'pdf' && (!payload.pdf || !payload.pdf.base64)) {
      return jsonOut_({ ok: false, success: false, message: 'PDF data is missing.' });
    }
    if (payload.submitterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.submitterEmail)) {
      return jsonOut_({ ok: false, success: false, message: 'Submitter email looks invalid.' });
    }

    // -------- Rate limit by submitter email --------
    if (payload.submitterEmail) {
      var limited = vacancyRateLimited_(payload.submitterEmail);
      if (limited) {
        return jsonOut_({ ok: false, success: false, message: 'Too many submissions from this email. Please try again later.' });
      }
    }

    // -------- Sheet handle --------
    var ss = VACANCY_CONFIG.SHEET_ID
      ? SpreadsheetApp.openById(VACANCY_CONFIG.SHEET_ID)
      : SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return jsonOut_({ ok: false, success: false, message: 'Spreadsheet not configured.' });
    }
    var sheet = ss.getSheetByName(VACANCY_CONFIG.VACANCIES_TAB);
    if (!sheet) {
      sheet = ss.insertSheet(VACANCY_CONFIG.VACANCIES_TAB);
      sheet.getRange(1, 1, 1, VACANCY_HEADERS.length).setValues([VACANCY_HEADERS]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    // -------- PDF upload --------
    var pdfUrl = '';
    if (srcType === 'pdf') {
      if (!VACANCY_CONFIG.DRIVE_FOLDER_ID) {
        return jsonOut_({ ok: false, success: false, message: 'PDF storage is not configured. Please use link or manual mode.' });
      }
      var pdf = payload.pdf;
      var sizeBytes = Number(pdf.size) || 0;
      var maxBytes = VACANCY_CONFIG.MAX_FILE_SIZE_MB * 1024 * 1024;
      if (sizeBytes > maxBytes) {
        return jsonOut_({ ok: false, success: false, message: 'Only PDF files up to ' + VACANCY_CONFIG.MAX_FILE_SIZE_MB + ' MB are allowed.' });
      }
      var mime = String(pdf.mimeType || 'application/pdf');
      if (mime !== 'application/pdf') {
        return jsonOut_({ ok: false, success: false, message: 'Only PDF files are accepted.' });
      }
      try {
        var bytes = Utilities.base64Decode(String(pdf.base64 || ''));
        if (bytes.length > maxBytes) {
          return jsonOut_({ ok: false, success: false, message: 'Only PDF files up to ' + VACANCY_CONFIG.MAX_FILE_SIZE_MB + ' MB are allowed.' });
        }
        var safeName = sanitizeFilename_(pdf.filename || 'vacancy.pdf');
        var blob = Utilities.newBlob(bytes, mime, safeName);
        var folder = DriveApp.getFolderById(VACANCY_CONFIG.DRIVE_FOLDER_ID);
        var file = folder.createFile(blob);
        try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (shareErr) { /* ignore if domain-restricted */ }
        pdfUrl = file.getUrl();
      } catch (uploadErr) {
        return jsonOut_({ ok: false, success: false, message: 'Could not save the PDF (' + uploadErr + ').' });
      }
    }

    // -------- Duplicate detection (cheap scan) --------
    var dupFlag = detectVacancyDuplicate_(sheet, {
      sourceUrl: payload.sourceUrl || '',
      organization: org,
      title: title,
      deadline: payload.deadline || ''
    });

    // -------- Generate Report ID --------
    var now = new Date();
    var reportId = generateVacancyReportId_(now, sheet);

    // -------- Append row --------
    var row = [
      reportId,
      now,
      'Under Review',
      srcType,
      title,
      org,
      '', // Department/Ministry (organization already covers it; reviewer can split)
      payload.location || '',
      payload.deadline || '',
      payload.numberOfPosts || '',
      payload.payLevel || '',
      payload.eligibility || (payload.description || ''),
      payload.sourceUrl || '',
      pdfUrl,
      payload.manualSourceDetails || (payload.seenAt ? ('Seen at: ' + payload.seenAt) : ''),
      payload.submitterName || '',
      payload.submitterEmail || '',
      '', // Reviewer Notes
      dupFlag,
      ''  // Published URL
    ];
    sheet.appendRow(row);

    // -------- Notifications --------
    notifyVacancyAdmin_(reportId, srcType, title, org, payload, pdfUrl, dupFlag);
    if (payload.submitterEmail) notifyVacancySubmitter_(payload.submitterEmail, reportId, title);

    return jsonOut_({
      ok: true,
      success: true,
      reportId: reportId,
      message: 'Report submitted successfully'
    });
  } catch (err) {
    return jsonOut_({ ok: false, success: false, message: 'Server error: ' + err });
  }
}

/* ---------- helpers ---------- */

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sanitizeFilename_(name) {
  var safe = String(name).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);
  if (!/\.pdf$/i.test(safe)) safe += '.pdf';
  var stamp = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd-HHmmss');
  return stamp + '_' + safe;
}

function generateVacancyReportId_(now, sheet) {
  var year = Utilities.formatDate(now, 'UTC', 'yyyy');
  var lastRow = sheet.getLastRow();
  var seq = Math.max(0, lastRow - 1) + 1; // header is row 1
  return 'RV-' + year + '-' + ('000000' + seq).slice(-6);
}

function detectVacancyDuplicate_(sheet, fields) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return '';
  // Read just the columns we need.
  var range = sheet.getRange(2, 5, lastRow - 1, 9).getValues();
  // Columns 5..13: Vacancy Title, Organization, Department, Location, Last Date,
  // # Posts, Pay Level, Eligibility, Source URL
  for (var i = 0; i < range.length; i++) {
    var r = range[i];
    var existingTitle = String(r[0] || '').trim().toLowerCase();
    var existingOrg   = String(r[1] || '').trim().toLowerCase();
    var existingDate  = String(r[4] || '').trim();
    var existingUrl   = String(r[8] || '').trim();
    if (fields.sourceUrl && existingUrl && existingUrl === fields.sourceUrl) return 'URL';
    if (existingOrg && existingTitle &&
        existingOrg === fields.organization.toLowerCase() &&
        existingTitle === fields.title.toLowerCase()) return 'TITLE';
    if (existingOrg && fields.deadline && existingDate &&
        existingOrg === fields.organization.toLowerCase() &&
        existingDate === fields.deadline) return 'DEADLINE';
  }
  return '';
}

function vacancyRateLimited_(email) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'rv_rl_' + email.toLowerCase();
    var now = Date.now();
    var windowMs = VACANCY_CONFIG.RATE_LIMIT_WINDOW_MIN * 60 * 1000;
    var raw = props.getProperty(key);
    var list = raw ? JSON.parse(raw) : [];
    list = list.filter(function (t) { return now - t < windowMs; });
    if (list.length >= VACANCY_CONFIG.RATE_LIMIT_PER_EMAIL) return true;
    list.push(now);
    props.setProperty(key, JSON.stringify(list));
    return false;
  } catch (e) { return false; }
}

function notifyVacancyAdmin_(reportId, srcType, title, org, payload, pdfUrl, dupFlag) {
  if (!VACANCY_CONFIG.ADMIN_EMAIL) return;
  var lines = [
    'A new deputation vacancy report has been submitted.',
    '',
    'Report ID  : ' + reportId,
    'Source Type: ' + srcType,
    'Title      : ' + title,
    'Organization: ' + org,
    'Deadline   : ' + (payload.deadline || '—'),
    'Submitter  : ' + (payload.submitterName || '—') + ' <' + (payload.submitterEmail || '—') + '>',
    dupFlag ? 'Duplicate flag: ' + dupFlag : 'Duplicate flag: none'
  ];
  if (payload.sourceUrl) lines.push('Source URL : ' + payload.sourceUrl);
  if (pdfUrl)            lines.push('PDF (Drive): ' + pdfUrl);
  if (payload.manualSourceDetails) lines.push('Manual source: ' + payload.manualSourceDetails);
  try {
    MailApp.sendEmail({
      to: VACANCY_CONFIG.ADMIN_EMAIL,
      subject: '[Deputations] New vacancy report ' + reportId,
      body: lines.join('\n')
    });
  } catch (e) { /* swallow mail errors */ }
}

function notifyVacancySubmitter_(email, reportId, title) {
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'We received your vacancy report (' + reportId + ')',
      body:
        'Thanks for reporting a deputation vacancy.\n\n' +
        'Report ID : ' + reportId + '\n' +
        'Vacancy   : ' + title + '\n' +
        'Status    : Under Review\n\n' +
        'Our team will verify the details before publishing. We will not publish your email.\n\n' +
        '— deputations.github.io'
    });
  } catch (e) { /* swallow mail errors */ }
}

/* =========================================================================
 * OPTIONAL DISPATCHER  — paste this in place of your existing doPost(e),
 * after renaming the body of your current doPost to handleDiscrepancyPost_:
 *
 * function doPost(e) {
 *   var payload = {};
 *   try { payload = JSON.parse(e.postData.contents || '{}'); } catch (err) {}
 *   if (payload && payload.action === 'vacancy') return handleVacancyPost_(payload);
 *   return handleDiscrepancyPost_(e, payload);   // your existing logic
 * }
 *
 * If you'd rather keep your existing doPost intact, just add this one branch
 * at the very top of it:
 *
 *   var __body; try { __body = JSON.parse(e.postData.contents || '{}'); } catch (err) {}
 *   if (__body && __body.action === 'vacancy') return handleVacancyPost_(__body);
 *
 * ========================================================================= */
