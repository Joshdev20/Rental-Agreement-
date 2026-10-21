'use strict';

const nodemailer = require('nodemailer');
const schema = require('./agreement-schema');
const submissions = require('./submissions');
const settings = require('./settings');

let transporter = null;
let transporterKey = null;

/**
 * Settings are read on every send so a change made in the dashboard takes
 * effect immediately. The transport is cached per configuration: reusing a
 * cached connection after the host or credentials change would silently send
 * mail through the old server.
 */
function mailerEnabled() {
  return Boolean(settings.notifyConfig().smtp.host);
}

function getTransporter() {
  const current = settings.notifyConfig();
  if (!current.smtp.host) return null;

  const key = JSON.stringify(current.smtp);
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: current.smtp.host,
      port: current.smtp.port,
      secure: current.smtp.secure,
      auth: current.smtp.user
        ? { user: current.smtp.user, pass: current.smtp.pass }
        : undefined,
    });
    transporterKey = key;
  }
  return transporter;
}

function buildSummaryText(submission) {
  const { data } = submission;
  const money = (field) => schema.displayValue(schema.fieldByName.get(field), data[field]) || '-';
  return [
    `New rental agreement submission: ${submission.reference}`,
    '',
    `Tenant:           ${data.tenant_name || '-'}`,
    `Tenant email:     ${data.tenant_email || '-'}`,
    `Tenant phone:     ${data.tenant_phone || '-'}`,
    `Property:         ${submission.property_address || '-'}`,
    `Monthly rent:     ${money('monthly_rent')}`,
    `Security deposit: ${money('security_deposit')}`,
    `Lease term:       ${schema.formatDate(data.lease_start) || '-'} to ${schema.formatDate(data.lease_end) || '-'}`,
    `Signed on:        ${schema.formatDate(data.signature_date) || '-'}`,
    `Submitted at:     ${submission.created_at}`,
    '',
    'Open the admin dashboard to review the full submission and print or download',
    'the generated PDF agreement.',
  ].join('\n');
}

