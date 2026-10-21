/* global window, document, fetch */
'use strict';

/**
 * Renders the rental agreement form from the server-provided schema and posts
 * the completed agreement back. Keeping the markup schema-driven means the
 * form, the stored payload and the generated PDF cannot drift apart.
 */

const $ = (selector, scope = document) => scope.querySelector(selector);

const state = {
  sections: [],
  errors: {},
};

// ------------------------------------------------------------------ helpers

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value);
    } else if (key === 'dataset') {
      Object.assign(node.dataset, value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function fieldId(name) {
  return `f-${name}`;
}

function labelFor(field) {
  return el('label', { for: fieldId(field.name) }, [
    field.label,
    field.required ? el('span', { class: 'req', text: '*' }) : null,
  ]);
}

/** Wrap a control with its label, hint and inline error message. */
function fieldWrapper(field, control, extraClass = '') {
  const errorNode = el('span', {
    class: 'field__error',
    id: `${fieldId(field.name)}-error`,
    role: 'alert',
  });

  return el('div', {
    class: `field ${field.type === 'textarea' || field.type === 'signature' || field.type === 'multi' ? 'field--full' : ''} ${extraClass}`,
    dataset: { field: field.name },
  }, [
    field.type === 'checkbox' ? null : labelFor(field),
    control,
    errorNode,
  ]);
}

// ------------------------------------------------------------------ controls

function buildTextControl(field) {
  const input = el('input', {
    id: fieldId(field.name),
    name: field.name,
    type: field.type === 'money' ? 'text' : field.type,
    inputmode: field.type === 'money' ? 'decimal' : undefined,
    placeholder: field.placeholder,
    autocomplete: autocompleteFor(field.name),
    min: field.min,
    max: field.max,
    step: field.step,
    value: field.default !== undefined ? field.default : '',
  });
  input.required = false; // validation is handled by the server and our own pass

  if (field.type === 'money') {
    return el('div', { class: 'money-wrap' }, [input]);
  }
  return input;
}

function autocompleteFor(name) {
  const map = {
    tenant_name: 'name',
    tenant_email: 'email',
    tenant_phone: 'tel',
    tenant_dob: 'bday',
    tenant_current_address: 'street-address',
    property_address: 'street-address',
    property_city: 'address-level2',
    property_state: 'address-level1',
    property_zip: 'postal-code',
    landlord_name: 'name',
    landlord_email: 'email',
    landlord_phone: 'tel',
  };
  return map[name];
}

function buildSelectControl(field) {
  const select = el('select', { id: fieldId(field.name), name: field.name });
  select.append(el('option', { value: '', text: field.required ? 'Select...' : 'Not specified' }));
  for (const option of field.options) {
    const [value, label] = Array.isArray(option) ? option : [option, option];
    select.append(el('option', { value, text: label }));
  }
  return select;
}

function buildTextarea(field) {
  return el('textarea', {
    id: fieldId(field.name),
    name: field.name,
    rows: field.rows || 3,
    placeholder: field.placeholder,
  });
}

function buildYesNo(field) {
  const group = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': field.label });
  for (const [value, label] of [['yes', 'Yes'], ['no', 'No']]) {
    const id = `${fieldId(field.name)}-${value}`;
    group.append(
      el('label', { for: id }, [
        el('input', { type: 'radio', id, name: field.name, value }),
        label,
      ])
    );
  }
  return group;
}

function buildMulti(field) {
  const wrap = el('div', { class: 'checks', role: 'group', 'aria-label': field.label });
  for (const option of field.options) {
    const id = `${fieldId(field.name)}-${option.replace(/\W+/g, '-').toLowerCase()}`;
    wrap.append(
      el('label', { class: 'check', for: id }, [
        el('input', { type: 'checkbox', id, name: field.name, value: option }),
        option,
      ])
    );
  }
  return wrap;
}

function buildCheckbox(field) {
  return el('label', { class: 'consent', for: fieldId(field.name) }, [
    el('input', { type: 'checkbox', id: fieldId(field.name), name: field.name, value: 'on' }),
    el('span', {}, [
      el('strong', { text: field.label }),
      field.type === 'checkbox' && field.name === 'acknowledgement'
        ? el('span', {
            class: 'small muted',
            style: 'display:block;margin-top:3px',
            text: 'You confirm the information provided is accurate and that you intend to be bound by this agreement.',
          })
        : null,
    ]),
  ]);
}

// -------------------------------------------------------------- signature pad

function buildSignature(field) {
  const canvas = el('canvas', {
    id: `${fieldId(field.name)}-canvas`,
    'aria-label': 'Signature drawing area',
    role: 'img',
  });
  const placeholder = el('div', { class: 'sig__placeholder', text: 'Sign here with your mouse, finger or stylus' });
  const wrap = el('div', { class: 'sig__canvas-wrap' }, [
    canvas,
    el('div', { class: 'sig__baseline' }),
    placeholder,
  ]);

  const clear = el('button', {
    class: 'btn btn--quiet btn--sm',
    type: 'button',
    text: 'Clear signature',
  });
  const status = el('span', { class: 'sig__status', text: 'Not signed' });

  const bar = el('div', { class: 'sig__bar' }, [
    el('span', { text: 'Draw your signature in the box above.' }),
    el('span', { style: 'display:flex;gap:10px;align-items:center' }, [status, clear]),
  ]);

  const hidden = el('input', { type: 'hidden', name: field.name, id: fieldId(field.name) });
  const pad = el('div', { class: 'sig' }, [wrap, bar, hidden]);

  // Wire the drawing surface once the element is in the DOM.
  queueMicrotask(() => initPad({ canvas, hidden, placeholder, status, clear, pad }));
  return pad;
}

function initPad({ canvas, hidden, placeholder, status, clear, pad }) {
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let hasInk = false;
  let last = null;

  function resize() {
    // Preserve existing strokes across resize by snapshotting first.
    const snapshot = hasInk ? canvas.toDataURL('image/png') : null;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(Math.floor(rect.width * ratio), 300);
    canvas.height = Math.floor((rect.height || 150) * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#16202c';

    if (snapshot) {
      const img = new Image();
      img.onload = () => {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.restore();
      };
      img.src = snapshot;
    }
  }

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event) {
    event.preventDefault();
    drawing = true;
    last = point(event);
    if (canvas.setPointerCapture && event.pointerId !== undefined) {
      canvas.setPointerCapture(event.pointerId);
    }
  }

  function move(event) {
    if (!drawing) return;
    event.preventDefault();
    const current = point(event);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();
    last = current;

    if (!hasInk) {
      hasInk = true;
      placeholder.classList.add('hidden');
      status.textContent = 'Signed';
      status.style.color = 'var(--success)';
      status.style.fontWeight = '700';
      pad.classList.add('has-ink');
    }
    // Mirror the drawing into the hidden input as a PNG data URL.
    hidden.value = canvas.toDataURL('image/png');
    clearFieldError('signature_data');
  }

  function end() {
    drawing = false;
    last = null;
  }

  clear.addEventListener('click', () => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    hasInk = false;
    hidden.value = '';
    placeholder.classList.remove('hidden');
    status.textContent = 'Not signed';
    status.style.color = '';
    status.style.fontWeight = '';
    pad.classList.remove('has-ink');
  });

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointerleave', end);
  canvas.addEventListener('pointercancel', end);

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 180);
  });

  resize();
}

