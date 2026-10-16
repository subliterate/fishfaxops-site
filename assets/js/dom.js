// Reader-state preservation (stage 6). A region is only rewritten when its markup
// changes; when it is, open panels, focus, table scroll and the reader's scroll
// position are carried across the rewrite.

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';
const rendered = new WeakMap();

function scopeFor(el, root) {
  const keyed = el.closest('[data-key]');
  return keyed && root.contains(keyed) && keyed !== root ? keyed : root;
}

function describe(el, root, selector) {
  const scope = scopeFor(el, root);
  return { key: scope === root ? null : scope.dataset.key, selector, index: [...scope.querySelectorAll(selector)].indexOf(el) };
}

function find(root, d) {
  const scope = d.key === null ? root : root.querySelector(`[data-key="${CSS.escape(d.key)}"]`);
  return scope ? scope.querySelectorAll(d.selector)[d.index] || null : null;
}

function selectorFor(el) {
  if (el.dataset.control) return `[data-control="${el.dataset.control}"]`;
  if (el.dataset.range) return `[data-range="${el.dataset.range}"]`;
  if (el.classList.contains('chart__point')) return '.chart__point';
  return FOCUSABLE;
}

export function captureState(root) {
  const active = document.activeElement;
  const focus = active && active !== document.body && root.contains(active) ? describe(active, root, selectorFor(active)) : null;
  const input = focus && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && typeof active.selectionStart === 'number'
    ? { start: active.selectionStart, end: active.selectionEnd } : null;
  return {
    open: [...root.querySelectorAll('details[open]')].map(d => describe(d, root, 'details')),
    scrolls: [...root.querySelectorAll('.table-scroll')].filter(t => t.scrollLeft).map(t => ({ ...describe(t, root, '.table-scroll'), left: t.scrollLeft })),
    focus,
    input,
  };
}

export function restoreState(root, state) {
  for (const d of state.open) { const el = find(root, d); if (el) el.open = true; }
  for (const d of state.scrolls) { const el = find(root, d); if (el) el.scrollLeft = d.left; }
  if (state.focus) {
    const el = find(root, state.focus);
    if (el) {
      if (el.classList.contains('chart__point')) {
        el.closest('.chart').querySelectorAll('.chart__point').forEach(p => { p.tabIndex = p === el ? 0 : -1; });
      }
      el.focus({ preventScroll: true });
      if (state.input && typeof el.setSelectionRange === 'function') {
        try { el.setSelectionRange(state.input.start, state.input.end); } catch { /* not a text input */ }
      }
    }
  }
}

/** Rewrite `el` only if `key` (default: the markup) differs from its last render. */
export function apply(el, html, key = html) {
  if (!el || rendered.get(el) === key) return false;
  const state = captureState(el);
  el.innerHTML = html;
  rendered.set(el, key);
  restoreState(el, state);
  return true;
}

/** Remember the first keyed element or heading at the top of the reading area. */
export function captureAnchor(offset) {
  // At the top of the page there is nothing to hold: content growing below the
  // header must not push the reader away from the start (or the skip link).
  if (window.scrollY <= 0) return null;
  for (const el of document.querySelectorAll('main [data-key], main h2[id], main h3[id]')) {
    const rect = el.getBoundingClientRect();
    if (rect.height && rect.bottom > offset) {
      return { selector: el.dataset.key ? `[data-key="${CSS.escape(el.dataset.key)}"]` : `#${CSS.escape(el.id)}`, top: rect.top };
    }
  }
  return null;
}

/** Keep that element where it was on screen after content above it changed. */
export function restoreAnchor(anchor) {
  if (!anchor) return;
  const el = document.querySelector(anchor.selector);
  if (!el) return;
  const delta = el.getBoundingClientRect().top - anchor.top;
  if (Math.abs(delta) >= 1) window.scrollBy({ top: delta, behavior: 'instant' });
}
