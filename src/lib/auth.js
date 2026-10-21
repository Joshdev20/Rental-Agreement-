'use strict';

const crypto = require('crypto');
const db = require('../db');

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS).toString('hex');
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, salt, expected] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    const expectedBuf = Buffer.from(expected, 'hex');
    return (
      derived.length === expectedBuf.length && crypto.timingSafeEqual(derived, expectedBuf)
    );
  } catch {
    return false;
  }
}

const statements = {
  byEmail: db.prepare('SELECT * FROM admins WHERE email = ?'),
  byId: db.prepare('SELECT id, email, name, created_at FROM admins WHERE id = ?'),
  count: db.prepare('SELECT COUNT(*) AS n FROM admins'),
  insert: db.prepare(
    'INSERT INTO admins (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)'
  ),
  updatePassword: db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?'),
};

function createAdmin({ email, password, name }) {
  const created = new Date().toISOString();
  const info = statements.insert.run(
    String(email).trim().toLowerCase(),
    (name || 'Administrator').trim(),
    hashPassword(password),
    created
  );
  return { id: Number(info.lastInsertRowid), email, name };
}

function adminCount() {
  return Number(statements.count.get().n);
}

function findAdminByEmail(email) {
  return statements.byEmail.get(String(email || '').trim().toLowerCase()) || null;
}

function findAdminById(id) {
  return statements.byId.get(Number(id)) || null;
}

function changePassword(adminId, newPassword) {
  statements.updatePassword.run(hashPassword(newPassword), Number(adminId));
}

/** Seed the first administrator from environment configuration. */
function ensureSeedAdmin({ email, password, name }) {
  if (adminCount() > 0) return null;
  const admin = createAdmin({ email, password, name });
  console.log(`[auth] Seeded administrator account: ${admin.email}`);
  return admin;
}

// --- Stateless signed session cookies -------------------------------------

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function issueToken(admin, secret, ttlMs) {
  const body = base64url(
    JSON.stringify({
      sub: admin.id,
      email: admin.email,
      exp: Date.now() + ttlMs,
      jti: crypto.randomBytes(8).toString('hex'),
    })
  );
  return `${body}.${sign(body, secret)}`;
}

function verifyToken(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = sign(body, secret);
  const a = Buffer.from(signature || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!claims.exp || claims.exp < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createAdmin,
  adminCount,
  findAdminByEmail,
  findAdminById,
  changePassword,
  ensureSeedAdmin,
  issueToken,
  verifyToken,
  parseCookies,
};
