// Timed update checks for Pulse (stage 6). No DOM access: everything is injected,
// so the timing rules are unit-tested with a fake clock.
//
// Rules (plan §8):
// - one request at a time; a check while one is in flight returns the same promise;
// - automatic checks only when due (>= interval since the last attempt) and visible;
// - a forced (manual) check skips the due rule but never the in-flight guard;
// - every request has a time limit; a late reply after the limit is ignored;
// - data is validated before use; a failed check keeps the last good snapshot;
// - "changed" compares content only: a new save time alone is not new data.

export function contentKey(s) {
  const sections = Object.fromEntries(Object.entries(s.sections).map(([k, v]) => [k, v.status === 'ok' ? 'ok' : [v.status, v.as_of]]));
  return JSON.stringify({ sections, models: s.models, economy: s.economy, networks: s.networks, posts: s.writing.posts, more: s.writing.coverage.has_more });
}

export function createRefresh({ load, validate, onSnapshot, onStatus = () => {}, now = () => Date.now(), visible = () => true, interval = 60000, timeout = 15000 }) {
  let snapshot = null;
  let key = null;
  let lastAttempt = -Infinity;
  let inflight = null;

  async function run() {
    lastAttempt = now();
    onStatus({ kind: 'checking', hasData: snapshot !== null });
    const controller = new AbortController();
    let timer;
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('timeout'), { timedOut: true })); }, timeout);
    });
    try {
      const raw = await Promise.race([load(controller.signal), limit]);
      const next = validate(raw, now());
      const nextKey = contentKey(next);
      const first = snapshot === null;
      const changed = nextKey !== key;
      snapshot = next;
      key = nextKey;
      onSnapshot(next, { first, changed });
      onStatus({ kind: 'ok', first, changed, at: now() });
      return { ok: true, changed };
    } catch (error) {
      onStatus({ kind: 'error', hasData: snapshot !== null, timedOut: Boolean(error?.timedOut), at: now() });
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    get snapshot() { return snapshot; },
    get busy() { return inflight !== null; },
    check({ force = false } = {}) {
      if (inflight) return inflight;
      if (!force && (!visible() || now() - lastAttempt < interval)) return Promise.resolve(null);
      inflight = run().finally(() => { inflight = null; });
      return inflight;
    },
  };
}
