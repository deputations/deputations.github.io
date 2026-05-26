/**
 * Feedback.gs — additive Apps Script module for the Contact / Community page.
 *
 * HOW TO INSTALL (one-time, ~2 minutes):
 *  1. Open the existing Apps Script project (same one that hosts Code.gs +
 *     Vacancies.gs). File > New > Script — name it "Feedback".
 *  2. Paste the contents of this file.
 *  3. Configure the constants in FEEDBACK_CONFIG below
 *     (ADMIN_EMAIL is the main one to set).
 *  4. In Code.gs, INSIDE the existing doPost(e), add ONE line right after the
 *     existing JSON.parse / try-catch and before the other action branches:
 *
 *         if (data && data.action === 'feedback') return handleFeedbackPost_(data);
 *
 *     ⚠ This line must be INSIDE doPost. Pasting it at the top level of the
 *     file causes "SyntaxError: Illegal return statement".
 *
 *  5. Deploy > Manage deployments > pencil on the active web-app deployment
 *     > Version: New version > Deploy. Same /exec URL stays valid.
 *
 *  The "Feedback" sheet/tab is auto-created on first POST.
 */

// =================== CONFIG ===================
var FEEDBACK_CONFIG = {
  // Leave empty to use the active spreadsheet bound to this script (recommended —
  // keeps Discrepancies, Vacancies and Feedback in the same workbook).
  SHEET_ID:        '',
  // Tab name for feedback rows. Auto-created if missing.
  FEEDBACK_TAB:    'Feedback',
  // Admin notification email. Leave empty to skip.
  ADMIN_EMAIL:     'vivek.ajnifm@gmail.com',
  // Rate limit: max feedback submissions per email in the trailing window (minutes).
  RATE_LIMIT_PER_EMAIL:  5,
  RATE_LIMIT_WINDOW_MIN: 10
};
// ==============================================

var FEEDBACK_HEADERS = [
  'Feedback ID', 'Submitted At', 'Status', 'Category',
  'Name', 'Email', 'Subject', 'Message',
  'Related Page', 'Relevant Link',
  'User Agent', 'Page Context',
  'Admin Notes', 'Resolved By', 'Resolved At'
];

var FEEDBACK_ALLOWED_CATEGORIES = [
  'General Feedback', 'Report a Bug', 'Suggest a Feature',
  'Vacancy Correction', 'Policy Clarification',
  'WhatsApp Group Issue', 'Other'
];

/**
 * Main entry point for the "feedback" action. Returns a TextOutput JSON response.
 */
