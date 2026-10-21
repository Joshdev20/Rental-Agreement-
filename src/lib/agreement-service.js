'use strict';

const path = require('path');
const config = require('../config');
const schema = require('./agreement-schema');
const submissions = require('./submissions');
const { generateAgreementPdf } = require('./pdf');
const { notifyAdmins } = require('./notify');

function stateName(code) {
  const match = schema.US_STATES.find(([abbr]) => abbr === code);
  return match ? match[1] : code || '';
}

function pdfPathFor(reference) {
  return path.join(config.pdfDir, `${reference}.pdf`);
}

function buildMeta(submission) {
  const { data } = submission;
  return {
    reference: submission.reference,
    preparedDate: schema.formatDate(submission.created_at.slice(0, 10)),
    submittedAt: new Date(submission.created_at).toUTCString(),
    governingState: data.governing_state,
    governingStateName: stateName(data.governing_state),
    landlordName: data.landlord_name,
    propertyAddress: submission.property_address,
  };
}

/** Render (or re-render) the agreement PDF and remember where it lives. */
async function renderPdf(submission) {
  const outputPath = pdfPathFor(submission.reference);
  await generateAgreementPdf({ data: submission.data, meta: buildMeta(submission), outputPath });
  return submissions.attachPdf(submission.id, outputPath);
}

/**
 * Persist a validated submission, generate its PDF and notify admins.
 * The PDF is generated before notification so the admin always has a document
 * waiting when the alert arrives.
 */
async function createSubmission(data) {
  const submission = submissions.create(data);
  const withPdf = await renderPdf(submission);
  // Fire and forget: notification latency must not delay the tenant's receipt.
  notifyAdmins(withPdf).catch((error) => console.error('[notify] unexpected error:', error));
  return withPdf;
}

module.exports = { createSubmission, renderPdf, buildMeta, pdfPathFor, stateName };
