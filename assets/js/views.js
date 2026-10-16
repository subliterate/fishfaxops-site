// Pulse section markup. Pure functions: validated snapshot data in, escaped HTML out.
import { escapeHTML as e, formatNumber, formatWhen, timeElement, modelLabel, shorten } from './summary.js';
import { chartMarkup, periodPhrase } from './charts.js';
import { filterPosts, rangePoints } from './data.js';

export const WRITING_BATCH = 6;
const QUALITY = { ok: 'Complete', incomplete: 'Period not finished', 'source-date-conflict': 'Dated after the source update' };

const seconds = ms => (ms === null ? 'Not available' : ms < 1000 ? `${formatNumber(Math.round(ms))} ms` : `${(ms / 1000).toFixed(2)} seconds`);
const replies = r => (r.attempted === null ? 'Not available' : `${formatNumber(r.succeeded)} of ${formatNumber(r.attempted)}`);
const table = (caption, heads, rows) => `<div class="table-scroll" role="region" aria-label="${e(caption)}" tabindex="0"><table><caption>${e(caption)}</caption><thead><tr>${heads.map(h => `<th scope="col">${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${heads.length}">No recorded rows.</td></tr>`}</tbody></table></div>`;
const notes = list => (list.length ? `<ul class="tech-notes">${list.map(n => `<li>${e(n)}</li>`).join('')}</ul>` : '');

export const lastComplete = metric => metric?.points.filter(p => p.quality === 'ok' && p.complete).at(-1) || null;
export const defaultMetric = n => n.metrics.find(m => m.key === n.default_metric) || n.metrics[0] || null;

/** Notice for a section that was carried over or could not be loaded. */
export function sectionNotice(section, what) {
  if (!section || section.status === 'ok') return '';
  if (section.status === 'retained') return `<p class="notice" role="note">${e(what)} could not be refreshed in the latest update. These are the figures saved ${timeElement(section.as_of)}.</p>`;
  return `<p class="notice notice--error" role="note">${e(what)} could not be loaded in the latest update.</p>`;
}

// ---------------------------------------------------------------- AI checks

export function modelCard(m, now) {
  const label = modelLabel(m, now);
  const history = m.history.map(h => ({ t: h.t, value: h.median_ms }));
  const detailRows = m.history.slice().reverse().map(h => [timeElement(h.t), e(seconds(h.median_ms)), e(seconds(h.slow_ms)), e(replies(h))]);
  const loadRows = m.levels.map(l => [e(formatNumber(l.concurrency)), e(seconds(l.median_ms)), e(seconds(l.slow_ms)), e(replies(l))]);
  return `<article class="card model-card" data-key="${e(m.id)}">
<h3 class="card__title">${e(m.name)}</h3>
<p class="status status--large status--${e(label.status)}"><span class="status__dot" aria-hidden="true"></span>${e(label.word)}</p>
<p class="qualifier${label.older ? ' qualifier--older' : ''}">${e(label.qualifier)}</p>
<dl class="model-card__facts"><div><dt>Typical reply time</dt><dd>${e(seconds(m.median_ms))}</dd></div><div><dt>Test requests answered</dt><dd>${e(replies(m))}</dd></div></dl>
${chartMarkup(history, { label: 'Typical reply time at each check (ms)', unit: 'ms', format: v => formatNumber(Math.round(v)) })}
<details class="more"><summary>More detail<span class="visually-hidden"> about ${e(m.name)}</span></summary><div class="more__body">
<p>“Typical” is the middle reply time of the test requests. “Slower replies” is the time that 19 in 20 replies beat. Reply times are only shown when every request in a check succeeded.</p>
${table(`${m.name}: every recorded check, newest first`, ['Check', 'Typical reply', 'Slower replies', 'Answered'], detailRows)}
<h4>When several requests arrive at once</h4>
<p>From the latest check only: the same test sent 1, 2 or 4 at a time.</p>
${table(`${m.name}: latest check by number of requests at once`, ['Requests at once', 'Typical reply', 'Slower replies', 'Answered'], loadRows)}
${notes(m.notes)}
</div></details>
</article>`;
}

export function modelsRegion(snapshot, now) {
  const notice = sectionNotice(snapshot.sections.models, 'AI check results');
  if (!snapshot.models.length) return `${notice || '<p class="notice">No AI check results are available.</p>'}`;
  return `${notice}<div class="card-grid card-grid--three">${snapshot.models.map(m => modelCard(m, now)).join('')}</div>`;
}

// ---------------------------------------------------------------- Agent economy

export function economyRegion(snapshot) {
  const notice = sectionNotice(snapshot.sections.agent_economy, 'Agent-economy figures');
  const ec = snapshot.economy;
  if (ec.registrations === null && ec.payment_value_usd === null) return notice || '<p class="notice">No agent-economy figures are available.</p>';
  const figure = (title, value, note) => `<div class="card figure-card"><h3 class="figure-card__title">${title}</h3><p class="figure-card__value">${value}</p><p class="figure-card__note">${note}</p></div>`;
  const reg = ec.registrations === null ? 'Not available' : e(formatNumber(ec.registrations));
  const pay = ec.payment_value_usd === null ? 'Not available' : `US$${e(formatNumber(ec.payment_value_usd))}`;
  const source = ec.source_url ? `<a href="${e(ec.source_url)}" rel="noopener">agenteconomy.to</a>` : 'agenteconomy.to';
  return `${notice}<div class="card-grid card-grid--two">
${figure('Agents registered on ERC-8004', reg, 'Total registrations in the ERC-8004 registry. One organisation can register more than once, so this is not a count of distinct agents.')}
${figure('Payment value through x402', pay, 'Total value of payments recorded through x402, in US dollars.')}
</div><p class="source-line">Source: ${source}, last updated ${timeElement(ec.source_updated_at)}. These two figures come from different systems and are not combined.</p>`;
}

// ---------------------------------------------------------------- Networks

export function atAGlance(networks) {
  const rows = networks.map(n => {
    const m = defaultMetric(n);
    const last = lastComplete(m);
    const text = last ? `<strong>${e(formatNumber(last.value))}</strong> ${e(m.unit)} ${e(periodPhrase(last.t, m.cadence))}` : 'No completed period recorded';
    return { name: n.name, html: `<li><span class="glance__name">${e(n.name)}</span><span class="glance__value">${text}</span></li>` };
  }).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  return `<div class="glance"><h3 class="glance__title">At a glance</h3><p class="muted">The latest completed count from each network, in alphabetical order. They measure different things, so they are not ranked.</p><ul class="glance__list" role="list">${rows.map(r => r.html).join('')}</ul></div>`;
}

export function networkCard(n) {
  const m = defaultMetric(n);
  if (!m) return `<article class="card network-card" data-key="${e(n.id)}"><h3 class="card__title">${e(n.name)}</h3><p class="muted">No recorded measures.</p></article>`;
  const last = lastComplete(m);
  const daily = m.cadence === 'monthly' ? m : { ...m, points: rangePoints(m.points, '90') };
  return `<article class="card network-card" data-key="${e(n.id)}">
<h3 class="card__title">${e(n.name)}</h3>
<p class="network-card__value">${last ? e(formatNumber(last.value)) : 'Not available'}</p>
<p class="network-card__label">${e(m.label.toLowerCase() === m.unit ? m.unit : `${m.label} (${m.unit})`)} ${last ? e(periodPhrase(last.t, m.cadence)) : '· no completed period'}</p>
${chartMarkup(daily.points, { label: `${m.label}, last 90 days recorded`, unit: m.unit, cadence: m.cadence })}
<p class="source-line">Source updated ${timeElement(n.source_updated_at)}.</p>
<button type="button" class="button button--small explore" data-network="${e(n.id)}">Explore ${e(n.name)}</button>
</article>`;
}

export function networksRegion(snapshot) {
  const notice = sectionNotice(snapshot.sections.agent_economy, 'Network figures');
  if (!snapshot.networks.length) return notice || '<p class="notice">No network figures are available.</p>';
  return `${notice}${atAGlance(snapshot.networks)}<div class="card-grid card-grid--three">${snapshot.networks.map(networkCard).join('')}</div>`;
}

export function explorerControls(networks, state) {
  const network = networks.find(n => n.id === state.network) || networks[0];
  const options = (items, value) => items.map(([v, t]) => `<option value="${e(v)}"${v === value ? ' selected' : ''}>${e(t)}</option>`).join('');
  const ranges = [['30', '30 days'], ['90', '90 days'], ['all', 'All recorded']];
  return `<div class="explorer__controls">
<label class="field"><span class="field__label">Network</span><select data-control="network">${options(networks.map(n => [n.id, n.name]), network.id)}</select></label>
<label class="field"><span class="field__label">Measure</span><select data-control="metric">${options(network.metrics.map(m => [m.key, m.label]), state.metric)}</select></label>
<div class="field" role="group" aria-labelledby="range-label"><span class="field__label" id="range-label">Period</span><div class="segmented">${ranges.map(([v, t]) => `<button type="button" data-range="${v}" aria-pressed="${v === state.range}">${t}</button>`).join('')}</div></div>
</div>`;
}

export function explorerOutput(networks, state) {
  const n = networks.find(x => x.id === state.network);
  const m = n?.metrics.find(x => x.key === state.metric);
  if (!n || !m) return '<p class="muted">Choose a network and measure.</p>';
  const range = m.cadence === 'monthly' && state.range !== 'all' ? 'all' : state.range;
  const points = rangePoints(m.points, range);
  const excluded = points.filter(p => !(p.quality === 'ok' && p.complete)).length;
  const span = points.length ? `${formatWhen(points[0].t)} to ${formatWhen(points.at(-1).t)}` : 'No dates available';
  const rows = points.slice().reverse().map(p => [`<time datetime="${e(p.t)}">${e(m.cadence === 'monthly' ? periodPhrase(p.t, 'monthly').replace(/^in /, '') : formatWhen(p.t))}</time>`, e(formatNumber(p.value)), e(QUALITY[p.quality] || p.quality), p.quality === 'ok' && p.complete ? 'Yes' : 'No']);
  const monthlyNote = m.cadence === 'monthly' && state.range !== 'all' ? ' Monthly figures always show every recorded month.' : '';
  return `<p class="explorer__span">${e(span)}. The period ends at the latest recorded ${m.cadence === 'weekly' ? 'week' : m.cadence === 'monthly' ? 'month' : 'day'}, not today.${e(monthlyNote)}</p>
${chartMarkup(points, { label: `${n.name}: ${m.label}`, unit: m.unit, cadence: m.cadence, large: true })}
<p class="muted">${excluded ? `${excluded} ${excluded === 1 ? 'period is' : 'periods are'} left out of the chart because ${excluded === 1 ? 'it was' : 'they were'} not finished or ${excluded === 1 ? 'is' : 'are'} dated after the source’s last update. ${excluded === 1 ? 'It is' : 'They are'} still listed in the table.` : 'Every period in this range is complete.'}</p>
<details class="more"><summary>Recorded values<span class="visually-hidden"> for ${e(n.name)}, ${e(m.label)}</span> (${points.length})</summary><div class="more__body">${table(`${n.name}: ${m.label}, newest first`, ['Period', m.label, 'Status', 'In chart'], rows)}${notes(n.notes)}</div></details>`;
}

// ---------------------------------------------------------------- Writing

export function writingControls(posts, state) {
  const communities = [...new Set(posts.map(p => p.community).filter(Boolean))].sort();
  return `<div class="writing__controls">
<label class="field field--grow"><span class="field__label">Search titles and excerpts</span><input type="search" data-control="query" value="${e(state.query)}" autocomplete="off"></label>
<label class="field"><span class="field__label">Community</span><select data-control="community"><option value="">All</option>${communities.map(c => `<option value="${e(c)}"${c === state.community ? ' selected' : ''}>${e(c)}</option>`).join('')}</select></label>
<label class="field"><span class="field__label">From</span><input type="date" data-control="from" value="${e(state.from)}"></label>
<label class="field"><span class="field__label">To</span><input type="date" data-control="to" value="${e(state.to)}"></label>
</div>`;
}

export function postItem(p, featured = false) {
  const community = p.community ? ` · ${e(p.community)}` : '';
  const excerpt = p.excerpt ? `<p class="post__excerpt">${e(shorten(p.excerpt, featured ? 480 : 260))}</p>` : '<p class="post__excerpt muted">No excerpt supplied.</p>';
  return `<li class="post${featured ? ' post--featured' : ''}" data-key="${e(p.id)}"><p class="post__meta">${timeElement(p.published_at)}${community}</p><h3 class="post__title"><a href="${e(p.url)}" rel="noopener">${e(p.title)}<span class="visually-hidden"> (opens on Moltbook)</span></a></h3>${excerpt}</li>`;
}

export function writingResults(writing, state) {
  const filtered = filterPosts(writing.posts, state);
  const shown = Math.max(state.shown || WRITING_BATCH, WRITING_BATCH);
  const visible = filtered.slice(0, shown);
  const filtering = Boolean(state.query.trim() || state.community || state.from || state.to);
  const more = writing.coverage.has_more === true ? ' Older posts are on Moltbook.' : '';
  const status = filtering
    ? `${formatNumber(filtered.length)} of ${formatNumber(writing.posts.length)} posts match. Showing ${formatNumber(visible.length)}.`
    : `Showing ${formatNumber(visible.length)} of ${formatNumber(writing.posts.length)} recent posts.${more}`;
  const list = visible.length
    ? `<ol class="post-list" role="list">${visible.map((p, i) => postItem(p, !filtering && i === 0)).join('')}</ol>`
    : `<p class="notice">${writing.posts.length ? 'No posts match these filters.' : 'No posts are available.'}</p>`;
  const button = visible.length < filtered.length ? `<button type="button" class="button button--secondary" data-control="more">Show ${formatNumber(Math.min(WRITING_BATCH, filtered.length - visible.length))} more</button>` : '';
  return { status, list, button, count: visible.length, total: filtered.length };
}