// ----------------------------------------------------------------- rendering

function buildControl(field) {
  switch (field.type) {
    case 'select':
      return fieldWrapper(field, buildSelectControl(field));
    case 'textarea':
      return fieldWrapper(field, buildTextarea(field));
    case 'yesno':
      return fieldWrapper(field, buildYesNo(field));
    case 'multi':
      return fieldWrapper(field, buildMulti(field));
    case 'checkbox':
      return fieldWrapper(field, buildCheckbox(field), 'field--full');
    case 'signature':
      return fieldWrapper(field, buildSignature(field), 'field--full');
    default:
      return fieldWrapper(field, buildTextControl(field));
  }
}

function renderSections() {
  const container = $('#sections');
  const toc = $('#toc-list');
  container.textContent = '';
  toc.textContent = '';

  state.sections.forEach((section, index) => {
    const sectionEl = el('section', {
      class: 'card',
      id: `section-${section.id}`,
      'aria-labelledby': `section-${section.id}-title`,
    }, [
      el('div', { class: 'card__head' }, [
        el('h2', { id: `section-${section.id}-title` }, [
          el('span', { class: 'section-badge', text: String(index + 1) }),
          section.title.replace(/^\d+\.\s*/, ''),
        ]),
        el('p', { text: section.description }),
      ]),
      el(
        'div',
        { class: 'card__body' },
        [el('div', { class: 'grid' }, section.fields.map(buildControl))]
      ),
    ]);
    container.append(sectionEl);

    toc.append(
      el('li', {}, [
        el('a', {
          href: `#section-${section.id}`,
          dataset: { section: section.id },
        }, [
          el('span', { class: 'toc__count', text: String(index + 1).padStart(2, '0') }),
          el('span', { text: section.title.replace(/^\d+\.\s*/, '') }),
        ]),
      ])
    );
  });
}

