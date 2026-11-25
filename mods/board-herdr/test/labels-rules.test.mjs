// A worktree's labels (labels-rules.js), run with `node --test test/` from the mod's folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normLabel, labelsOf, toggleLabel, allLabels, suggest, groupByLabel, dropGone, catalog, remember, removeLabel } from "../labels-rules.js";

test("normLabel: trimmed, one space, lower case, at most 24 characters", () => {
  assert.equal(normLabel("  Bug  Fix "), "bug fix");
  assert.equal(normLabel("Pesquisa"), "pesquisa");
  assert.equal(normLabel("   "), "");
  assert.equal(normLabel("x".repeat(40)).length, 24);
});

test("toggleLabel: adds a new one, takes an existing one off, the worktree without labels drops out", () => {
  let m = {};
  m = toggleLabel(m, "sp1", "Bug");
  m = toggleLabel(m, "sp1", "feature");
  assert.deepEqual(labelsOf(m, "sp1"), ["bug", "feature"]);
  m = toggleLabel(m, "sp1", "BUG");
  assert.deepEqual(labelsOf(m, "sp1"), ["feature"]);
  m = toggleLabel(m, "sp1", "feature");
  assert.deepEqual(m, {});
  assert.deepEqual(toggleLabel({}, "sp1", "  "), {});
});

test("allLabels: every label in use, the most used first, then by name", () => {
  assert.deepEqual(allLabels({ a: ["bug", "pesquisa"], b: ["bug"], c: ["feature"] }), ["bug", "feature", "pesquisa"]);
  assert.deepEqual(allLabels(null), []);
});

test("suggest: the labels that have the text, and a new one when none is exactly it", () => {
  const all = ["bug", "feature", "pesquisa"];
  assert.deepEqual(suggest(all, ""), { list: all, create: null });
  assert.deepEqual(suggest(all, "Fea"), { list: ["feature"], create: "fea" });
  assert.deepEqual(suggest(all, "BUG"), { list: ["bug"], create: null });
  assert.deepEqual(suggest(all, "infra"), { list: [], create: "infra" });
});

test("groupByLabel: a column's cards under their first label, once each, then the ones without", () => {
  const cards = [{ key: "a" }, { key: "b" }, { key: "c" }];
  const m = { a: ["bug"], b: ["feature", "bug"] };
  assert.deepEqual(groupByLabel(cards, m).map(([l, cs]) => [l, cs.map((c) => c.key)]),
    [["bug", ["a"]], ["feature", ["b"]], [null, ["c"]]]);
  assert.deepEqual(groupByLabel([{ key: "c" }], m), [[null, [{ key: "c" }]]]);
});

test("dropGone: a space that no longer exists drops its labels", () => {
  assert.deepEqual(dropGone({ a: ["bug"], b: ["x"] }, new Set(["a"])), { a: ["bug"] });
});

test("dropGone: a space on a machine that isn't ready (reconnecting) keeps its labels", () => {
  const map = { a: ["bug"], "box/s1": ["root"], "box/s2": ["x"] };
  assert.deepEqual(dropGone(map, new Set(["a"]), (m) => m !== "box"), map);
  assert.deepEqual(dropGone(map, new Set(["a", "box/s1"]), () => true), { a: ["bug"], "box/s1": ["root"] });
});

test("catalog: every saved label stays, the used first (most used), then the unused by name", () => {
  assert.deepEqual(catalog(["zeta", "bug", "alpha"], { a: ["bug"], b: ["bug", "new"] }), ["bug", "new", "alpha", "zeta"]);
  assert.deepEqual(catalog(undefined, {}), []);
});

test("remember: a label joins the catalog once, normalized", () => {
  assert.deepEqual(remember(["bug"], "  Feature  "), ["bug", "feature"]);
  assert.deepEqual(remember(["bug"], "BUG"), ["bug"]);
  assert.deepEqual(remember(undefined, ""), []);
});

test("removeLabel: off every card, and a card left without any drops out", () => {
  assert.deepEqual(removeLabel({ a: ["bug", "x"], b: ["bug"] }, "bug"), { a: ["x"] });
});
