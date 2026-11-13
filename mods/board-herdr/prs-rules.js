// The PRs view's rules: which pull requests to ask GitHub for, what of each the board keeps, which CODEOWNERS folders
// are the team's, and the column each one goes in. Pure (nothing from herdr), so `node --test test/*.test.mjs` runs it.
// The lanes and their columns, in screen order: [key, label, color].
export const THEIRS = [
  ["draft", "Draft", "#56555b"],
  ["review", "Precisa da minha revisão", "#ffb406"],
  ["team", "Precisa do meu time", "#8f7fd1"],
  ["reviewed", "Revisado, esperando o autor", "#6fb3f2"],
  ["ready", "Pronto para merge", "#53cf91"],
];
export const MINE = [
  ["draft_review", "Draft: revisar para liberar", "#b4a0db"],
  ["draft_ideas", "Draft: ideias", "#56555b"],
  ["comments", "Comentários a resolver", "#e0707f"],
  ["waiting", "Esperando review", "#6fb3f2"],
  ["ready", "Pronto para merge", "#53cf91"],
];
export const STALE_MS = 30 * 86400000; // other people's PRs with no update for longer leave the board

// One page of one search (first: 50, or 20 for a team repo: a page of 50 of a busy repo times out); files only for a repo whose team is a CODEOWNERS team
export const PR_QUERY = `query($q: String!, $files: Boolean!, $first: Int!, $after: String) {
  viewer { login }
  search(query: $q, type: ISSUE, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      number title url isDraft updatedAt mergeable reviewDecision headRefName
      repository { name }
      author { login avatarUrl }
      reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } } } }
      reviews(last: 50) { nodes { author { login } state submittedAt } }
      reviewThreads(first: 100) { nodes { isResolved } }
      commits(last: 50) { nodes { commit { committedDate parents { totalCount } author { user { login } } statusCheckRollup { state } } } }
      timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 20) { nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on User { login } } } } }
      files(first: 100) @include(if: $files) { nodes { path } }
    } }
  }
}`;

// prs.json: {org, team_repos: [{repo, codeowners?}]}; no file is an empty one
export function parseConfig(text) {
  if (text == null || !String(text).trim()) return { org: "", team_repos: [] };
  let v;
  try { v = JSON.parse(text); } catch (e) { return { error: String(e.message ?? e) }; }
  const org = String(v?.org ?? "").trim();
  const team_repos = (Array.isArray(v?.team_repos) ? v.team_repos : [])
    .map((r) => ({ repo: String(r?.repo ?? "").trim(), codeowners: String(r?.codeowners ?? "").trim() }))
    .filter((r) => r.repo)
    .map((r) => (r.codeowners ? r : { repo: r.repo }));
  return { org, team_repos };
}

const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// What to ask GitHub: my PRs, the ones asking me, the ones I reviewed, and each team repo's
export function searches(cfg, me, now) {
  if (!cfg?.org) return [];
  const open = "is:pr is:open archived:false";
  const since = `updated:>=${day(now - STALE_MS)}`;
  return [
    { key: "mine", q: `${open} org:${cfg.org} author:${me}`, files: false, first: 50 },
    { key: "requested", q: `${open} org:${cfg.org} user-review-requested:${me} -author:${me} ${since}`, files: false, first: 50 },
    { key: "reviewed", q: `${open} org:${cfg.org} reviewed-by:${me} -author:${me} ${since}`, files: false, first: 50 },
    ...cfg.team_repos.map((r) => ({ key: "team", q: `${open} repo:${cfg.org}/${r.repo} -author:${me} ${since}`,
      files: Boolean(r.codeowners), first: 20, repo: r.repo, ...(r.codeowners ? { codeowners: r.codeowners } : {}) })),
  ];
}

export function parseSearchPage(body) {
  let v;
  try { v = JSON.parse(body); } catch (e) { return { error: String(e.message ?? e) }; }
  if (v?.errors?.length) return { error: v.errors.map((e) => e.message).join("; ") };
  const s = v?.data?.search;
  if (!s) return { error: "no search in GitHub's answer" };
  return { me: v.data.viewer?.login ?? null, nodes: (s.nodes ?? []).filter((n) => n?.url), next: s.pageInfo?.hasNextPage ? s.pageInfo.endCursor : null };
}

const ms = (s) => (s ? Date.parse(s) : null);
const latest = (list) => list.reduce((m, t) => (t != null && (m == null || t > m) ? t : m), null);
const CHECKS = { SUCCESS: "pass", FAILURE: "fail", ERROR: "fail", PENDING: "running", EXPECTED: "running" };

