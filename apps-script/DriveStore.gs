/**
 * DriveStore.gs — store a base64 PDF in Google Drive and return a shareable link.
 * Lets the deputations pipeline keep source PDFs in your 5 TB Drive (instead of
 * Supabase storage) and link to them from a vacancy when no official link exists.
 *
 * INSTALL (one-time, ~2 min):
 *  1. Open the same Apps Script project that hosts your Vacancies/Feedback API.
 *  2. File > New > Script  →  name it "DriveStore"  →  paste this whole file.
 *  3. (Optional) change DRIVE_STORE_FOLDER_ID below to a dedicated folder.
 *  4. INSIDE your existing doPost(e), add ONE line near the other action checks:
 *
 *        if (data && data.action === 'drive_store') return handleDriveStore_(data);
 *
 *  5. Deploy > Manage deployments > edit active deployment > New version > Deploy.
 *     (Same /exec URL keeps working.)
 */

// Reuses the same Drive folder your vacancy uploads already use. Change if you like.
var DRIVE_STORE_FOLDER_ID = '1Nt7m5IyLHhsNIjjs5KrWObkexvFk6Bkb';

function handleDriveStore_(payload) {
  try {
    var b64 = String(payload.file_base64 || '');
    if (!b64) return _dsJson({ ok: false, message: 'file_base64 required' });
    if (b64.indexOf(',') > -1) b64 = b64.split(',')[1]; // strip data: prefix

    var name = String(payload.filename || ('source_' + Date.now()))
      .replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);
    if (!/\.pdf$/i.test(name)) name += '.pdf';

    var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', name);
    var folder = DriveApp.getFolderById(DRIVE_STORE_FOLDER_ID);
    var file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

    var id = file.getId();
    return _dsJson({
      ok: true,
      id: id,
      url: 'https://drive.google.com/file/d/' + id + '/view',
      preview: 'https://drive.google.com/file/d/' + id + '/preview'
    });
  } catch (err) {
    return _dsJson({ ok: false, message: String(err) });
  }
}

function _dsJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
