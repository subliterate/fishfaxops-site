// Recent observations (stage 5a — new work, no earlier implementation).
// A derived, bounded index into evidence already on the page. Not an event log:
// - one row per real record (model check, completed network period, post);
// - identity = source type + entity + period, so a new snapshot time is not a new row;
// - sorted by the record's own date, keeping date-only precision for periods;
// - linked to the relevant Pulse section or the original post.
import { escapeHTML as e, formatNumber, formatWhen, numberWord, STATUS_WORD } from './summary.js';
import { periodPhrase } from './charts.js';
import { defaultMetric, lastComplete } from './views.js';

export const RAIL_LIMIT = 6;
// Fishfax posts several times a day; uncapped, they would crowd the AI checks and
// network periods out of a six-row index. Every post remains under Writing.
export const RAIL_POST_LIMIT = 2;
const TYPE = { model: 'AI check', network: 'Network', post: 'Writing' };

/** Sort key: date-only periods count as the end of that day (UTC), so a period
 *  never outranks a timed record from the same day by an invented early time. */
const sortKey = r => (r.precision === 'day' ? Date.parse(`${r.date}T23:59:59.999Z`) : Date.parse(r.date));

export function deriveObservations(snapshot) {
  const rows = new Map();
  const add = row => { if (!rows.has(row.id)) rows.set(row.id, row); };

  // One row per model per check time. Models checked together are grouped.
  const byTime = new Map();
  for (const m of snapshot.models) {
    if (!m.observed_at) continue;
    if (!byTime.has(m.observed_at)) byTime.set(m.observed_at, []);
    byTime.get(m.observed_at).push(m);
  }
  for (const [time, models] of byTime) {
    const counts = {};
    for (const m of models) counts[m.status] = (counts[m.status] || 0) + 1;
    const summary = models.length > 1 && counts.ok === models.length
      ? `All ${models.length} models working`
      : models.map(m => `${m.name}: ${STATUS_WORD[m.status] || STATUS_WORD.unknown}`).join('; ');
    add({ id: `model:${time}`, type: 'model', date: time, precision: 'time', text: summary, href: '#ai-checks' });
  }

  // Latest completed period for each network's headline measure.
  for (const n of snapshot.networks) {
    const m = defaultMetric(n);
    const p = lastComplete(m);
    if (!p) continue;
    add({ id: `network:${n.id}:${m.key}:${p.t}`, type: 'network', date: p.t, precision: 'day', cadence: m.cadence, text: `${n.name}: ${formatNumber(p.value)} ${m.unit} ${periodPhrase(p.t, m.cadence)}`, href: '#network-activity' });
  }

  for (const p of snapshot.writing.posts) {
    add({ id: `post:${p.id}`, type: 'post', date: p.published_at, precision: 'time', text: p.title, href: p.url, external: true });
  }

  return sortRows([...rows.values()]);
}

function when(row) {
  if (row.precision === 'day') return row.cadence === 'weekly' ? `Week of ${formatWhen(row.date)}` : formatWhen(row.date);
  return formatWhen(row.date);
}

export function observationRow(row) {
  const link = row.external
    ? `<a href="${e(row.href)}" rel="noopener">${e(row.text)}<span class="visually-hidden"> (opens on Moltbook)</span></a>`
    : `<a href="${e(row.href)}">${e(row.text)}</a>`;
  return `<li class="obs" data-key="${e(row.id)}"><p class="obs__meta"><span class="obs__type">${TYPE[row.type]}</span> · <time datetime="${e(row.date)}">${e(when(row))}</time></p><p class="obs__text">${link}</p></li>`;
}

/** Pick the rows to show: newest first, at most RAIL_POST_LIMIT posts. */
export function chooseRows(rows, limit = RAIL_LIMIT) {
  const chosen = [];
  let posts = 0;
  for (const row of rows) {
    if (chosen.length >= limit) break;
    if (row.type === 'post' && ++posts > RAIL_POST_LIMIT) continue;
    chosen.push(row);
  }
  return { chosen, capped: posts > RAIL_POST_LIMIT };
}

export const sortRows = rows => rows.slice().sort((a, b) => sortKey(b) - sortKey(a) || a.id.localeCompare(b.id));

/** Markup for an already-derived (possibly held) list of rows. */
export function railMarkup(rows, limit = RAIL_LIMIT) {
  if (!rows.length) return '<p class="muted">No dated observations are available.</p>';
  const { chosen, capped } = chooseRows(sortRows(rows), limit);
  return `<ol class="obs-list" role="list">${chosen.map(observationRow).join('')}</ol><p class="obs__coverage">The ${formatNumber(chosen.length)} newest dated entries on this page${capped ? `, including the ${numberWord(RAIL_POST_LIMIT)} newest posts. Every post is listed under <a href="#writing">Writing</a>` : ''}.</p>`;
}

export function observationsRegion(snapshot, limit = RAIL_LIMIT) {
  return railMarkup(deriveObservations(snapshot), limit);
}
