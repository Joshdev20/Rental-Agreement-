'use strict';

const express = require('express');
const schema = require('../lib/agreement-schema');
const { createSubmission } = require('../lib/agreement-service');
const submissions = require('../lib/submissions');

const router = express.Router();

/** Form metadata: the client renders the form from this, so it stays in sync. */
router.get('/form-schema', (req, res) => {
  res.json({ sections: schema.sections, usStates: schema.US_STATES });
});

/** Accept a completed agreement. */
router.post('/submissions', async (req, res, next) => {
  try {
    const data = schema.normalize(req.body || {});
    const { errors } = schema.validate(data);

    if (Object.keys(errors).length > 0) {
      return res.status(422).json({
        ok: false,
        message: 'Please correct the highlighted fields and submit again.',
        errors,
      });
    }

    const submission = await createSubmission(data);
    res.status(201).json({
      ok: true,
      reference: submission.reference,
      id: submission.id,
      message: 'Your rental agreement has been submitted to the property manager.',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Status lookup for the tenant. Requires the reference plus the e-mail used on
 * the form, so references cannot be enumerated by a stranger.
 */
router.post('/submissions/status', (req, res) => {
  const reference = String(req.body?.reference || '').trim().toUpperCase();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const submission = submissions.getByReference(reference);

  if (!submission || submission.tenant_email.toLowerCase() !== email) {
    return res.status(404).json({ ok: false, message: 'No submission found for that reference and email.' });
  }

  res.json({
    ok: true,
    reference: submission.reference,
    status: submission.status,
    submittedAt: submission.created_at,
    property: submission.property_address,
    tenant: submission.tenant_name,
    hasPdf: Boolean(submission.pdf_path),
  });
});

module.exports = router;
