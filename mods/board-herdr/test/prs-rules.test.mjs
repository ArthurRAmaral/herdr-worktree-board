// The PRs view's rules (prs-rules.js), run with `node --test test/` from the mod's folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../prs-rules.js";

const NOW = Date.UTC(2026, 10, 13, 12);
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const pr = (over = {}) => ({
  url: "https://github.com/acme/web/pull/1", number: 1, title: "A change", repo: "web", author: "ana", avatar: "", mine: false,
  draft: false, updatedAt: NOW - DAY, branch: "ana/change", decision: null, approvals: 0, conflict: false, checks: null,
  threads: 0, requested: false, everRequested: false, lastReviewAt: null, authorPushAt: null, reviewers: [], sources: [], team: false,
  ...over,
});

test("parseConfig: no file is an empty config", () => {
  assert.deepEqual(R.parseConfig(null), { org: "", team_repos: [] });
});

test("parseConfig: bad JSON is an error", () => {
  assert.ok(R.parseConfig("{").error);
});

test("parseConfig: trims and drops entries without a repo", () => {
  const c = R.parseConfig('{"org":" acme ","team_repos":[{"repo":"web"},{"x":1},{"repo":"api","codeowners":"payments"}]}');
  assert.equal(c.org, "acme");
  assert.deepEqual(c.team_repos, [{ repo: "web" }, { repo: "api", codeowners: "payments" }]);
});

test("searches: one per source and per team repo, others' cut at 30 days", () => {
  const s = R.searches({ org: "acme", team_repos: [{ repo: "web" }, { repo: "api", codeowners: "payments" }] }, "@me", Date.UTC(2026, 10, 13));
  assert.equal(s.length, 5);
  assert.equal(s[0].q, "is:pr is:open archived:false org:acme author:@me");
  assert.equal(s[1].q, "is:pr is:open archived:false org:acme user-review-requested:@me -author:@me updated:>=2026-10-14");
  assert.equal(s[2].q, "is:pr is:open archived:false org:acme reviewed-by:@me -author:@me updated:>=2026-10-14");
  assert.equal(s[3].q, "is:pr is:open archived:false repo:acme/web -author:@me updated:>=2026-10-14");
  assert.equal(s.find((x) => x.repo === "api").files, true);
  assert.equal(s.find((x) => x.repo === "web").files, false);
  assert.equal(s.find((x) => x.repo === "api").codeowners, "payments");
});

test("searches: team repos read in smaller pages (heavy pages time out on GitHub)", () => {
  const s = R.searches({ org: "acme", team_repos: [{ repo: "web" }] }, "@me", NOW);
  assert.deepEqual(s.map((x) => x.first), [50, 50, 50, 20]);
  assert.match(R.PR_QUERY, /first: \$first, after: \$after/);
});

test("searches: no org, no searches", () => {
  assert.deepEqual(R.searches({ org: "", team_repos: [{ repo: "web" }] }, "@me", NOW), []);
});

test("parseSearchPage: GraphQL errors come back as an error", () => {
  assert.deepEqual(R.parseSearchPage('{"errors":[{"message":"SAML"}]}'), { error: "SAML" });
});

test("parseSearchPage: the next page's cursor", () => {
  const p = R.parseSearchPage(JSON.stringify({ data: { viewer: { login: "me" },
    search: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [{ number: 1, url: "u" }, {}] } } }));
  assert.equal(p.me, "me");
  assert.equal(p.next, "c1");
  assert.equal(p.nodes.length, 1);
});

test("parseSearchPage: the last page has no cursor", () => {
  const p = R.parseSearchPage(JSON.stringify({ data: { viewer: { login: "me" },
    search: { pageInfo: { hasNextPage: false, endCursor: "c9" }, nodes: [] } } }));
  assert.equal(p.next, null);
});

