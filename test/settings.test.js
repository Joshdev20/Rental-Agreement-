'use strict';

/**
 * Settings tests. These exercise the real settings module, the real Express
 * routes and a real SMTP conversation, so the dashboard's "test connection"
 * buttons are verified against live sockets rather than stubs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const { baseSubmission, cleanup } = require('./helpers');

const { app } = require('../src/server');
const auth = require('../src/lib/auth');
const config = require('../src/config');
const settings = require('../src/lib/settings');
const schema = require('../src/lib/agreement-schema');
const submissions = require('../src/lib/submissions');

let server;
let baseUrl;
let cookie = '';

/** Minimal SMTP server that accepts a message and records the transcript. */
function startSmtpServer() {
  const state = { transcript: '', messages: 0 };
  const srv = net.createServer((socket) => {
    socket.write('220 test.local ESMTP\r\n');
    let buffer = '';
    let inData = false;
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      state.transcript += chunk.toString();
      if (inData) {
        if (buffer.includes('\r\n.\r\n')) {
          state.messages += 1;
          inData = false;
          buffer = '';
          socket.write('250 OK queued\r\n');
        }
        return;
      }
      const lines = buffer.split('\r\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (/^(EHLO|HELO)/i.test(line)) socket.write('250-test.local\r\n250 OK\r\n');
        else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write('354 Start mail input\r\n');
        } else if (/^QUIT/i.test(line)) {
          socket.write('221 Bye\r\n');
          socket.end();
        } else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve({ server: srv, state, port: srv.address().port }));
  });
}

function startWebhookServer(status = 200) {
  const received = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        received.push({ headers: req.headers, body: JSON.parse(body) });
      } catch {
        received.push({ headers: req.headers, body: null });
      }
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve({ server: srv, received, port: srv.address().port }));
  });
}

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
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

async function login() {
  const response = await api('/admin/api/login', {
    method: 'POST',
    body: JSON.stringify({ email: config.admin.email, password: config.admin.password }),
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')];
  cookie = setCookie.map((entry) => entry.split(';')[0]).join('; ');
}

// ------------------------------------------------------------- access control

test('settings require an authenticated administrator', async () => {
  const saved = cookie;
  cookie = '';
  try {
    const response = await api('/admin/api/settings');
    assert.equal(response.status, 401, 'anonymous reads must be rejected');

    const write = await api('/admin/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ settings: { smtp_host: 'evil.example.com' } }),
    });
    assert.equal(write.status, 401, 'anonymous writes must be rejected');

    // The settings page itself must not be served to an anonymous visitor.
    const page = await fetch(`${baseUrl}/admin/settings`, { redirect: 'manual' });
    assert.equal(page.status, 302);
    assert.match(page.headers.get('location'), /\/admin\/login/);
  } finally {
    cookie = saved;
  }

  await login();
});

// ------------------------------------------------------------------ read/write

test('settings round-trip through the dashboard API', async () => {
  const before = await api('/admin/api/settings');
  assert.equal(before.status, 200);
  const body = await before.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.settings) && body.settings.length > 0);

  // Every field the UI needs must be present.
  for (const entry of body.settings) {
    assert.ok(entry.key, 'a setting needs a key');
    assert.ok(entry.group, 'a setting needs a group');
    assert.ok(entry.label, 'a setting needs a label');
    assert.ok(entry.type, 'a setting needs a type');
    assert.ok(typeof entry.source === 'string', 'a setting needs a source');
  }

  const save = await api('/admin/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      settings: {
        notify_email: 'alerts@example.com',
        smtp_host: 'smtp.example.com',
        smtp_port: '587',
        mail_from: 'Desk <desk@example.com>',
        webhook_url: 'https://hooks.example.com/rental',
      },
    }),
  });
  assert.equal(save.status, 200);
  const saved = await save.json();
  assert.equal(saved.ok, true);
  assert.ok(saved.updated.includes('smtp_host'));

  const after = await (await api('/admin/api/settings')).json();
  const byKey = Object.fromEntries(after.settings.map((entry) => [entry.key, entry]));
  assert.equal(byKey.smtp_host.value, 'smtp.example.com');
  assert.equal(byKey.notify_email.value, 'alerts@example.com');
  assert.equal(byKey.webhook_url.value, 'https://hooks.example.com/rental');
  assert.equal(byKey.smtp_host.source, 'dashboard', 'a saved value should be attributed to the dashboard');

  // The saved values must reach the notify layer.
  const effective = settings.notifyConfig();
  assert.equal(effective.smtp.host, 'smtp.example.com');
  assert.equal(effective.email, 'alerts@example.com');
  assert.equal(effective.webhookUrl, 'https://hooks.example.com/rental');
});

