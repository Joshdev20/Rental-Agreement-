/* global document, window, fetch, location, URLSearchParams */
'use strict';

const STATUSES = ['submitted', 'reviewed', 'approved', 'declined', 'archived'];
const submissionId = window.location.pathname.split('/').filter(Boolean).pop();

let submission = null;
let sections = [];

const $ = (selector) => document.querySelector(selector);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function alertBox(type, message) {
  const box = el('div', { class: `alert alert--${type}`, role: 'alert' }, [el('span', { text: message })]);
  $('#alerts').append(box);
  setTimeout(() => box.remove(), 6000);
}

// --------------------------------------------------------------- formatting

const YESNO = { yes: 'Yes', no: 'No' };

function optionLabel(field, value) {
  if (Array.isArray(field.options)) {
    for (const option of field.options) {
      if (Array.isArray(option) && option[0] === value) return option[1];
      if (option === value) return value;
    }
  }
  return value;
}

function formatMoney(value) {
  const number = Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatDate(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function displayValue(field, raw) {
  if (raw === undefined || raw === null || raw === '') return '';
  if (field.type === 'multi') return (Array.isArray(raw) ? raw : [raw]).join(', ');
  if (field.type === 'yesno') return YESNO[String(raw).toLowerCase()] || String(raw);
  if (field.type === 'checkbox') return raw === true || raw === 'true' ? 'Agreed' : 'Not agreed';
  if (field.type === 'money') return formatMoney(raw);
  if (field.type === 'date') return formatDate(raw);
  if (field.type === 'select') return optionLabel(field, String(raw));
  return String(raw);
}

// ------------------------------------------------------------------ render

function renderHeader() {
  document.title = `${submission.reference} - Rental Agreement Desk`;
  $('#crumb-ref').textContent = submission.reference;
  $('#title').textContent = submission.tenant_name || 'Rental agreement';
  $('#subtitle').textContent =
    `${submission.property_address || 'Property not specified'} | Submitted ${formatDate(
      submission.created_at.slice(0, 10)
    )} | Lease ${formatDate(submission.lease_start) || '-'} to ${formatDate(submission.lease_end) || '-'}`;

  const select = $('#status-select');
  select.textContent = '';
  for (const status of STATUSES) {
    select.append(el('option', { value: status, text: status.charAt(0).toUpperCase() + status.slice(1), selected: submission.status === status }));
  }

  const pdfUrl = `/admin/api/submissions/${submission.id}/pdf`;
  $('#btn-download').href = `${pdfUrl}?download=1`;
  $('#btn-download').setAttribute('download', `Rental-Agreement-${submission.reference}.pdf`);

  if (submission.pdfAvailable) {
    $('#pdf-frame').src = `${pdfUrl}#view=FitH`;
  } else {
    $('#pdf-frame').replaceWith(
      el('div', { class: 'alert alert--warn' }, [
        el('span', { text: 'The PDF has not been generated yet. Use "Regenerate PDF" to create it.' }),
      ])
    );
  }

  if (submission.status === 'submitted') {
    $('#notice').append(
      el('div', { class: 'alert alert--info no-print' }, [
        el('span', { text: 'This submission has not been reviewed yet. Review the details, then mark it reviewed or approved.' }),
      ])
    );
  }
}

function renderNotifications() {
  const container = $('#notifications');
  container.textContent = '';
  const notifications = submission.notifications || [];

  if (!notifications.length) {
    container.append(el('p', { class: 'muted small mb-0', text: 'No notification attempts recorded.' }));
    return;
  }

  const table = el('table', {}, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { text: 'Channel' }),
        el('th', { text: 'Target' }),
        el('th', { text: 'Status' }),
        el('th', { text: 'Detail' }),
        el('th', { text: 'When' }),
      ]),
    ]),
    el('tbody', {}, notifications.map((item) =>
      el('tr', {}, [
        el('td', { class: 'cell-strong', text: item.channel }),
        el('td', { class: 'small', text: item.target || '-' }),
        el('td', {}, [
          el('span', {
            class: `badge badge--${item.status === 'sent' ? 'approved' : item.status === 'failed' ? 'declined' : 'archived'}`,
            text: item.status,
          }),
        ]),
        el('td', { class: 'small muted', text: item.detail || '-' }),
        el('td', { class: 'small nowrap', text: new Date(item.created_at).toLocaleString('en-US') }),
      ])
    )),
  ]);

  container.append(el('div', { class: 'table-scroll' }, [table]));
}