const T1 = NOW - 5 * DAY, T2 = NOW - 4 * DAY, T3 = NOW - 3 * DAY, T4 = NOW - 2 * DAY, T5 = NOW - DAY;
const node = {
  number: 7, title: "Retry webhooks", url: "https://github.com/acme/api/pull/7", isDraft: false, updatedAt: iso(T5),
  mergeable: "CONFLICTING", reviewDecision: "REVIEW_REQUIRED", headRefName: "ana/retry",
  repository: { name: "api" }, author: { login: "ana", avatarUrl: "https://a/ana.png" },
  reviewRequests: { nodes: [{ requestedReviewer: { login: "me" } }, { requestedReviewer: {} }, { requestedReviewer: { login: "bo" } }] },
  reviews: { nodes: [
    { author: { login: "me" }, state: "COMMENTED", submittedAt: iso(T1) },
    { author: { login: "me" }, state: "PENDING", submittedAt: iso(T2) },
    { author: { login: "bo" }, state: "APPROVED", submittedAt: iso(T1) },
    { author: { login: "cy" }, state: "APPROVED", submittedAt: iso(T1) },
    { author: { login: "cy" }, state: "CHANGES_REQUESTED", submittedAt: iso(T2) },
    { author: { login: "cy" }, state: "COMMENTED", submittedAt: iso(T3) },
  ] },
  reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] },
  commits: { nodes: [
    { commit: { committedDate: iso(T3), parents: { totalCount: 1 }, author: { user: { login: "ana" } }, statusCheckRollup: null } },
    { commit: { committedDate: iso(T4), parents: { totalCount: 2 }, author: { user: { login: "ana" } }, statusCheckRollup: null } },
    { commit: { committedDate: iso(T5), parents: { totalCount: 1 }, author: { user: { login: "bot[bot]" } }, statusCheckRollup: { state: "FAILURE" } } },
  ] },
  timelineItems: { nodes: [{ createdAt: iso(T1), requestedReviewer: { login: "me" } }] },
};

test("normalize: flattens what the board needs", () => {
  const p = R.normalize(node, "me");
  assert.equal(p.url, node.url);
  assert.equal(p.repo, "api");
  assert.equal(p.author, "ana");
  assert.equal(p.avatar, "https://a/ana.png");
  assert.equal(p.mine, false);
  assert.equal(p.branch, "ana/retry");
  assert.equal(p.updatedAt, T5);
  assert.equal(p.checks, "fail");
  assert.equal(p.conflict, true);
  assert.equal(p.threads, 1);
  assert.equal(p.requested, true);
  assert.equal(p.everRequested, true);
  assert.deepEqual(p.reviewers, ["me", "bo"]);
  assert.deepEqual(p.sources, []);
  assert.equal(p.team, false);
});

test("normalize: my last review skips pending ones", () => {
  assert.equal(R.normalize(node, "me").lastReviewAt, T1);
});

test("normalize: the author's last push skips merges and others' commits", () => {
  assert.equal(R.normalize(node, "me").authorPushAt, T3);
});

test("normalize: approvals count each reviewer's latest decisive review", () => {
  assert.equal(R.normalize(node, "me").approvals, 1); // bo approved; cy approved then requested changes
});

test("normalize: changes requested counts without a review decision", () => {
  assert.equal(R.normalize({ ...node, reviewDecision: null }, "me").changesRequested, true); // cy's latest decisive review
  const approvedOnly = { ...node, reviews: { nodes: [{ author: { login: "bo" }, state: "APPROVED", submittedAt: iso(T1) }] } };
  assert.equal(R.normalize(approvedOnly, "me").changesRequested, false);
});

test("classifyMine: changes requested where no review is required", () => {
  assert.equal(R.classifyMine(pr({ mine: true, decision: null, approvals: 1, changesRequested: true })), "comments");
});

test("normalize: checks words", () => {
  const withRollup = (state) => ({ ...node, commits: { nodes: [{ commit: { ...node.commits.nodes[0].commit, statusCheckRollup: state ? { state } : null } }] } });
  assert.equal(R.normalize(withRollup("SUCCESS"), "me").checks, "pass");
  assert.equal(R.normalize(withRollup("ERROR"), "me").checks, "fail");
  assert.equal(R.normalize(withRollup("PENDING"), "me").checks, "running");
  assert.equal(R.normalize(withRollup("EXPECTED"), "me").checks, "running");
  assert.equal(R.normalize(withRollup(null), "me").checks, null);
});