test('settings validation rejects bad values and keeps the previous ones', async () => {
  const response = await api('/admin/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      settings: {
        smtp_port: '99999',
        notify_email: 'not-an-email',
        webhook_url: 'ftp://example.com/hook',
      },
    }),
  });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.ok(body.errors.smtp_port, 'port range must be enforced');
  assert.ok(body.errors.notify_email, 'email format must be enforced');
  assert.ok(body.errors.webhook_url, 'only http(s) webhooks may be saved');

  // A rejected write must not have changed anything.
  const after = await (await api('/admin/api/settings')).json();
  const byKey = Object.fromEntries(after.settings.map((entry) => [entry.key, entry]));
  assert.equal(byKey.smtp_host.value, 'smtp.example.com');
});

test('a non-http webhook scheme is refused', () => {
  for (const bad of ['file:///etc/passwd', 'ftp://example.com', 'gopher://example.com']) {
    assert.equal(settings.normalizeHttpUrl(bad).ok, false, `${bad} must be rejected`);
  }
  assert.equal(settings.normalizeHttpUrl('https://example.com/hook').ok, true);
  assert.equal(settings.normalizeHttpUrl('').ok, true, 'a blank URL disables the webhook');
});

// ------------------------------------------------------------------- secrets

test('the SMTP password is never returned to the browser', async () => {
  await api('/admin/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: { smtp_pass: 'super-secret-value' } }),
  });

  const body = await (await api('/admin/api/settings')).json();
  const password = body.settings.find((entry) => entry.key === 'smtp_pass');
  assert.equal(password.value, '', 'the secret must not be echoed back');
  assert.equal(password.isSet, true, 'the UI must still know a secret exists');

  // It must not appear anywhere in the serialized response.
  assert.ok(!JSON.stringify(body).includes('super-secret-value'), 'secret leaked in the payload');
});

test('a blank password field preserves the stored secret', async () => {
  await api('/admin/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: { smtp_pass: 'keep-me-please' } }),
  });

  // Simulate saving the form while leaving the password field untouched.
  await api('/admin/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: { smtp_pass: '', smtp_user: 'mailer@example.com' } }),
  });

  assert.equal(settings.get('smtp_pass'), 'keep-me-please', 'a blank field must not erase the secret');
  assert.equal(settings.get('smtp_user'), 'mailer@example.com');
});

test('a password can be explicitly cleared', async () => {
  await api('/admin/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: { smtp_pass: 'clear-me' } }),
  });
  assert.equal(settings.get('smtp_pass'), 'clear-me');

  await api('/admin/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: {}, clear: ['smtp_pass'] }),
  });
  assert.equal(settings.get('smtp_pass'), '', 'an explicit clear must remove the secret');

  const body = await (await api('/admin/api/settings')).json();
  const password = body.settings.find((entry) => entry.key === 'smtp_pass');
  assert.equal(password.isSet, false);
});

// --------------------------------------------------------- live connections

