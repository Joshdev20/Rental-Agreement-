'use strict';

/**
 * Single source of truth for the residential rental agreement.
 *
 * The public form markup mirrors these field names, and this schema drives
 * server-side validation, PDF rendering and CSV export so the three can never
 * drift apart silently.
 *
 * Field types:
 *   text | email | tel | date | number | money | select | textarea | multi
 *   | yesno | checkbox | signature
 */

const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'],
  ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

const UTILITY_ITEMS = [
  'Water', 'Sewer', 'Trash', 'Electricity', 'Natural Gas',
  'Internet', 'Cable TV', 'Heating Oil', 'Lawn Care', 'Snow Removal',
];

const sections = [
  {
    id: 'property',
    title: '1. Premises',
    description: 'Identify the rental property covered by this agreement.',
    fields: [
      { name: 'property_address', label: 'Street address', type: 'text', required: true, placeholder: '1428 Elm Street' },
      { name: 'property_unit', label: 'Unit / apartment no.', type: 'text', placeholder: 'Apt 4B' },
      { name: 'property_city', label: 'City', type: 'text', required: true, placeholder: 'Springfield' },
      { name: 'property_state', label: 'State', type: 'select', required: true, options: US_STATES },
      { name: 'property_zip', label: 'ZIP code', type: 'text', required: true, placeholder: '62704' },
      { name: 'property_type', label: 'Property type', type: 'select', options: [
        'Single-family home', 'Apartment', 'Condominium', 'Townhouse', 'Duplex',
        'Mobile / manufactured home', 'Room in shared home', 'Other',
      ] },
      { name: 'bedrooms', label: 'Bedrooms', type: 'number', min: 0, max: 20 },
      { name: 'bathrooms', label: 'Bathrooms', type: 'number', min: 0, max: 20, step: '0.5' },
      { name: 'square_feet', label: 'Approx. square feet', type: 'number', min: 0 },
      { name: 'furnished', label: 'Furnishings', type: 'select', options: [
        'Unfurnished', 'Partially furnished', 'Fully furnished',
      ] },
      { name: 'parking', label: 'Parking', type: 'select', options: [
        'No parking included', 'One assigned space', 'Two assigned spaces',
        'Attached garage', 'Driveway', 'Street parking only',
      ] },
    ],
  },
  {
    id: 'term',
    title: '2. Lease Term',
    description: 'The length of the tenancy and how it renews.',
    fields: [
      { name: 'lease_type', label: 'Lease type', type: 'select', required: true, options: [
        'Fixed term', 'Month-to-month', 'Week-to-week',
      ] },
      { name: 'lease_start', label: 'Lease start date', type: 'date', required: true },
      { name: 'lease_end', label: 'Lease end date', type: 'date', required: true },
      { name: 'renewal', label: 'Renewal terms', type: 'select', options: [
        'No automatic renewal', 'Automatically renews month-to-month',
        'Automatically renews for another 12 months',
      ] },
      { name: 'early_termination_terms', label: 'Early termination terms', type: 'textarea', rows: 2,
        placeholder: 'e.g. Tenant may terminate with 60 days written notice and payment of one month rent.' },
    ],
  },
  {
    id: 'rent',
    title: '3. Rent and Fees',
    description: 'Amounts, due dates and payment handling.',
    fields: [
      { name: 'monthly_rent', label: 'Monthly rent (USD)', type: 'money', required: true, placeholder: '1850.00' },
      { name: 'rent_due_day', label: 'Rent due on day of month', type: 'number', min: 1, max: 28, default: 1 },
      { name: 'payment_method', label: 'Accepted payment method', type: 'select', options: [
        'Bank transfer (ACH)', 'Online tenant portal', 'Check', 'Money order', 'Cash', 'Other',
      ] },
      { name: 'payment_instructions', label: 'Payment instructions', type: 'textarea', rows: 2,
        placeholder: 'Payable to ... mailed to ...' },
      { name: 'late_fee_amount', label: 'Late fee (USD)', type: 'money' },
      { name: 'late_fee_grace_days', label: 'Late fee grace period (days)', type: 'number', min: 0, max: 30, default: 5 },
      { name: 'returned_payment_fee', label: 'Returned payment fee (USD)', type: 'money' },
      { name: 'prorated_rent', label: 'Prorated first-month rent (USD)', type: 'money' },
    ],
  },
  {
    id: 'deposit',
    title: '4. Security Deposit',
    description: 'Deposit amounts and how they are held.',
    fields: [
      { name: 'security_deposit', label: 'Security deposit (USD)', type: 'money', required: true },
      { name: 'deposit_held_by', label: 'Deposit held by', type: 'text', placeholder: 'Landlord / Escrow account' },
      { name: 'pet_deposit', label: 'Pet deposit (USD)', type: 'money' },
      { name: 'last_month_rent_paid', label: 'Last month rent paid at signing', type: 'yesno' },
    ],
  },
  {
    id: 'utilities',
    title: '5. Utilities and Services',
    description: 'Who pays for which services.',
    fields: [
      { name: 'utilities_landlord', label: 'Paid by landlord', type: 'multi', options: UTILITY_ITEMS },
      { name: 'utilities_tenant', label: 'Paid by tenant', type: 'multi', options: UTILITY_ITEMS },
      { name: 'hoa_fee', label: 'HOA / association fee (USD per month)', type: 'money' },
      { name: 'hoa_responsible', label: 'HOA fee responsibility', type: 'select', options: [
        'Landlord', 'Tenant', 'Split between parties', 'Not applicable',
      ] },
      { name: 'utilities_notes', label: 'Utility notes', type: 'textarea', rows: 2 },
    ],
  },
  {
    id: 'occupancy',
    title: '6. Occupants, Pets and Smoking',
    description: 'Who may live in the unit and the house rules.',
    fields: [
      { name: 'number_of_occupants', label: 'Total number of occupants', type: 'number', min: 1, max: 20, default: 1 },
      { name: 'occupants', label: 'Names of all occupants (other than tenant)', type: 'textarea', rows: 3,
        placeholder: 'One name per line, include relationship and age.' },
      { name: 'pets_allowed', label: 'Pets permitted', type: 'yesno' },
      { name: 'pet_details', label: 'Pet description', type: 'textarea', rows: 2,
        placeholder: 'Type, breed, weight, number of pets.' },
      { name: 'smoking_allowed', label: 'Smoking permitted on premises', type: 'yesno' },
    ],
  },
  {
    id: 'terms',
    title: '7. Maintenance, Access and Rules',
    description: 'Ongoing obligations during the tenancy.',
    fields: [
      { name: 'maintenance_responsibility', label: 'Routine maintenance handled by', type: 'select', options: [
        'Landlord', 'Tenant', 'Landlord for major systems, tenant for minor upkeep',
      ] },
      { name: 'entry_notice_hours', label: 'Notice before landlord entry (hours)', type: 'number', min: 0, max: 72, default: 24 },
      { name: 'subletting_allowed', label: 'Subletting permitted', type: 'yesno' },
      { name: 'renters_insurance_required', label: 'Renter\'s insurance required', type: 'yesno' },
      { name: 'rules_notes', label: 'Additional rules and conditions', type: 'textarea', rows: 3,
        placeholder: 'Quiet hours, guests, parking, alterations, etc.' },
    ],
  },
  {
    id: 'landlord',
    title: '8. Landlord / Agent',
    description: 'The party leasing the premises.',
    fields: [
      { name: 'landlord_name', label: 'Landlord or agent full name', type: 'text', required: true },
      { name: 'landlord_email', label: 'Email', type: 'email', required: true },
      { name: 'landlord_phone', label: 'Phone', type: 'tel' },
      { name: 'landlord_address', label: 'Mailing address for notices', type: 'textarea', rows: 2 },
    ],
  },
  {
    id: 'tenant',
    title: '9. Tenant Information',
    description: 'The person completing and signing this agreement.',
    fields: [
      { name: 'tenant_name', label: 'Tenant full legal name', type: 'text', required: true },
      { name: 'tenant_email', label: 'Email', type: 'email', required: true },
      { name: 'tenant_phone', label: 'Phone', type: 'tel', required: true },
      { name: 'tenant_dob', label: 'Date of birth', type: 'date' },
      { name: 'tenant_license', label: 'Driver license / state ID no.', type: 'text' },
      { name: 'tenant_current_address', label: 'Current address', type: 'textarea', rows: 2 },
      { name: 'co_tenant_name', label: 'Co-tenant full legal name', type: 'text' },
      { name: 'co_tenant_email', label: 'Co-tenant email', type: 'email' },
      { name: 'co_tenant_phone', label: 'Co-tenant phone', type: 'tel' },
    ],
  },
  {
    id: 'legal',
    title: '10. Legal Disclosures',
    description: 'Required notices and final acknowledgements.',
    fields: [
      { name: 'governing_state', label: 'Governing state law', type: 'select', required: true, options: US_STATES },
      { name: 'lead_paint_disclosure', label: 'Pre-1978 housing lead-based paint disclosure', type: 'select', options: [
        'Not applicable - property built in 1978 or later',
        'Disclosure provided to tenant',
        'Disclosure and EPA pamphlet provided to tenant',
      ] },
      { name: 'additional_terms', label: 'Additional terms', type: 'textarea', rows: 3,
        placeholder: 'Any other agreed terms. Leave blank if none.' },
      { name: 'signature_date', label: 'Date of signature', type: 'date', required: true },
      { name: 'signature_data', label: 'Tenant signature', type: 'signature', required: true },
      { name: 'printed_name', label: 'Printed name of signer', type: 'text', required: true },
      { name: 'acknowledgement', label: 'I have read and agree to the terms of this rental agreement.', type: 'checkbox', required: true },
    ],
  },
];

