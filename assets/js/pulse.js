// Pulse page entry.
// Stage 5: render every section from the validated snapshot.
// Stage 6: check for updates every 60 s while visible; update values in place;
// hold new entries behind a reveal button; keep the reader's place.
import { validateSnapshot } from './data.js';
import { statusSentence, savedLine, formatWhen, escapeHTML as e } from './summary.js';
import { enableCharts } from './charts.js';
import { modelsRegion, economyRegion, networksRegion, explorerControls, explorerOutput, writingControls, writingResults, WRITING_BATCH, defaultMetric } from './views.js';
import { railMarkup } from './observations.js';
import { createRefresh } from './refresh.js';
import { revealAll, reconcile, pendingLabel } from './reconcile.js';
import { apply, captureAnchor, restoreAnchor } from './dom.js';

const INTERVAL = 60000;
const TICK = 15000;
const $ = sel => document.querySelector(sel);
const region = name => document.querySelector(`[data-region="${name}"]`);

const state = {
  latest: null,   // newest validated snapshot
  view: null,     // what the reader has revealed (posts, rail rows)
  result: null,   // reconcile(view, latest)
  explorer: { network: null, metric: null, range: '90' },
  writing: { query: '', community: '', from: '', to: '', shown: WRITING_BATCH },
};

const hhmm = ms => { const d = new Date(ms); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`; };
const stickyOffset = () => ($('.site-header')?.offsetHeight || 0) + ($('.section-links')?.offsetHeight || 0);

// ---------------------------------------------------------------- skeleton (built once)

function buildSkeleton() {
  apply($('[data-update-line]'), `<p data-saved></p><p class="notice notice--caution" data-overdue role="note" hidden></p>
<div class="update-controls"><button type="button" class="button button--small" data-control="check">Check for updates</button><p class="update-controls__status" data-check-status aria-live="polite"></p></div>`);
  apply(region('writing'), `<div data-slot="notice"></div><div data-slot="controls"></div>
<div class="pending" data-slot="pending-writing"></div>
<p class="writing__status" data-writing-status aria-live="polite"></p><div data-slot="list"></div><div class="writing__more" data-slot="more"></div>`);
  apply(region('observations'), '<div class="pending" data-slot="pending-rail"></div><div data-slot="rail"></div>');
  const heading = $('#recent-observations-title');
  if (heading) heading.tabIndex = -1;
}

const slot = (name, root = document) => root.querySelector(`[data-slot="${name}"]`);

// ---------------------------------------------------------------- rendering

function renderIntro(now) {
  const s = state.latest;
  $('[data-status-sentence]').textContent = s.models.length ? statusSentence(s.models, now) : 'AI check results are not available in this update.';
  const saved = savedLine(s.generated_at, now);
  $('[data-saved]').textContent = saved.text;
  const overdue = $('[data-overdue]');
  overdue.hidden = !saved.overdue;
  overdue.textContent = saved.overdueText;
  const footer = $('[data-footer-saved]');
  if (footer) footer.textContent = `${saved.text}.`;
}

function syncExplorerState(networks) {
  const ex = state.explorer;
  const network = networks.find(n => n.id === ex.network) || networks[0];
  ex.network = network?.id || null;
  if (network && !network.metrics.some(m => m.key === ex.metric)) ex.metric = defaultMetric(network)?.key || null;
}

function renderExplorer() {
  const networks = state.latest.networks;
  const el = region('explorer');
  if (!networks.length) { apply(el, ''); return; }
  syncExplorerState(networks);
  apply(el, '<h3 class="explorer__title" id="explorer-title" tabindex="-1">Explore a network</h3><div data-slot="explorer-controls"></div><div class="explorer__output" data-slot="explorer-output"></div>', 'explorer-skeleton');
  apply(slot('explorer-controls', el), explorerControls(networks, state.explorer));
  apply(slot('explorer-output', el), explorerOutput(networks, state.explorer));
}

function renderWritingResults() {
  const el = region('writing');
  const out = writingResults(state.result.displayed.writing, state.writing);
  el.querySelector('[data-writing-status]').textContent = out.status;
  apply(slot('list', el), out.list);
  apply(slot('more', el), out.button);
}

function renderWriting() {
  const el = region('writing');
  const { writing, sections } = state.result.displayed;
  const notice = sections.writing.status === 'ok' ? '' : sections.writing.status === 'retained'
    ? '<p class="notice" role="note">Writing could not be refreshed in the latest update. These are the posts saved earlier.</p>'
    : '<p class="notice notice--error" role="note">Writing could not be loaded in the latest update.</p>';
  apply(slot('notice', el), notice);
  // Controls are keyed on their options only, so an update never disturbs typing.
  const communities = [...new Set([...writing.posts, ...state.result.pendingPosts].map(p => p.community).filter(Boolean))].sort();
  if (state.writing.community && !communities.includes(state.writing.community)) communities.push(state.writing.community);
  apply(slot('controls', el), writingControls(writing.posts.concat(state.result.pendingPosts), state.writing), communities.join('\u0000'));
  renderWritingResults();
}

function renderPending() {
  const r = state.result;
  const line = (text, n, where) => `<p class="pending__line"><span>${e(text)} since you opened this page.</span> <button type="button" class="button button--small" data-control="reveal" data-from="${where}">Show ${n === 1 ? 'it' : 'them'}</button></p>`;
  const posts = r.pendingPosts.length;
  apply(slot('pending-writing'), posts ? line(`${posts} new ${posts === 1 ? 'post' : 'posts'}`, posts, 'writing') : '');
  apply(slot('pending-rail'), r.count ? line(pendingLabel(r), r.count, 'rail') : '');
}

function renderAll() {
  const now = Date.now();
  const anchor = captureAnchor(stickyOffset());
  state.result = reconcile(state.view, state.latest);
  const shown = state.result.displayed;
  renderIntro(now);
  apply(region('models'), modelsRegion(shown, now));
  apply(region('economy'), economyRegion(shown));
  apply(region('networks'), networksRegion(shown));
  renderExplorer();
  renderWriting();
  renderPending();
  apply(slot('rail'), railMarkup(state.result.rows));
  restoreAnchor(anchor);
  document.body.dataset.loadState = 'ready';
}

function renderFirstFailure() {
  $('[data-status-sentence]').textContent = 'The recorded data could not be loaded.';
  for (const name of ['models', 'economy', 'networks', 'writing', 'observations']) apply(region(name), '<p class="muted">Not loaded.</p>');
  apply(region('explorer'), '');
  document.body.dataset.loadState = 'error';
}

// ---------------------------------------------------------------- update checks

function onSnapshot(snapshot, { first }) {
  state.latest = snapshot;
  if (first || !state.view) {
    state.view = revealAll(snapshot);
    buildSkeleton();
  }
  renderAll();
}

function onStatus(status) {
  const out = $('[data-check-status]');
  const button = $('[data-control="check"]');
  if (!out) return;
  button.disabled = status.kind === 'checking';
  if (status.kind === 'checking') { out.textContent = status.hasData ? 'Checking for updates…' : 'Loading the recorded data…'; return; }
  if (status.kind === 'ok') {
    button.textContent = 'Check for updates';
    out.textContent = status.first ? '' : status.changed ? `Updated at ${hhmm(status.at)}.` : `Checked at ${hhmm(status.at)}. No new data.`;
    return;
  }
  // Failure: keep whatever is on screen, with its original dates.
  const why = status.timedOut ? 'The check took too long.' : 'The check failed.';
  if (status.hasData) {
    out.textContent = `${why} Could not check for updates at ${hhmm(status.at)}. Still showing the data saved ${formatWhen(state.latest.generated_at)}.`;
  } else {
    out.innerHTML = `<span role="alert">${e(why)} The page could not load its data file. Please try again later.</span>`;
    button.textContent = 'Try again';
    renderFirstFailure();
  }
}

const refresh = createRefresh({
  load: async signal => {
    const response = await fetch('/pulse/data.json', { cache: 'no-store', credentials: 'same-origin', signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },
  validate: (raw, now) => validateSnapshot(raw, now),
  onSnapshot,
  onStatus,
  visible: () => !document.hidden,
  interval: INTERVAL,
});

// ---------------------------------------------------------------- controls

function reveal(from) {
  const before = state.result;
  const newPosts = before.pendingPosts.map(p => p.id);
  const newRows = [...before.pendingRows.map(r => r.id), ...newPosts.map(id => `post:${id}`)];
  state.view = revealAll(state.latest);
  state.writing.shown += newPosts.length; // keep every post the reader could already see
  renderAll();
  const target = from === 'writing'
    ? newPosts.map(id => region('writing').querySelector(`.post[data-key="${CSS.escape(id)}"] a`)).find(Boolean)
    : newRows.map(id => slot('rail').querySelector(`.obs[data-key="${CSS.escape(id)}"] a`)).find(Boolean);
  (target || (from === 'writing' ? region('writing').querySelector('[data-writing-status]') : $('#recent-observations-title')))?.focus();
}

function onClick(ev) {
  const control = ev.target.closest('[data-control]')?.dataset.control;
  if (control === 'check') refresh.check({ force: true });
  else if (control === 'reveal') reveal(ev.target.closest('[data-control]').dataset.from);
}

function onExplorerChange(ev) {
  const control = ev.target.dataset.control;
  if (control === 'network') { state.explorer.network = ev.target.value; state.explorer.metric = null; }
  else if (control === 'metric') state.explorer.metric = ev.target.value;
  else return;
  renderExplorer();
  region('explorer').querySelector(`[data-control="${control}"]`)?.focus();
}

function onExplorerClick(ev) {
  const button = ev.target.closest('[data-range]');
  if (!button) return;
  state.explorer.range = button.dataset.range;
  renderExplorer();
  region('explorer').querySelector(`[data-range="${button.dataset.range}"]`)?.focus();
}

function onExplore(ev) {
  const button = ev.target.closest('.explore');
  if (!button) return;
  state.explorer.network = button.dataset.network;
  state.explorer.metric = null;
  renderExplorer();
  const heading = $('#explorer-title');
  heading.scrollIntoView({ block: 'start' });
  heading.focus({ preventScroll: true });
}

function onWritingInput(ev) {
  const control = ev.target.dataset.control;
  if (!['query', 'community', 'from', 'to'].includes(control) || !state.result) return;
  state.writing[control] = ev.target.value;
  state.writing.shown = WRITING_BATCH;
  renderWritingResults();
}

function onWritingMore(ev) {
  if (!ev.target.closest('[data-control="more"]')) return;
  const before = state.writing.shown;
  state.writing.shown += WRITING_BATCH;
  renderWritingResults();
  region('writing').querySelectorAll('.post')[before]?.querySelector('a')?.focus();
}

function start() {
  enableCharts(document);
  apply($('[data-update-line]'), `<div class="update-controls"><button type="button" class="button button--small" data-control="check">Check for updates</button><p class="update-controls__status" data-check-status aria-live="polite"></p></div>`, 'boot');
  document.addEventListener('click', onClick);
  region('explorer').addEventListener('change', onExplorerChange);
  region('explorer').addEventListener('click', onExplorerClick);
  region('networks').addEventListener('click', onExplore);
  region('writing').addEventListener('input', onWritingInput);
  region('writing').addEventListener('change', onWritingInput);
  region('writing').addEventListener('click', onWritingMore);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh.check(); });
  // Time-based wording ("Older result", "later than usual") ages without new data;
  // unchanged regions are not rewritten.
  setInterval(() => { if (state.latest) renderAll(); refresh.check(); }, TICK);
  document.body.dataset.loadState = 'loading';
  refresh.check({ force: true });
}

start();
