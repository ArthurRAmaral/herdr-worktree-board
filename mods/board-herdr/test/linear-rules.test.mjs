// The Linear column's rules (linear-rules.js), run with `node --test test/` from the mod's folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../linear-rules.js";

test("readBoardConfig: legacy orchestrate key", () => {
  assert.deepEqual(L.readBoardConfig({ orchestrate: "orch" }),
    { skills: ["orch"], stageSkills: { in_progress: "orch" }, issueArg: [], skillFlags: {} });
});

test("readBoardConfig: drops bad names and reads all keys", () => {
  const cfg = L.readBoardConfig({
    skills: ["orch", "plan-skill", "../x"], stageSkills: { todo: "plan-skill" },
    issueArg: ["plan-skill"], skillFlags: { "plan-skill": "--sync-repos" },
  });
  assert.deepEqual(cfg.skills, ["orch", "plan-skill"]);
  assert.deepEqual(cfg.stageSkills, { todo: "plan-skill" });
  assert.deepEqual(cfg.issueArg, ["plan-skill"]);
  assert.deepEqual(cfg.skillFlags, { "plan-skill": "--sync-repos" });
});

test("readBoardConfig: null gives empty lists and maps", () => {
  assert.deepEqual(L.readBoardConfig(null), { skills: [], stageSkills: {}, issueArg: [], skillFlags: {} });
});

test("issueFromBranch finds a known team's ID", () => {
  assert.equal(L.issueFromBranch("dev/eng-12-fix-refund", ["ENG"]), "ENG-12");
  assert.equal(L.issueFromBranch("ops-64-overflow", ["OPS"]), "OPS-64");
});

test("issueFromBranch matches only at the start of the last path segment", () => {
  assert.equal(L.issueFromBranch("fix/ops-64-overflow", ["OPS"]), null);
});

test("issueFromBranch ignores tokens whose team key is unknown", () => {
  assert.equal(L.issueFromBranch("fix-utf-8", ["ENG"]), null);
  assert.equal(L.issueFromBranch("release-2026", ["ENG"]), null);
  assert.equal(L.issueFromBranch(null, ["ENG"]), null);
});

test("canDrop: only todo and in_progress", () => {
  for (const s of ["todo", "in_progress"]) assert.equal(L.canDrop(s), true);
  for (const s of ["perpetual", "in_review", "done", "archived"]) assert.equal(L.canDrop(s), false);
});

test("startedState: lowest position", () => {
  const states = [{ id: "a", type: "unstarted", position: 0 }, { id: "b", type: "started", position: 2 },
    { id: "c", type: "started", position: 1 }];
  assert.equal(L.startedState(states).id, "c");
});

test("startedState: none", () => {
  assert.equal(L.startedState([]), null);
});

test("firstMessage: issue skill with flag", () => {
  const cfg = { issueArg: ["plan-skill"], skillFlags: { "plan-skill": "--sync-repos" } };
  assert.equal(
    L.firstMessage({ skill: "plan-skill", cfg, issueId: "ENG-12", stage: "todo", text: "", context: ["- Linear issue: ENG-12"] }),
    "/plan-skill ENG-12 --sync-repos\n\nContext:\n- Linear issue: ENG-12");
});

test("firstMessage: orchestrator takes no ID", () => {
  assert.equal(L.firstMessage({ skill: "orch", cfg: {}, issueId: "ENG-12", stage: "in_progress", text: "go", context: [] }), "/orch go");
});

test("firstMessage: no skill", () => {
  const base = { skill: "", cfg: {}, issueId: "ENG-12", text: "", context: [] };
  assert.equal(L.firstMessage({ ...base, stage: "todo" }), "Plan the work for Linear issue ENG-12. Don't change code yet.");
  assert.equal(L.firstMessage({ ...base, stage: "in_progress" }), "Start working on the Linear issue ENG-12.");
  assert.equal(L.firstMessage({ ...base, stage: "todo", text: "do it" }), "do it");
});

test("firstMessage: no issue, no text", () => {
  const base = { skill: "", cfg: {}, issueId: null, stage: "todo", text: "" };
  assert.equal(L.firstMessage({ ...base, context: ["- x"] }), "Context:\n- x");
  assert.equal(L.firstMessage({ ...base, context: [] }), "");
});

test("todoColumn hides linked and starting issues", () => {
  const now = 1_000_000;
  const mk = (id, type) => ({ identifier: id, id, state: { type } });
  const issues = [mk("ENG-1", "unstarted"), mk("ENG-2", "unstarted"), mk("ENG-3", "unstarted"), mk("ENG-4", "started")];
  const ids = (r) => r.map((i) => i.id);
  const linked = new Set(["ENG-2"]);
  assert.deepEqual(ids(L.todoColumn(issues, { linked, starting: { "ENG-3": now - 1000 }, now })), ["ENG-1"]);
  assert.deepEqual(ids(L.todoColumn(issues, { linked, starting: { "ENG-3": now - 200000 }, now })), ["ENG-1", "ENG-3"]);
});

test("moveInLinear: only a Linear start that ends in progress", () => {
  assert.equal(L.moveInLinear(true, "in_progress"), true);
  assert.equal(L.moveInLinear(true, "todo"), false);
  assert.equal(L.moveInLinear(false, "in_progress"), false);
});
