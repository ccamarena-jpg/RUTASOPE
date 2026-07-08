// Google API clients (Sheets + Drive) authenticated with a service account.
// Clients are created lazily and cached across warm serverless invocations.
const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

let _auth = null;
let _sheets = null;
let _drive = null;

function getAuth() {
  if (_auth) return _auth;
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  // Vercel stores the key with literal "\n"; turn them into real newlines.
  const key = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('Faltan GOOGLE_SERVICE_ACCOUNT_EMAIL o GOOGLE_PRIVATE_KEY en las variables de entorno.');
  }
  _auth = new google.auth.JWT({ email, key, scopes: SCOPES });
  return _auth;
}

function sheets() {
  if (!_sheets) _sheets = google.sheets({ version: 'v4', auth: getAuth() });
  return _sheets;
}

function drive() {
  if (!_drive) _drive = google.drive({ version: 'v3', auth: getAuth() });
  return _drive;
}

const SHEET_ID = () => {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error('Falta GOOGLE_SHEET_ID en las variables de entorno.');
  return id;
};

const DRIVE_FOLDER_ID = () => process.env.GOOGLE_DRIVE_FOLDER_ID || null;

module.exports = { sheets, drive, SHEET_ID, DRIVE_FOLDER_ID, getAuth };
