'use strict';

const express = require('express');
const config = require('../config');
const auth = require('../lib/auth');

const router = express.Router();

const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function isLockedOut(key) {
  const record = attempts.get(key);
  if (!record) return false;
  if (Date.now() - record.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function recordFailure(key) {
  const record = attempts.get(key);
  if (!record || Date.now() - record.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: Date.now() });
    return;
  }
  record.count += 1;
}

function clearFailures(key) {
  attempts.delete(key);
}

/** Reads the signed session cookie and exposes req.admin when valid. */
function attachAdmin(req, res, next) {
  const cookies = auth.parseCookies(req.headers.cookie);
  const claims = auth.verifyToken(cookies[config.sessionCookie], config.sessionSecret);
  req.admin = claims ? auth.findAdminById(claims.sub) : null;
  next();
}

function requireAdmin(req, res, next) {
  if (req.admin) return next();
  // Inside a mounted router req.path is relative (e.g. "/submissions"), so the
  // full request path has to come from originalUrl. API callers expect JSON -
  // redirecting them to an HTML login page breaks their JSON parsing.
  const fullPath = req.originalUrl || req.url || '';
  const wantsJson =
    fullPath.startsWith('/admin/api') ||
    fullPath.startsWith('/api') ||
    (req.get('accept') || '').includes('application/json');
  if (wantsJson) {
    return res.status(401).json({ ok: false, message: 'Authentication required.' });
  }
  return res.redirect('/admin/login');
}

router.use(attachAdmin);

router.post('/api/login', (req, res) => {
  const key = clientKey(req);
  if (isLockedOut(key)) {
    return res.status(429).json({
      ok: false,
      message: 'Too many failed attempts. Please try again in a few minutes.',
    });
  }

  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  const admin = auth.findAdminByEmail(email);

  if (!admin || !auth.verifyPassword(password, admin.password_hash)) {
    recordFailure(key);
    return res.status(401).json({ ok: false, message: 'Invalid email or password.' });
  }

  clearFailures(key);
  const token = auth.issueToken(admin, config.sessionSecret, config.sessionTtlMs);
  res.cookie(config.sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: config.sessionTtlMs,
    path: '/',
  });
  res.json({ ok: true, admin: { id: admin.id, email: admin.email, name: admin.name } });
});

router.post('/api/logout', (req, res) => {
  res.clearCookie(config.sessionCookie, { path: '/' });
  res.json({ ok: true });
});

router.get('/api/me', (req, res) => {
  if (!req.admin) return res.status(401).json({ ok: false });
  res.json({ ok: true, admin: req.admin });
});

router.post('/api/password', requireAdmin, (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next_ = String(req.body?.newPassword || '');

  if (next_.length < 10) {
    return res.status(422).json({ ok: false, message: 'New password must be at least 10 characters.' });
  }

  const admin = auth.findAdminByEmail(req.admin.email);
  if (!admin || !auth.verifyPassword(current, admin.password_hash)) {
    return res.status(401).json({ ok: false, message: 'Current password is incorrect.' });
  }

  auth.changePassword(admin.id, next_);
  res.clearCookie(config.sessionCookie, { path: '/' });
  res.json({ ok: true, message: 'Password updated. Please sign in again.' });
});

module.exports = { router, requireAdmin, attachAdmin };
