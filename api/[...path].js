// Single Vercel serverless function that handles every /api/* request.
// Vercel routes all /api/* here (catch-all), preserving the original URL, so
// the Express app can match its own /api/... routes. Files/folders starting
// with "_" (like _lib) are ignored by Vercel and never become functions.
module.exports = require('./_lib/app');
