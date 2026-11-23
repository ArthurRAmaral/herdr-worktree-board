// A worktree's pull requests (worktree-prs.js), run with `node --test test/` from the mod's folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClonePrs, mergePrs, repoOf, timedOut, ghStall, stallProblem, STALL_AFTER, parseRepoPrs, prsByCommits, eachLimit } from "../worktree-prs.js";

const pr = (n, repo = "acme/api", over = {}) => ({ number: n, url: `https://github.com/${repo}/pull/${n}`, title: `PR ${n}`, ...over });

test("repoOf: owner/repo from a pull request's url", () => {
  assert.equal(repoOf("https://github.com/acme/api/pull/7"), "acme/api");
  assert.equal(repoOf("nope"), null);
});

test("parseClonePrs: only the open PRs whose branch this clone has", () => {
  const json = JSON.stringify([
    { number: 1, url: "https://github.com/acme/api/pull/1", title: "Mine here", isDraft: false, headRefName: "dev/eng-1", statusCheckRollup: [] },
    { number: 2, url: "https://github.com/acme/api/pull/2", title: "Another clone's", isDraft: true, headRefName: "dev/other", statusCheckRollup: [] },
  ]);
  const out = parseClonePrs(`main\ndev/eng-1\n---\n${json}`);
  assert.deepEqual(out.map((p) => p.number), [1]);
  assert.equal(out[0].repo, "acme/api");
  assert.equal(out[0].draft, false);
  assert.equal(out[0].branch, "dev/eng-1");
});

test("parseClonePrs: no gh answer (not on GitHub, gh missing) is no PRs", () => {
  assert.deepEqual(parseClonePrs("main\n---\n"), []);
  assert.deepEqual(parseClonePrs("main\n---\nnot json"), []);
  assert.deepEqual(parseClonePrs(""), []);
});

test("parseRepoPrs: every open PR of a repo with the commit its branch is at", () => {
  const json = JSON.stringify([
    { number: 7, url: "https://github.com/acme/api/pull/7", title: "Someone's", isDraft: true, headRefName: "feat/x", headRefOid: "abc123" },
  ]);
  assert.deepEqual(parseRepoPrs(json), [{ number: 7, url: "https://github.com/acme/api/pull/7", title: "Someone's", state: "OPEN",
    draft: true, checks: null, repo: "acme/api", branch: "feat/x", oid: "abc123" }]);
  assert.deepEqual(parseRepoPrs("not json"), []);
  assert.deepEqual(parseRepoPrs(""), []);
});

test("prsByCommits: a folder on another branch name (a review's rev/123) still has the PR whose head it holds", () => {
  const list = parseRepoPrs(JSON.stringify([
    { number: 1, url: "https://github.com/acme/api/pull/1", title: "a", headRefName: "feat/a", headRefOid: "aaa" },
    { number: 2, url: "https://github.com/acme/api/pull/2", title: "b", headRefName: "feat/b", headRefOid: "bbb" },
  ]));
  // the review added a commit on top (ccc), the PR's head (aaa) is under it
  assert.deepEqual(prsByCommits(list, ["ccc", "aaa", "zzz"]).map((p) => p.number), [1]);
  assert.deepEqual(prsByCommits(list, []), []);
  assert.deepEqual(prsByCommits(null, ["aaa"]), []);
});

test("eachLimit: runs every item, at most n at a time", async () => {
  let running = 0, most = 0;
  const seen = [];
  await eachLimit([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
    running++; most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 5));
    seen.push(x);
    running--;
  });
  assert.deepEqual(seen.sort(), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(most, 3);
});

test("mergePrs: the worktree's own first, then the rest, each once", () => {
  const own = pr(4, "acme/web");
  const out = mergePrs(own, [[pr(1), pr(4, "acme/web")], [pr(1), null, pr(9, "acme/infra")]]);
  assert.deepEqual(out.map((p) => p.url), [own.url, pr(1).url, pr(9, "acme/infra").url]);
});

test("mergePrs: none", () => {
  assert.deepEqual(mergePrs(null, []), []);
});

test("timedOut: herdr's own timeout, not gh's errors", () => {
  assert.equal(timedOut(new Error("`herdr.exec`: gh took longer than 30 s on box and was stopped")), true);
  assert.equal(timedOut(new Error("could not resolve to a Repository")), false);
  assert.equal(timedOut(null), false);
});

test("ghStall: counts timeouts in a row per machine, and an answer starts over", () => {
  let s = {};
  s = ghStall(s, "box", true);
  s = ghStall(s, "box", true);
  s = ghStall(s, null, true);
  assert.deepEqual(s, { box: 2, "": 1 });
  s = ghStall(s, "box", false);
  assert.deepEqual(s, { "": 1 });
});

test("stallProblem: quiet until a machine has STALL_AFTER timeouts in a row", () => {
  let s = {};
  for (let i = 1; i < STALL_AFTER; i++) s = ghStall(s, "box", true);
  assert.equal(stallProblem(s), null);
  s = ghStall(s, "box", true);
  assert.match(stallProblem(s), /^gh on box: GitHub didn't answer \d+ times in a row/);
  let here = {};
  for (let i = 0; i < STALL_AFTER; i++) here = ghStall(here, null, true);
  assert.match(stallProblem(here) ?? "", /^gh: GitHub didn't answer/);
});
