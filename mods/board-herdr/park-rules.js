// Ending a worktree's agents to free its machine, and bringing them back where they left off (Claude Code's
// --resume, OpenCode's -s); pure (nothing from herdr), so `node --test test/*.test.mjs` runs it.

// the agents that can come back, by what they report: "claude", "opencode", or null
export function appOf(app) {
  const a = String(app ?? "").toLowerCase();
  return a === "claude" || a === "claude-code" ? "claude" : a === "opencode" ? "opencode" : null;
}

// the flags that take the next word as their value (the rest of the words that aren't flags are its first message)
const VALUED = {
  claude: new Set(["--model", "--permission-mode", "--add-dir", "--agent", "--agents", "--settings", "--mcp-config",
    "--append-system-prompt", "--system-prompt", "--allowedTools", "--allowed-tools", "--disallowedTools",
    "--disallowed-tools", "--fallback-model", "--effort", "--setting-sources", "--plugin-dir"]),
  opencode: new Set(["--model", "-m", "--agent", "--port", "--hostname", "--log-level"]),
};
// a session it was resuming or continuing, a print run: not carried over (with its value when it has one)
const DROP = {
  claude: new Map([["--resume", true], ["-r", true], ["--session-id", true], ["--continue", false], ["-c", false],
    ["--print", false], ["-p", false], ["--fork-session", false]]),
  opencode: new Map([["--session", true], ["-s", true], ["--prompt", true], ["--continue", false], ["-c", false]]),
};

// the command that brings it back: its program and flags as it started, then the session
export function resumeArgv(app, argv, session) {
  if (!app || !session || !VALUED[app]) return null;
  const [cmd = app, ...rest] = argv ?? [];
  const keep = [];
  for (let i = 0; i < rest.length; i++) {
    const w = String(rest[i]);
    if (!w.startsWith("-")) continue; // the first message
    const name = w.split("=")[0];
    if (DROP[app].has(name)) { if (DROP[app].get(name) && !w.includes("=")) i++; continue; }
    keep.push(w);
    if (VALUED[app].has(name) && !w.includes("=") && i + 1 < rest.length) keep.push(String(rest[++i]));
  }
  return [cmd, ...keep, ...(app === "claude" ? ["--resume", session] : ["-s", session])];
}

// OpenCode's session for a terminal (`opencode session list --format json`): the folder's one whose title the
// terminal shows ("OC | <title>"), else the folder's newest
export function pickOpencodeSession(list, cwd, title) {
  const here = (Array.isArray(list) ? list : []).filter((s) => s?.id && s.directory === cwd)
    .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0));
  const shown = String(title ?? "").replace(/^\s*OC\s*\|\s*/i, "").trim().toLowerCase();
  return (shown && here.find((s) => String(s.title ?? "").trim().toLowerCase() === shown))?.id ?? here[0]?.id ?? null;
}

const quote = (w) => (/^[\w@%+=:,./-]+$/.test(w) ? w : `'${w.replace(/'/g, "'\\''")}'`);

// what is typed in the terminal's shell to bring it back, in its folder
export function shellLine(cwd, argv) {
  const cmd = argv.map((w) => quote(String(w))).join(" ");
  return cwd ? `cd ${quote(cwd)} && ${cmd}` : cmd;
}

// Claude Code's ~/.claude/sessions/<pid>.json: the process and the session it is in
export function parseClaudeSession(stdout) {
  try {
    const j = JSON.parse(stdout);
    return j?.sessionId && j.pid ? { pid: j.pid, session: j.sessionId } : null;
  } catch { return null; }
}

export const parkedCount = (rec) => rec?.agents?.length ?? 0;
