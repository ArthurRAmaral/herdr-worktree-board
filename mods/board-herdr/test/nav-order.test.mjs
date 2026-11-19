// The sidebar's order and a worktree's main agent (nav-order.js), run with `node --test test/` from the mod's folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as O from "../nav-order.js";

test("seq: hc addresses count up in base 36, a machine's prefix aside", () => {
  assert.ok(O.seq("t7s") < O.seq("t7t"));
  assert.ok(O.seq("t9z") < O.seq("ta0"));
  assert.ok(O.seq("tzz") < O.seq("t100"));
  assert.equal(O.seq("mini:t7s"), O.seq("t7s"));
});

test("mainAgent: the orchestrator, not the sub-agents it started in its own space", () => {
  const parentOf = new Map([["t7t", "t7s"], ["t92", "t7t"]]);
  assert.equal(O.mainAgent(["t92", "t7t", "t7s"], parentOf), "t7s");
});

test("mainAgent: a sub-agent whose parent is gone still isn't the main one", () => {
  // t8c was started by t7y, since removed; t7s started nothing here but has no parent at all
  const parentOf = new Map([["t8c", "t7y"]]);
  assert.equal(O.mainAgent(["t8c", "t7s"], parentOf), "t7s");
});

test("mainAgent: an agent started from another space is that space's main one", () => {
  const parentOf = new Map([["t40", "t20"], ["t41", "t40"]]);
  assert.equal(O.mainAgent(["t41", "t40"], parentOf), "t40");
});

test("mainAgent: two agents started by hand, the older one", () => {
  assert.equal(O.mainAgent(["t5c", "t2w"], new Map()), "t2w");
});

test("mainAgent: none", () => {
  assert.equal(O.mainAgent([], new Map()), null);
});

test("addNew: nothing new keeps the same list", () => {
  const order = ["a", "b"];
  assert.equal(O.addNew(order, ["b", "a"], "top"), order);
});

test("addNew: new worktrees go on top, in the order given; new agents at the end", () => {
  assert.deepEqual(O.addNew(["a", "b"], ["c", "a", "d"], "top"), ["c", "d", "a", "b"]);
  assert.deepEqual(O.addNew(["a", "b"], ["c", "a", "d"], "end"), ["a", "b", "c", "d"]);
});

test("moveKey: before or after the row it's dropped on", () => {
  assert.deepEqual(O.moveKey(["a", "b", "c", "d"], "d", "b", false), ["a", "d", "b", "c"]);
  assert.deepEqual(O.moveKey(["a", "b", "c", "d"], "a", "c", true), ["b", "c", "a", "d"]);
});

test("moveKey: onto itself or an unknown row changes nothing", () => {
  assert.deepEqual(O.moveKey(["a", "b"], "a", "a", true), ["a", "b"]);
  assert.deepEqual(O.moveKey(["a", "b"], "a", "z", true), ["a", "b"]);
});

test("toFront: a worktree that changes stage comes in at the top", () => {
  assert.deepEqual(O.toFront(["a", "b", "c"], "c"), ["c", "a", "b"]);
});

test("byOrder: sorts by place in the order; unknown ones last, as they came", () => {
  const items = [{ k: "x" }, { k: "b" }, { k: "y" }, { k: "a" }];
  assert.deepEqual(O.byOrder(items, (i) => i.k, ["a", "b"]).map((i) => i.k), ["a", "b", "x", "y"]);
});