function renderDetails() {
  const container = $('#details');
  container.textContent = '';

  for (const section of sections) {
    const dl = el('dl', { class: 'dl' });
    let rendered = 0;

    for (const field of section.fields) {
      if (field.type === 'signature') continue;
      const value = displayValue(field, submission.data[field.name]);
      if (!value) continue;
      dl.append(el('dt', { text: field.label }));
      dl.append(el('dd', { text: value }));
      rendered += 1;
    }

    // Utilities are shown as two clear rows rather than a checkbox dump.
    if (section.id === 'utilities' && !rendered) continue;
    if (!rendered) continue;

    container.append(
      el('section', { class: 'card' }, [
        el('div', { class: 'card__head' }, [
          el('h2', { text: section.title.replace(/^\d+\.\s*/, '') }),
          el('p', { text: section.description }),
        ]),
        el('div', { class: 'card__body', style: 'padding-bottom:20px' }, [dl]),
      ])
    );
  }

  // Signature panel: show the drawn image alongside the typed confirmation.
  const signatureData = submission.data.signature_data;
  const signatureCard = el('section', { class: 'card' }, [
    el('div', { class: 'card__head' }, [
      el('h2', { text: 'Signature' }),
      el('p', { text: 'Electronically signed by the tenant when this agreement was submitted.' }),
    ]),
    el('div', { class: 'card__body', style: 'padding-bottom:20px' }, [
      el('dl', { class: 'dl' }, [
        el('dt', { text: 'Printed name' }),
        el('dd', { text: submission.data.printed_name || submission.tenant_name || '-' }),
        el('dt', { text: 'Date signed' }),
        el('dd', { text: formatDate(submission.data.signature_date) || '-' }),
        el('dt', { text: 'Acknowledgement' }),
        el('dd', { text: submission.data.acknowledgement ? 'Agreed to the terms' : 'Not recorded' }),
        el('dt', { text: 'Signature' }),
        el('dd', {}, [
          typeof signatureData === 'string' && signatureData.startsWith('data:image/')
            ? el('img', {
                src: signatureData,
                alt: 'Tenant signature',
                style: 'max-width:340px;border-bottom:1px solid var(--border-strong);padding-bottom:4px',
              })
            : el('span', { class: 'muted', text: 'No signature image on file.' }),
        ]),
      ]),
    ]),
  ]);
  container.append(signatureCard);

  // Raw JSON is genuinely useful for integrators, so keep it behind a toggle.
  const jsonPre = el('pre', {
    class: 'small',
    style:
      'margin:0;padding:14px;background:#fafbfd;border:1px solid var(--border);border-radius:8px;overflow:auto;max-height:340px',
    text: JSON.stringify(submission.data, null, 2),
  });
  const toggle = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Show raw values' });
  const jsonWrap = el('div', { class: 'hidden' }, [jsonPre]);
  toggle.addEventListener('click', () => {
    const hidden = jsonWrap.classList.toggle('hidden');
    toggle.textContent = hidden ? 'Show raw values' : 'Hide raw values';
  });

  container.append(
    el('section', { class: 'card no-print' }, [
      el('div', { class: 'card__head' }, [
        el('h2', { text: 'Stored submission values' }),
        el('p', { text: 'The exact data captured from the form, for integration or audit.' }),
      ]),
      el('div', { class: 'card__body', style: 'padding-bottom:20px' }, [
        el('div', { class: 'toolbar', style: 'border:1px solid var(--border);border-radius:8px;margin-bottom:12px' }, [toggle]),
        jsonWrap,
      ]),
    ])
  );
}

// ------------------------------------------------------------------ actions

async function load() {
  try {
    const response = await fetch(`/admin/api/submissions/${submissionId}`);
    if (response.status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    if (response.status === 404) {
      $('#loading').classList.add('hidden');
      alertBox('error', 'That submission could not be found.');
      return;
    }
    const body = await response.json();
    submission = body.submission;
    sections = body.sections;

    renderHeader();
    renderNotifications();
    renderDetails();

    $('#loading').classList.add('hidden');
    $('#content').classList.remove('hidden');
  } catch (error) {
    $('#loading').classList.add('hidden');
    alertBox('error', 'Could not load this submission. Please refresh the page.');
  }
}

$('#status-select').addEventListener('change', async (event) => {
  const status = event.target.value;
  try {
    const response = await fetch(`/admin/api/submissions/${submission.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) throw new Error('failed');
    submission.status = status;
    alertBox('success', `Status updated to ${status}.`);
  } catch {
    event.target.value = submission.status;
    alertBox('error', 'Could not update the status. Please try again.');
  }
});

$('#btn-regenerate').addEventListener('click', async () => {
  const button = $('#btn-regenerate');
  button.disabled = true;
  button.textContent = 'Regenerating...';
  try {
    const response = await fetch(`/admin/api/submissions/${submission.id}/pdf/regenerate`, { method: 'POST' });
    if (!response.ok) throw new Error('failed');
    // Cache-bust the iframe so the freshly written file is displayed.
    $('#pdf-frame').src = `/admin/api/submissions/${submission.id}/pdf?t=${Date.now()}#view=FitH`;
    alertBox('success', 'PDF regenerated successfully.');
  } catch {
    alertBox('error', 'Could not regenerate the PDF.');
  } finally {
    button.disabled = false;
    button.textContent = 'Regenerate PDF';
  }
});

$('#btn-print').addEventListener('click', () => {
  const frame = $('#pdf-frame');
  try {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  } catch {
    window.open(`/admin/api/submissions/${submission.id}/pdf`, '_blank');
  }
});

$('#btn-logout').addEventListener('click', async () => {
  await fetch('/admin/api/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

load();
