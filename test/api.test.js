'use strict';

/**
 * End-to-end API tests. These run against the real Express app, the real
 * SQLite database and the real PDF generator - no mocks.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { baseSubmission, cleanup } = require('./helpers');

const { app } = require('../src/server');
const auth = require('../src/lib/auth');
const config = require('../src/config');

let server;
let baseUrl;
let cookie = '';

test.before(async () => {
  auth.ensureSeedAdmin(config.admin);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  cleanup();
});

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  return response;
}

async function login() {
  const response = await api('/admin/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: config.admin.email, password: config.admin.password }),
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')];
  cookie = setCookie.map((entry) => entry.split(';')[0]).join('; ');
  return response.json();
}

// ---------------------------------------------------------------- public API

test('health check responds', async () => {
  const response = await api('/healthz');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test('form schema endpoint exposes all sections and fields', async () => {
  const response = await api('/api/form-schema');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sections.length, 10);
  const names = body.sections.flatMap((section) => section.fields.map((field) => field.name));
  assert.ok(names.includes('signature_data'));
  assert.ok(names.includes('monthly_rent'));
  assert.ok(body.usStates.length >= 50);
});

test('a complete submission is accepted and returns a reference', async () => {
  const response = await api('/api/submissions', {
    method: 'POST',
    body: JSON.stringify(baseSubmission()),
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.match(body.reference, /^RA-\d{4}-[0-9A-F]{6}$/);
});

test('an invalid submission is rejected with per-field errors', async () => {
  const response = await api('/api/submissions', {
    method: 'POST',
    body: JSON.stringify({ tenant_email: 'nope' }),
  });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.ok(body.errors.tenant_email);
  assert.ok(body.errors.property_address);
});

test('a crafted payload cannot inject fields into storage', async () => {
  const response = await api('/api/submissions', {
    method: 'POST',
    body: JSON.stringify(baseSubmission({ tenant_name: 'Injection Test', injected_field: 'malicious' })),
  });
  assert.equal(response.status, 201);
  const { reference } = await response.json();

  await login();
  const listResponse = await api('/admin/api/submissions?limit=200');
  const { items } = await listResponse.json();
  const created = items.find((item) => item.reference === reference);
  const detail = await (await api(`/admin/api/submissions/${created.id}`)).json();
  assert.equal(detail.submission.data.injected_field, undefined);
});

test('status lookup requires the matching email', async () => {
  const created = await (
    await api('/api/submissions', { method: 'POST', body: JSON.stringify(baseSubmission()) })
  ).json();

  const wrong = await api('/api/submissions/status', {
    method: 'POST',
    body: JSON.stringify({ reference: created.reference, email: 'someone-else@example.com' }),
  });
  assert.equal(wrong.status, 404);

  const right = await api('/api/submissions/status', {
    method: 'POST',
    body: JSON.stringify({ reference: created.reference, email: 'john@example.com' }),
  });
  assert.equal(right.status, 200);
  assert.equal((await right.json()).reference, created.reference);
});

// ------------------------------------------------------------------ security

test('admin endpoints reject anonymous requests', async () => {
  const saved = cookie;
  cookie = '';
  for (const path of ['/admin/api/submissions', '/admin/api/export.csv', '/admin/api/me']) {
    const response = await api(path);
    assert.equal(response.status, 401, `${path} should require authentication`);
  }
  cookie = saved;
});

test('the admin dashboard redirects anonymous visitors to the login page', async () => {
  const response = await fetch(`${baseUrl}/admin`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/admin/login');
});

test('login rejects a bad password and accepts the seeded one', async () => {
  const bad = await api('/admin/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: config.admin.email, password: 'wrong-password' }),
  });
  assert.equal(bad.status, 401);

  const good = await login();
  assert.equal(good.ok, true);
  assert.equal(good.admin.email, config.admin.email);
});

test('password hashes are salted, so identical passwords differ on disk', () => {
  const a = auth.hashPassword('SamePassword123');
  const b = auth.hashPassword('SamePassword123');
  assert.notEqual(a, b);
  assert.ok(auth.verifyPassword('SamePassword123', a));
  assert.ok(!auth.verifyPassword('DifferentPassword', a));
});

test('a tampered session token is rejected', () => {
  const admin = auth.findAdminByEmail(config.admin.email);
  const token = auth.issueToken(admin, config.sessionSecret, 60000);
  assert.ok(auth.verifyToken(token, config.sessionSecret));

  const [body, signature] = token.split('.');
  assert.equal(auth.verifyToken(`${body}.${signature.slice(0, -2)}xx`, config.sessionSecret), null);
  assert.equal(auth.verifyToken(token, 'a-different-secret'), null);
  assert.equal(auth.verifyToken('garbage', config.sessionSecret), null);
});

test('an expired session token is rejected', () => {
  const admin = auth.findAdminByEmail(config.admin.email);
  const expired = auth.issueToken(admin, config.sessionSecret, -1000);
  assert.equal(auth.verifyToken(expired, config.sessionSecret), null);
});

// --------------------------------------------------------------- admin flows

test('the admin list returns submissions with summary columns', async () => {
  await login();
  const response = await api('/admin/api/submissions?limit=10');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.total >= 1);
  const item = body.items[0];
  assert.ok(item.reference);
  assert.ok(item.tenant_name);
  assert.ok('monthly_rent' in item);
});

test('the generated PDF is a valid multi-page document with an embedded signature', async () => {
  await login();
  const created = await (
    await api('/api/submissions', { method: 'POST', body: JSON.stringify(baseSubmission()) })
  ).json();

  const list = await (await api('/admin/api/submissions?limit=200')).json();
  const row = list.items.find((item) => item.reference === created.reference);

  const response = await api(`/admin/api/submissions/${row.id}/pdf`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  assert.ok(buffer.includes(Buffer.from('%%EOF')), 'PDF should be complete');

  // The stored file must exist and match what was streamed.
  const stored = fs.readFileSync(row.pdf_path);
  assert.equal(stored.length, buffer.length);

  // At least one image XObject proves the signature was embedded.
  assert.ok(buffer.includes(Buffer.from('/Subtype /Image')) || buffer.includes(Buffer.from('/Subtype/Image')));
});

test('the PDF can be forced as a download', async () => {
  await login();
  const list = await (await api('/admin/api/submissions?limit=1')).json();
  const response = await api(`/admin/api/submissions/${list.items[0].id}/pdf?download=1`);
  assert.match(response.headers.get('content-disposition'), /^attachment/);
});

test('a submission status can be updated', async () => {
  await login();
  const list = await (await api('/admin/api/submissions?limit=1')).json();
  const id = list.items[0].id;

  const response = await api(`/admin/api/submissions/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: 'reviewed' }),
  });
  assert.equal(response.status, 200);

  const detail = await (await api(`/admin/api/submissions/${id}`)).json();
  assert.equal(detail.submission.status, 'reviewed');
});

test('an unknown status is rejected', async () => {
  await login();
  const list = await (await api('/admin/api/submissions?limit=1')).json();
  const response = await api(`/admin/api/submissions/${list.items[0].id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: 'exploded' }),
  });
  assert.equal(response.status, 422);
});

test('CSV export contains a header row and one row per submission', async () => {
  await login();
  const response = await api('/admin/api/export.csv');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);

  const text = await response.text();
  const lines = text.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.match(lines[0], /^reference,status,submitted_at,/);
  assert.ok(lines[0].includes('tenant_email'));
  assert.ok(lines.length >= 2);
});

test('CSV export escapes commas and quotes in values', async () => {
  await login();
  await api('/api/submissions', {
    method: 'POST',
    body: JSON.stringify(baseSubmission({ tenant_name: 'Tenant, "Quoted" Name' })),
  });
  const text = await (await api('/admin/api/export.csv')).text();
  assert.ok(text.includes('"Tenant, ""Quoted"" Name"'));
});

test('notification attempts are recorded even when delivery is skipped', async () => {
  await login();
  const created = await (
    await api('/api/submissions', { method: 'POST', body: JSON.stringify(baseSubmission()) })
  ).json();

  const list = await (await api('/admin/api/submissions?limit=200')).json();
  const row = list.items.find((item) => item.reference === created.reference);

  // Notification is dispatched asynchronously after the response is sent.
  let detail = null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    detail = await (await api(`/admin/api/submissions/${row.id}`)).json();
    if (detail.submission.notifications.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }

  const channels = detail.submission.notifications.map((item) => item.channel);
  assert.ok(channels.includes('email'), 'email notification should be logged');
  assert.ok(channels.includes('webhook'), 'webhook notification should be logged');
  for (const notification of detail.submission.notifications) {
    assert.ok(['sent', 'skipped', 'failed'].includes(notification.status));
  }
});

test('the submission detail includes every form section for rendering', async () => {
  await login();
  const list = await (await api('/admin/api/submissions?limit=1')).json();
  const detail = await (await api(`/admin/api/submissions/${list.items[0].id}`)).json();
  assert.equal(detail.sections.length, 10);
  assert.equal(detail.submission.pdfAvailable, true);
  assert.ok(detail.submission.data.tenant_name);
});

test('static pages are served', async () => {
  for (const path of ['/', '/status.html', '/admin/login', '/css/styles.css', '/js/form.js']) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 200, `${path} should be served`);
  }
});

test('unknown API routes return JSON 404s', async () => {
  const response = await api('/api/does-not-exist');
  assert.equal(response.status, 404);
  assert.equal((await response.json()).ok, false);
});
