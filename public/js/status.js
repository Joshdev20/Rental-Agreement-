/* global document, fetch */
'use strict';

const $ = (selector) => document.querySelector(selector);

function alertBox(type, message) {
  const alerts = $('#alerts');
  alerts.textContent = '';
  const box = document.createElement('div');
  box.className = `alert alert--${type}`;
  box.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = message;
  box.append(text);
  alerts.append(box);
}

$('#status-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#btn-check');
  button.disabled = true;
  button.textContent = 'Checking...';
  $('#result').classList.add('hidden');

  try {
    const response = await fetch('/api/submissions/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: $('#reference').value,
        email: $('#email').value,
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || !body.ok) {
      alertBox('error', body.message || 'No submission found for those details.');
      return;
    }

    $('#alerts').textContent = '';
    $('#result-ref').textContent = body.reference;
    const badge = $('#result-status');
    badge.className = `badge badge--${body.status}`;
    badge.textContent = body.status;
    $('#result-tenant').textContent = body.tenant || '-';
    $('#result-property').textContent = body.property || '-';
    $('#result-date').textContent = new Date(body.submittedAt).toLocaleString('en-US');
    $('#result').classList.remove('hidden');
  } catch (error) {
    alertBox('error', 'Could not reach the server. Please try again.');
  } finally {
    button.disabled = false;
    button.textContent = 'Check status';
  }
});
