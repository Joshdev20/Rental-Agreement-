'use strict';

const fs = require('fs');
const express = require('express');
const schema = require('../lib/agreement-schema');
const submissions = require('../lib/submissions');
const { renderPdf } = require('../lib/agreement-service');
const { requireAdmin } = require('./admin-auth');

const router = express.Router();

router.use('/api', requireAdmin);

function toCsv(rows) {
  const columns = schema.allFields.map((field) => field.name);
  const escape = (value) => {
    const text = value === undefined || value === null ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = ['reference', 'status', 'submitted_at', ...columns].map(escape).join(',');
  const body = rows.map((row) =>
    [
      row.reference,
      row.status,
      row.created_at,
      ...columns.map((name) => schema.displayValue(schema.fieldByName.get(name), row.data[name])),
    ]
      .map(escape)
      .join(',')
  );
  return [header, ...body].join('\r\n');
}

router.get('/api/submissions', (req, res) => {
  const limit = Number(req.query.limit || 50);
  const offset = Number(req.query.offset || 0);
  const { items, total } = submissions.list({ limit, offset });

  res.json({
    ok: true,
    total,
    limit,
    offset,
    items: items.map((item) => ({
      ...item,
      notificationSummary: submissions.notificationSummary(item.id),
    })),
  });
});

router.get('/api/submissions/:id', (req, res) => {
  const submission = submissions.getById(req.params.id);
  if (!submission) return res.status(404).json({ ok: false, message: 'Submission not found.' });

  const { pdf_path: pdfPath, ...rest } = submission;
  res.json({
    ok: true,
    submission: {
      ...rest,
      pdfAvailable: Boolean(pdfPath && fs.existsSync(pdfPath)),
      notifications: submissions.notificationsFor(submission.id),
    },
    sections: schema.sections,
  });
});

/** Stream the generated agreement inline for viewing or printing in-browser. */
router.get('/api/submissions/:id/pdf', async (req, res, next) => {
  try {
    const submission = submissions.getById(req.params.id);
    if (!submission) return res.status(404).json({ ok: false, message: 'Submission not found.' });

    let current = submission;
    if (!current.pdf_path || !fs.existsSync(current.pdf_path)) {
      current = await renderPdf(current);
    }

    const filename = `Rental-Agreement-${current.reference}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${filename}"`
    );
    fs.createReadStream(current.pdf_path).pipe(res);
  } catch (error) {
    next(error);
  }
});

/** Force a re-render, e.g. after correcting a stored value. */
router.post('/api/submissions/:id/pdf/regenerate', async (req, res, next) => {
  try {
    const submission = submissions.getById(req.params.id);
    if (!submission) return res.status(404).json({ ok: false, message: 'Submission not found.' });
    const updated = await renderPdf(submission);
    res.json({ ok: true, pdfAvailable: true, reference: updated.reference });
  } catch (error) {
    next(error);
  }
});

router.post('/api/submissions/:id/status', (req, res) => {
  const allowed = ['submitted', 'reviewed', 'approved', 'declined', 'archived'];
  const status = String(req.body?.status || '');
  if (!allowed.includes(status)) {
    return res.status(422).json({ ok: false, message: `Status must be one of: ${allowed.join(', ')}.` });
  }
  const submission = submissions.getById(req.params.id);
  if (!submission) return res.status(404).json({ ok: false, message: 'Submission not found.' });

  submissions.setStatus(submission.id, status);
  res.json({ ok: true, status });
});

router.get('/api/export.csv', (req, res) => {
  const rows = submissions.listAll();
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="rental-submissions-${stamp}.csv"`);
  res.send('\uFEFF' + toCsv(rows));
});

module.exports = router;
