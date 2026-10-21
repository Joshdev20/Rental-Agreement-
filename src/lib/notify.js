'use strict';

const nodemailer = require('nodemailer');
const config = require('../config');
const schema = require('./agreement-schema');
const submissions = require('./submissions');

let transporter = null;

function mailerEnabled() {
  return Boolean(config.notify.smtp.host);
}

function getTransporter() {
  if (!mailerEnabled()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.notify.smtp.host,
      port: config.notify.smtp.port,
      secure: config.notify.smtp.secure,
      auth: config.notify.smtp.user
        ? { user: config.notify.smtp.user, pass: config.notify.smtp.pass }
        : undefined,
    });
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
  const to = config.notify.email;
  if (!mailerEnabled()) {
    submissions.recordNotification(submission.id, {
      channel: 'email',
      target: to,
      status: 'skipped',
      detail: 'SMTP_HOST is not configured; e-mail notification not sent.',
    });
    return { channel: 'email', status: 'skipped' };
  }

  try {
    await getTransporter().sendMail({
      from: config.notify.from,
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
  const url = config.notify.webhookUrl;
  if (!url) {
    submissions.recordNotification(submission.id, {
      channel: 'webhook',
      target: null,
      status: 'skipped',
      detail: 'NOTIFY_WEBHOOK_URL is not configured.',
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
 * Notify administrators about a new submission. Never throws: a notification
 * problem must not cost the tenant their submission.
 */
async function notifyAdmins(submission) {
  const results = await Promise.allSettled([sendEmail(submission), sendWebhook(submission)]);
  return results.map((result) =>
    result.status === 'fulfilled' ? result.value : { channel: 'unknown', status: 'failed' }
  );
}

module.exports = { notifyAdmins, mailerEnabled, buildSummaryText };