function handleFeedbackPost_(payload) {
  try {
    // -------- Honeypot --------
    if (payload && payload.website) {
      // Pretend success so bots stop trying.
      return feedbackJsonOut_({ ok: true, success: true, feedbackId: 'FB-IGNORED', message: 'OK' });
    }

    // -------- Basic field validation --------
    var subject = String(payload.subject || '').trim();
    var message = String(payload.message || '').trim();
    if (!subject) {
      return feedbackJsonOut_({ ok: false, success: false, message: 'Please add a short subject.' });
    }
    if (message.length < 8) {
      return feedbackJsonOut_({ ok: false, success: false, message: 'Message is too short — please add a bit more detail.' });
    }
    var email = String(payload.email || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return feedbackJsonOut_({ ok: false, success: false, message: 'Email looks invalid.' });
    }
    var category = String(payload.category || 'General Feedback').trim();
    if (FEEDBACK_ALLOWED_CATEGORIES.indexOf(category) === -1) category = 'General Feedback';

    // Length caps to keep the sheet sane.
    subject = subject.slice(0, 200);
    message = message.slice(0, 6000);

    // -------- Rate limit by submitter email --------
    if (email) {
      var limited = feedbackRateLimited_(email);
      if (limited) {
        return feedbackJsonOut_({ ok: false, success: false, message: 'Too many submissions from this email. Please try again later.' });
      }
    }

    // -------- Sheet handle --------
    var ss = FEEDBACK_CONFIG.SHEET_ID
      ? SpreadsheetApp.openById(FEEDBACK_CONFIG.SHEET_ID)
      : SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return feedbackJsonOut_({ ok: false, success: false, message: 'Spreadsheet not configured.' });
    }
    var sheet = ss.getSheetByName(FEEDBACK_CONFIG.FEEDBACK_TAB);
    if (!sheet) {
      sheet = ss.insertSheet(FEEDBACK_CONFIG.FEEDBACK_TAB);
      sheet.getRange(1, 1, 1, FEEDBACK_HEADERS.length).setValues([FEEDBACK_HEADERS]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    // -------- Generate ID --------
    var now = new Date();
    var year = Utilities.formatDate(now, 'UTC', 'yyyy');
    var lastRow = sheet.getLastRow();
    var seq = Math.max(0, lastRow - 1) + 1;
    var feedbackId = 'FB-' + year + '-' + ('000000' + seq).slice(-6);

    // -------- Append row --------
    var row = [
      feedbackId,
      now,
      'New',
      category,
      String(payload.name || '').slice(0, 120),
      email,
      subject,
      message,
      String(payload.relatedPage || '').slice(0, 400),
      String(payload.relatedLink || '').slice(0, 600),
      String(payload.userAgent || '').slice(0, 400),
      String(payload.pageContext || '').slice(0, 400),
      '', // Admin Notes
      '', // Resolved By
      ''  // Resolved At
    ];
    sheet.appendRow(row);

    // -------- Notifications --------
    feedbackNotifyAdmin_(feedbackId, category, subject, message, payload);
    if (email) feedbackNotifySubmitter_(email, feedbackId, subject);

    return feedbackJsonOut_({
      ok: true,
      success: true,
      feedbackId: feedbackId,
      message: 'Feedback submitted successfully'
    });
  } catch (err) {
    return feedbackJsonOut_({ ok: false, success: false, message: 'Server error: ' + err });
  }
}

/* ---------- helpers ---------- */

function feedbackJsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function feedbackRateLimited_(email) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = 'fb_rl_' + email.toLowerCase();
    var now = Date.now();
    var windowMs = FEEDBACK_CONFIG.RATE_LIMIT_WINDOW_MIN * 60 * 1000;
    var raw = props.getProperty(key);
    var list = raw ? JSON.parse(raw) : [];
    list = list.filter(function (t) { return now - t < windowMs; });
    if (list.length >= FEEDBACK_CONFIG.RATE_LIMIT_PER_EMAIL) return true;
    list.push(now);
    props.setProperty(key, JSON.stringify(list));
    return false;
  } catch (e) { return false; }
}

function feedbackNotifyAdmin_(feedbackId, category, subject, message, payload) {
  if (!FEEDBACK_CONFIG.ADMIN_EMAIL) return;
  var lines = [
    'New feedback received on the Deputations portal.',
    '',
    'Feedback ID  : ' + feedbackId,
    'Category     : ' + category,
    'Subject      : ' + subject,
    'From         : ' + (payload.name || '—') + ' <' + (payload.email || '—') + '>',
    payload.relatedPage ? 'Related page : ' + payload.relatedPage : null,
    payload.relatedLink ? 'Relevant link: ' + payload.relatedLink : null,
    payload.pageContext ? 'Referrer     : ' + payload.pageContext : null,
    '',
    'Message:',
    message
  ].filter(function (l) { return l !== null; });
  try {
    MailApp.sendEmail({
      to: FEEDBACK_CONFIG.ADMIN_EMAIL,
      subject: '[Deputations] Feedback ' + feedbackId + ' — ' + category,
      replyTo: payload.email || undefined,
      body: lines.join('\n')
    });
  } catch (e) { /* swallow mail errors */ }
}

function feedbackNotifySubmitter_(email, feedbackId, subject) {
  try {
    MailApp.sendEmail({
      to: email,
      subject: 'We received your feedback (' + feedbackId + ')',
      body:
        'Thanks for taking the time to write in.\n\n' +
        'Reference ID: ' + feedbackId + '\n' +
        'Subject     : ' + subject + '\n' +
        'Status      : New\n\n' +
        'We review feedback periodically and will get back if a reply is needed.\n' +
        'For urgent peer support or policy discussions, the WhatsApp Group is faster:\n' +
        '  https://chat.whatsapp.com/EuBUchI2ZjI0AOWtkoX3X1\n\n' +
        '— deputations.github.io'
    });
  } catch (e) { /* swallow mail errors */ }
}
