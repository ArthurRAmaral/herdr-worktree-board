// A worktree's pull requests: its own branch's, the ones its clones under repos/ have open on their branches, and
// those of the folders its agents work in; pure (nothing from herdr), so `node --test test/*.test.mjs` runs it.

// a pull request's checks in one word: FAIL, pending, pass, or null when it has none
export function checks(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return null;
  const word = (c) => String(c.conclusion || c.state || c.status || "").toUpperCase();
  if (rollup.some((c) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(word(c)))) return "FAIL";
  if (rollup.some((c) => ["", "PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "EXPECTED"].includes(word(c)))) return "pending";
  return "pass";
}

export const repoOf = (url) => /github\.com\/([^/]+\/[^/]+)\/pull\/\d+/.exec(String(url ?? ""))?.[1] ?? null;

// what CLONE_PRS prints: the clone's local branches, `---`, then `gh pr list --json` of your open PRs in its repo.
// A clone is this worktree's own, so a PR from any branch it has is this worktree's, checked out or not
export function parseClonePrs(stdout) {
  const [heads, json] = String(stdout ?? "").split(/^---$/m);
  const mine = new Set(String(heads ?? "").split("\n").map((l) => l.trim()).filter(Boolean));
  let list;
  try { list = JSON.parse(json ?? ""); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter((p) => mine.has(p.headRefName)).map((p) => ({
    number: p.number, url: p.url, title: p.title, state: "OPEN", draft: Boolean(p.isDraft), checks: checks(p.statusCheckRollup),
    repo: repoOf(p.url), branch: p.headRefName,
  }));
}

// the worktree's own pull request first, then the others as found, each once (by url)
export function mergePrs(own, lists) {
  const seen = new Set(), out = [];
  for (const p of [own, ...lists.flat()]) {
    if (!p?.url || seen.has(p.url)) continue;
    seen.add(p.url);
    out.push({ ...p, repo: p.repo ?? repoOf(p.url) });
  }
  return out;
}

// a gh that herdr stopped for taking too long: the machine's link to GitHub dropped the connection (it comes back by
// itself), not a mistake to show. The footer says so only once it happens STALL_AFTER times in a row on one machine
export const STALL_AFTER = 3;
export const timedOut = (e) => /took longer than/i.test(String(e?.message ?? e ?? ""));

// timeouts in a row per machine ("" is this one): one more when gh timed out, none once it answers
export function ghStall(stalls, on, slow) {
  const key = on ?? "", next = { ...stalls };
  if (slow) next[key] = (next[key] ?? 0) + 1;
  else delete next[key];
  return next;
}

export function stallProblem(stalls) {
  const [key, n] = Object.entries(stalls).find(([, n]) => n >= STALL_AFTER) ?? [];
  return key === undefined ? null : `gh${key ? ` on ${key}` : ""}: GitHub didn't answer ${n} times in a row, pull requests may be out of date`;
}
