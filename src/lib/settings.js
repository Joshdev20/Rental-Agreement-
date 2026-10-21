'use strict';

/**
 * Editable application settings, stored in SQLite so an administrator can
 * configure external connections from the dashboard instead of editing .env.
 *
 * This module is the single source of truth: the dashboard renders its fields,
 * validates against its rules, and the notify layer reads resolved values from
 * here. Precedence is stored value -> environment (.env) -> built-in default,
 * so existing deployments keep working and a value saved in the dashboard
 * overrides the environment without a restart.
 */

const db = require('../db');
const config = require('../config');

const statements = {
  all: db.prepare('SELECT key, value FROM settings'),
  byKey: db.prepare('SELECT value FROM settings WHERE key = ?'),
  upsert: db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `),
  removeAll: db.prepare('DELETE FROM settings'),
};

// --- Validation helpers ----------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HOST_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

function isValidEmail(value) {
  return EMAIL_RE.test(String(value).trim());
}

function isValidHost(value) {
  const text = String(value).trim();
  if (!text) return false;
  // Allow an IPv4 literal, otherwise a hostname (optionally with a port).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return true;
  return HOST_RE.test(text);
}

/**
 * Only http(s) endpoints may be called by the notifier. Rejecting other
 * schemes here stops a saved setting from turning into a file: or gopher:
 * fetch, which would be a server-side request forgery primitive.
 */
function normalizeHttpUrl(value) {
  const text = String(value).trim();
  if (!text) return { ok: true, value: '' };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: 'Enter a full URL, for example https://example.com/hooks/rental.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, message: 'The URL must start with http:// or https://.' };
  }
  return { ok: true, value: url.toString() };
}

// --- Definitions -----------------------------------------------------------
// envDefault is a function so the environment is read at call time. That keeps
// .env values as the fallback and lets tests point the notifier at a fixture
// server after this module has loaded.

const DEFINITIONS = [
  {
    key: 'notify_email',
    group: 'email',
    label: 'Notification recipient',
    hint: 'Where submission alerts are sent. Defaults to the administrator address.',
    type: 'email',
    placeholder: 'manager@example.com',
    envDefault: () => config.notify.email || '',
    validate: (value) => (!value || isValidEmail(value) ? null : 'Enter a valid email address.'),
  },
  {
    key: 'smtp_host',
    group: 'email',
    label: 'SMTP host',
    hint: 'Mail server hostname, for example smtp.gmail.com. Leave blank to disable email alerts.',
    type: 'text',
    placeholder: 'smtp.example.com',
    envDefault: () => config.notify.smtp.host || '',
    validate: (value) => (!value || isValidHost(value) ? null : 'Enter a valid hostname.'),
  },
  {
    key: 'smtp_port',
    group: 'email',
    label: 'SMTP port',
    hint: '587 for STARTTLS, 465 for implicit TLS, 25 for plain relay.',
    type: 'number',
    placeholder: '587',
    envDefault: () => String(config.notify.smtp.port || 587),
    validate: (value) => {
      if (!value) return null;
      const port = Number(value);
      return Number.isInteger(port) && port >= 1 && port <= 65535
        ? null
        : 'Port must be a whole number between 1 and 65535.';
    },
  },
  {
    key: 'smtp_secure',
    group: 'email',
    label: 'Use implicit TLS',
    hint: 'Turn on for port 465. Leave off for 587, which upgrades with STARTTLS.',
    type: 'boolean',
    envDefault: () => (config.notify.smtp.secure ? 'true' : 'false'),
    validate: () => null,
  },
  {
    key: 'smtp_user',
    group: 'email',
    label: 'SMTP username',
    hint: 'Usually the full email address of the sending account.',
    type: 'text',
    placeholder: 'notifications@example.com',
    envDefault: () => config.notify.smtp.user || '',
    validate: () => null,
  },
  {
    key: 'smtp_pass',
    group: 'email',
    label: 'SMTP password',
    hint: 'Stored on this server and never sent back to the browser.',
    type: 'password',
    secret: true,
    envDefault: () => config.notify.smtp.pass || '',
    validate: () => null,
  },
  {
    key: 'mail_from',
    group: 'email',
    label: 'From address',
    hint: 'The sender shown on alert emails.',
    type: 'text',
    placeholder: 'Rental Agreement Desk <no-reply@example.com>',
    envDefault: () => config.notify.from || '',
    validate: (value) => {
      if (!value) return null;
      const address = String(value).match(/<([^>]+)>/);
      const candidate = address ? address[1] : value;
      return isValidEmail(candidate) ? null : 'Enter a valid email address.';
    },
  },
  {
    key: 'webhook_url',
    group: 'webhook',
    label: 'Webhook URL',
    hint: 'Receives a JSON POST for every submission. Useful for Slack, Zapier or your own endpoint.',
    type: 'url',
    placeholder: 'https://example.com/hooks/rental',
    envDefault: () => config.notify.webhookUrl || '',
    validate: (value) => {
      const result = normalizeHttpUrl(value);
      return result.ok ? null : result.message;
    },
  },
];

const byKey = new Map(DEFINITIONS.map((def) => [def.key, def]));

// --- Read ------------------------------------------------------------------

function storedValues() {
  const out = {};
  for (const row of statements.all.all()) out[row.key] = row.value;
  return out;
}

/** The stored value, or undefined when the administrator has never saved one. */
function stored(key) {
  const row = statements.byKey.get(String(key));
  return row ? row.value : undefined;
}

/** Resolved value honouring stored -> environment -> default precedence. */
function get(key) {
  const def = byKey.get(key);
  if (!def) return undefined;
  const saved = stored(key);
  if (saved !== undefined) return saved;
  return def.envDefault();
}

/** Where the effective value comes from, so the dashboard can show it. */
function source(key) {
  if (stored(key) !== undefined) return 'dashboard';
  const def = byKey.get(key);
  if (!def) return 'default';
  return def.envDefault() ? 'environment' : 'default';
}

function resolved() {
  const out = {};
  for (const def of DEFINITIONS) out[def.key] = get(def.key);
  return out;
}

/** Shape consumed by the notify layer. */
function notifyConfig() {
  return {
    email: get('notify_email') || config.admin.email,
    from: get('mail_from') || config.notify.from,
    webhookUrl: get('webhook_url') || '',
    smtp: {
      host: get('smtp_host') || '',
      port: Number(get('smtp_port')) || 587,
      secure: String(get('smtp_secure')) === 'true',
      user: get('smtp_user') || '',
      pass: get('smtp_pass') || '',
    },
  };
}

// --- Presentation ----------------------------------------------------------

/**
 * Definitions plus current values for the dashboard. Secret values are never
 * returned: the browser receives a flag so it can show "configured" instead.
 */
function forClient() {
  return DEFINITIONS.map((def) => {
    const value = get(def.key) || '';
    const entry = {
      key: def.key,
      group: def.group,
      label: def.label,
      hint: def.hint || '',
      type: def.type,
      placeholder: def.placeholder || '',
      source: source(def.key),
    };
    if (def.secret) {
      entry.value = '';
      entry.secret = true;
      entry.isSet = Boolean(value);
    } else {
      entry.value = value;
    }
    return entry;
  });
}

/** A short, non-secret description of the active configuration. */
function summary() {
  const current = notifyConfig();
  return {
    email: {
      enabled: Boolean(current.smtp.host),
      host: current.smtp.host || null,
      port: current.smtp.host ? current.smtp.port : null,
      secure: current.smtp.host ? current.smtp.secure : null,
      recipient: current.email,
      from: current.from,
    },
    webhook: {
      enabled: Boolean(current.webhookUrl),
      url: current.webhookUrl || null,
    },
  };
}

// --- Write -----------------------------------------------------------------

/**
 * Persist a set of settings. Secrets are only written when a replacement is
 * supplied, so a blank password field means "leave it alone" rather than
 * "erase the stored password".
 *
 * Returns { ok, errors, updated } where errors is keyed by setting name.
 */
function update(input = {}, { clear = [] } = {}) {
  const errors = {};
  const writes = [];
  const clears = new Set([].concat(clear).map(String));

  for (const [key, raw] of Object.entries(input)) {
    const def = byKey.get(key);
    if (!def) continue;
    if (clears.has(key)) continue;

    const value = raw === undefined || raw === null ? '' : String(raw).trim();

    // A blank secret means "unchanged", so skip it entirely.
    if (def.secret && value === '') continue;

    const message = def.validate(value);
    if (message) {
      errors[key] = message;
      continue;
    }

    writes.push({ key, value: def.type === 'url' ? normalizeHttpUrl(value).value : value });
  }

  for (const key of clears) {
    if (!byKey.has(key)) continue;
    writes.push({ key, value: '' });
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors, updated: [] };

  const now = new Date().toISOString();
  const seen = new Set();
  const updated = [];
  for (const { key, value } of writes) {
    if (seen.has(key)) continue;
    seen.add(key);
    statements.upsert.run(key, value, now);
    updated.push(key);
  }

  return { ok: true, errors: {}, updated };
}

/** Remove every stored override, falling back to .env and defaults. */
function resetAll() {
  statements.removeAll.run();
}

module.exports = {
  DEFINITIONS,
  get,
  source,
  resolved,
  stored,
  notifyConfig,
  forClient,
  summary,
  update,
  resetAll,
  isValidEmail,
  normalizeHttpUrl,
};