// -------------------------------------------------------------- error display

function clearFieldError(name) {
  delete state.errors[name];
  const wrapper = document.querySelector(`[data-field="${name}"]`);
  if (!wrapper) return;
  wrapper.classList.remove('has-error');
  const control = document.getElementById(fieldId(name));
  if (control) control.removeAttribute('aria-invalid');
  if (control && control.tagName === 'SELECT') control.removeAttribute('aria-invalid');
}

function showFieldErrors(errors) {
  state.errors = errors || {};
  document.querySelectorAll('.field.has-error').forEach((node) => node.classList.remove('has-error'));
  document.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));

  let first = null;
  for (const [name, message] of Object.entries(state.errors)) {
    const wrapper = document.querySelector(`[data-field="${name}"]`);
    if (!wrapper) continue;
    wrapper.classList.add('has-error');
    const errorNode = wrapper.querySelector('.field__error');
    if (errorNode) errorNode.textContent = message;
    const control = document.getElementById(fieldId(name));
    if (control) control.setAttribute('aria-invalid', 'true');
    if (!first) first = wrapper;
  }
  if (first) {
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const focusable = first.querySelector('input, select, textarea, canvas');
    if (focusable && focusable.focus) focusable.focus({ preventScroll: true });
  }
}

function showAlert(type, title, message, list) {
  const box = el('div', { class: `alert alert--${type}` }, [
    el('div', {}, [
      el('strong', { class: 'alert__title', text: title }),
      el('span', { text: message }),
      list && list.length ? el('ul', {}, list.map((item) => el('li', { text: item }))) : null,
    ]),
  ]);
  $('#alerts').append(box);
  return box;
}

function clearAlerts() {
  $('#alerts').textContent = '';
}

// ------------------------------------------------------------- form payload

/** Read the form into the shape the API expects. */
function collect() {
  const data = {};
  for (const section of state.sections) {
    for (const field of section.fields) {
      const id = fieldId(field.name);
      switch (field.type) {
        case 'multi':
          data[field.name] = Array.from(document.querySelectorAll(`[name="${field.name}"]:checked`)).map(
            (input) => input.value
          );
          break;
        case 'checkbox':
          data[field.name] = Boolean(document.getElementById(id)?.checked);
          break;
        case 'signature':
          data[field.name] = document.getElementById(id)?.value || '';
          break;
        case 'yesno': {
          const checked = document.querySelector(`[name="${field.name}"]:checked`);
          data[field.name] = checked ? checked.value : '';
          break;
        }
        default:
          data[field.name] = document.getElementById(id)?.value?.trim() ?? '';
      }
    }
  }
  return data;
}

/** Count filled fields to drive the progress indicator. */
function updateProgress() {
  const data = collect();
  let total = 0;
  let filled = 0;
  const perSection = [];

  for (const section of state.sections) {
    let sectionTotal = 0;
    let sectionFilled = 0;
    for (const field of section.fields) {
      total += 1;
      sectionTotal += 1;
      const value = data[field.name];
      const isFilled =
        field.type === 'multi' ? Array.isArray(value) && value.length > 0
        : field.type === 'checkbox' ? value === true
        : String(value || '').trim() !== '';
      if (isFilled) {
        filled += 1;
        sectionFilled += 1;
      }
    }
    perSection.push({ id: section.id, done: sectionFilled === sectionTotal });
  }

  const percent = total ? Math.round((filled / total) * 100) : 0;
  $('#progress-bar').style.width = `${percent}%`;
  $('#progress-text').textContent = `${percent}% complete`;

  for (const item of perSection) {
    const link = document.querySelector(`.toc a[data-section="${item.id}"]`);
    if (link) link.classList.toggle('is-done', item.done);
  }
}

