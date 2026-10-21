/* global document, window, fetch, location */
'use strict';

const STATUSES = ['submitted', 'reviewed', 'approved', 'declined', 'archived'];
let allItems = [];
let me = null;

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

function money(value) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  return number.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function shortDate(iso) {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function longDate(value) {
  if (!value) return '-';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return String(value);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function alertBox(type, message) {
  const alerts = $('#alerts');
  const box = el('div', { class: `alert alert--${type}`, role: 'alert' }, [el('span', { text: message })]);
  alerts.append(box);
  setTimeout(() => box.remove(), 6000);
}

// -------------------------------------------------------------------- render

function matches(item) {
  const term = $('#search').value.trim().toLowerCase();
  const status = $('#status-filter').value;
  if (status && item.status !== status) return false;
  if (!term) return true;
  return [
    item.reference,
    item.tenant_name,
    item.tenant_email,
    item.tenant_phone,
    item.property_address,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(term);
}

function renderRows() {
  const tbody = $('#rows');
  const items = allItems.filter(matches);
  tbody.textContent = '';

  $('#empty').classList.toggle('hidden', items.length > 0);
  if (!items.length) {
    $('#empty').querySelector('h3').textContent = allItems.length ? 'No matching submissions' : 'No submissions yet';
    return;
  }

  for (const item of items) {
    const statusSelect = el('select', {
      'aria-label': `Status for ${item.reference}`,
      style: 'width:auto;min-width:130px;padding:5px 26px 5px 8px;font-size:12.5px',
    }, STATUSES.map((status) =>
      el('option', { value: status, text: status.charAt(0).toUpperCase() + status.slice(1), selected: item.status === status })
    ));
    statusSelect.addEventListener('change', async () => {
      const previous = item.status;
      item.status = statusSelect.value;
      try {
        const response = await fetch(`/admin/api/submissions/${item.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: statusSelect.value }),
        });
        if (!response.ok) throw new Error('failed');
        renderStats();
        alertBox('success', `${item.reference} marked as ${statusSelect.value}.`);
      } catch {
        item.status = previous;
        statusSelect.value = previous;
        alertBox('error', 'Could not update the status. Please try again.');
      }
    });

    tbody.append(
      el('tr', {}, [
        el('td', {}, [el('a', { class: 'cell-ref', href: `/admin/submissions/${item.id}`, text: item.reference })]),
        el('td', {}, [
          el('span', { class: 'cell-strong', text: item.tenant_name || '-' }),
          el('span', { class: 'cell-sub', text: item.tenant_email || '' }),
        ]),
        el('td', {}, [el('span', { text: item.property_address || '-' })]),
        el('td', { class: 'nowrap small' }, [
          el('span', { text: `${longDate(item.lease_start)} - ${longDate(item.lease_end)}` }),
        ]),
        el('td', { class: 'num cell-strong', text: money(item.monthly_rent) }),
        el('td', {}, [statusSelect]),
        el('td', { class: 'nowrap small', text: shortDate(item.created_at) }),
        el('td', {}, [
          el('div', { class: 'cell-actions' }, [
            el('a', {
              class: 'btn btn--ghost btn--sm',
              href: `/admin/api/submissions/${item.id}/pdf`,
              target: '_blank',
              rel: 'noopener',
              text: 'View PDF',
            }),
            el('a', {
              class: 'btn btn--quiet btn--sm',
              href: `/admin/api/submissions/${item.id}/pdf?download=1`,
              text: 'Download',
            }),
          ]),
        ]),
      ])
    );
  }
}

function renderStats() {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonth = allItems.filter((item) => (item.created_at || '').startsWith(monthKey));
  const pending = allItems.filter((item) => item.status === 'submitted');
  const rentTotal = allItems
    .filter((item) => item.status !== 'declined' && item.status !== 'archived')
    .reduce((sum, item) => sum + (Number(item.monthly_rent) || 0), 0);

  $('#stat-total').textContent = String(allItems.length);
  $('#stat-pending').textContent = String(pending.length);
  $('#stat-month').textContent = String(thisMonth.length);
  $('#stat-month-label').textContent = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  $('#stat-rent').textContent = money(rentTotal);
}

// ---------------------------------------------------------------------- data

async function load() {
  try {
    const response = await fetch('/admin/api/submissions?limit=200');
    if (response.status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    const body = await response.json();
    allItems = body.items || [];
    renderStats();
    renderRows();
  } catch {
    alertBox('error', 'Could not load submissions. Please refresh the page.');
  }
}

async function loadMe() {
  try {
    const response = await fetch('/admin/api/me');
    if (!response.ok) return;
    const body = await response.json();
    me = body.admin;
    $('#who').textContent = me.name || me.email;
    $('#who').title = me.email;
  } catch {
    /* non-fatal */
  }
}

function openPasswordModal() {
  $('#pw-modal').classList.add('is-open');
  $('#pw-alerts').textContent = '';
  $('#pw-current').value = '';
  $('#pw-new').value = '';
  $('#pw-current').focus();
}

function closePasswordModal() {
  $('#pw-modal').classList.remove('is-open');
}

async function savePassword() {
  const alerts = $('#pw-alerts');
  alerts.textContent = '';
  const button = $('#pw-save');
  button.disabled = true;

  try {
    const response = await fetch('/admin/api/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: $('#pw-current').value,
        newPassword: $('#pw-new').value,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) {
      alerts.append(el('div', { class: 'alert alert--error' }, [el('span', { text: body.message || 'Could not update the password.' })]));
      return;
    }
    closePasswordModal();
    window.location.href = '/admin/login';
  } finally {
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------- boot

$('#search').addEventListener('input', renderRows);
$('#status-filter').addEventListener('change', renderRows);
$('#btn-refresh').addEventListener('click', load);
$('#btn-password').addEventListener('click', openPasswordModal);
$('#btn-logout').addEventListener('click', async () => {
  await fetch('/admin/api/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});
$('#pw-modal').addEventListener('click', (event) => {
  if (event.target === $('#pw-modal') || event.target.hasAttribute('data-close')) closePasswordModal();
});
$('#pw-save').addEventListener('click', savePassword);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePasswordModal();
  // Ctrl/Cmd + K focuses search, a familiar shortcut for a records view.
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    $('#search').focus();
  }
});

loadMe();
load();