const allFields = sections.flatMap((section) =>
  section.fields.map((field) => ({ ...field, sectionId: section.id, sectionTitle: section.title }))
);

const fieldByName = new Map(allFields.map((field) => [field.name, field]));

const YESNO_LABELS = { yes: 'Yes', no: 'No' };

function humanize(name) {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bUsd\b/, '(USD)');
}

function formatMoney(value) {
  const number = Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(number)) return String(value);
  return `$${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return '';
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!iso) return String(value);
  const [, y, m, d] = iso;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Resolve a select option value to its human-readable label. */
function optionLabel(field, value) {
  if (!Array.isArray(field.options)) return value;
  for (const option of field.options) {
    if (Array.isArray(option) && option[0] === value) return option[1];
    if (option === value) return value;
  }
  return value;
}

/** Convert a raw stored value into the text used on screen, in PDFs and CSV. */
function displayValue(field, raw) {
  if (raw === undefined || raw === null || raw === '') return '';
  if (field.type === 'multi') {
    const list = Array.isArray(raw) ? raw : [raw];
    return list.length ? list.join(', ') : '';
  }
  if (field.type === 'yesno') return YESNO_LABELS[String(raw).toLowerCase()] || String(raw);
  if (field.type === 'checkbox') return raw === true || raw === 'true' || raw === 'on' ? 'Agreed' : 'Not agreed';
  if (field.type === 'money') return formatMoney(raw);
  if (field.type === 'date') return formatDate(raw);
  // The signature is an image; never surface the raw base64 payload as text.
  if (field.type === 'signature') return 'Signed electronically';
  if (field.type === 'select') return optionLabel(field, String(raw));
  return String(raw);
}

function isBlank(field, value) {
  if (value === undefined || value === null) return true;
  if (field.type === 'multi') return !Array.isArray(value) || value.length === 0;
  if (field.type === 'checkbox') return !(value === true || value === 'true' || value === 'on');
  return String(value).trim() === '';
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

/**
 * Normalize a raw request body into the canonical stored payload.
 * Unknown keys are dropped so a crafted request cannot inject fields into the
 * database or the generated PDF.
 */
function normalize(input) {
  const data = {};
  for (const field of allFields) {
    const raw = input[field.name];
    switch (field.type) {
      case 'multi':
        data[field.name] = toArray(raw).map((v) => String(v).trim()).filter(Boolean);
        break;
      case 'checkbox':
        data[field.name] = raw === true || raw === 'true' || raw === 'on';
        break;
      case 'signature':
        // Store only a canonical, integrity-checked PNG data URL. Anything
        // unusable becomes empty so validation reports it as a missing field.
        data[field.name] = sanitizeSignatureDataUrl(raw) || '';
        break;
      case 'number': {
        const text = raw === undefined || raw === null ? '' : String(raw).trim();
        data[field.name] = text === '' ? '' : text;
        break;
      }
      default:
        data[field.name] = raw === undefined || raw === null ? '' : String(raw).trim();
    }
  }
  return data;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;
const SIGNATURE_PREFIX = 'data:image/png;base64,';
const MAX_SIGNATURE_BYTES = 400 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// --- PNG integrity checking ------------------------------------------------
// PDFKit decodes embedded images asynchronously while the document is flushed,
// so a corrupt PNG raises inside a zlib callback that no try/catch can reach
// and takes the whole process down. Every signature is therefore fully
// validated here, before it is ever handed to the PDF renderer.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

const MAX_PNG_PIXELS = 4000 * 4000;
const MAX_INFLATED_BYTES = 8 * 1024 * 1024;

/** Structural + checksum validation of a PNG buffer. */
function isValidPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 45) return false;
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) return false;

  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  const dataChunks = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) return false;

    const data = buffer.subarray(dataStart, dataEnd);
    const expected = buffer.readUInt32BE(dataEnd);
    if (crc32(buffer.subarray(offset + 4, dataEnd)) !== expected) return false;

    if (type === 'IHDR') {
      if (sawHeader || length !== 13) return false;
      const width = data.readUInt32BE(0);
      const height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const interlace = data[12];

      if (width < 1 || height < 1 || width * height > MAX_PNG_PIXELS) return false;
      // Restrict to the 8-bit, non-interlaced formats canvas output produces.
      // Exotic variants are the ones the bundled decoder mishandles, and
      // mishandling it would abort the whole PDF render.
      if (bitDepth !== 8 || interlace !== 0) return false;
      if (![0, 2, 3, 4, 6].includes(colorType)) return false;

      sawHeader = true;
    } else if (type === 'IDAT') {
      sawData = true;
      dataChunks.push(data);
    } else if (type === 'IEND') {
      sawEnd = true;
      break;
    }

    offset = dataEnd + 4;
  }

  if (!sawHeader || !sawData || !sawEnd) return false;

  // Confirm the pixel stream really inflates, which is what PDFKit does next.
  try {
    const zlib = require('zlib');
    zlib.inflateSync(Buffer.concat(dataChunks), { maxOutputLength: MAX_INFLATED_BYTES });
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate and normalize a signature data URL.
 * @returns {string|null} a canonical data URL, or null when unusable.
 */
function sanitizeSignatureDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith(SIGNATURE_PREFIX)) return null;
  const payload = value.slice(SIGNATURE_PREFIX.length);
  if (!payload || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return null;

  let buffer;
  try {
    buffer = Buffer.from(payload, 'base64');
  } catch {
    return null;
  }
  if (!buffer.length || buffer.length > MAX_SIGNATURE_BYTES) return null;
  if (!isValidPng(buffer)) return null;

  return SIGNATURE_PREFIX + buffer.toString('base64');
}


/** Validate a normalized payload. Returns { errors: {field: message} }. */
function validate(data) {
  const errors = {};

  for (const field of allFields) {
    const value = data[field.name];
    if (field.required && isBlank(field, value)) {
      // A signature that failed integrity checks is discarded by normalize(),
      // so it lands here too. Point the user at the box either way.
      errors[field.name] =
        field.type === 'signature'
          ? 'Please draw your signature in the signature box.'
          : field.type === 'checkbox'
            ? 'This acknowledgement must be confirmed before you submit.'
            : `${field.label} is required.`;
      continue;
    }
    if (isBlank(field, value)) continue;

    switch (field.type) {
      case 'email':
        if (!EMAIL_RE.test(String(value))) errors[field.name] = 'Enter a valid email address.';
        break;
      case 'tel':
        if (String(value).replace(/\D/g, '').length < 10) {
          errors[field.name] = 'Enter a valid phone number with at least 10 digits.';
        }
        break;
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
          errors[field.name] = 'Enter a valid date.';
        }
        break;
      case 'money': {
        const number = Number(String(value).replace(/[$,\s]/g, ''));
        if (!Number.isFinite(number) || number < 0) errors[field.name] = 'Enter a valid amount.';
        else if (number > 1_000_000) errors[field.name] = 'Amount looks too large.';
        break;
      }
      case 'number': {
        const number = Number(value);
        if (!Number.isFinite(number)) {
          errors[field.name] = 'Enter a valid number.';
        } else if (field.min !== undefined && number < field.min) {
          errors[field.name] = `Must be ${field.min} or more.`;
        } else if (field.max !== undefined && number > field.max) {
          errors[field.name] = `Must be ${field.max} or less.`;
        }
        break;
      }
      case 'signature': {
        // normalize() already reduced this to a valid PNG data URL or ''.
        if (!String(value).startsWith(SIGNATURE_PREFIX)) {
          errors[field.name] = 'Please draw your signature in the signature box.';
        }
        break;
      }
      default:
        break;
    }
  }

  if (data.property_zip && !ZIP_RE.test(String(data.property_zip))) {
    errors.property_zip = 'Enter a valid US ZIP code.';
  }

  const { lease_start: start, lease_end: end } = data;
  if (start && end && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
    if (new Date(end) <= new Date(start)) {
      errors.lease_end = 'Lease end date must be after the start date.';
    }
  }

  const utilitiesLandlord = toArray(data.utilities_landlord);
  const utilitiesTenant = toArray(data.utilities_tenant);
  const overlap = utilitiesLandlord.filter((item) => utilitiesTenant.includes(item));
  if (overlap.length) {
    errors.utilities_tenant = `Each utility can be assigned to only one party (check: ${overlap.join(', ')}).`;
  }

  if (data.pets_allowed === 'yes' && !String(data.pet_details || '').trim()) {
    errors.pet_details = 'Describe the pet(s) since pets are permitted.';
  }

  return { errors };
}

/** Build the compact row summary stored alongside the full payload. */
function summarize(data) {
  return {
    tenant_name: data.tenant_name || '',
    tenant_email: data.tenant_email || '',
    tenant_phone: data.tenant_phone || '',
    property_address: [
      data.property_address,
      data.property_unit,
      data.property_city,
      data.property_state,
      data.property_zip,
    ]
      .filter(Boolean)
      .join(', '),
    monthly_rent: data.monthly_rent === '' ? null : Number(String(data.monthly_rent).replace(/[$,\s]/g, '')),
    lease_start: data.lease_start || null,
    lease_end: data.lease_end || null,
  };
}

module.exports = {
  US_STATES,
  UTILITY_ITEMS,
  sections,
  allFields,
  fieldByName,
  normalize,
  validate,
  summarize,
  displayValue,
  optionLabel,
  formatMoney,
  formatDate,
  isBlank,
  sanitizeSignatureDataUrl,
  isValidPng,
  MAX_SIGNATURE_BYTES,
};