/**
 * Pin the submit bar to the bottom of the viewport only once the end of the
 * form has been reached. While the tenant is working through the sections the
 * bar stays in normal flow, off-screen, so it cannot cover the fields being
 * filled.
 *
 * The bar is the last element on the page, so "reached the end" is simply
 * "scrolled to the bottom of the document". At that point the bar's natural
 * position already fills the bottom of the viewport, so pinning shifts nothing
 * and cannot obscure a field. A sentinel-based trigger would pin early on
 * narrow screens, where the bar wraps to several rows and is taller than the
 * gap above it.
 */
function initActionBar() {
  const actions = document.querySelector('.actions');
  if (!actions) return;

  let frame = 0;

  function update() {
    frame = 0;
    const page = document.documentElement;
    const atEnd = window.scrollY + window.innerHeight >= page.scrollHeight - 2;
    actions.classList.toggle('is-pinned', atEnd);
  }

  function schedule() {
    if (frame) return;
    frame = window.requestAnimationFrame(update);
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  update();
}

/** Mirror the active section in the table of contents while scrolling. */
function initScrollSpy() {
  const links = Array.from(document.querySelectorAll('.toc a'));
  const sections = state.sections
    .map((section) => document.getElementById(`section-${section.id}`))
    .filter(Boolean);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((link) =>
          link.classList.toggle('is-active', link.dataset.section === entry.target.id.replace('section-', ''))
        );
      }
    },
    { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
  );
  sections.forEach((section) => observer.observe(section));
}

// --------------------------------------------------------------- submission

async function submit(event) {
  event.preventDefault();
  clearAlerts();

  const button = $('#btn-submit');
  const data = collect();

  button.disabled = true;
  const original = button.textContent;
  button.textContent = '';
  button.append(el('span', { class: 'spinner' }), document.createTextNode('Submitting...'));

  try {
    const response = await fetch('/api/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await response.json().catch(() => ({}));

    if (response.status === 422 && body.errors) {
      showFieldErrors(body.errors);
      const count = Object.keys(body.errors).length;
      showAlert(
        'error',
        `Please fix ${count} field${count === 1 ? '' : 's'}`,
        body.message || 'Some details need attention before you can submit.',
        Object.entries(body.errors)
          .slice(0, 8)
          .map(([, message]) => message)
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (!response.ok || !body.ok) {
      showAlert('error', 'Submission failed', body.message || 'Please try again in a moment.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    $('#success-ref').textContent = body.reference;
    $('#meta-ref').textContent = `Reference ${body.reference}`;
    $('#form-view').classList.add('hidden');
    $('#success-view').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    showAlert(
      'error',
      'Could not reach the server',
      'Check your internet connection and try again. Your answers have not been lost.'
    );
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function resetForm() {
  $('#agreement-form').reset();
  document.querySelectorAll('.sig').forEach((pad) => {
    const clear = pad.querySelector('.btn--quiet');
    if (clear) clear.click();
  });
  $('#success-view').classList.add('hidden');
  $('#form-view').classList.remove('hidden');
  clearAlerts();
  updateProgress();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --------------------------------------------------------------------- boot

async function boot() {
  try {
    const response = await fetch('/api/form-schema');
    const body = await response.json();
    state.sections = body.sections;
  } catch (error) {
    showAlert('error', 'Could not load the agreement', 'Please refresh the page to try again.');
    return;
  }

  renderSections();
  initScrollSpy();
  initActionBar();

  $('#agreement-form').addEventListener('submit', submit);
  $('#agreement-form').addEventListener('input', updateProgress);
  $('#agreement-form').addEventListener('change', updateProgress);
  $('#btn-print').addEventListener('click', () => window.print());
  $('#start-over').addEventListener('click', resetForm);

  updateProgress();
}

document.addEventListener('DOMContentLoaded', boot);
