'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Minimal .env loader. Keeps the project dependency-light and makes local
 * setup a single `cp .env.example .env`. Real environment values always win.
 */
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const rootDir = path.resolve(__dirname, '..');
loadDotEnv(path.join(rootDir, '.env'));

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const dataDir = path.resolve(rootDir, process.env.DATA_DIR || 'data');

const config = {
  rootDir,
  port: Number(process.env.PORT || 12000),
  sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  dataDir,
  pdfDir: path.join(dataDir, 'pdf'),
  dbFile: path.join(dataDir, 'rental.sqlite'),
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
    password: process.env.ADMIN_PASSWORD || 'ChangeMe123!',
    name: process.env.ADMIN_NAME || 'Property Manager',
  },
  notify: {
    email: process.env.ADMIN_NOTIFY_EMAIL || process.env.ADMIN_EMAIL || 'admin@example.com',
    smtp: {
      host: process.env.SMTP_HOST || '',
      port: Number(process.env.SMTP_PORT || 587),
      secure: bool(process.env.SMTP_SECURE, false),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
    from: process.env.MAIL_FROM || 'Rental Agreement Desk <no-reply@example.com>',
    webhookUrl: process.env.NOTIFY_WEBHOOK_URL || '',
  },
  sessionCookie: 'ra_session',
  sessionTtlMs: 1000 * 60 * 60 * 8,
};

// A random fallback secret silently logs everyone out on restart, so make the
// problem loud instead of mysterious.
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[config] SESSION_SECRET is not set - admin sessions will not survive a restart.');
}

module.exports = config;
