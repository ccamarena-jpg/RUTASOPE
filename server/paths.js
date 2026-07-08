const path = require('path');
const fs = require('fs');

// Where persistent data lives. On Render (or any host) set DATA_DIR to a
// mounted disk (e.g. /var/data) so the SQLite DB and uploaded guias survive
// deploys/restarts. Locally, with no DATA_DIR set, everything stays next to
// the server code exactly like before.
const DATA_DIR = process.env.DATA_DIR || null;

const DB_PATH = process.env.DB_PATH
  || (DATA_DIR ? path.join(DATA_DIR, 'ruteo.db') : path.join(__dirname, 'ruteo.db'));

const UPLOAD_DIR = process.env.UPLOAD_DIR
  || (DATA_DIR ? path.join(DATA_DIR, 'uploads') : path.join(__dirname, 'uploads'));

if (DATA_DIR && !fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = { DATA_DIR, DB_PATH, UPLOAD_DIR };
