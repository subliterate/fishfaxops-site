// Public snapshot boundary (schema v2). Only named public fields cross into the view.
// Ported from sites/fishfaxops_beta/rich-preview/core.mjs (v1). Changes:
// - A model's recognised status is kept when latency is withheld (v1 forced
//   'unknown' whenever any request failed, hiding degraded/down results).
// - Status that contradicts the request counts becomes 'unknown'.
// - Monthly completeness uses real calendar months, not 30 days.
// - Metrics carry their own cadence; per-section diagnostics are validated.

const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = v => (Array.isArray(v) ? v : []);
const text = v => (typeof v === 'string' ? v : '');
const num = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const integer = v => (Number.isInteger(v) ? num(v) : null);
const fraction = v => (num(v) !== null && v <= 1 ? v : null);
const strings = v => arr(v).filter(x => typeof x === 'string');

export const SCHEMA_VERSION = 2;
export const MODEL_STATUSES = ['ok', 'degraded', 'down', 'unknown'];
export const SECTION_NAMES = ['models', 'agent_economy', 'writing'];
const SECTION_STATES = ['ok', 'retained', 'unavailable'];
const CADENCES = ['daily', 'weekly', 'monthly'];
const QUALITIES = ['ok', 'source-date-conflict', 'incomplete'];
const AUTHOR = '05aa93ba-c615-406b-9171-30c12496e00d';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86400000;
const SOURCE = 'https://agenteconomy.to/data.json';

function sourceProvenance(raw, generated) {
  const source_url = own(raw, 'source_url') === SOURCE ? SOURCE : '';
  const source_updated_at = source_url ? iso(own(raw, 'source_updated_at'), generated) : null;
  return { source_url, source_updated_at };
}

export const validDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

function iso(v, now) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|\+00:00)$/.test(v) || !validDay(v.slice(0, 10)) || !Number.isFinite(Date.parse(v)) || Date.parse(v) > now) return null;
  return new Date(v).toISOString();
}

export function safeURL(v) {
  try {
    const u = new URL(v);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : '';
  } catch { return ''; }
}

/** End of the period starting at day `t` (exclusive), in ms. */
export function periodEnd(t, cadence) {
  const start = new Date(`${t}T00:00:00Z`);
  if (cadence === 'monthly') return Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
  return start.getTime() + (cadence === 'weekly' ? 7 : 1) * DAY;
}

export function rangePoints(points, range) {
  if (range === 'all' || !points.length) return points;
  const end = Math.max(...points.map(p => Date.parse(p.t)));
  return points.filter(p => Date.parse(p.t) > end - Number(range) * DAY);
}

export function filterPosts(posts, { query = '', community = '', from = '', to = '' } = {}) {
  const q = query.trim().toLocaleLowerCase('en-GB');
  return posts.filter(p => (!q || `${p.title} ${p.excerpt} ${p.community}`.toLocaleLowerCase('en-GB').includes(q)) && (!community || p.community === community) && (!from || p.published_at.slice(0, 10) >= from) && (!to || p.published_at.slice(0, 10) <= to));
}

function reading(raw) {
  const v = obj(raw);
  const r = { median_ms: num(own(v, 'median_ms')), slow_ms: num(own(v, 'slow_ms')), success_rate: fraction(own(v, 'success_rate')), attempted: integer(own(v, 'attempted')), succeeded: integer(own(v, 'succeeded')) };
  if (!consistent(r)) r.success_rate = null;
  return r;
}

/** Counts and the supplied rate must independently agree. */
function consistent(r) {
  return r.attempted !== null && r.succeeded !== null && r.attempted > 0 && r.succeeded <= r.attempted && r.success_rate !== null && Math.abs(r.success_rate - r.succeeded / r.attempted) < 1e-9;
}

/** Latency is trustworthy only when every counted request succeeded. */
function clean(r) {
  return consistent(r) && r.attempted === r.succeeded;
}

function withheld(r) {
  return clean(r) ? r : { ...r, median_ms: null, slow_ms: null };
}

function modelStatus(raw, r, observed) {
  if (observed === null) return 'unknown';
  const claimed = MODEL_STATUSES.includes(own(raw, 'status')) ? own(raw, 'status') : 'unknown';
  if (!consistent(r)) return 'unknown';
  const derived = r.succeeded === r.attempted ? 'ok' : r.succeeded === 0 ? 'down' : 'degraded';
  return claimed === derived ? claimed : 'unknown';
}

function validateModel(raw, now) {
  const m = obj(raw);
  const observed = iso(own(m, 'observed_at'), now);
  const r = reading(m);
  const levels = arr(own(m, 'levels')).map(obj).filter(l => integer(own(l, 'concurrency')) > 0).map(l => ({ concurrency: l.concurrency, ...withheld(reading(l)) }));
  const history = arr(own(m, 'history')).map(obj).filter(h => iso(own(h, 't'), now)).map(h => ({ t: h.t, ...withheld(reading(h)) })).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const status = modelStatus(m, r, observed);
  const latency = status === 'unknown' ? { median_ms: null, slow_ms: null } : withheld(r);
  return { id: text(own(m, 'id')), name: text(own(m, 'name')), status, observed_at: observed, ...r, median_ms: latency.median_ms, slow_ms: latency.slow_ms, levels, history, notes: strings(own(m, 'notes')) };
}

