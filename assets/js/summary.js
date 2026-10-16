// Shared view model: status words, dated qualifiers and the plain status sentence.
// Used at build time to prerender Home, and by Pulse at runtime (stage 5), so
// both pages describe the same snapshot in the same words.

export const STATUS_WORD = { ok: 'Working', degraded: 'Having trouble', down: 'Down', unknown: 'Unknown' };
export const OLDER_AFTER_MS = 24 * 3600 * 1000; // display threshold (plan §6), not an uptime SLA
export const OVERDUE_AFTER_MS = 18 * 3600 * 1000; // review gate 4

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pad = n => String(n).padStart(2, '0');

/** '30 Sep 2026, 00:24 UTC' for timestamps; '22 Sep 2026' for date-only values. */
export function formatWhen(value, { year = true } = {}) {
  if (typeof value !== 'string' || !value) return 'date unavailable';
  const d = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(d.getTime())) return 'date unavailable';
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`;
  return value.length === 10 ? day : `${day}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export const timeElement = (value, options) => value
  ? `<time datetime="${escapeHTML(value)}">${escapeHTML(formatWhen(value, options))}</time>`
  : 'date unavailable';

export const numberWord = n => (Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n));
const capitalise = s => s.charAt(0).toUpperCase() + s.slice(1);

export function formatNumber(value) {
  if (value === null || value === undefined) return 'Not available';
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: value !== 0 && Math.abs(value) < 1 ? 4 : 0 }).format(value);
}

export const isOlder = (observed, now) => observed !== null && now - Date.parse(observed) > OLDER_AFTER_MS;

/** Card label for one model: plain word plus dated qualifier (review gate 3). */
export function modelLabel(model, now) {
  if (model.observed_at === null) return { word: STATUS_WORD.unknown, status: 'unknown', qualifier: 'No dated check available', older: false };
  const older = isOlder(model.observed_at, now);
  return { word: STATUS_WORD[model.status] || STATUS_WORD.unknown, status: model.status, qualifier: `${older ? 'Older result · ' : ''}at the check on ${formatWhen(model.observed_at)}`, older };
}

const list = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const verb = (names, one, many) => (names.length === 1 ? one : many);

/** One plain sentence from the model results. Always dated; never “right now”. */
export function statusSentence(models, now) {
  const dated = models.filter(m => m.observed_at !== null);
  if (!models.length || !dated.length) return 'No recorded AI check results are available.';
  const latest = dated.map(m => m.observed_at).sort().at(-1);
  const sameTime = dated.every(m => m.observed_at === latest);
  const when = sameTime ? `at the last check, ${formatWhen(latest)}` : `at their latest checks (most recent ${formatWhen(latest)})`;
  const by = status => models.filter(m => m.observed_at !== null && m.status === status).map(m => m.name);
  const ok = by('ok');
  const trouble = by('degraded');
  const down = by('down');
  const unknown = models.filter(m => m.observed_at === null || m.status === 'unknown').map(m => m.name);
  const total = models.length;
  const parts = [];
  if (ok.length === total) parts.push(`All ${numberWord(total)} AI services answered normally ${when}.`);
  else if (ok.length) parts.push(`${capitalise(numberWord(ok.length))} of ${numberWord(total)} AI services answered normally ${when}.`);
  else parts.push(`None of the ${numberWord(total)} AI services answered normally ${when}.`);
  if (trouble.length) parts.push(`${list(trouble)} ${verb(trouble, 'was', 'were')} having trouble.`);
  if (down.length) parts.push(`${list(down)} did not reply successfully.`);
  if (unknown.length) parts.push(`No result is available for ${list(unknown)}.`);
  if (isOlder(latest, now)) parts.push('These results are more than a day old.');
  return parts.join(' ');
}

/** Footer line (review gate 4): full saved date, usual cadence, overdue note. */
export function savedLine(generatedAt, now) {
  const overdue = now - Date.parse(generatedAt) > OVERDUE_AFTER_MS;
  return { text: `Data last saved ${formatWhen(generatedAt)} · usually updated twice a day`, overdue, overdueText: overdue ? 'This update is later than usual.' : '' };
}

/** Cut supplied source text at a word boundary; never rewrites it. */
// Source excerpts arrive cut at exactly 500 characters, often mid-word; any
// limit below 500 therefore ends every cut excerpt at a word boundary.
export function shorten(text, max = 220) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}

// ---------------------------------------------------------------- Home

function homeModels(snapshot, now) {
  if (snapshot.sections.models.status === 'unavailable' || !snapshot.models.length) {
    return '<p class="muted">AI check results were not available when this page was built. The full record is on Pulse.</p>';
  }
  const rows = snapshot.models.map(m => {
    const label = modelLabel(m, now);
    return `<li class="result-row"><span class="result-row__name">${escapeHTML(m.name)}</span><span class="status status--${escapeHTML(label.status)}"><span class="status__dot" aria-hidden="true"></span>${escapeHTML(label.word)}</span></li>`;
  }).join('');
  return `<p class="status-sentence status-sentence--compact">${escapeHTML(statusSentence(snapshot.models, now))}</p><ul class="result-list" role="list">${rows}</ul>`;
}

function homeEconomy(snapshot) {
  const ec = snapshot.economy;
  if (snapshot.sections.agent_economy.status === 'unavailable' || (ec.registrations === null && ec.payment_value_usd === null)) {
    return '<p class="muted">Agent-economy figures were not available when this page was built.</p>';
  }
  const figure = (label, value, note) => `<div class="figure"><dt>${label}</dt><dd><span class="figure__value">${value}</span><span class="figure__note">${note}</span></dd></div>`;
  const reg = ec.registrations === null ? 'Not available' : escapeHTML(formatNumber(ec.registrations));
  const pay = ec.payment_value_usd === null ? 'Not available' : `US$${escapeHTML(formatNumber(ec.payment_value_usd))}`;
  return `<dl class="figures">${figure('Agents registered', reg, 'ERC-8004 registry total')}${figure('Payment value', pay, 'x402 total, US dollars')}</dl><p class="source-line">Source: agenteconomy.to, updated ${timeElement(ec.source_updated_at)}. Two separate systems; not combined.</p>`;
}

export function homeOverview(snapshot, now) {
  return `${homeModels(snapshot, now)}<h3 class="panel__subtitle">Agent economy</h3>${homeEconomy(snapshot)}`;
}

export function homeWriting(snapshot) {
  const post = snapshot.writing.posts[0];
  if (snapshot.sections.writing.status === 'unavailable' || !post) {
    return '<p class="muted">Recent writing was not available when this page was built. See Pulse for the full list.</p>';
  }
  const community = post.community ? ` · ${escapeHTML(post.community)}` : '';
  const excerpt = post.excerpt ? `<p class="feature-post__excerpt">${escapeHTML(shorten(post.excerpt))}</p>` : '';
  return `<article class="feature-post"><p class="feature-post__meta">${timeElement(post.published_at)}${community}</p><h3 class="feature-post__title"><a href="${escapeHTML(post.url)}" rel="noopener">${escapeHTML(post.title)}<span class="visually-hidden"> (opens on Moltbook)</span></a></h3>${excerpt}<p class="feature-post__source">Excerpt from the original post on Moltbook.</p></article>`;
}

export const homeUnavailable = {
  overview: '<p class="muted">Recorded results were not available when this page was built. The full, dated record is on Pulse.</p>',
  writing: '<p class="muted">Recent writing was not available when this page was built. See Pulse for the full list.</p>',
};