test("normalize: my own PR, nothing reviewed", () => {
  const p = R.normalize({ ...node, author: { login: "me", avatarUrl: "" }, reviews: { nodes: [] }, timelineItems: { nodes: [] } }, "me");
  assert.equal(p.mine, true);
  assert.equal(p.lastReviewAt, null);
  assert.equal(p.everRequested, false);
});

const rules = R.parseCodeowners([
  "# owners", "", "/libs/pay/ @acme/payments", "*.md @acme/docs", "docs/* @acme/docs", "/libs/pay/README.md @acme/web",
].join("\n"));

test("CODEOWNERS: a folder owns what's under it", () => {
  assert.equal(R.ownedBy(rules, ["libs/pay/a/b.ts"], "acme", "payments"), true);
});

test("CODEOWNERS: the last matching rule wins", () => {
  assert.equal(R.ownedBy(rules, ["libs/pay/README.md"], "acme", "payments"), false);
});

test("CODEOWNERS: dir/* is only the folder's own files", () => {
  assert.equal(R.ownedBy(rules, ["docs/a/x.txt"], "acme", "docs"), false);
  assert.equal(R.ownedBy(rules, ["docs/x.txt"], "acme", "docs"), true);
});

test("CODEOWNERS: an unanchored glob matches at any depth, owners ignore case", () => {
  assert.equal(R.ownedBy(rules, ["x/y/z.md"], "acme", "DOCS"), true);
});

test("CODEOWNERS: no files, not owned", () => {
  assert.equal(R.ownedBy(rules, [], "acme", "payments"), false);
});

test("CODEOWNERS: ** and anchoring by a middle slash", () => {
  const r = R.parseCodeowners("apps/**/api @acme/payments\nsrc/ @acme/web");
  assert.equal(R.ownedBy(r, ["apps/a/b/api/x.ts"], "acme", "payments"), true);
  assert.equal(R.ownedBy(r, ["other/apps/a/api/x.ts"], "acme", "payments"), false);
  assert.equal(R.ownedBy(r, ["lib/src/x.ts"], "acme", "web"), true);
});

test("merge: unions sources and team by url", () => {
  const m = new Map();
  R.merge(m, pr(), "requested", false);
  R.merge(m, pr(), "team", true);
  R.merge(m, pr(), "reviewed", false);
  assert.equal(m.size, 1);
  assert.deepEqual(m.get(pr().url).sources, ["requested", "team", "reviewed"]);
  assert.equal(m.get(pr().url).team, true);
});

test("classifyTheirs: a draft", () => {
  assert.equal(R.classifyTheirs(pr({ draft: true, requested: true })), "draft");
});

test("classifyTheirs: approved with a conflict is ready, blocked by it", () => {
  const p = pr({ decision: "APPROVED", conflict: true, requested: true });
  assert.equal(R.classifyTheirs(p), "ready");
  assert.equal(R.blocker(p), "conflito");
});

test("classifyTheirs: one approval counts when no review is required", () => {
  assert.equal(R.classifyTheirs(pr({ decision: null, approvals: 1, lastReviewAt: T1 })), "ready");
});

test("classifyTheirs: requested", () => {
  assert.equal(R.classifyTheirs(pr({ requested: true })), "review");
});

test("classifyTheirs: the author pushed after my review", () => {
  assert.equal(R.classifyTheirs(pr({ lastReviewAt: T1, authorPushAt: T2 })), "review");
});

test("classifyTheirs: reviewed, nothing new", () => {
  assert.equal(R.classifyTheirs(pr({ lastReviewAt: T2, authorPushAt: T1 })), "reviewed");
});

test("classifyTheirs: my team's, nobody asked me", () => {
  assert.equal(R.classifyTheirs(pr({ team: true })), "team");
});

test("classifyTheirs: nothing holds it", () => {
  assert.equal(R.classifyTheirs(pr()), null);
});

test("classifyMine: drafts by choice", () => {
  assert.equal(R.classifyMine(pr({ mine: true, draft: true }), undefined), "draft_review");
  assert.equal(R.classifyMine(pr({ mine: true, draft: true }), "ideas"), "draft_ideas");
  assert.equal(R.classifyMine(pr({ mine: true, draft: true }), "review"), "draft_review");
});

test("classifyMine: approved but failing goes to comments", () => {
  assert.equal(R.classifyMine(pr({ mine: true, decision: "APPROVED", checks: "fail" })), "comments");
});

