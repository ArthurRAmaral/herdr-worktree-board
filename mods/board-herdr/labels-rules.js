// A worktree's labels: your own words for it (pesquisa, feature, bug…), made by typing one that isn't there yet, to
// tell cards apart, filter and group them; pure (nothing from herdr), so `node --test test/*.test.mjs` runs it.

// one spelling per label: trimmed, single spaces, lower case, at most 24 characters
export const normLabel = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase().slice(0, 24).trim();

// space id -> labels
export const labelsOf = (map, space) => (map ?? {})[space] ?? [];

// on if it isn't there, off if it is; a worktree left without labels drops out of the map
export function toggleLabel(map, space, label) {
  const l = normLabel(label);
  const { [space]: mine = [], ...rest } = map ?? {};
  if (!l) return { ...rest, ...(mine.length ? { [space]: mine } : {}) };
  const next = mine.includes(l) ? mine.filter((x) => x !== l) : [...mine, l];
  return next.length ? { ...rest, [space]: next } : rest;
}

// every label in use, the most used first, then by name
export function allLabels(map) {
  const n = new Map();
  for (const list of Object.values(map ?? {})) for (const l of list) n.set(l, (n.get(l) ?? 0) + 1);
  return [...n.keys()].sort((a, b) => n.get(b) - n.get(a) || a.localeCompare(b));
}

// what the label field offers for what you typed: the labels that have it, and a new one when none is exactly it
export function suggest(all, query) {
  const q = normLabel(query);
  return { list: q ? all.filter((l) => l.includes(q)) : all, create: q && !all.includes(q) ? q : null };
}

// a column's cards under their first label (one place each, so the keys walk them once), the labels in allLabels'
// order, then the ones without (null); only the labels it has cards for
export function groupByLabel(cards, map) {
  const first = (t) => labelsOf(map, t.key)[0] ?? null;
  const groups = allLabels(map).map((l) => [l, cards.filter((t) => first(t) === l)]).filter(([, cs]) => cs.length);
  const none = cards.filter((t) => first(t) === null);
  return none.length ? [...groups, [null, none]] : groups;
}

// a space that no longer exists drops its labels
export function dropGone(map, live) {
  return Object.fromEntries(Object.entries(map ?? {}).filter(([id]) => live.has(id)));
}
