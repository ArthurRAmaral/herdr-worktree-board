// Sessions and tags (tags.js), run with `node --test test/` from the mod's folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as T from "../tags.js";

test("readTagConfig: names or {name, color}, a label and a shared list to read tags from", () => {
  const c = T.readTagConfig({ tags: ["Ops", { name: "Security", color: "#ff0000" }, "Ops", " "], tagLabel: "hbl.group", tagList: "hbl.groups" });
  assert.deepEqual(c.tags.map((t) => t.name), ["Ops", "Security"]);
  assert.equal(c.tags[1].color, "#ff0000");
  assert.equal(c.tags[0].color, T.tagColor("Ops"));
  assert.equal(c.tagLabel, "hbl.group");
  assert.equal(c.tagList, "hbl.groups");
});

test("readTagConfig: no board.json, or junk in it, means no tags and nothing read from labels", () => {
  assert.deepEqual(T.readTagConfig(null), { tags: [], tagLabel: null, tagList: null });
  assert.deepEqual(T.readTagConfig({ tags: "x", tagLabel: "a b", tagList: 3 }), { tags: [], tagLabel: null, tagList: null });
});

test("catalog: lists in order, then tags only a session has; the first color wins", () => {
  const mine = [{ name: "Ops", color: "#111111" }];
  const groups = [{ name: "Instagram", pinned: false }, { name: "Ops", pinned: true }];
  const all = T.catalog([mine, groups], ["Finance", "Ops"]);
  assert.deepEqual(all.map((t) => t.name), ["Ops", "Instagram", "Finance"]);
  assert.equal(all[0].color, "#111111");
});

test("parseTags and formatTags: a comma-separated label, each tag once, no comma inside a tag", () => {
  assert.deepEqual(T.parseTags("Ops, Security,,Ops"), ["Ops", "Security"]);
  assert.deepEqual(T.parseTags(undefined), []);
  assert.equal(T.formatTags(["Ops", "Security"]), "Ops,Security");
  assert.equal(T.cleanTag("a,b"), "a b");
});

test("toggleTag: on, then off", () => {
  assert.deepEqual(T.toggleTag(["A"], "B"), ["A", "B"]);
  assert.deepEqual(T.toggleTag(["A", "B"], "A"), ["B"]);
  assert.deepEqual(T.toggleTag(["A"], "  "), ["A"]);
});

test("toSeed: live sessions never tagged, with a value in the label to copy", () => {
  const terms = [
    { address: "t1", state: "live", labels: { "hbl.group": "Instagram" } },
    { address: "t2", state: "live", labels: { "hbl.group": "Ops", [T.TAGGED_LABEL]: "1" } }, // you took its tags off
    { address: "t3", state: "live", labels: { "hbl.group": "Ops", [T.TAGS_LABEL]: "Finance" } },
    { address: "t4", state: "finished", labels: { "hbl.group": "Ops" } },
    { address: "t5", state: "live", labels: {} },
  ];
  assert.deepEqual(T.toSeed(terms, "hbl.group"), [["t1", ["Instagram"]]]);
  assert.deepEqual(T.toSeed(terms, null), []);
});

test("sessionStage: its own known stage, else its worktree's", () => {
  const known = (k) => ["todo", "in_review"].includes(k);
  assert.equal(T.sessionStage("in_review", "todo", known), "in_review");
  assert.equal(T.sessionStage(undefined, "todo", known), "todo");
  assert.equal(T.sessionStage("nope", "todo", known), "todo");
});

test("sessions: an agent started by another one in the worktree is on that one's card, even through a sub-agent", () => {
  // t1 started t2; t2 started a sub-agent s9 (no pane), which started t3; t4 was started from another worktree's t8
  const parentOf = new Map([["t2", "t1"], ["s9", "t2"], ["t3", "s9"], ["t4", "t8"]]);
  assert.deepEqual(T.sessions(["t3", "t1", "t4", "t2"], parentOf), [
    { root: "t1", members: ["t1", "t3", "t2"] },
    { root: "t4", members: ["t4"] },
  ]);
});

test("sessions: two agents started by hand are two sessions", () => {
  assert.deepEqual(T.sessions(["t5", "t6"], new Map()), [{ root: "t5", members: ["t5"] }, { root: "t6", members: ["t6"] }]);
});
