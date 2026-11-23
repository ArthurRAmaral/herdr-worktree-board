// Ending a worktree's agents and bringing them back (park-rules.js), run with `node --test test/` from the mod's folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { appOf, resumeArgv, pickOpencodeSession, shellLine, parseClaudeSession, parkedCount } from "../park-rules.js";

test("appOf: the agents that can come back, by what they report", () => {
  assert.equal(appOf("claude-code"), "claude");
  assert.equal(appOf("claude"), "claude");
  assert.equal(appOf("opencode"), "opencode");
  assert.equal(appOf("codex"), null);
  assert.equal(appOf(undefined), null);
});

test("resumeArgv: Claude Code keeps its flags, drops the first message, resumes the session", () => {
  assert.deepEqual(resumeArgv("claude", ["claude", "--dangerously-skip-permissions", "--model", "opus", "/plan-skill ENG-12 go"], "abc"),
    ["claude", "--dangerously-skip-permissions", "--model", "opus", "--resume", "abc"]);
  // a session it was already resuming, or a print run, is not carried over
  assert.deepEqual(resumeArgv("claude", ["/usr/bin/claude", "--resume", "old", "-c", "--permission-mode=plan"], "new"),
    ["/usr/bin/claude", "--permission-mode=plan", "--resume", "new"]);
});

test("resumeArgv: OpenCode keeps its flags and takes -s", () => {
  assert.deepEqual(resumeArgv("opencode", ["opencode", "--standalone", "-m", "x/y", "--continue"], "ses_1"),
    ["opencode", "--standalone", "-m", "x/y", "-s", "ses_1"]);
});

test("resumeArgv: nothing to resume, or an agent it can't", () => {
  assert.equal(resumeArgv("claude", ["claude"], null), null);
  assert.equal(resumeArgv(null, ["codex"], "s"), null);
  assert.deepEqual(resumeArgv("claude", [], "s"), ["claude", "--resume", "s"]);
});

test("pickOpencodeSession: the folder's session whose title the terminal shows, else its newest", () => {
  const list = [
    { id: "a", title: "Execução do brief pla439-web", updated: 5, directory: "/w/web" },
    { id: "b", title: "Execução do brief pla439-sdk", updated: 9, directory: "/w/web" },
    { id: "c", title: "Execução do brief pla439-web", updated: 99, directory: "/w/other" },
  ];
  assert.equal(pickOpencodeSession(list, "/w/web", "OC | Execução do brief pla439-web"), "a");
  assert.equal(pickOpencodeSession(list, "/w/web", "something else"), "b");
  assert.equal(pickOpencodeSession(list, "/w/none", "OC | Execução do brief pla439-web"), null);
  assert.equal(pickOpencodeSession(null, "/w/web", ""), null);
});

test("shellLine: what is typed in the terminal's shell, quoted", () => {
  assert.equal(shellLine("/home/a b/it's", ["claude", "--resume", "x"]), "cd '/home/a b/it'\\''s' && claude --resume x");
  assert.equal(shellLine(null, ["opencode", "-s", "ses_1"]), "opencode -s ses_1");
});

test("parseClaudeSession: Claude Code's ~/.claude/sessions/<pid>.json", () => {
  assert.deepEqual(parseClaudeSession('{"pid":42,"sessionId":"31d5","cwd":"/x"}'), { pid: 42, session: "31d5" });
  assert.equal(parseClaudeSession(""), null);
  assert.equal(parseClaudeSession('{"pid":42}'), null);
});

test("parkedCount: how many agents a parked worktree brings back", () => {
  assert.equal(parkedCount({ agents: [{}, {}] }), 2);
  assert.equal(parkedCount(null), 0);
});
