// What the reader sees after an update (stage 6).
//
// - Values in existing cards (AI checks, figures, networks) update in place.
// - New posts and new "Recent observations" entries wait behind a reveal button.
// - Removed posts disappear at once: a withdrawal must not linger behind the queue.
// - Corrections to posts already shown (same ID) apply at once.
// - Rail rows already shown stay, with refreshed content where the record still exists;
//   a superseded check stays as a true, dated past observation until the reader reveals.
import { deriveObservations, sortRows } from './observations.js';

/** Everything in `snapshot` counts as seen. */
export function revealAll(snapshot) {
  const rows = deriveObservations(snapshot);
  return { posts: new Set(snapshot.writing.posts.map(p => p.id)), rail: new Set(rows.map(r => r.id)), rows };
}

export function reconcile(view, snapshot) {
  const nextRows = deriveObservations(snapshot);
  const byId = new Map(nextRows.map(r => [r.id, r]));
  const livePosts = new Set(snapshot.writing.posts.map(p => p.id));

  const posts = snapshot.writing.posts.filter(p => view.posts.has(p.id));
  const pendingPosts = snapshot.writing.posts.filter(p => !view.posts.has(p.id));
  const rows = sortRows(view.rows
    .filter(r => r.type !== 'post' || livePosts.has(r.id.slice('post:'.length)))
    .map(r => byId.get(r.id) || r));
  // New posts are counted once, under posts, even though they also yield rail rows.
  const pendingRows = nextRows.filter(r => r.type !== 'post' && !view.rail.has(r.id));

  return {
    displayed: { ...snapshot, writing: { ...snapshot.writing, posts } },
    rows,
    pendingPosts,
    pendingRows,
    count: pendingPosts.length + pendingRows.length,
  };
}

/** Plain description of what is waiting, e.g. "2 new posts and 1 new AI check". */
export function pendingLabel(result) {
  const parts = [];
  const n = result.pendingPosts.length;
  if (n) parts.push(`${n} new ${n === 1 ? 'post' : 'posts'}`);
  const checks = result.pendingRows.filter(r => r.type === 'model').length;
  if (checks) parts.push(`${checks} new AI ${checks === 1 ? 'check' : 'checks'}`);
  const periods = result.pendingRows.filter(r => r.type === 'network').length;
  if (periods) parts.push(`${periods} new network ${periods === 1 ? 'figure' : 'figures'}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] || '';
}
