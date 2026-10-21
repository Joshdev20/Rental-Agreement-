'use strict';

/**
 * Admin-facing settings API. Every route is mounted behind requireAdmin, so
 * external connections can only be configured by an authenticated operator.
 */

const express = require('express');
const settings = require('../lib/settings');
const { testEmail, testWebhook } = require('../lib/notify');
const { requireAdmin } = require('./admin-auth');

const router = express.Router();

/**
 * Guard the settings endpoints individually. Applying requireAdmin to the whole
 * /admin prefix would also intercept /admin/login and redirect it to itself.
 */
router.use('/api/settings', requireAdmin);

/** Current configuration, with secrets withheld. */
router.get('/api/settings', (req, res) => {
  res.json({
    ok: true,
    settings: settings.forClient(),
    summary: settings.summary(),
  });
});

/** Save configuration. Unknown keys are ignored; blank secrets are preserved. */
router.put('/api/settings', (req, res) => {
  const body = req.body || {};
  const values = body.settings && typeof body.settings === 'object' ? body.settings : body;
  const clear = Array.isArray(body.clear) ? body.clear : [];

  const result = settings.update(values, { clear });
  if (!result.ok) {
    return res.status(422).json({
      ok: false,
      message: 'Some settings need attention.',
      errors: result.errors,
    });
  }

  res.json({
    ok: true,
    message:
      result.updated.length > 0
        ? `Saved ${result.updated.length} setting${result.updated.length === 1 ? '' : 's'}.`
        : 'Nothing to save.',
    updated: result.updated,
    settings: settings.forClient(),
    summary: settings.summary(),
  });
});

/** Send a real test email using the saved settings. */
router.post('/api/settings/test-email', async (req, res) => {
  const result = await testEmail(req.body?.recipient);
  res.status(result.ok ? 200 : 422).json({ ok: result.ok, message: result.message, detail: result.detail || null });
});

/** POST a sample payload to the configured webhook. */
router.post('/api/settings/test-webhook', async (req, res) => {
  const result = await testWebhook();
  res.status(result.ok ? 200 : 422).json({ ok: result.ok, message: result.message });
});

/** Drop stored overrides and fall back to .env and built-in defaults. */
router.post('/api/settings/reset', (req, res) => {
  settings.resetAll();
  res.json({
    ok: true,
    message: 'Settings reset to the values from the server environment.',
    settings: settings.forClient(),
    summary: settings.summary(),
  });
});

module.exports = router;
