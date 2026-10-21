'use strict';

const path = require('path');
const express = require('express');
const config = require('./config');
const auth = require('./lib/auth');
const publicRoutes = require('./routes/public');
const { router: adminAuthRoutes, requireAdmin } = require('./routes/admin-auth');
const adminRoutes = require('./routes/admin');
const adminSettingsRoutes = require('./routes/admin-settings');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Signature images arrive as base64 PNG data URLs, so the default 100kb body
// limit is too small.
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

const publicDir = path.join(config.rootDir, 'public');

app.use('/api', publicRoutes);
app.use('/admin', adminAuthRoutes);
app.use('/admin', adminRoutes);
app.use('/admin', adminSettingsRoutes);

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin', 'login.html'));
});

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(publicDir, 'admin', 'index.html'));
});

app.get('/admin/settings', requireAdmin, (req, res) => {
  res.sendFile(path.join(publicDir, 'admin', 'settings.html'));
});

app.get('/admin/submissions/:id', requireAdmin, (req, res) => {
  res.sendFile(path.join(publicDir, 'admin', 'submission.html'));
});

app.use(express.static(publicDir, { extensions: ['html'] }));

app.get('/healthz', (req, res) => {
  res.json({ ok: true, service: 'rental-agreement-app', time: new Date().toISOString() });
});

app.use((req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/admin/api')) {
    return res.status(404).json({ ok: false, message: 'Not found.' });
  }
  res.status(404).sendFile(path.join(publicDir, '404.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  console.error('[error]', error);
  if (res.headersSent) return res.end();
  const status = error.status || 500;
  const message =
    status === 413 ? 'The submitted data is too large. Please reduce signature size and retry.' : 'Something went wrong. Please try again.';
  if (req.path.startsWith('/api') || req.path.startsWith('/admin')) {
    return res.status(status).json({ ok: false, message });
  }
  res.status(status).send(message);
});

function start() {
  const seeded = auth.ensureSeedAdmin(config.admin);
  if (seeded) {
    console.log(`[auth] Sign in with ${seeded.email} (password from ADMIN_PASSWORD).`);
  }

  const server = app.listen(config.port, () => {
    console.log(`Rental agreement app listening on http://localhost:${config.port}`);
    console.log(`Tenant form:     http://localhost:${config.port}/`);
    console.log(`Admin dashboard: http://localhost:${config.port}/admin`);
    console.log(`Data directory:  ${config.dataDir}`);
  });
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
