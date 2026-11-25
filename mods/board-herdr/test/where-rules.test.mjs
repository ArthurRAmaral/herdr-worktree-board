// Where New agent starts (where-rules.js), run with `node --test test/` from the mod's folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { placesOn, placeOf, repoPlace } from "../where-rules.js";

const list = [
  { id: "a", machine: null, name: "workspace", common: "/r/ws/.git", repoName: "workspace", isMain: true, at: 1 },
  { id: "b", machine: null, name: "Fatura", common: "/r/ws/.git", repoName: "workspace", isMain: false, at: 9 },
  { id: "c", machine: null, name: "notes", common: null, repoName: null, isMain: false, at: 5 },
  { id: "d", machine: "box", name: "Box wt", common: "/h/ws/.git", repoName: "workspace", isMain: false, at: 3 },
  { id: "e", machine: null, name: "api", common: "/r/api/.git", repoName: "api", isMain: false, at: 2 },
];

test("placesOn: a machine's repos (their worktrees together, the main checkout first), then the spaces outside git", () => {
  const p = placesOn(list, null);
  assert.deepEqual(p.map((x) => [x.name, x.git, x.main, x.worktrees.map((w) => w.id)]),
    [["api", true, "e", ["e"]], ["workspace", true, "a", ["a", "b"]], ["notes", false, "c", ["c"]]]);
  assert.deepEqual(placesOn(list, "box").map((x) => [x.name, x.main]), [["workspace", "d"]]);
  assert.deepEqual(placesOn([], null), []);
});

test("placesOn: a repo without its main checkout open starts from its latest worktree", () => {
  const p = placesOn([{ ...list[1] }, { ...list[1], id: "f", at: 20 }], null);
  assert.equal(p[0].main, "f");
});

test("placeOf: the entry a space is in", () => {
  const p = placesOn(list, null);
  assert.equal(placeOf(p, "b").name, "workspace");
  assert.equal(placeOf(p, "zz"), null);
});

test("repoPlace: the named repo on the machine preferred, else this computer, else any; its main folder", () => {
  assert.deepEqual(repoPlace(list, "workspace", "box"), { machine: "box", dir: "/h/ws" });
  assert.deepEqual(repoPlace(list, "workspace", "other"), { machine: null, dir: "/r/ws" });
  assert.deepEqual(repoPlace(list.filter((w) => w.machine), "workspace", null), { machine: "box", dir: "/h/ws" });
  assert.equal(repoPlace(list, "nope", null), null);
  assert.equal(repoPlace(list, null, null), null);
});
