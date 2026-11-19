// The sidebar's order, which only you change (drag a row), and a worktree's main agent; plain rules, no Herdr calls,
// so test/nav-order.test.mjs runs them with node.

// an hc address's place in time: they count up in base 36 (t7s, t7t, … t10), a machine's "name:" prefix aside
export const seq = (address) => parseInt(String(address).split(":").pop().replace(/^t/, ""), 36) || 0;

// a worktree's main agent: one no other agent in it started (hc's parent chain), first one with no parent at all
// (the one you started, not a sub-agent whose parent is gone), then the oldest
export function mainAgent(addresses, parentOf) {
  const mine = new Set(addresses);
  const startedHere = (a) => {
    const seen = new Set([a]);
    for (let p = parentOf.get(a), hops = 0; p && hops < 32 && !seen.has(p); p = parentOf.get(p), hops++) {
      if (mine.has(p)) return true;
      seen.add(p);
    }
    return false;
  };
  const roots = addresses.filter((a) => !startedHere(a));
  const pick = (roots.length ? roots : addresses).slice()
    .sort((x, y) => Number(parentOf.has(x)) - Number(parentOf.has(y)) || seq(x) - seq(y));
  return pick[0] ?? null;
}

// the order with the keys it hasn't seen yet: on top (worktrees: a new one shows first) or at the end (agents);
// the same list when nothing is new
export function addNew(order, keys, where) {
  const known = new Set(order);
  const fresh = keys.filter((k, i) => !known.has(k) && keys.indexOf(k) === i);
  if (!fresh.length) return order;
  return where === "top" ? [...fresh, ...order] : [...order, ...fresh];
}

// a dragged key, put before or after the one it was dropped on
export function moveKey(order, key, target, after) {
  if (key === target || !order.includes(target)) return order;
  const rest = order.filter((k) => k !== key);
  const at = rest.indexOf(target) + (after ? 1 : 0);
  return [...rest.slice(0, at), key, ...rest.slice(at)];
}

export const toFront = (order, key) => [key, ...order.filter((k) => k !== key)];

// items in the order's sequence; ones it doesn't have go last, as they came
export function byOrder(items, keyOf, order) {
  const at = new Map(order.map((k, i) => [k, i]));
  const rank = (it) => at.get(keyOf(it)) ?? Infinity;
  return items.map((it, i) => [it, i]).sort(([x, i], [y, j]) => (rank(x) - rank(y)) || i - j).map(([it]) => it);
}