test("classifyMine: approved with checks running is ready", () => {
  assert.equal(R.classifyMine(pr({ mine: true, decision: "APPROVED", checks: "running" })), "ready");
});

test("classifyMine: waiting, changes requested, threads, conflict", () => {
  assert.equal(R.classifyMine(pr({ mine: true, decision: "REVIEW_REQUIRED" })), "waiting");
  assert.equal(R.classifyMine(pr({ mine: true, decision: "CHANGES_REQUESTED" })), "comments");
  assert.equal(R.classifyMine(pr({ mine: true, threads: 2 })), "comments");
  assert.equal(R.classifyMine(pr({ mine: true, decision: "APPROVED", conflict: true })), "comments");
});

test("keep: others' PRs older than 30 days leave", () => {
  assert.equal(R.keep(pr({ requested: true, sources: ["requested"], updatedAt: NOW - 31 * DAY }), NOW), false);
});

test("keep: my own always stay", () => {
  assert.equal(R.keep(pr({ mine: true, sources: ["mine"], updatedAt: NOW - 90 * DAY }), NOW), true);
});

test("keep: a one-off review elsewhere doesn't bring a PR in", () => {
  assert.equal(R.keep(pr({ sources: ["reviewed"], everRequested: false, team: false }), NOW), false);
  assert.equal(R.keep(pr({ sources: ["reviewed"], everRequested: true }), NOW), true);
});

test("keep: a team repo PR outside the team's folders is dropped", () => {
  assert.equal(R.keep(pr({ sources: ["team"], team: false }), NOW), false);
  assert.equal(R.keep(pr({ sources: ["team"], team: true }), NOW), true);
});

test("lanes: every column, and the count of what waits on me", () => {
  const l = R.lanes([
    pr({ url: "a", requested: true, sources: ["requested"] }),
    pr({ url: "b", mine: true, sources: ["mine"], threads: 1 }),
    pr({ url: "c", mine: true, sources: ["mine"], draft: true }),
    pr({ url: "d", mine: true, sources: ["mine"] }),
  ], {}, NOW);
  assert.deepEqual(Object.keys(l.theirs), ["draft", "review", "team", "reviewed", "ready"]);
  assert.deepEqual(Object.keys(l.mine), ["draft_review", "draft_ideas", "comments", "waiting", "ready"]);
  assert.equal(l.count, 3);
  assert.equal(l.mine.waiting.length, 1);
});

test("lanes: the newest update first, drafts by choice", () => {
  const l = R.lanes([
    pr({ url: "old", mine: true, sources: ["mine"], updatedAt: NOW - 3 * DAY }),
    pr({ url: "new", mine: true, sources: ["mine"], updatedAt: NOW - DAY }),
    pr({ url: "idea", mine: true, sources: ["mine"], draft: true }),
  ], { idea: "ideas" }, NOW);
  assert.deepEqual(l.mine.waiting.map((p) => p.url), ["new", "old"]);
  assert.deepEqual(l.mine.draft_ideas.map((p) => p.url), ["idea"]);
  assert.equal(l.count, 0);
});

test("blocker: what holds an approved PR", () => {
  assert.equal(R.blocker(pr({ checks: "fail" })), "CI falhando");
  assert.equal(R.blocker(pr({ checks: "running" })), "CI rodando");
  assert.equal(R.blocker(pr({ checks: "pass" })), null);
});

test("pruneDrafts: drops choices for PRs no longer my drafts", () => {
  assert.deepEqual(R.pruneDrafts({ u1: "ideas", u2: "ideas", u3: "ideas" },
    [pr({ url: "u1", mine: true, draft: true }), pr({ url: "u2", mine: true, draft: false })]), { u1: "ideas" });
});

test("columns: labels verbatim, in screen order", () => {
  assert.deepEqual(R.THEIRS.map(([, l]) => l), ["Draft", "Precisa da minha revisão", "Precisa do meu time", "Revisado, esperando o autor", "Pronto para merge"]);
  assert.deepEqual(R.MINE.map(([, l]) => l), ["Draft: revisar para liberar", "Draft: ideias", "Comentários a resolver", "Esperando review", "Pronto para merge"]);
});