function buildSummaryHtml(submission) {
  const { data } = submission;
  const money = (field) => schema.displayValue(schema.fieldByName.get(field), data[field]) || '-';
  const row = (label, value) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#4b5563;font:600 13px system-ui">${label}</td>` +
    `<td style="padding:6px 0;color:#111827;font:13px system-ui">${escapeHtml(String(value))}</td></tr>`;

  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;padding:24px">
  <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
    <div style="background:#111827;padding:18px 24px">
      <div style="color:#fff;font:700 16px system-ui">New Rental Agreement Submission</div>
      <div style="color:#9ca3af;font:13px system-ui;margin-top:2px">Reference ${escapeHtml(submission.reference)}</div>
    </div>
    <div style="padding:20px 24px">
      <table style="border-collapse:collapse;width:100%">
        ${row('Tenant', data.tenant_name || '-')}
        ${row('Email', data.tenant_email || '-')}
        ${row('Phone', data.tenant_phone || '-')}
        ${row('Property', submission.property_address || '-')}
        ${row('Monthly rent', money('monthly_rent'))}
        ${row('Security deposit', money('security_deposit'))}
        ${row('Lease term', `${schema.formatDate(data.lease_start) || '-'} to ${schema.formatDate(data.lease_end) || '-'}`)}
        ${row('Signed on', schema.formatDate(data.signature_date) || '-')}
      </table>
      <p style="font:13px system-ui;color:#4b5563;margin:18px 0 0">
        Sign in to the admin dashboard to view every field, then print or download the
        generated PDF agreement.
      </p>
    </div>
  </div></body></html>`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendEmail(submission) {
  const current = settings.notifyConfig();
  const to = current.email;
  if (!current.smtp.host) {
    submissions.recordNotification(submission.id, {
      channel: 'email',
      target: to,
      status: 'skipped',
      detail: 'No SMTP host is configured; e-mail notification not sent.',
    });
    return { channel: 'email', status: 'skipped' };
  }

  try {
    await getTransporter().sendMail({
      from: current.from,
      to,
      subject: `New rental agreement ${submission.reference} - ${submission.tenant_name}`,
      text: buildSummaryText(submission),
      html: buildSummaryHtml(submission),
    });
    submissions.recordNotification(submission.id, {
      channel: 'email',
      target: to,
      status: 'sent',
      detail: null,
    });
    return { channel: 'email', status: 'sent' };
  } catch (error) {
    submissions.recordNotification(submission.id, {
      channel: 'email',
      target: to,
      status: 'failed',
      detail: error.message,
    });
    console.error('[notify] e-mail failed:', error.message);
    return { channel: 'email', status: 'failed' };
  }
}

async function sendWebhook(submission) {
  const url = settings.notifyConfig().webhookUrl;
  if (!url) {
    submissions.recordNotification(submission.id, {
      channel: 'webhook',
      target: null,
      status: 'skipped',
      detail: 'No webhook URL is configured.',
    });
    return { channel: 'webhook', status: 'skipped' };
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'rental_agreement.submitted',
        reference: submission.reference,
        submittedAt: submission.created_at,
        tenant: {
          name: submission.tenant_name,
          email: submission.tenant_email,
          phone: submission.tenant_phone,
        },
        property: submission.property_address,
        monthlyRent: submission.monthly_rent,
        leaseStart: submission.lease_start,
        leaseEnd: submission.lease_end,
        adminUrl: `/admin/submissions/${submission.id}`,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const status = response.ok ? 'sent' : 'failed';
    submissions.recordNotification(submission.id, {
      channel: 'webhook',
      target: url,
      status,
      detail: `HTTP ${response.status}`,
    });
    return { channel: 'webhook', status };
  } catch (error) {
    submissions.recordNotification(submission.id, {
      channel: 'webhook',
      target: url,
      status: 'failed',
      detail: error.message,
    });
    console.error('[notify] webhook failed:', error.message);
    return { channel: 'webhook', status: 'failed' };
  }
}

/**
 * Verify the mail settings by opening a real connection and sending a test
 * message. Returns a result object rather than throwing so the dashboard can
 * show the server's own error text.
 */
async function testEmail(recipient) {
  const current = settings.notifyConfig();
  if (!current.smtp.host) {
    return { ok: false, message: 'Set an SMTP host before testing.' };
  }
  const to = String(recipient || '').trim() || current.email;
  if (!settings.isValidEmail(to)) {
    return { ok: false, message: 'Enter a valid recipient email address.' };
  }

  try {
    const info = await getTransporter().sendMail({
      from: current.from,
      to,
      subject: 'Rental Agreement Desk test email',
      text: [
        'This is a test message from your Rental Agreement Desk dashboard.',
        '',
        `SMTP host: ${current.smtp.host}:${current.smtp.port}`,
        `Implicit TLS: ${current.smtp.secure ? 'yes' : 'no'}`,
        '',
        'If you received this, submission alerts are configured correctly.',
      ].join('\n'),
    });
    return { ok: true, message: `Test email accepted for ${to}.`, detail: info.response || null };
  } catch (error) {
    return { ok: false, message: `SMTP rejected the message: ${error.message}` };
  }
}

/** Verify the webhook by POSTing a sample payload. */
async function testWebhook() {
  const url = settings.notifyConfig().webhookUrl;
  if (!url) return { ok: false, message: 'Set a webhook URL before testing.' };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'rental_agreement.test',
        message: 'Test delivery from the Rental Agreement Desk dashboard.',
        sentAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return { ok: false, message: `The endpoint replied with HTTP ${response.status}.` };
    }
    return { ok: true, message: `The endpoint replied with HTTP ${response.status}.` };
  } catch (error) {
    return { ok: false, message: `Could not reach the endpoint: ${error.message}` };
  }
}

/**
 * Notify administrators about a new submission. Never throws: a notification
 * problem must not cost the tenant their submission.
 */
async function notifyAdmins(submission) {
  const results = await Promise.allSettled([sendEmail(submission), sendWebhook(submission)]);
  return results.map((result) =>
    result.status === 'fulfilled' ? result.value : { channel: 'unknown', status: 'failed' }
  );
}

module.exports = { notifyAdmins, mailerEnabled, buildSummaryText, testEmail, testWebhook };
