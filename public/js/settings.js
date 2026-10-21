/* global document, window, fetch */
'use strict';

/**
 * Settings screen. Fields are rendered from the API response rather than
 * hard-coded here, so the server definition stays the single source of truth.
 */

let definitions = [];
let me = null;
let dirty = false;

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

function alertBox(type, message, target = '#alerts') {
  const host = $(target);
  const box = el('div', { class: `alert alert--${type}`, role: 'alert' }, [el('span', { text: message })]);
  host.append(box);
  setTimeout(() => box.remove(), 8000);
  return box;
}

function sourceLabel(source) {
  if (source === 'dashboard') return 'Saved here';
  if (source === 'environment') return 'From server environment';
  return 'Default';
}

// -------------------------------------------------------------------- render

function fieldControl(def) {
  const id = `set-${def.key}`;

  if (def.type === 'boolean') {
    const input = el('input', { type: 'checkbox', id, checked: String(def.value) === 'true' });
    input.addEventListener('change', markDirty);
    return el('label', { class: 'consent', for: id }, [
      input,
      el('span', {}, [
        el('strong', { text: def.label }),
        el('span', { class: 'small muted', style: 'display:block;margin-top:3px', text: def.hint }),
      ]),
    ]);
  }

  const input = el('input', {
    type: def.type === 'number' ? 'number' : def.type === 'password' ? 'password' : def.type === 'url' ? 'url' : 'text',
    id,
    name: def.key,
    value: def.secret ? '' : def.value,
    placeholder: def.secret && def.isSet ? 'Saved - leave blank to keep' : def.placeholder,
    autocomplete: def.type === 'password' ? 'new-password' : 'off',
    spellcheck: 'false',
  });
  input.addEventListener('input', markDirty);

  const wrap = el('div', { class: 'field' }, [
    el('label', { for: id }, [def.label, el('span', { class: 'field__source', text: sourceLabel(def.source) })]),
    input,
    el('span', { class: 'field__hint', text: def.hint }),
    el('span', { class: 'field__error hidden', id: `${id}-error` }),
  ]);

  if (def.secret && def.isSet) {
    wrap.append(
      el('label', { class: 'check check--clear', for: `${id}-clear` }, [
        el('input', { type: 'checkbox', id: `${id}-clear`, 'data-clear': def.key }),
        el('span', { text: 'Remove the saved password' }),
      ])
    );
  }

  return wrap;
}

function renderForm() {
  const groups = { email: $('#group-email'), webhook: $('#group-webhook') };
  for (const host of Object.values(groups)) host.textContent = '';

  for (const def of definitions) {
    const host = groups[def.group];
    if (!host) continue;
    const control = fieldControl(def);
    if (def.type === 'boolean') control.classList.add('field--full');
    host.append(control);
  }

  $('#loading').classList.add('hidden');
  $('#settings-form').classList.remove('hidden');
  markClean();
}

function renderSummary(summary) {
  const email = summary.email || {};
  const webhook = summary.webhook || {};

  $('#stat-email').textContent = email.enabled ? 'Active' : 'Off';
  $('#stat-email').className = `stat__value ${email.enabled ? 'stat__value--ok' : 'stat__value--off'}`;
  $('#stat-email-sub').textContent = email.enabled
    ? `${email.host}:${email.port}${email.secure ? ' (TLS)' : ''}`
    : 'Set an SMTP host to enable';

  $('#stat-webhook').textContent = webhook.enabled ? 'Active' : 'Off';
  $('#stat-webhook').className = `stat__value ${webhook.enabled ? 'stat__value--ok' : 'stat__value--off'}`;
  $('#stat-webhook-sub').textContent = webhook.enabled ? webhook.url : 'Set a webhook URL to enable';

  $('#stat-recipient').textContent = email.recipient || '-';
}

function markDirty() {
  dirty = true;
  $('#save-note').textContent = 'You have unsaved changes.';
  $('#save-note').classList.add('actions__note--dirty');
}

function markClean() {
  dirty = false;
  $('#save-note').textContent = 'Changes take effect immediately. Passwords are never displayed once saved.';
  $('#save-note').classList.remove('actions__note--dirty');
}

function clearErrors() {
  for (const node of document.querySelectorAll('.field__error')) {
    node.classList.add('hidden');
    node.textContent = '';
  }
  for (const input of document.querySelectorAll('#settings-form input')) {
    input.removeAttribute('aria-invalid');
  }
}

function showErrors(errors) {
  for (const [key, message] of Object.entries(errors || {})) {
    const node = $(`#set-${key}-error`);
    const input = $(`#set-${key}`);
    if (node) {
      node.textContent = message;
      node.classList.remove('hidden');
    }
    if (input) input.setAttribute('aria-invalid', 'true');
  }
}

function collect() {
  const values = {};
  const clear = [];
  for (const def of definitions) {
    const input = $(`#set-${def.key}`);
    if (!input) continue;
    if (def.type === 'boolean') values[def.key] = input.checked ? 'true' : 'false';
    else values[def.key] = input.value;

    const clearBox = $(`#set-${def.key}-clear`);
    if (clearBox && clearBox.checked) clear.push(def.key);
  }
  return { settings: values, clear };
}

// ---------------------------------------------------------------------- data

async function load() {
  try {
    const response = await fetch('/admin/api/settings');
    if (response.status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    const body = await response.json();
    definitions = body.settings || [];
    renderForm();
    renderSummary(body.summary || {});
  } catch {
    alertBox('error', 'Could not load settings. Please refresh the page.');
  }
}

async function save(event) {
  if (event) event.preventDefault();
  clearErrors();

  const buttons = [$('#btn-save'), $('#btn-save-bottom')];
  buttons.forEach((button) => (button.disabled = true));

  try {
    const response = await fetch('/admin/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collect()),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || !body.ok) {
      showErrors(body.errors);
      alertBox('error', body.message || 'Could not save the settings.');
      return;
    }

    definitions = body.settings || definitions;
    renderForm();
    renderSummary(body.summary || {});
    alertBox('success', body.message || 'Settings saved.');
  } catch {
    alertBox('error', 'Could not reach the server. Please try again.');
  } finally {
    buttons.forEach((button) => (button.disabled = false));
  }
}

async function testChannel(channel, button) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Testing...';

  try {
    const response = await fetch(`/admin/api/settings/test-${channel}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await response.json().catch(() => ({}));
    alertBox(body.ok ? 'success' : 'error', body.message || 'The test could not be completed.');
  } catch {
    alertBox('error', 'Could not reach the server to run the test.');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function reset() {
  if (!window.confirm('Reset every stored setting back to the server environment values?')) return;
  try {
    const response = await fetch('/admin/api/settings/reset', { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) {
      alertBox('error', body.message || 'Could not reset the settings.');
      return;
    }
    definitions = body.settings || definitions;
    renderForm();
    renderSummary(body.summary || {});
    alertBox('info', body.message || 'Settings reset.');
  } catch {
    alertBox('error', 'Could not reach the server. Please try again.');
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

$('#settings-form').addEventListener('submit', save);
$('#btn-save').addEventListener('click', save);
$('#btn-reset').addEventListener('click', reset);
$('#btn-test-email').addEventListener('click', (event) => testChannel('email', event.currentTarget));
$('#btn-test-webhook').addEventListener('click', (event) => testChannel('webhook', event.currentTarget));
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
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    save();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

loadMe();
load();
