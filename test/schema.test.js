'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { baseSubmission } = require('./helpers');
const schema = require('../src/lib/agreement-schema');

// Comfortably past the 400KB signature limit once base64-encoded.
const MAX_B64 = 800 * 1024;

test('schema: normalizes a complete payload', () => {
  const data = schema.normalize(baseSubmission());
  assert.equal(data.property_address, '1428 Elm Street');
  assert.deepEqual(data.utilities_tenant, ['Electricity', 'Water']);
  assert.equal(data.acknowledgement, true);
});

test('schema: drops unknown keys so crafted input cannot reach storage', () => {
  const data = schema.normalize({ ...baseSubmission(), __proto__: { polluted: true }, evil: 'x' });
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'evil'), false);
  assert.equal(data.polluted, undefined);
  assert.equal({}.polluted, undefined);
});

test('schema: a complete valid submission produces no errors', () => {
  const { errors } = schema.validate(schema.normalize(baseSubmission()));
  assert.deepEqual(errors, {});
});

test('schema: reports every missing required field', () => {
  const { errors } = schema.validate(schema.normalize({}));
  for (const name of [
    'property_address',
    'property_city',
    'property_state',
    'property_zip',
    'lease_type',
    'lease_start',
    'lease_end',
    'monthly_rent',
    'security_deposit',
    'landlord_name',
    'landlord_email',
    'tenant_name',
    'tenant_email',
    'tenant_phone',
    'governing_state',
    'signature_date',
    'signature_data',
    'printed_name',
    'acknowledgement',
  ]) {
    assert.ok(errors[name], `expected a required error for ${name}`);
  }
});

test('schema: rejects an email that is not an email', () => {
  const { errors } = schema.validate(schema.normalize(baseSubmission({ tenant_email: 'not-an-email' })));
  assert.match(errors.tenant_email, /valid email/i);
});

test('schema: rejects a malformed ZIP code', () => {
  const { errors } = schema.validate(schema.normalize(baseSubmission({ property_zip: 'ABCDE' })));
  assert.match(errors.property_zip, /ZIP/i);
});

test('schema: accepts ZIP+4', () => {
  const { errors } = schema.validate(schema.normalize(baseSubmission({ property_zip: '62704-1234' })));
  assert.equal(errors.property_zip, undefined);
});

test('schema: rejects a lease end date before the start date', () => {
  const { errors } = schema.validate(
    schema.normalize(baseSubmission({ lease_start: '2027-01-01', lease_end: '2026-01-01' }))
  );
  assert.match(errors.lease_end, /after the start/i);
});

test('schema: rejects a signature that is not a PNG data URL', () => {
  const { errors } = schema.validate(schema.normalize(baseSubmission({ signature_data: 'scribble' })));
  assert.match(errors.signature_data, /draw your signature/i);
});

test('schema: rejects a PNG with a corrupted image stream', () => {
  // Correct magic bytes and a plausible size, but the deflate stream is junk.
  const corrupt = 'data:image/png;base64,' + Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64').toString('base64');
  const data = schema.normalize(baseSubmission({ signature_data: corrupt }));
  assert.equal(data.signature_data, '', 'corrupt PNG must not survive normalization');
  const { errors } = schema.validate(data);
  assert.match(errors.signature_data, /draw your signature/i);
});

test('schema: rejects a PNG whose bytes are not a PNG at all', () => {
  const notPng = 'data:image/png;base64,' + Buffer.from('this is just text').toString('base64');
  assert.equal(schema.sanitizeSignatureDataUrl(notPng), null);
});

test('schema: rejects an oversized signature payload', () => {
  const huge = 'data:image/png;base64,' + 'A'.repeat(MAX_B64);
  assert.equal(schema.sanitizeSignatureDataUrl(huge), null);
});

test('schema: sanitizeSignatureDataUrl accepts a real PNG and canonicalizes it', () => {
  const canonical = schema.sanitizeSignatureDataUrl(baseSubmission().signature_data);
  assert.ok(canonical && canonical.startsWith('data:image/png;base64,'));
});

