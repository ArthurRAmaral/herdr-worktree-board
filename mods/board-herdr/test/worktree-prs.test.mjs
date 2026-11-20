// A worktree's pull requests (worktree-prs.js), run with `node --test test/` from the mod's folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClonePrs, mergePrs, repoOf } from "../worktree-prs.js";

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

test("mergePrs: the worktree's own first, then the rest, each once", () => {
  const own = pr(4, "acme/web");
  const out = mergePrs(own, [[pr(1), pr(4, "acme/web")], [pr(1), null, pr(9, "acme/infra")]]);
  assert.deepEqual(out.map((p) => p.url), [own.url, pr(1).url, pr(9, "acme/infra").url]);
});

test("mergePrs: none", () => {
  assert.deepEqual(mergePrs(null, []), []);
});
