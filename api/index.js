'use strict';

/**
 * Serverless entry point.
 *
 * Vercel's filesystem is read-only except for /tmp, and /tmp is per-invocation
 * and not shared between concurrent instances. That is fine for serving the
 * form and the dashboard UI, but SQLite and the generated PDFs will not
 * survive, so this entry point is for previews and demos only.
 *
 * For a deployment that keeps submissions, run the app on a host with a real
 * volume and point DATA_DIR at it. See "Deployment" in the README.
 */
process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/rental-agreement-data';

const server = require('../src/server');

// Serverless platforms never call start(), so seed the first administrator
// here. Without this the dashboard would have no account to sign in with.
server.bootstrap();

module.exports = server.app;
