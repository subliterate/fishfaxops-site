// SVG charts. Ported from rich-preview/charts.mjs with plain dates and shared formatting.
// Each chart: its own scale from zero, real time axis, gaps not joined, one keyboard stop,
// exact values on focus/tap, and a readout that does not depend on hover or colour.
import { escapeHTML as e, formatNumber, formatWhen } from './summary.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86400000;

const axisLabel = t => { const d = new Date(t.length === 10 ? `${t}T00:00:00Z` : t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const monthIndex = t => { const d = new Date(`${t.slice(0, 10)}T00:00:00Z`); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
const good = p => Number.isFinite(p.value) && p.value >= 0 && (p.quality === undefined || p.quality === 'ok') && p.complete !== false;

/** Date phrase for one period, in plain words. */
export function periodPhrase(t, cadence) {
  if (cadence === 'monthly') { const d = new Date(`${t}T00:00:00Z`); return `in ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`; }
  if (cadence === 'weekly') return `in the week starting ${formatWhen(t)}`;
  if (cadence === 'daily') return `on ${formatWhen(t)}`;
  return `at ${formatWhen(t)}`;
}

function isGap(prev, p, cadence) {
  if (!prev) return false;
  const span = Date.parse(p.t) - Date.parse(prev.t);
  if (cadence === 'daily') return span > DAY;
  if (cadence === 'weekly') return span > 7 * DAY;
  if (cadence === 'monthly') return monthIndex(p.t) - monthIndex(prev.t) > 1;
  return true; // individual checks: plotted as points, never joined into a continuous line
}

export function chartMarkup(points, { label = '', unit = '', cadence = 'observations', large = false, format = formatNumber } = {}) {
  const rows = points.filter(p => Number.isFinite(Date.parse(p.t))).slice().sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const plotted = rows.filter(good);
  if (!plotted.length) return '<p class="chart-empty">No completed, dated values to plot.</p>';
  const W = large ? 620 : 300, L = large ? 52 : 6, R = large ? 16 : 6, T = large ? 14 : 8, B = large ? 30 : 8, H = large ? 270 : 90;
  const start = Date.parse(rows[0].t), end = Date.parse(rows.at(-1).t);
  const max = Math.max(...plotted.map(p => p.value), 1);
  const x = p => L + (end === start ? (W - L - R) / 2 : ((Date.parse(p.t) - start) / (end - start)) * (W - L - R));
  const y = p => T + (1 - p.value / max) * (H - T - B);
  const segments = [];
  let segment = [], prev = null;
  for (const p of rows) {
    if (!good(p) || isGap(prev, p, cadence)) { if (segment.length) segments.push(segment); segment = []; }
    if (good(p)) segment.push(p);
    prev = p;
  }
  if (segment.length) segments.push(segment);
  const paths = segments.filter(s => s.length > 1).map(s => `<path class="chart__line" d="${s.map((p, i) => `${i ? 'L' : 'M'}${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(' ')}"/>`).join('');
  const describe = p => `${periodPhrase(p.t, cadence).replace(/^./, c => c.toUpperCase())}: ${format(p.value)}${unit ? ` ${unit}` : ''}`;
  const dots = plotted.map((p, i) => {
    const text = describe(p);
    return `<g class="chart__point" tabindex="${i === plotted.length - 1 ? 0 : -1}" role="img" aria-label="${e(text)}" data-value="${e(text)}"><circle class="chart__hit" cx="${x(p).toFixed(1)}" cy="${y(p).toFixed(1)}" r="12"/><circle cx="${x(p).toFixed(1)}" cy="${y(p).toFixed(1)}" r="${large ? 4 : 2.5}"/></g>`;
  }).join('');
  const compact = v => new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  // Small charts carry their scale and dates as HTML text beneath (legible at any size);
  // only the large explorer chart draws tick labels inside the SVG.
  const grid = [0, 0.5, 1].map(f => { const gy = (T + f * (H - T - B)).toFixed(1); return `<line class="chart__grid" x1="${L}" x2="${W - R}" y1="${gy}" y2="${gy}"/>${large ? `<text class="chart__tick" x="${L - 8}" y="${(Number(gy) + 4).toFixed(1)}" text-anchor="end">${e(compact(max * (1 - f)))}</text>` : ''}`; }).join('');
  const help = cadence === 'observations' ? 'Each dot is one check; checks are not joined into a line.' : 'Gaps mean no value was supplied. Unfinished periods are left out.';
  return `<figure class="chart${large ? ' chart--large' : ''}"><figcaption class="chart__caption">${e(label)}${unit && large ? ` <span>(${e(unit)})</span>` : ''}</figcaption><svg class="chart__svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="${e(label)}: ${plotted.length} dated values. Use the arrow keys to move between them.">${grid}${paths}${dots}${large ? `<text class="chart__tick" x="${L}" y="${H - 6}">${e(axisLabel(rows[0].t))}</text><text class="chart__tick" x="${W - R}" y="${H - 6}" text-anchor="end">${e(axisLabel(rows.at(-1).t))}</text>` : ''}</svg>${large ? '' : `<p class="chart__axis"><span>${e(axisLabel(rows[0].t))}</span><span>highest ${e(compact(Math.max(...plotted.map(p => p.value))))}</span><span>${e(axisLabel(rows.at(-1).t))}</span></p>`}<p class="chart__readout" aria-live="polite">${e(describe(plotted.at(-1)))}</p>${large ? `<p class="chart__help">${help} Tap or focus a dot for its value.</p>` : ''}</figure>`;
}

/** Keyboard/pointer behaviour for every chart on the page (event delegation). */
export function enableCharts(root = document) {
  const show = point => {
    const chart = point?.closest('.chart');
    if (!chart) return;
    chart.querySelectorAll('.chart__point').forEach(p => p.classList.toggle('is-selected', p === point));
    const readout = chart.querySelector('.chart__readout');
    if (readout) readout.textContent = point.dataset.value || '';
  };
  root.addEventListener('focusin', ev => show(ev.target.closest?.('.chart__point')));
  root.addEventListener('click', ev => show(ev.target.closest?.('.chart__point')));
  root.addEventListener('pointerover', ev => show(ev.target.closest?.('.chart__point')));
  root.addEventListener('keydown', ev => {
    const point = ev.target.closest?.('.chart__point');
    if (!point) return;
    const all = [...point.closest('.chart').querySelectorAll('.chart__point')];
    let i = all.indexOf(point);
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') i = Math.min(i + 1, all.length - 1);
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') i = Math.max(i - 1, 0);
    else if (ev.key === 'Home') i = 0;
    else if (ev.key === 'End') i = all.length - 1;
    else return;
    ev.preventDefault();
    all.forEach(p => { p.tabIndex = -1; });
    all[i].tabIndex = 0;
    all[i].focus();
  });
}
