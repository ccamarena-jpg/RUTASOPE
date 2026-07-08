// Upload a guia de remision (image/PDF) to Google Drive and return a viewable
// link. The file is stored in the folder given by GOOGLE_DRIVE_FOLDER_ID and
// made readable by anyone with the link (so choferes/cuentas can open it).
const { Readable } = require('stream');
const { drive, DRIVE_FOLDER_ID } = require('./google');

async function uploadGuia(buffer, originalname, mimetype) {
  const folderId = DRIVE_FOLDER_ID();
  const safeName = `${Date.now()}-${(originalname || 'guia').replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;

  const fileMeta = { name: safeName };
  if (folderId) fileMeta.parents = [folderId];

  const created = await drive().files.create({
    requestBody: fileMeta,
    media: { mimeType: mimetype || 'application/octet-stream', body: Readable.from(buffer) },
    fields: 'id, webViewLink',
  });

  const fileId = created.data.id;

  // Make it viewable by anyone with the link.
  await drive().permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  return created.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
}

module.exports = { uploadGuia };