test('schema: isValidPng accepts a real PNG and rejects a truncated one', () => {
  const real = Buffer.from(baseSubmission().signature_data.split(',')[1], 'base64');
  assert.equal(schema.isValidPng(real), true);
  assert.equal(schema.isValidPng(real.subarray(0, real.length - 12)), false);
  assert.equal(schema.isValidPng(Buffer.alloc(0)), false);
});

test('schema: rejects the same utility assigned to both parties', () => {
  const { errors } = schema.validate(
    schema.normalize(baseSubmission({ utilities_landlord: ['Water'], utilities_tenant: ['Water'] }))
  );
  assert.match(errors.utilities_tenant, /only one party/i);
});

test('schema: requires pet details when pets are permitted', () => {
  const { errors } = schema.validate(schema.normalize(baseSubmission({ pets_allowed: 'yes', pet_details: '' })));
  assert.match(errors.pet_details, /describe the pet/i);
});

test('schema: enforces numeric bounds', () => {
  const { errors } = schema.validate(schema.normalize(baseSubmission({ rent_due_day: '45' })));
  assert.match(errors.rent_due_day, /28 or less/i);
});

test('schema: rejects a negative money amount', () => {
  const { errors } = schema.validate(schema.normalize(baseSubmission({ monthly_rent: '-100' })));
  assert.match(errors.monthly_rent, /valid amount/i);
});

test('schema: money values render as US currency', () => {
  assert.equal(schema.displayValue(schema.fieldByName.get('monthly_rent'), '1850'), '$1,850.00');
  assert.equal(schema.displayValue(schema.fieldByName.get('monthly_rent'), '925.5'), '$925.50');
});

test('schema: dates render in long US form', () => {
  assert.equal(schema.displayValue(schema.fieldByName.get('lease_start'), '2026-11-01'), 'November 1, 2026');
});

test('schema: state codes render as full state names', () => {
  const field = schema.fieldByName.get('property_state');
  assert.equal(schema.displayValue(field, 'IL'), 'Illinois');
  assert.equal(schema.displayValue(field, 'CA'), 'California');
});

test('schema: a missing acknowledgement reads as a sentence, not a label echo', () => {
  const { errors } = schema.validate(schema.normalize(baseSubmission({ acknowledgement: false })));
  assert.equal(errors.acknowledgement, 'This acknowledgement must be confirmed before you submit.');
});

test('schema: an invalid email and phone are reported per field', () => {
  const { errors } = schema.validate(
    schema.normalize(baseSubmission({ tenant_email: 'not-an-email', tenant_phone: 'abc' }))
  );
  assert.ok(errors.tenant_email, 'bad email must be rejected');
  assert.ok(errors.tenant_phone, 'bad phone must be rejected');
});

test('schema: a malformed ZIP code is rejected', () => {
  const { errors } = schema.validate(schema.normalize(baseSubmission({ property_zip: '1234' })));
  assert.ok(errors.property_zip);
  const zipPlus4 = schema.validate(schema.normalize(baseSubmission({ property_zip: '62704-1234' })));
  assert.equal(zipPlus4.errors.property_zip, undefined);
});

test('schema: the signature never leaks its base64 payload as text', () => {
  const field = schema.fieldByName.get('signature_data');
  assert.equal(schema.displayValue(field, 'data:image/png;base64,AAAA'), 'Signed electronically');
});

test('schema: yes/no values render as words', () => {
  const field = schema.fieldByName.get('pets_allowed');
  assert.equal(schema.displayValue(field, 'yes'), 'Yes');
  assert.equal(schema.displayValue(field, 'no'), 'No');
});

test('schema: summarize produces the stored row summary', () => {
  const summary = schema.summarize(schema.normalize(baseSubmission()));
  assert.equal(summary.tenant_name, 'John Tenant');
  assert.equal(summary.monthly_rent, 1850);
  assert.equal(summary.property_address, '1428 Elm Street, Apt 4B, Springfield, IL, 62704');
});
