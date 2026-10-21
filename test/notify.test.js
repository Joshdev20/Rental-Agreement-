'use strict';

/**
 * Notification tests against real servers: a live HTTP endpoint for the webhook
 * and a real SMTP conversation for e-mail. No mocks - the production notify
 * module talks to actual sockets.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { baseSubmission } = require('./helpers');

const schema = require('../src/lib/agreement-schema');
const submissions = require('../src/lib/submissions');

/** Minimal SMTP server: accepts a message and records the raw transcript. */
function startSmtpServer() {
  const state = { transcript: '', messages: 0 };
  const server = net.createServer((socket) => {
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
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, state, port: server.address().port })
    );
  });
}

function startWebhookServer() {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        received.push({ headers: req.headers, body: JSON.parse(body) });
      } catch {
        received.push({ headers: req.headers, body: null });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port }));
  });
}

test('notifications: e-mail and webhook are delivered and recorded', async (t) => {
  const smtp = await startSmtpServer();
  const hook = await startWebhookServer();
  t.after(() => {
    smtp.server.close();
    hook.server.close();
  });

  // Configure the notify module after its dependencies are reachable.
  const config = require('../src/config');
  config.notify.email = 'owner@example.com';
  config.notify.smtp = { host: '127.0.0.1', port: smtp.port, secure: false, user: '', pass: '' };
  config.notify.webhookUrl = `http://127.0.0.1:${hook.port}/notify`;

  const { notifyAdmins } = require('../src/lib/notify');

  const data = schema.normalize(baseSubmission({ tenant_name: 'Notify Tester' }));
  const submission = submissions.create(data);
  const results = await notifyAdmins(submission);

  assert.deepEqual(
    results.map((result) => `${result.channel}:${result.status}`).sort(),
    ['email:sent', 'webhook:sent']
  );

  // The webhook payload must describe the submission.
  assert.equal(hook.received.length, 1);
  const payload = hook.received[0].body;
  assert.equal(payload.event, 'rental_agreement.submitted');
  assert.equal(payload.reference, submission.reference);
  assert.equal(payload.tenant.name, 'Notify Tester');
  assert.equal(payload.tenant.email, 'john@example.com');
  assert.equal(payload.monthlyRent, 1850);
  assert.ok(payload.adminUrl.includes('/admin/submissions/'));
  assert.match(hook.received[0].headers['content-type'], /application\/json/);

  // The SMTP transcript must contain a real message to the admin address.
  assert.equal(smtp.state.messages, 1);
  assert.match(smtp.state.transcript, /Subject: New rental agreement/);
  assert.ok(smtp.state.transcript.includes('owner@example.com'), 'admin address must appear');
  assert.ok(smtp.state.transcript.includes('Notify Tester'), 'message must name the tenant');
  assert.ok(smtp.state.transcript.includes('RA-'), 'message must include the reference');

  // Both attempts are persisted for the dashboard.
  const logged = submissions.notificationsFor(submission.id).map((n) => `${n.channel}:${n.status}`);
  assert.ok(logged.includes('email:sent'));
  assert.ok(logged.includes('webhook:sent'));
});

test('notifications: a failing webhook is recorded as failed, not thrown', async (t) => {
  const config = require('../src/config');
  config.notify.smtp = { host: '', port: 587, secure: false, user: '', pass: '' };
  // Port 1 is closed, so the connection is refused.
  config.notify.webhookUrl = 'http://127.0.0.1:1/unreachable';

  const { notifyAdmins } = require('../src/lib/notify');
  const data = schema.normalize(baseSubmission());
  const submission = submissions.create(data);

  const results = await notifyAdmins(submission);
  const webhook = results.find((result) => result.channel === 'webhook');
  assert.equal(webhook.status, 'failed', 'a broken webhook must not throw');

  const logged = submissions.notificationsFor(submission.id);
  const failed = logged.find((entry) => entry.channel === 'webhook');
  assert.equal(failed.status, 'failed');
  assert.ok(failed.detail, 'failure reason should be recorded');

  // Reset so later tests see the unconfigured default.
  config.notify.webhookUrl = '';
});
