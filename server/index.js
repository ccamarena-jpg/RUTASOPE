const express = require('express');
const cors = require('cors');
const path = require('path');

require('./db'); // init + seed

const { UPLOAD_DIR } = require('./paths');
const authRoutes = require('./routes/auth');
const catalogRoutes = require('./routes/catalog');
const routeRoutes = require('./routes/routes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/uploads', express.static(UPLOAD_DIR));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api', catalogRoutes);
app.use('/api/routes', routeRoutes);

// Serve the built React client (run `npm run build` in /client) so the whole
// app can be hosted from this single Express server in production.
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
const fs = require('fs');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Ruteo API escuchando en puerto ${PORT}`));