test('the test-email button sends through the configured SMTP server', async (t) => {
  const smtp = await startSmtpServer();
  t.after(() => smtp.server.close());

  await api('/admin/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      settings: {
        notify_email: 'owner@example.com',
        smtp_host: '127.0.0.1',
        smtp_port: String(smtp.port),
        smtp_secure: 'false',
        mail_from: 'Desk <desk@example.com>',
      },
      clear: ['smtp_user', 'smtp_pass'],
    }),
  });

  const response = await api('/admin/api/settings/test-email', {
    method: 'POST',
    body: JSON.stringify({ recipient: 'owner@example.com' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true, `test email failed: ${body.message}`);

  assert.equal(smtp.state.messages, 1, 'the SMTP server must have received a message');
  assert.match(smtp.state.transcript, /Subject: Rental Agreement Desk test email/);
  assert.ok(smtp.state.transcript.includes('owner@example.com'), 'recipient must appear in the message');
});

test('the test-webhook button posts a sample payload', async (t) => {
  const hook = await startWebhookServer();
  t.after(() => hook.server.close());

  await api('/admin/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: { webhook_url: `http://127.0.0.1:${hook.port}/notify` } }),
  });

  const response = await api('/admin/api/settings/test-webhook', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);

  assert.equal(hook.received.length, 1);
  assert.equal(hook.received[0].body.event, 'rental_agreement.test');
});

test('an unreachable endpoint is reported, not thrown', async () => {
  await api('/admin/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: { webhook_url: 'http://127.0.0.1:1/unreachable' } }),
  });

  const response = await api('/admin/api/settings/test-webhook', { method: 'POST' });
  assert.equal(response.status, 422);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.ok(body.message.length > 0, 'the operator must get a readable reason');
});

// ------------------------------------------------------ notifier integration

test('a saved dashboard setting drives real submission alerts', async (t) => {
  const smtp = await startSmtpServer();
  const hook = await startWebhookServer();
  t.after(() => {
    smtp.server.close();
    hook.server.close();
  });

  await api('/admin/api/settings', {
    method: 'PUT',
    body: JSON.stringify({
      settings: {
        notify_email: 'dash@example.com',
        smtp_host: '127.0.0.1',
        smtp_port: String(smtp.port),
        smtp_secure: 'false',
        mail_from: 'Desk <desk@example.com>',
        webhook_url: `http://127.0.0.1:${hook.port}/notify`,
      },
      clear: ['smtp_user', 'smtp_pass'],
    }),
  });

  // Deliver through the production notify path, exactly as a submission does.
  const { notifyAdmins } = require('../src/lib/notify');
  const submission = submissions.create(schema.normalize(baseSubmission({ tenant_name: 'Dash Tester' })));
  const results = await notifyAdmins(submission);

  assert.deepEqual(
    results.map((result) => `${result.channel}:${result.status}`).sort(),
    ['email:sent', 'webhook:sent'],
    'dashboard settings must reach both channels'
  );
  assert.equal(smtp.state.messages, 1);
  assert.ok(smtp.state.transcript.includes('dash@example.com'), 'the dashboard recipient must be used');
  assert.equal(hook.received.length, 1);
  assert.equal(hook.received[0].body.tenant.name, 'Dash Tester');
});

// -------------------------------------------------------------- reset to env

test('reset restores the environment fallback', async () => {
  await api('/admin/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: { smtp_host: 'temporary.example.com' } }),
  });
  assert.equal(settings.get('smtp_host'), 'temporary.example.com');

  const response = await api('/admin/api/settings/reset', { method: 'POST' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);

  // The test environment has SMTP_HOST empty, so the value falls back to ''.
  assert.equal(settings.get('smtp_host'), '', 'reset must drop stored overrides');
  const body = await (await api('/admin/api/settings')).json();
  const host = body.settings.find((entry) => entry.key === 'smtp_host');
  assert.notEqual(host.source, 'dashboard');
});

test('the settings page is served to an authenticated administrator', async () => {
  const response = await api('/admin/settings');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Connections and configuration/);
  assert.match(html, /\/js\/settings\.js/);
});