// A search node, flattened to what the board shows and classifies by
export function normalize(n, me) {
  const author = n.author?.login ?? "ghost";
  const reviews = n.reviews?.nodes ?? [];
  const commits = (n.commits?.nodes ?? []).map((c) => c.commit).filter(Boolean);
  const reviewers = (n.reviewRequests?.nodes ?? []).map((r) => r.requestedReviewer?.login).filter(Boolean);
  // each reviewer's latest review that decides something
  const decisive = new Map();
  for (const r of reviews) {
    if (!r.author?.login || (r.state !== "APPROVED" && r.state !== "CHANGES_REQUESTED" && r.state !== "DISMISSED")) continue;
    const prev = decisive.get(r.author.login);
    if (!prev || ms(r.submittedAt) >= ms(prev.submittedAt)) decisive.set(r.author.login, r);
  }
  return {
    url: n.url, number: n.number, title: n.title ?? "", repo: n.repository?.name ?? "", author, avatar: n.author?.avatarUrl ?? "",
    mine: author === me, draft: Boolean(n.isDraft), updatedAt: ms(n.updatedAt) ?? 0, branch: n.headRefName ?? null,
    decision: n.reviewDecision ?? null,
    approvals: [...decisive.values()].filter((r) => r.state === "APPROVED").length,
    // a reviewer whose latest word is "changes requested" (the review decision is empty where no review is required)
    changesRequested: [...decisive.values()].some((r) => r.state === "CHANGES_REQUESTED"),
    conflict: n.mergeable === "CONFLICTING",
    checks: CHECKS[commits.at(-1)?.statusCheckRollup?.state] ?? null,
    threads: (n.reviewThreads?.nodes ?? []).filter((t) => !t.isResolved).length,
    requested: reviewers.includes(me),
    everRequested: (n.timelineItems?.nodes ?? []).some((e) => e?.requestedReviewer?.login === me),
    lastReviewAt: latest(reviews.filter((r) => r.author?.login === me && r.state !== "PENDING").map((r) => ms(r.submittedAt))),
    // only the author's own commits, not merges of the base branch nor a bot's
    authorPushAt: latest(commits.filter((c) => c.parents?.totalCount === 1 && c.author?.user?.login === author).map((c) => ms(c.committedDate))),
    reviewers, sources: [], team: false,
  };
}

// CODEOWNERS as rules, each a path pattern and its owners
export function parseCodeowners(text) {
  return String(text ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
    const [pattern, ...owners] = l.split(/\s+/);
    return { re: patternRe(pattern), owners: owners.map((o) => o.toLowerCase()) };
  });
}

function patternRe(p) {
  const dir = p.endsWith("/");
  const core = p.replace(/^\/+/, "").replace(/\/+$/, "");
  const anchored = p.startsWith("/") || core.includes("/");
  const last = core.split("/").pop();
  const body = core.split(/(\*\*|\*|\?)/).map((part) =>
    part === "**" ? ".*" : part === "*" ? "[^/]*" : part === "?" ? "[^/]" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("");
  const under = dir || !last.includes("*") ? "(/.*)?" : "";
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${body}${under}$`);
}

// whether any of these files is the team's (the last rule that matches a file names its owners)
export function ownedBy(rules, paths, org, team) {
  const want = `@${org}/${team}`.toLowerCase();
  return paths.some((path) => {
    let owners = null;
    for (const r of rules) if (r.re.test(path)) owners = r.owners;
    return Boolean(owners?.includes(want));
  });
}

// the same PR found by several searches: one, with every source
export function merge(map, pr, source, team) {
  const had = map.get(pr.url);
  const p = had ?? { ...pr, sources: [] };
  if (!p.sources.includes(source)) p.sources.push(source);
  p.team = p.team || Boolean(team);
  map.set(pr.url, p);
}

// my own always; other people's only recent, asking me, my team's, or reviewed by me where I was asked or it's my team's
export function keep(pr, now) {
  if (pr.mine) return true;
  if (now - pr.updatedAt > STALE_MS) return false;
  return pr.sources.includes("requested") || pr.team || (pr.sources.includes("reviewed") && (pr.everRequested || pr.team));
}

const approved = (pr) => pr.decision === "APPROVED" || (pr.decision == null && pr.approvals > 0);

export function classifyTheirs(pr) {
  if (pr.draft) return "draft";
  if (approved(pr)) return "ready";
  if (pr.requested || (pr.lastReviewAt && pr.authorPushAt > pr.lastReviewAt)) return "review";
  if (pr.lastReviewAt) return "reviewed";
  if (pr.team) return "team";
  return null;
}

export function classifyMine(pr, choice) {
  if (pr.draft) return choice === "ideas" ? "draft_ideas" : "draft_review";
  if (pr.decision === "CHANGES_REQUESTED" || (pr.decision == null && pr.changesRequested) || pr.threads > 0 || pr.checks === "fail" || pr.conflict) return "comments";
  if (approved(pr)) return "ready";
  return "waiting";
}

// both lanes, every column (newest update first), and how many wait on me
export function lanes(prs, drafts, now) {
  const theirs = Object.fromEntries(THEIRS.map(([k]) => [k, []]));
  const mine = Object.fromEntries(MINE.map(([k]) => [k, []]));
  for (const pr of prs) {
    if (!keep(pr, now)) continue;
    if (pr.mine) mine[classifyMine(pr, drafts?.[pr.url])].push(pr);
    else { const k = classifyTheirs(pr); if (k) theirs[k].push(pr); }
  }
  for (const list of [...Object.values(theirs), ...Object.values(mine)]) list.sort((a, b) => b.updatedAt - a.updatedAt);
  return { theirs, mine, count: theirs.review.length + mine.comments.length + mine.draft_review.length };
}

// what keeps an approved PR from merging
export function blocker(pr) {
  return pr.conflict ? "conflito" : pr.checks === "fail" ? "CI falhando" : pr.checks === "running" ? "CI rodando" : null;
}

// the draft choices of PRs still my drafts
export function pruneDrafts(drafts, prs) {
  const live = new Set(prs.filter((p) => p.mine && p.draft).map((p) => p.url));
  return Object.fromEntries(Object.entries(drafts ?? {}).filter(([url]) => live.has(url)));
}
