/* global document, fetch */
'use strict';

const form = document.getElementById('login-form');
const button = document.getElementById('btn-login');

function showError(message) {
  const alerts = document.getElementById('alerts');
  alerts.textContent = '';
  const box = document.createElement('div');
  box.className = 'alert alert--error';
  box.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent = message;
  box.append(text);
  alerts.append(box);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  document.getElementById('alerts').textContent = '';

  button.disabled = true;
  button.textContent = 'Signing in...';

  try {
    const response = await fetch('/admin/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || !body.ok) {
      showError(body.message || 'Sign in failed. Please try again.');
      return;
    }
    window.location.href = '/admin';
  } catch (error) {
    showError('Could not reach the server. Please try again.');
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in';
  }
});
