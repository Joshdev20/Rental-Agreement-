'use strict';

const crypto = require('crypto');
const db = require('../db');
const schema = require('./agreement-schema');

const statements = {
  insert: db.prepare(`
    INSERT INTO submissions
      (reference, status, tenant_name, tenant_email, tenant_phone, property_address,
       monthly_rent, lease_start, lease_end, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  list: db.prepare(`
    SELECT id, reference, status, tenant_name, tenant_email, tenant_phone, property_address,
           monthly_rent, lease_start, lease_end, pdf_path, created_at
    FROM submissions
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `),
  count: db.prepare('SELECT COUNT(*) AS n FROM submissions'),
  byId: db.prepare('SELECT * FROM submissions WHERE id = ?'),
  byReference: db.prepare('SELECT * FROM submissions WHERE reference = ?'),
  setPdf: db.prepare('UPDATE submissions SET pdf_path = ?, updated_at = ? WHERE id = ?'),
  setStatus: db.prepare('UPDATE submissions SET status = ?, updated_at = ? WHERE id = ?'),
  all: db.prepare('SELECT * FROM submissions ORDER BY created_at DESC, id DESC'),
  insertNotification: db.prepare(`
    INSERT INTO notifications (submission_id, channel, target, status, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  notificationsFor: db.prepare(
    'SELECT * FROM notifications WHERE submission_id = ? ORDER BY created_at DESC, id DESC'
  ),
  notificationCounts: db.prepare(`
    SELECT status, COUNT(*) AS n FROM notifications
    WHERE submission_id = ? GROUP BY status
  `),
};

/** Human friendly, sortable reference such as RA-2026-4F7C21. */
function makeReference() {
  const year = new Date().getUTCFullYear();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
    const reference = `RA-${year}-${suffix}`;
    if (!statements.byReference.get(reference)) return reference;
  }
  return `RA-${year}-${Date.now().toString(36).toUpperCase()}`;
}

function create(data) {
  const now = new Date().toISOString();
  const summary = schema.summarize(data);
  const reference = makeReference();

  const info = statements.insert.run(
    reference,
    'submitted',
    summary.tenant_name,
    summary.tenant_email,
    summary.tenant_phone,
    summary.property_address,
    summary.monthly_rent,
    summary.lease_start,
    summary.lease_end,
    JSON.stringify(data),
    now,
    now
  );

  return getById(Number(info.lastInsertRowid));
}

function hydrate(row) {
  if (!row) return null;
  let payload = {};
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = {};
  }
  return { ...row, data: payload };
}

function getById(id) {
  return hydrate(statements.byId.get(Number(id)));
}

function getByReference(reference) {
  return hydrate(statements.byReference.get(String(reference)));
}

function list({ limit = 50, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  return {
    total: Number(statements.count.get().n),
    items: statements.list.all(safeLimit, safeOffset),
  };
}

function listAll() {
  return statements.all.all().map(hydrate);
}

function attachPdf(id, pdfPath) {
  statements.setPdf.run(pdfPath, new Date().toISOString(), Number(id));
  return getById(id);
}

function setStatus(id, status) {
  statements.setStatus.run(String(status), new Date().toISOString(), Number(id));
  return getById(id);
}

function recordNotification(submissionId, { channel, target, status, detail }) {
  statements.insertNotification.run(
    Number(submissionId),
    String(channel),
    target ? String(target) : null,
    String(status),
    detail ? String(detail) : null,
    new Date().toISOString()
  );
}

function notificationsFor(submissionId) {
  return statements.notificationsFor.all(Number(submissionId));
}

function notificationSummary(submissionId) {
  const rows = statements.notificationCounts.all(Number(submissionId));
  return rows.reduce((acc, row) => {
    acc[row.status] = Number(row.n);
    return acc;
  }, {});
}

module.exports = {
  create,
  getById,
  getByReference,
  list,
  listAll,
  attachPdf,
  setStatus,
  recordNotification,
  notificationsFor,
  notificationSummary,
};
