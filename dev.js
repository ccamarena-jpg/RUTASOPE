// Local development server: runs the same Express app that Vercel deploys as a
// serverless function, on a normal port. Needs the Google env vars (put them in
// a .env file at the repo root, see .env.example). Run with: npm run dev:api
require('dotenv').config();
const app = require('./api/_lib/app');

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Ruteo API (Sheets) escuchando en http://localhost:${PORT}`));
