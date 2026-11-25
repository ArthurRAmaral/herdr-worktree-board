// Where New agent starts: a machine's Herdr spaces, a repo's worktrees together under the repo (the main checkout
// first), the spaces outside git each on its own; and where a Linear issue starts (board.json's linearRepo, on any
// machine). Pure (nothing from herdr), so `node --test test/*.test.mjs` runs it.
// A space here is {id, machine, name, common (its repo's git dir, or null), repoName, isMain, at (last used)}.

export function placesOn(list, machine) {
  const groups = new Map(), out = [];
  for (const w of list ?? []) {
    if ((w.machine ?? null) !== machine) continue;
    if (!w.common) { out.push({ key: w.id, name: w.name, git: false, main: w.id, worktrees: [w] }); continue; }
    if (!groups.has(w.common)) groups.set(w.common, { key: w.common, name: w.repoName ?? w.name, git: true, worktrees: [] });
    groups.get(w.common).worktrees.push(w);
  }
  for (const g of groups.values()) {
    g.worktrees.sort((a, b) => Number(b.isMain) - Number(a.isMain) || (b.at ?? 0) - (a.at ?? 0));
    g.main = g.worktrees[0].id;
    out.push(g);
  }
  return out.sort((a, b) => Number(b.git) - Number(a.git) || String(a.name).localeCompare(String(b.name)));
}

// the entry a space is in
export const placeOf = (places, id) => places.find((p) => p.worktrees.some((w) => w.id === id)) ?? null;

// the repo named, on the machine preferred, else this computer, else any machine it's open on: {machine, dir}
export function repoPlace(list, repoName, prefer) {
  if (!repoName) return null;
  const ws = (list ?? []).filter((w) => w.common && w.repoName === repoName);
  const on = (m) => ws.find((w) => (w.machine ?? null) === m);
  const w = on(prefer ?? null) ?? on(null) ?? ws[0];
  return w ? { machine: w.machine ?? null, dir: w.common.replace(/\/\.git$/, "") } : null;
}