function validatePoint(p, cadence, src) {
  const complete = src !== null && Date.parse(src) >= periodEnd(p.t, cadence);
  const conflict = p.quality === 'source-date-conflict' || (src !== null && Date.parse(src) < Date.parse(p.t));
  const quality = conflict ? 'source-date-conflict' : complete && p.quality === 'ok' ? 'ok' : 'incomplete';
  return { t: p.t, value: p.value, quality, complete: quality === 'ok' };
}

function validateNetwork(raw, generated, now) {
  const n = obj(raw);
  const provenance = sourceProvenance(n, generated);
  const src = provenance.source_updated_at;
  const metrics = (src === null ? [] : arr(own(n, 'metrics'))).map(obj).filter(m => text(own(m, 'key')) && text(own(m, 'label'))).map(m => {
    const cadence = CADENCES.includes(own(m, 'cadence')) ? m.cadence : n.cadence;
    const points = arr(own(m, 'points')).map(obj)
      .filter(p => validDay(own(p, 't')) && Date.parse(p.t) <= now && num(own(p, 'value')) !== null && QUALITIES.includes(own(p, 'quality')) && typeof own(p, 'complete') === 'boolean' && (cadence !== 'monthly' || p.t.endsWith('-01')))
      .map(p => validatePoint(p, cadence, src))
      .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
    return { key: m.key, label: m.label, unit: text(own(m, 'unit')), cadence, points };
  });
  return { id: n.id, name: n.name, ...provenance, cadence: n.cadence, default_metric: text(own(n, 'default_metric')), notes: strings(own(n, 'notes')), metrics };
}

function validatePosts(raw, now) {
  const seen = new Set();
  return arr(raw).map(obj).filter(p => {
    const id = own(p, 'id');
    if (typeof id !== 'string' || !UUID.test(id) || seen.has(id) || own(p, 'author_id') !== AUTHOR || own(p, 'deleted') || own(p, 'is_deleted') || own(p, 'spam') || own(p, 'is_spam') || !iso(own(p, 'published_at'), now) || !text(own(p, 'title')) || own(p, 'url') !== `https://www.moltbook.com/post/${id}`) return false;
    seen.add(id);
    return true;
  }).map(p => ({ id: p.id, title: p.title, excerpt: text(own(p, 'excerpt')).slice(0, 500), published_at: iso(p.published_at, now), community: text(own(p, 'community')), url: p.url, author_id: p.author_id }))
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)).slice(0, 60);
}

function validateSections(raw, now) {
  const s = obj(raw);
  const out = {};
  for (const name of SECTION_NAMES) {
    const sec = obj(own(s, name));
    const status = SECTION_STATES.includes(own(sec, 'status')) ? sec.status : 'unavailable';
    const asOf = iso(own(sec, 'as_of'), now);
    out[name] = status !== 'unavailable' && asOf === null ? { status: 'unavailable', as_of: null } : { status, as_of: status === 'unavailable' ? null : asOf };
  }
  return out;
}

export function validateSnapshot(raw, now = Date.now()) {
  const s = obj(raw);
  if (own(s, 'schema_version') !== SCHEMA_VERSION || !iso(own(s, 'generated_at'), now)) throw new Error('Unrecognised or undated snapshot');
  // A later visit cannot legitimize evidence newer than the saved artifact.
  // Network series periods are the exception: keep dated source conflicts for
  // inspection, bounded by viewing time rather than source/generation time.
  const generated = Date.parse(s.generated_at);
  const sections = validateSections(own(s, 'sections'), generated);
  const models = arr(own(s, 'models')).map(obj).filter(m => text(own(m, 'id')) && text(own(m, 'name'))).map(m => validateModel(m, generated));
  const ec = obj(own(s, 'economy'));
  const provenance = sourceProvenance(ec, generated);
  const economy = { ...provenance, registrations: provenance.source_updated_at === null ? null : num(own(ec, 'registrations')), payment_value_usd: provenance.source_updated_at === null ? null : num(own(ec, 'payment_value_usd')) };
  if (provenance.source_updated_at === null) sections.agent_economy = { status: 'unavailable', as_of: null };
  const networks = arr(own(s, 'networks')).map(obj).filter(n => text(own(n, 'id')) && text(own(n, 'name')) && CADENCES.includes(own(n, 'cadence'))).map(n => validateNetwork(n, generated, now));
  const w = obj(own(s, 'writing'));
  const coverage = obj(own(w, 'coverage'));
  const posts = validatePosts(own(w, 'posts'), generated);
  const writing = { posts, coverage: { fetched_at: iso(own(coverage, 'fetched_at'), generated), count: posts.length, oldest: posts.at(-1)?.published_at || null, newest: posts[0]?.published_at || null, has_more: typeof own(coverage, 'has_more') === 'boolean' ? coverage.has_more : null, description: text(own(coverage, 'description')) } };
  return { schema_version: SCHEMA_VERSION, generated_at: new Date(s.generated_at).toISOString(), sections, limitations: strings(own(s, 'limitations')), models, economy, networks, writing };
}
