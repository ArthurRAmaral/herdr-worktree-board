// The git read each worktree gets (main.js's GIT script), run with `node --test test/` from the mod's folder: the
// board throws away a read that exits non-zero, so the script must end well whatever the folder has.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const src = readFileSync(new URL("../main.js", import.meta.url), "utf8");
const GIT = /const GIT = `([\s\S]*?)`;/.exec(src)[1].replace(/\\([$\\])/g, "$1"); // as the template literal gives it
const run = (dir) => spawnSync("sh", ["-c", GIT, "sh", dir], { encoding: "utf8" });
const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "board-git-"));
  git(dir, "init", "-q");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
  return dir;
}

test("GIT: a worktree without clones under repos/ still reads (exit 0)", () => {
  const dir = repo();
  try {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^root=/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("GIT: repos/ with a folder that isn't a clone, then none that is: still exit 0, no clone line", () => {
  const dir = repo();
  try {
    mkdirSync(join(dir, "repos", "notes"), { recursive: true });
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /^clone=/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("GIT: a clone under repos/ is listed", () => {
  const dir = repo();
  try {
    mkdirSync(join(dir, "repos", "api"), { recursive: true });
    git(join(dir, "repos", "api"), "init", "-q");
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^clone=.*\/repos\/api$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("GIT: the commits the branch has over the default one, for a PR whose branch has another name here", () => {
  const dir = repo();
  try {
    const root = git(dir, "rev-parse", "HEAD").stdout.trim();
    git(dir, "update-ref", "refs/remotes/origin/main", root);
    git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    git(dir, "checkout", "-q", "-b", "rev/12");
    for (const m of ["y", "z"]) git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", m);
    const [head, prev] = git(dir, "rev-list", "-2", "HEAD").stdout.trim().split("\n");
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^commits=${head} ${prev} *$`, "m"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
