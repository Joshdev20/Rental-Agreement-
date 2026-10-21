'use strict';

/**
 * Shared fixtures and helpers for the test suite.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

// Point the app at a throwaway data directory before anything loads config.
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-test-'));
process.env.DATA_DIR = testDataDir;
process.env.SESSION_SECRET = 'test-secret-do-not-use-in-production';
process.env.ADMIN_EMAIL = 'owner@example.com';
process.env.ADMIN_PASSWORD = 'TestPassword123!';
process.env.ADMIN_NAME = 'Test Owner';
process.env.SMTP_HOST = '';
process.env.NOTIFY_WEBHOOK_URL = '';

/**
 * A genuinely valid 120x40 8-bit RGB PNG (a diagonal stroke), generated with
 * correct chunk CRCs and a real deflate stream. The signature pipeline
 * integrity-checks PNGs, so fixtures must be real images rather than stubs.
 */
const TINY_PNG =
  'data:image/png;base64,' +
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAIAAAC6iKlyAAAAoklEQVR42u3ZMQ6AIAwFUA/B/a+qiaODiQm20L6/s7wB2s9x' +
  'SkgOBKBBC2jQoAU0aAENGrSABi2gQYMW0J2gxx1SQdCPgAuC5v7XHT2+BOu0x5B7ztTBPWe8454zR3PPWVh6uudvhk3cl1vB' +
  'q7qv3nWUcd+sVNrXfe/2biP3UjXpyu6V++il3BsV/7nufX9Ygt19ZQW5gw5yBz3NHXSQ+/uRC+Dx3mYZicSqAAAAAElFTkSu' +
  'QmCC';

function baseSubmission(overrides = {}) {
  return {
    property_address: '1428 Elm Street',
    property_unit: 'Apt 4B',
    property_city: 'Springfield',
    property_state: 'IL',
    property_zip: '62704',
    property_type: 'Apartment',
    bedrooms: '3',
    bathrooms: '2',
    lease_type: 'Fixed term',
    lease_start: '2026-11-01',
    lease_end: '2027-10-31',
    monthly_rent: '1850',
    security_deposit: '1850',
    landlord_name: 'Jane Owner',
    landlord_email: 'jane@example.com',
    landlord_phone: '5559876543',
    tenant_name: 'John Tenant',
    tenant_email: 'john@example.com',
    tenant_phone: '5551234567',
    governing_state: 'IL',
    signature_date: '2026-10-21',
    printed_name: 'John Tenant',
    acknowledgement: 'on',
    signature_data: TINY_PNG,
    utilities_landlord: ['Trash'],
    utilities_tenant: ['Electricity', 'Water'],
    pets_allowed: 'no',
    smoking_allowed: 'no',
    ...overrides,
  };
}

function cleanup() {
  try {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}


module.exports = { testDataDir, baseSubmission, TINY_PNG, cleanup };
