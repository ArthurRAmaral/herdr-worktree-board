// Board (Herdr): a board of worktrees, fed by Herdr's own spaces and agents. In Herdr a worktree is a space (the
// worktree mod makes one per checkout), so each card is a space: its stage, its repo and branch, every agent running in
// it and the sub-agents those started (hc run), counted by status. One mod draws every part; the layout says which with
// props().part: "top" (the pinned Board tab with its needs-you badge, then the shown space's tabs), "nav" (the top of
// the sidebar: + New agent, Board, who needs you, then every worktree grouped by stage, most recently used first, its
// agents under it; a click goes straight to an agent, a right-click moves the worktree to another stage), "board"
// (today's numbers, the next move, project chips and one column per stage) and "bottom" (when the board last read, any
// git or gh problem, the clock). "new" is the New agent dialog: a new worktree of the shown repo with the agent in it,
// or one more agent in a worktree, started on your message plus a Context block of the references you add (a Linear
// issue, picked from yours when LINEAR_API_KEY is set, a pull request, a Slack message, any link or note); "stage" is
// the stage picker; "cleanup" lists the worktrees left without a space, to open or remove. ⌘W (keys.json,
// board-herdr.close) on a worktree's last tab opens Herdr's own Remove worktree, so closed tasks don't pile up on disk. Both give the keyboard back to the board when they
// close (Herdr only does that for focusable mods).
// Two things kept apart: a worktree's stage (Todo, In progress, In review, Watch, Temp, Done, Archived, Paused), which
// only you change, kept in shared state by space (Done removes the worktree after 3 days there, unless it has
// uncommitted changes); and each agent's status (working, waiting for you, done, idle), which the
// agent reports and the board only shows. A card suggests the next stage when its pull request says so (opened: In
// review; merged: Archived) but never moves by itself. Archived also puts the worktree's tabs away (tab.settle).
// The board and the sidebar show the worktrees of the shown space's repo, or every one (V on the board), and say when
// an agent elsewhere needs you.
// Keyboard, like Linear's: ↑↓/jk within a column, ←→/hl across columns, 1-8 a column, S the stage, ⇧←→ the stage
// before or after, ⏎ opens the worktree's agent, Space peeks at it beside the board, N a new worktree, ⇧N one more agent
// in this one, / searches, ? lists every key; ⌘E (keys.json, board-herdr.toggle) goes from an agent to the board and
// back.
// Data: spaces() and agents(); terminals() for the sub-agents; git in each worktree's folder for its repo, branch,
// commits ahead of the default branch, uncommitted files and +added −removed; gh for the branch's pull request and
// checks, and for what you merged this week. Merge PR runs `gh pr merge`, Ship PR runs `git push -u origin HEAD && gh
// pr create --fill`, New agent runs `git worktree add` into ~/.herdr/worktrees/<repo>/<branch>, where Herdr's own
// worktree mod puts them, and, only with LINEAR_API_KEY set in your shell, asks api.linear.app for your open issues.
// Focus (F) fades everything but who needs you and shows the agent's live terminal in the layout's hidden
// "focus-term" block, so the question can be answered in place.
// Asks (github.com/sachin-philip/herdr-agent-ask, fitted here): the sidebar copy runs its engine (asks-engine.js), which
// turns every question an agent asks (a permission, a menu of options, a turn that ends asking in plain text, read with
// `claude -p` Haiku) into a record in shared("asks.state"). A card shows its worktree's question with the options to
// click (Y takes the recommended one); "asks" is the panel at the board's right with every question in scope, to answer
// or type a reply (⌘⇧A, R, the sidebar's Asks row). Answers go in with hc and are logged where asks.json's `log` says.
import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { spaces, agents, panes, run, props, exec, shared, setShared, window, nextCommand, layout, openOverlay, closeOverlay,
  knownAgents, home, focused, setAgentOrder, terminals, notify } from "herdr";
import { Engine } from "./asks-engine.js";
import { loadConfig } from "./asks-state.js";
import { AsksPanel, Answerer, pickable, waitingAsks, questionsOf } from "./asks.js";

const MOD = "board-herdr";
const C = {
  top: "#101012", side: "#0f0f11", main: "#121214", card: "#1a1a1d", raised: "#242328", hover: "#1f1f23",
  line: "#1e1e20", line2: "#2a2a30", text: "#e4e4e7", soft: "#c8c8cc", muted: "#8a898e", dim: "#56555b",
  accent: "#b4a0db", accentDim: "#625187",
  you: "#ffb406", youBg: "#1f1a10", youCard: "#1b1912", youAsk: "#241f12", youLine: "#4a3a12",
  work: "#8f7fd1", land: "#53cf91", landBg: "#12201a", landLine: "#1d3a2c", done: "#6fb3f2", red: "#e0707f",
};
// the stages a worktree goes through, in order: the board's columns and the sidebar's groups
const STAGES = [
  ["todo", "Todo", "#8a8f98"],
  ["in_progress", "In progress", "#e6b422"],
  ["in_review", "In review", "#3ec9b4"],
  ["watch", "Watch", "#7d8590"],
  ["temp", "Temp", "#53cf91"],
  ["done", "Done", "#b5e06b"],
  ["archived", "Archived", "#5b8def"],
  ["paused", "Paused", "#f0883e"],
];
const DONE_MS = 3 * 86400000; // how long a worktree stays in Done before it's removed
const DEFAULT_STAGE = "in_progress"; // a worktree nobody gave a stage (Archived when all its tabs were put away)
const OLD_STAGE_LABEL = "herdr.stage"; // where stages were before they belonged to worktrees: on each agent's terminal
const stageInfo = (k) => STAGES.find(([s]) => s === k) ?? STAGES[1];
const CHIPS = [
  ["#e0707f", "#3b1d24"], ["#3ec9b4", "#11302d"], ["#f0a050", "#3a2410"], ["#a690e8", "#2a2245"],
  ["#e6c35c", "#352c10"], ["#6fb3f2", "#152a40"], ["#e88cc8", "#3a1a30"], ["#8fd18a", "#1c321c"],
];
const COL_MIN = 260; // px: the narrowest a column with cards gets; below that the columns scroll sideways
const FOLDED_W = 140; // px: a folded column (just its header)
const EMPTY_W = 118; // px: a column without cards
const CARD_AGENTS = 4; // agents listed on a card; the rest are counted
const MONO = "JetBrains Mono";
const SANS = "Geist";
const GIT_MS = 10000; // how often each worktree's folder is read with git (also when an agent changes status)
const GH_MS = 60000; // how often each branch's pull request is asked of GitHub
const WEEK_MS = 300000; // how often the merged pull requests of the week are counted
const ASK_MS = 5000; // how often the questions of blocked agents are read off their screens
const CONFIRM = new Set(["land", "ship"]); // asked on the card first
const LABEL = { land: "Merge PR", ship: "Ship PR" };
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 }; // the most urgent first, as Herdr ranks a space's status
const WORD = { blocked: "waiting", working: "working", done: "done", idle: "idle" };

const VIEW = "boardh.view"; // shared: "board" or "work", which child of the main stack shows
const LEFT = "boardh.left"; // shared: when the top bar last sent a picked space to the work view (ms)
const FOCUS = "boardh.focus"; // shared: Focus is on (the top bar fades tabs too)
const COUNTS = "boardh.counts"; // shared: what the top bar counts
const REPOS = "boardh.repos"; // shared: space id -> {common, name}: its repo, for the sidebar's repo filter
const STAY = "boardh.stay"; // shared: when New agent made a space with a first message (ms): the top bar keeps the board
const PICK = "boardh.agent"; // shared: the agent New agent last started
// what New agent offers, until knownAgents() says how this machine runs them and whether they're installed
const NEW_AGENTS = [
  { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false, run: ["claude"], installed: null },
  { key: "opencode", name: "OpenCode", icon: "icons/opencode.svg", tint: true, run: ["opencode"], installed: null },
];
const USED = "boardh.used"; // shared: address -> when you last left that agent (ms), the sidebar's order
const FOLD = "boardh.fold"; // shared: the sidebar's folded groups
const SCOPE = "boardh.scope"; // shared: "all", or anything else for the shown space's repo
const PEEK = "boardh.peek"; // shared: Space shows the selected agent beside the board (the top bar then keeps the board)
const COL = "boardh.col"; // shared: {kind, at}, the stage the sidebar last opened the board on (kind null: none)
const REFOCUS = "boardh.refocus"; // shared: when a dialog over the board closed (ms): the board takes the keyboard back
const NEW_STAGE = "boardh.newStage"; // shared: the stage New agent last gave
const PENDING = "boardh.pending"; // shared: {stage, folder, at}: New agent's stage, for the space that opens in folder
const SPACE_STAGES = "boardh.spaceStages"; // shared: space id -> its stage
const STAGE_AT = "boardh.stageAt"; // shared: space id -> when it last changed stage (ms): Done's 3 days count from it
const SPACE_TITLES = "boardh.spaceTitles"; // shared: space id -> the title New agent gave its worktree

// one call per folder: the repo, its branch, how far it is from the default branch, and what's uncommitted
const GIT = `cd "$1" 2>/dev/null || exit 3
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
echo "root=$(git rev-parse --show-toplevel)"
echo "common=$(git rev-parse --path-format=absolute --git-common-dir)"
echo "branch=$(git branch --show-current)"
base=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null); echo "base=$base"
echo "dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
if [ -n "$base" ]; then
  mb=$(git merge-base "$base" HEAD 2>/dev/null)
  if [ -n "$mb" ]; then echo "ahead=$(git rev-list --count "$mb"..HEAD)"; echo "diff=$(git diff --shortstat "$mb" 2>/dev/null)"; fi
fi
echo "unpushed=$(git rev-list --count @{u}..HEAD 2>/dev/null)"`;

// New agent's: the repo a folder is in, the branch a new worktree starts from, and the home the worktrees go under
// a reference New agent puts in the agent's first message: what it is, from what you paste
const REF_KINDS = { linear: ["Linear issue", "#8b93f8"], pr: ["Pull request", "#53cf91"], slack: ["Slack message", "#e88cc8"],
  link: ["Link", "#6fb3f2"], note: ["Note", "#8a898e"] };
function classify(raw) {
  const s = raw.trim();
  let m;
  if (!s) return null;
  if ((m = /linear\.app\/[^/\s]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/.exec(s))) return { kind: "linear", id: m[1].toUpperCase(), url: s };
  if ((m = /^([A-Za-z][A-Za-z0-9]*-\d+)$/.exec(s))) return { kind: "linear", id: m[1].toUpperCase(), url: null };
  if ((m = /github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/.exec(s))) return { kind: "pr", id: `${m[1]}#${m[2]}`, url: s };
  if (/slack\.com\/archives\//.test(s)) return { kind: "slack", id: "", url: s };
  if (/^https?:\/\//.test(s)) return { kind: "link", id: "", url: s };
  return { kind: "note", id: s, url: null };
}
// how a reference reads in the first message
function refLine(r) {
  if (r.kind === "linear") return `- Linear issue: ${r.id}${r.title ? ` — ${r.title}` : ""}${r.url ? ` (${r.url})` : ""}`;
  if (r.kind === "pr") return `- Pull request: ${r.id} (${r.url})`;
  if (r.kind === "note") return `- Note: ${r.id}`;
  return `- ${REF_KINDS[r.kind][0]}: ${r.url}`;
}
const LINEAR_ISSUE = "identifier title url branchName state { name }";
// the Linear API with your key (it never leaves this machine but for api.linear.app)
async function linear(key, query, variables) {
  const r = await fetch("https://api.linear.app/graphql", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: key }, body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data;
}

const REPO = `cd "$1" 2>/dev/null || exit 3
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
echo "top=$(git rev-parse --show-toplevel)"
echo "common=$(git rev-parse --path-format=absolute --git-common-dir)"
echo "base=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)"
echo "home=$HOME"`;

const findNode = (node, id) => node?.id === id ? node : (node?.children ?? []).reduce((f, c) => f ?? findNode(c, id), null);
const shownView = () => findNode(layout(), "main")?.active ?? shared(VIEW) ?? "board";
const lastLine = (s) => ((s ?? "").split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "").slice(0, 200);
const mono = (size, color, text) => div().font_family(MONO).text_size(size).text_color(color).child(text);
const icon = (name, size, color) => svg(`mods/${MOD}/${name}.svg`).size(size).flex_none().text_color(color);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const base = (p) => String(p ?? "").replace(/\/+$/, "").split("/").pop();
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
// a short title for people: the first sentence or line, cut at a word under n characters
function shortTitle(text, n = 48) {
  const t = String(text ?? "").split(/[.!?](?:\s|$)|\n/)[0].replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1), sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:–-]+$/, "") + "…";
}
// what an agent says it's doing, from its terminal title, when that tells more than its program's name or a path
function agentTitle(a) {
  const t = cleanTitle(a?.title);
  return t && t !== a.program?.name && t.toLowerCase() !== a.program?.key && !/^[~/]/.test(t) && !t.includes("@") ? t : null;
}
// a terminal title without the spinner or status glyph agents put in front ("✳ Fix login" -> "Fix login")
const cleanTitle = (s) => String(s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const kv = (stdout) => Object.fromEntries(String(stdout ?? "").split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]).filter(([k]) => k));
// a branch name from a first message ("Ajustar o webhook do Apple Pay" -> "ajustar-o-webhook-do-apple-pay")
const branchFrom = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 6).join("-").slice(0, 40).replace(/-+$/, "");
// the folder a branch's worktree goes in, as Herdr's worktree mod names it (slashes as dashes)
const slugPath = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

function dur(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${Math.floor(h / 24)}d`;
}
const chipColor = (name) => CHIPS[[...String(name ?? "")].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0) % CHIPS.length];
function chip(name) {
  const [fg, bg] = chipColor(name);
  return div().flex_none().px(5).rounded(3).bg(bg).text_color(fg).font_family(SANS).text_size(11).child(name);
}

function parseGit(stdout) {
  const v = kv(stdout);
  if (!v.root) return null;
  const common = v.common ?? "";
  const ins = /(\d+) insertion/.exec(v.diff ?? ""), del = /(\d+) deletion/.exec(v.diff ?? "");
  const int = (x) => (x === undefined || x === "" ? null : Number(x));
  return {
    root: v.root,
    // the main checkout's name, also for a worktree (whose own folder is named after its branch)
    project: base(common.endsWith("/.git") ? common.slice(0, -5) : common.replace(/\.git$/, "")) || base(v.root),
    common,
    branch: v.branch || null,
    base: v.base ? v.base.replace(/^origin\//, "") : null,
    dirty: int(v.dirty) ?? 0,
    ahead: int(v.ahead),
    unpushed: int(v.unpushed),
    lines: v.diff ? { added: ins ? Number(ins[1]) : 0, removed: del ? Number(del[1]) : 0 } : null,
  };
}

// a pull request's checks in one word: FAIL, pending, pass, or null when it has none
function checks(rollup) {
  if (!Array.isArray(rollup) || !rollup.length) return null;
  const word = (c) => String(c.conclusion || c.state || c.status || "").toUpperCase();
  if (rollup.some((c) => ["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(word(c)))) return "FAIL";
  if (rollup.some((c) => ["", "PENDING", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "EXPECTED"].includes(word(c)))) return "pending";
  return "pass";
}

// what a blocked agent asks: the lowest line on its screen that ends a question
async function question(address) {
  const r = await exec("hc", ["read", address]);
  if (r.code !== 0) return "";
  const lines = r.stdout.split("\n").map((l) => l.replace(/^[\s│┃╭╰╮╯─━❯›>⎿⏺●•◆□☐✳*]+/u, "").trim()).reverse();
  const q = lines.find((l) => l.length >= 10 && /\p{L}/u.test(l) && /\?(\s|\)|$)/.test(l) && !l.startsWith("?") && !/shortcuts/i.test(l));
  return !q ? "" : q.length > 160 ? q.slice(0, 159) + "…" : q;
}

// ---- worktrees ----------------------------------------------------------------------------------------------------

// where a space is now: its first terminal's live folder, else where it was made
function place(s, paneList = panes()) {
  const tabs = new Set(s.tabs.map((t) => t.id));
  return paneList.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

// where Herdr's worktree mod and New agent put worktrees; only these are ever removed, never a main checkout
const WT_ROOT = () => `${home()}/.herdr/worktrees/`;
const isWorktree = (s) => !s.machine && [place(s), s.folder].some((d) => d?.startsWith(WT_ROOT()));
// the space showing a folder (its terminals are in it), if one is open
const showing = (folder, on) => spaces().find((x) => (x.machine ?? undefined) === (on ?? undefined)
  && [place(x), x.folder].some((d) => d === folder || d?.startsWith(folder + "/")));
// `git worktree list --porcelain`: [{path, branch, prunable}] (prunable: git still lists it, its folder is gone)
const parseTrees = (stdout) => String(stdout ?? "").split(/\n\n+/).map((block) => ({
  path: /^worktree (.+)$/m.exec(block)?.[1],
  branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null,
  prunable: /^prunable/m.test(block),
})).filter((w) => w.path);

// ⌘W: closes the tab, as Herdr does, but a worktree's last tab opens Herdr's own Remove worktree instead (it warns
// about uncommitted changes, closes the space and runs git worktree remove; the branch and its commits stay). On the
// board it does nothing: the tab it would close isn't the one you see.
function closeTab() {
  if (shownView() === "board") return;
  const s = spaces().find((x) => x.id === focused()?.space) ?? activeSpace();
  if (s && s.tabs.length <= 1 && isWorktree(s)) deleteWorktree(s.id);
  else run("tab.close", {});
}

// a sub-agent's status as the agents list shows it: an error is blocked; done is idle (its parent's done is the news)
function subStatus(t) {
  const s = t.status;
  return s === "error" || s === "blocked" ? "blocked" : s === "working" ? "working" : "idle";
}

// reads every space's stage: the one you picked, else (from before stages were per worktree) its first agent's old
// label, else Archived when all its tabs are put away, else the default
function stageReader(list) {
  const picked = shared(SPACE_STAGES) ?? {};
  const labels = new Map(terminals().map((t) => [t.address, t.labels?.[OLD_STAGE_LABEL]]));
  const known = (k) => STAGES.some(([x]) => x === k);
  return (s) => {
    if (known(picked[s.id])) return picked[s.id];
    const old = list.filter((a) => a.space === s.id).map((a) => labels.get(a.address)).find(known);
    if (old) return old;
    return s.tabs.length && s.tabs.every((t) => t.settled) ? "archived" : DEFAULT_STAGE;
  };
}

// moves a worktree to a stage; Archived puts its tabs away (they keep running and come back when they need you),
// leaving Archived brings them back
function setStage(spaceId, stage) {
  if ((shared(SPACE_STAGES) ?? {})[spaceId] !== stage) setShared(STAGE_AT, { ...(shared(STAGE_AT) ?? {}), [spaceId]: Date.now() });
  setShared(SPACE_STAGES, { ...(shared(SPACE_STAGES) ?? {}), [spaceId]: stage });
  for (const t of spaces().find((s) => s.id === spaceId)?.tabs ?? []) {
    if (stage === "archived" && !t.settled) run("tab.settle", { id: t.id });
    else if (stage !== "archived" && t.settled) run("tab.unsettle", { id: t.id });
  }
}

// every space as a worktree: its agents (the most urgent first, then the one used last), each with the sub-agents it
// started, all of them counted, and its stage
function worktrees() {
  const list = agents();
  const used = shared(USED) ?? {};
  const live = terminals().filter((t) => !t.state || t.state === "live");
  const byAddr = new Map(live.map((t) => [t.address, t]));
  const isAgent = new Set(list.map((a) => a.address));
  // each sub-agent goes under the agent with a pane at the top of its chain of parents
  const subs = new Map();
  for (const t of live) {
    if (!t.parent || isAgent.has(t.address)) continue;
    let p = t.parent;
    for (let hops = 0; p && !isAgent.has(p) && hops < 8; hops++) p = byAddr.get(p)?.parent;
    if (!isAgent.has(p)) continue;
    if (!subs.has(p)) subs.set(p, []);
    subs.get(p).push(t);
  }
  const stageOf = stageReader(list);
  const titles = shared(SPACE_TITLES) ?? {};
  return spaces().map((s) => {
    const tabs = new Map(s.tabs.map((t) => [t.id, t]));
    const ags = list.filter((a) => a.space === s.id)
      .map((a) => ({ a, tab: tabs.get(a.tab), subs: subs.get(a.address) ?? [], at: used[a.address] ?? tabs.get(a.tab)?.changed_at ?? 0 }))
      .sort((x, y) => RANK[y.a.status] - RANK[x.a.status] || y.at - x.at);
    return {
      key: s.id, space: s, agents: ags, subs: ags.flatMap((x) => x.subs), needs: ags.filter((x) => x.a.status === "blocked"),
      status: s.status, stage: stageOf(s),
      at: Math.max(0, ...ags.map((x) => x.at), ...s.tabs.map((t) => t.changed_at ?? 0)),
      // one you gave the space, else New agent's title, else what its agent says it's doing, else the branch
      name: s.named ? s.name : titles[s.id] || shortTitle(agentTitle(ags[0]?.a) ?? "") || s.branch || s.name,
    };
  });
}

// ---- scope, navigation --------------------------------------------------------------------------------------------

const activeSpace = () => spaces().find((s) => s.active) ?? null;
const allSpaces = () => shared(SCOPE) === "all";
// a space's repo (its git common dir, as the board last read it), or the space itself when it isn't in one
const repoKey = (id) => (shared(REPOS) ?? {})[id]?.common ?? `space:${id}`;
// whether the board and the sidebar show this space: the shown space's repo, or every one
const inScope = (spaceId) => allSpaces() || repoKey(spaceId) === repoKey(activeSpace()?.id);
const scopeName = () => (shared(REPOS) ?? {})[activeSpace()?.id]?.name ?? activeSpace()?.name ?? "this repo";

// the Asks panel at the board's right (the layout's hidden "asks" block): ⌘⇧A, R on the board, the sidebar's Asks row
function toggleAsks(show) {
  const on = findNode(layout(), "asks")?.hidden === false;
  if (show ?? !on) run("layout.show", { id: "asks" }); else run("layout.hide", { id: "asks" });
}
// the questions waiting in a worktree, its agents' and their sub-agents', newest first
function asksIn(t) {
  const mine = new Set([...t.agents.map((x) => x.a.address), ...t.subs.map((s) => s.address)]);
  return waitingAsks().filter((a) => a.space === t.key || mine.has(a.address));
}
const askColor = (kind) => ({ APPROVAL: C.you, DECISION: C.accent, QUESTION: C.work }[kind] ?? C.dim);

// shows the board and marks a column there (null: just the board)
function openBoard(kind) {
  run("layout.select", { stack: "main", child: "board" });
  setShared(VIEW, "board");
  setShared(COL, { kind, at: Date.now() });
}

// how to start an agent on a first message: Herdr's task puts it last on the command line, as Claude Code takes it;
// OpenCode's first argument is a folder, so it gets --prompt
const launch = (a, task) => (!task ? { argv: a.run } : a.key === "opencode" ? { argv: [...a.run, "--prompt", task] } : { argv: a.run, task });

// New agent: a new worktree of the shown repo, or (space) one more agent in that worktree
const newAgent = (space) => openOverlay({ mod: MOD, props: { part: "new", space: space ?? null }, kind: "dialog", width: 540, height: 720 });

// the stage picker: at the pointer for a click, centered for a key
function openStagePicker(space, title, stage, pointer) {
  const deletable = Boolean(spaces().find((s) => s.id === space && isWorktree(s)));
  openOverlay({ mod: MOD, props: { part: "stage", space, title, stage, deletable }, kind: pointer ? "popup" : "dialog",
    width: 250, height: 44 + STAGES.length * 30 + (deletable ? 40 : 0) });
}

// Delete worktree: Herdr's own Remove worktree (it warns about uncommitted changes, closes the space and runs git
// worktree remove; the branch and its commits stay). Only for worktrees under ~/.herdr/worktrees, never a main checkout.
function deleteWorktree(spaceId) {
  const s = spaces().find((x) => x.id === spaceId);
  if (s && isWorktree(s)) openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space: s.id, action: "remove" } });
}

// an agent's terminal, with the keyboard
function goToAgent(address) {
  if (shared(FOCUS)) { run("layout.hide", { id: "focus-term" }); setShared(FOCUS, false); }
  run("agent.focus", { terminal: address });
  run("pane.focus", { terminal: address });
  run("layout.select", { stack: "main", child: "work" });
  setShared(LEFT, Date.now());
  setShared(VIEW, "work");
}

// a worktree: the agent that needs you, else the one used last; a worktree without agents shows its terminals
function goToWorktree(w) {
  if (w.agents[0]) { goToAgent(w.agents[0].a.address); return; }
  if (shared(FOCUS)) { run("layout.hide", { id: "focus-term" }); setShared(FOCUS, false); }
  run("space.select", { id: w.key });
  run("layout.select", { stack: "main", child: "work" });
  setShared(LEFT, Date.now());
  setShared(VIEW, "work");
}

// This repo / All, for the board and the sidebar
function scopeSwitch(id, wide) {
  const all = allSpaces();
  const repo = (shared(REPOS) ?? {})[activeSpace()?.id]?.name ?? activeSpace()?.name;
  const seg = (key, on, label, value) => h_flex().id(`${id}-${key}`).h(wide ? 28 : 24).px(wide ? 8 : 9).gap(6).items_center()
    .when(wide, (el) => el.flex_1().min_w(0).justify_center()).flex_none().rounded(5).cursor_pointer()
    .bg(on ? C.raised : "#00000000").hover((st) => st.bg(on ? C.raised : C.hover))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click(() => setShared(SCOPE, value))
    .child(div().min_w(0).truncate().font_family(SANS).text_size(12).text_color(on ? C.text : C.muted).child(label));
  return h_flex().id(id).flex_none().p(2).gap(2).rounded(7).border(1).border_color(C.line2).bg(C.main)
    .when(wide, (el) => el.w_full())
    .child(seg("repo", !all, repo ? `Repo: ${repo}` : "This repo", "repo"))
    .child(seg("all", all, "All", "all"));
}

// "2 elsewhere": blocked agents the repo filter hides, a click shows every repo
function elsewhere(id, n, size) {
  return h_flex().id(id).flex_none().gap(5).px(7).py(2).rounded(5).items_center().cursor_pointer()
    .bg(C.youBg).border(1).border_color(C.youLine).hover((st) => st.opacity(0.85))
    .on_click((_e, cx) => { cx.stop_propagation(); setShared(SCOPE, "all"); })
    .child(div().w(6).h(6).rounded(3).bg(C.you))
    .child(div().font_family(SANS).text_size(size).text_color(C.you).child(`${n} elsewhere`));
}

// what an agent itself is doing, as an icon: working, waiting for you, done (finished while you weren't looking), idle
function statusIcon(status, size) {
  const dot = (color, filled) => div().w(size).h(size).flex_none().rounded(size / 2).border(1).border_color(color).bg(filled ? color : "#00000000");
  return status === "working" ? icon("spinner", size + 3, C.work).spin(900)
    : status === "blocked" ? dot(C.you, true).loop("opacity", { from: 0.35, to: 1, period: 1200 })
    : status === "done" ? dot(C.land, true) : dot(C.dim, false);
}
const statusColor = (status) => ({ blocked: C.you, working: C.work, done: C.land }[status] ?? C.line2);
// how many of each status, the most urgent first: [[status, n], ...] without the zeros
const tally = (list) => ["blocked", "working", "done", "idle"].map((k) => [k, list.filter((s) => s === k).length]).filter(([, n]) => n);

export default class Board extends View {
  init(_props, cx) {
    this.part = _props?.part ?? props()?.part;
    this.now = Date.now();
    if (this.part === "new") { this.initNew(cx); return; }
    if (this.part === "stage") { this.initStage(cx); return; }
    if (this.part === "cleanup") { this.initCleanup(cx); return; }
    if (this.part === "asks") {
      this.asksUi = new AsksPanel({
        inScope: (id) => (id ? inScope(id) : allSpaces()), scopeName, all: allSpaces,
        setAll: (on) => setShared(SCOPE, on ? "all" : "repo"), open: (ask) => goToAgent(ask.address), close: () => toggleAsks(false),
      });
      this.asksUi.init(cx);
      return;
    }
    if (this.part !== "board") { // the bars only draw what the board shares, and the clock
      cx.timer.every(30000, (cx) => { this.now = Date.now(); cx.notify(); });
      // board-herdr.open-board|open-<stage>|new-agent|go-<address>|toggle: what the sidebar's rows do, for keys.json
      // (only this copy takes them, so New agent opens once)
      // Asks: the sidebar is always shown, so its copy finds the questions, before the panel is ever opened
      if (this.part === "nav") {
        this.engine = new Engine();
        const config = (cx) => cx.spawn(async (cx) => { this.engine.config = await loadConfig(); cx.notify(); });
        config(cx);
        cx.timer.every(30000, config);
        cx.timer.every(1000, (cx) => this.engine.tick(cx));
      }
      if (this.part === "nav") cx.spawn(async (cx) => {
        for (;;) {
          const c = String(await nextCommand()).replace(/^board-herdr\./, "");
          const k = c === "open-board" ? null : c.startsWith("open-") && STAGES.some(([s]) => s === c.slice(5)) ? c.slice(5) : undefined;
          if (k !== undefined) openBoard(k);
          else if (c === "new-agent") newAgent();
          else if (c === "close") closeTab();
          else if (c === "asks") toggleAsks(); // ⌘⇧A
          else if (c === "asks-open") { openBoard(null); toggleAsks(true); } // a question's toast
          else if (c === "asks-recheck") this.engine.recheck(); // read every agent's last turn again
          else if (c.startsWith("go-")) goToAgent(c.slice(3)); // board-herdr.go-t7: what a click on an agent does
          // ⌘E from an agent: the board (which takes the keyboard); from the board, the board's copy goes back
          else if (c === "toggle" && shownView() !== "board") openBoard(shared(COL)?.kind ?? null);
          cx.notify();
        }
      });
      return;
    }
    this.h = cx.focus_handle();
    this.git = {}; // folder -> parseGit() or null (not a repo)
    this.prs = {}; // "common|branch" -> {number, url, state, checks, merge, draft} or null (none)
    this.prAt = {}; // "common|branch" -> when it was last asked
    this.offGithub = new Set(); // repos (git common dir) whose remotes aren't on GitHub
    this.merged = []; // closedAt (ms) of my pull requests merged in the last 7 days
    this.problem = null; // the last git or gh error
    this.reading = false;
    this.lastRead = 0;
    this.sig = null; // the agents' statuses and the spaces' folders, to read again when one changes
    this.asks = {}; // address -> the question on its screen
    this.asking = false;
    this.filter = null; // a project, or null for all
    this.sel = null; // the selected worktree (space id)
    this.focus = false;
    this.peek = false; // Space: the selected worktree's agent beside the board, following the selection
    this.help = false; // ?: every key
    this.scroll = STAGES.map(() => ScrollHandle.new()); // each column's list, to keep the selected card in view
    this.hscroll = ScrollHandle.new(); // the columns, sideways, to keep the selected column in view
    this.folded = new Set(["archived"]); // columns drawn as just their header
    this.refocusAt = shared(REFOCUS) ?? 0;
    this.query = ""; // /: cards whose name, branch, project, agents or question have it
    this.searching = false;
    this.search = InputState.new({ placeholder: "Search worktrees" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); cx.notify(); });
    this.search.on("submit", (_e, cx) => { this.h.focus(); this.step(cx, 0, 0); });
    this.search.on("focus", (_e, cx) => { this.searching = true; cx.notify(); });
    this.search.on("blur", (_e, cx) => { this.searching = false; cx.notify(); });
    this.confirm = null; // {key, do}: Merge PR or Ship PR, asked on the card
    this.acts = {}; // space id -> {do, state, line}
    this.sweeping = new Set(); // Done worktrees being removed
    this.orphans = []; // worktrees under ~/.herdr/worktrees no space shows: {common, main, repo, path, branch, prunable}
    this.answerer = new Answerer(); // a card's option, answered with hc
    this.answerer.loadConfig(cx);
    // Focus starts off; the layout remembers a shown focus-term across reloads, so close it to match
    run("layout.hide", { id: "focus-term" });
    if (shared(FOCUS)) setShared(FOCUS, false);
    if (shared(PEEK)) setShared(PEEK, false);
    this.refresh(cx, true);
    this.readWeek(cx);
    // board-herdr.<command> from keys.json or `herdr-app do`: works while the board doesn't have the keyboard
    cx.spawn(async (cx) => { for (;;) { this.command(String(await nextCommand()).replace(/^board-herdr\./, ""), cx); cx.notify(); } });
    cx.timer.every(1000, (cx) => this.tick(cx));
    cx.timer.every(ASK_MS, (cx) => this.readAsks(cx));
    cx.timer.every(WEEK_MS, (cx) => this.readWeek(cx));
    cx.timer.every(60000, (cx) => this.sweepDone(cx));
    cx.timer.every(30000, (cx) => { this.now = Date.now(); cx.notify(); });
  }

  // ---- data -------------------------------------------------------------------------------------------------

  // every worktree as a card, with what git and gh said about its folder
  get cards() {
    const paneList = panes();
    return worktrees().map((w) => {
      const cwd = place(w.space, paneList);
      const g = cwd ? this.git[cwd] : null;
      const pr = g?.branch ? this.prs[`${g.common}|${g.branch}`] ?? null : null;
      return { ...w, cwd, git: g, pr, machine: w.space.machine ?? null, project: g?.project ?? w.space.name,
        branch: g?.branch ?? w.space.branch ?? null };
    });
  }

  tick(cx) {
    const sig = agents().map((a) => `${a.address}:${a.status}`).join(" ") + "|" + spaces().map((s) => `${s.id}:${place(s)}`).join(" ");
    if (sig !== this.sig) {
      this.sig = sig;
      this.refresh(cx, false);
    } else if (!this.reading && Date.now() - this.lastRead >= GIT_MS) this.refresh(cx, false);
  }

  // git in every worktree's folder, then gh for the branches whose pull request is due
  refresh(cx, force) {
    if (this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const paneList = panes();
        const where = new Map();
        for (const s of spaces()) { const d = place(s, paneList); if (d) where.set(d, s.machine ?? null); }
        let problem = null;
        for (const [dir, on] of where) {
          try {
            const r = await exec("sh", ["-c", GIT, "sh", dir], { on });
            this.git[dir] = r.code === 0 ? parseGit(r.stdout) : null;
          } catch (e) { problem = `git: ${String(e.message ?? e)}`; }
        }
        this.share();
        cx.notify();
        // the worktrees each repo here has under ~/.herdr/worktrees that no space shows: what a closed space left
        const orphans = [];
        for (const common of new Set(Object.values(this.git).filter((g) => g?.common.endsWith("/.git")).map((g) => g.common))) {
          const main = common.slice(0, -5);
          try {
            const r = await exec("git", ["worktree", "list", "--porcelain"], { cwd: main });
            for (const w of parseTrees(r.stdout)) {
              if (w.path.startsWith(WT_ROOT()) && !showing(w.path)) orphans.push({ common, main, repo: base(main), path: w.path, branch: w.branch, prunable: w.prunable });
            }
          } catch { /* a repo on another machine, or gone */ }
        }
        this.orphans = orphans;
        // one pull request lookup per branch that isn't the default one
        const branches = new Map();
        for (const [dir, on] of where) {
          const g = this.git[dir];
          if (g?.branch && g.branch !== g.base) branches.set(`${g.common}|${g.branch}`, { g, on });
        }
        for (const [key, { g, on }] of branches) {
          if (!force && this.prs[key] !== undefined && Date.now() - (this.prAt[key] ?? 0) < GH_MS) continue;
          this.prAt[key] = Date.now();
          try {
            const r = await exec("gh", ["pr", "view", g.branch, "--json", "number,url,state,isDraft,mergeStateStatus,statusCheckRollup"], { cwd: g.root, on });
            if (r.code === 0) {
              const p = JSON.parse(r.stdout);
              this.prs[key] = { number: p.number, url: p.url, state: p.state, draft: p.isDraft, merge: p.mergeStateStatus, checks: checks(p.statusCheckRollup) };
            } else if (/no pull requests found/i.test(r.stderr ?? "")) this.prs[key] = null;
            // a repo whose remotes aren't on GitHub: no pull requests to look for, and nothing to ship
            else if (/known GitHub host|no git remotes/i.test(r.stderr ?? "")) { this.prs[key] = null; this.offGithub.add(g.common); }
            else problem = `gh: ${lastLine(r.stderr)}`;
          } catch (e) { problem = `gh: ${String(e.message ?? e)}`; }
        }
        this.problem = problem;
      } finally {
        this.reading = false;
        this.lastRead = Date.now();
        this.now = Date.now();
      }
      this.share();
      cx.notify();
      this.readAsks(cx);
    });
  }

  // my pull requests merged in the last 7 days, for LANDED TODAY and its bars
  readWeek(cx) {
    cx.spawn(async (cx) => {
      const since = new Date(Date.now() - 6 * 86400000);
      const day = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(since.getDate()).padStart(2, "0")}`;
      try {
        const r = await exec("gh", ["search", "prs", "--author=@me", `--merged-at=>=${day}`, "--json", "closedAt", "--limit", "500"]);
        if (r.code === 0) { this.merged = JSON.parse(r.stdout).map((p) => Date.parse(p.closedAt)); cx.notify(); }
      } catch { /* no gh: the strip shows zeros */ }
    });
  }

  // what the top bar and the sidebar need from git: the count, and each space's repo; written only when it changed
  share() {
    const cards = this.cards;
    const counts = { tasks: cards.filter((t) => t.stage !== "archived").length, needs: cards.reduce((n, t) => n + t.needs.length, 0),
      when: new Date().toTimeString().slice(0, 5), problem: this.problem };
    if (JSON.stringify(counts) !== JSON.stringify(shared(COUNTS) ?? {})) setShared(COUNTS, counts);
    const repos = Object.fromEntries(cards.filter((t) => t.git).map((t) => [t.key, { common: t.git.common, name: t.git.project }]));
    if (JSON.stringify(repos) !== JSON.stringify(shared(REPOS) ?? {})) setShared(REPOS, repos);
  }

  readAsks(cx) {
    if (this.asking) return;
    const blocked = agents().filter((a) => a.status === "blocked");
    if (!blocked.length) return;
    this.asking = true;
    cx.spawn(async (cx) => {
      let changed = false;
      for (const a of blocked) {
        let q = "";
        try { q = await question(a.address); } catch { /* no screen */ }
        if (q !== (this.asks[a.address] ?? "")) { this.asks[a.address] = q; changed = true; }
      }
      this.asking = false;
      if (changed) cx.notify();
    });
  }

  // ---- actions ----------------------------------------------------------------------------------------------

  // Merge PR (gh pr merge, with the method the repo allows) or Ship PR (push the branch and open a pull request)
  act(cx, task, what) {
    const a = this.acts[task.key];
    if (a && a.state === "running") return;
    this.confirm = null;
    const rec = { do: what, state: "running", line: "" };
    this.acts[task.key] = rec;
    cx.notify();
    const g = task.git, on = task.machine;
    cx.spawn(async (cx) => {
      try {
        let r;
        if (what === "land") {
          const allowed = await exec("gh", ["repo", "view", "--json", "squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed"], { cwd: g.root, on });
          const m = allowed.code === 0 ? JSON.parse(allowed.stdout) : {};
          const how = m.squashMergeAllowed ? "--squash" : m.mergeCommitAllowed ? "--merge" : m.rebaseMergeAllowed ? "--rebase" : "--squash";
          r = await exec("gh", ["pr", "merge", String(task.pr.number), how], { cwd: g.root, on, timeout: 120000 });
        } else if (what === "ship") {
          r = await exec("sh", ["-c", 'git push -u origin HEAD && gh pr create --fill --head "$(git branch --show-current)"'], { cwd: task.cwd, on, timeout: 120000 });
        }
        rec.state = r.code === 0 ? "done" : "failed";
        rec.line = r.code === 0 ? "done" : lastLine(r.stderr) || lastLine(r.stdout) || `exit ${r.code}`;
      } catch (e) {
        rec.state = "failed"; rec.line = String(e.message ?? e);
      }
      if (rec.state === "done") delete this.acts[task.key]; // a failed one stays on its card
      if (task.git) delete this.prAt[`${task.git.common}|${task.git.branch}`];
      this.refresh(cx, true);
      this.readWeek(cx);
      cx.notify();
    });
  }

  // when a card in Done goes (null: never, it isn't a worktree here or has no time; 0: due)
  doneLeft(t) {
    const at = (shared(STAGE_AT) ?? {})[t.key];
    return t.stage !== "done" || !isWorktree(t.space) || !at ? null : Math.max(0, at + DONE_MS - Date.now());
  }

  // worktrees 3 days in Done: removed (space closed, git worktree remove; the branch and its commits stay), unless
  // they have uncommitted changes, checked again just before
  sweepDone(cx) {
    for (const t of this.cards) {
      if (this.doneLeft(t) !== 0 || this.sweeping.has(t.key) || t.git?.dirty) continue;
      const root = t.git?.root, main = t.git?.common?.endsWith("/.git") ? t.git.common.slice(0, -5) : null;
      if (!root || !main || root === main || !root.startsWith(WT_ROOT())) continue;
      this.sweeping.add(t.key);
      cx.spawn(async (cx) => {
        try {
          const st = await exec("git", ["--no-optional-locks", "status", "--porcelain"], { cwd: root });
          if (st.code !== 0 || st.stdout.trim()) return;
          run("space.close", { id: t.key, confirmed: true });
          const r = await exec("git", ["worktree", "remove", root], { cwd: main, timeout: 600000 });
          notify(r.code === 0
            ? { title: `Removed ${t.name}`, body: `3 days in Done; the branch ${t.branch ?? ""} stays`, level: "success" }
            : { title: `Couldn't remove ${t.name}`, body: lastLine(r.stderr) || "git worktree remove failed", level: "error" });
        } catch (e) {
          notify({ title: `Couldn't remove ${t.name}`, body: String(e.message ?? e), level: "error" });
        } finally {
          this.sweeping.delete(t.key);
          cx.notify();
        }
      });
    }
  }

  // A: to Archived (its tabs put away; they keep running and come back when they need you), or back out of it
  archive(task) {
    setStage(task.key, task.stage === "archived" ? DEFAULT_STAGE : "archived");
  }

  ask(cx, task, what) {
    if (CONFIRM.has(what)) { this.confirm = { key: task.key, do: what }; cx.notify(); } else this.act(cx, task, what);
  }

  // ⇧← / ⇧→: the stage before or after
  moveStage(cx, t, by) {
    if (!t) return;
    const i = STAGES.findIndex(([k]) => k === t.stage);
    const n = Math.max(0, Math.min(STAGES.length - 1, i + by));
    if (n !== i) { this.folded.delete(STAGES[n][0]); setStage(t.key, STAGES[n][0]); }
    cx.notify();
  }

  // a nudge, never a move: an open pull request on a card still in Todo or In progress, or a merged one not archived
  nudge(t) {
    if (t.pr?.state === "OPEN" && (t.stage === "todo" || t.stage === "in_progress")) return "in_review";
    if (t.pr?.state === "MERGED" && t.stage !== "archived") return "archived";
    return null;
  }

  // ---- moving around ------------------------------------------------------------------------------------------

  // the cards the board shows, column by column: the repo, project and search filters (and with only, Focus's: just
  // the worktrees where an agent waits for you)
  columns(only) {
    const q = this.query.trim().toLowerCase();
    const hit = (t) => !q || [t.name, t.branch, t.project, t.space.name, ...t.agents.map((x) => cleanTitle(x.a.title)),
      ...t.needs.map((x) => this.asks[x.a.address])].some((v) => String(v ?? "").toLowerCase().includes(q));
    const shown = this.cards.filter((t) => inScope(t.key) && (!this.filter || t.project === this.filter) && hit(t));
    return STAGES.map(([k]) => shown.filter((t) => t.stage === k && (!only || !this.focus || t.needs.length)));
  }

  // what the keys move through: folded columns count as empty
  navCols() { return this.columns(true).map((l, i) => (this.folded.has(STAGES[i][0]) ? [] : l)); }

  visible() { return this.navCols().flat(); }

  pick(cx, key) {
    this.sel = key;
    const t = this.cards.find((x) => x.key === key);
    if (this.focus && t?.needs.length) this.answerIn(t.needs[0].a.address);
    else if (this.peek && t?.agents[0]) this.show(cx, t.agents[0].a.address);
    cx.notify();
  }

  // the board takes the keyboard, just after this draw or command (focus can't move while drawing, nor from a task)
  grab(cx) {
    cx.timer.after(30, () => this.h.focus());
  }

  // an agent in the focus-term block, the keyboard staying on the board
  show(cx, address) {
    run("agent.focus", { terminal: address });
    this.grab(cx);
  }

  // shows the agent in the focus-term block and gives that block the keyboard (pane.focus prefers a visible layout
  // terminal block showing the address), so typing answers it
  answerIn(address) {
    run("agent.focus", { terminal: address });
    run("pane.focus", { terminal: address });
  }

  // ↑↓ within the column (dr), ←→ to the nearest column with cards (dc), keeping the row as near as it can;
  // with nothing selected, the first card (of the column the sidebar marked, else the first one with cards)
  step(cx, dc, dr) {
    const cols = this.navCols();
    let c = cols.findIndex((l) => l.some((t) => t.key === this.sel));
    if (c < 0) {
      const marked = STAGES.findIndex(([k]) => k === this.col);
      c = marked >= 0 && cols[marked].length ? marked : cols.findIndex((l) => l.length);
      if (c >= 0) this.select(cx, cols, c, 0);
      return;
    }
    const r = cols[c].findIndex((t) => t.key === this.sel);
    if (dr) { this.select(cx, cols, c, Math.max(0, Math.min(cols[c].length - 1, r + dr))); return; }
    for (let n = c + dc; dc && n >= 0 && n < cols.length; n += dc) {
      if (cols[n].length) { this.select(cx, cols, n, Math.min(r, cols[n].length - 1)); return; }
    }
  }

  select(cx, cols, c, r) {
    this.hscroll.scroll_to_item(c);
    this.scroll[c].scroll_to_item(r);
    this.pick(cx, cols[c][r].key);
  }

  // 1-8: that column's first card (unfolding it)
  toColumn(cx, c) {
    if (!STAGES[c]) return;
    this.folded.delete(STAGES[c][0]);
    const cols = this.navCols();
    if (cols[c]?.length) this.select(cx, cols, c, 0);
    cx.notify();
  }

  goTo(cx, t, address) {
    if (!t) return;
    if (this.focus) this.setFocus(cx, false);
    if (this.peek) this.setPeek(cx, false);
    if (address) goToAgent(address); else goToWorktree(t);
  }

  setFocus(cx, on, task) {
    this.focus = on;
    if (on) {
      this.peek = false; // Focus shows the same block, with the keyboard
      setShared(PEEK, false);
      const needs = this.visible();
      const t = task ?? needs.find((x) => x.key === this.sel) ?? needs[0];
      run("layout.show", { id: "focus-term" });
      if (t?.needs.length) {
        this.sel = t.key;
        this.answerIn(t.needs[0].a.address);
      }
    } else {
      run("layout.hide", { id: "focus-term" });
      this.grab(cx);
    }
    setShared(FOCUS, on);
    cx.notify();
  }

  // Space: the selected worktree's agent beside the board, following the selection; the keyboard stays here
  setPeek(cx, on) {
    if (this.focus) return;
    this.peek = on;
    setShared(PEEK, on);
    const t = this.cards.find((x) => x.key === this.sel);
    if (on) {
      run("layout.show", { id: "focus-term" });
      if (t?.agents[0]) this.show(cx, t.agents[0].a.address);
    } else run("layout.hide", { id: "focus-term" });
    cx.notify();
  }

  // what Merge (M) does: merge the card's pull request, or ship one
  landMove(t) { return t ? this.moves(t)[0] ?? null : null; }

  // P: the next project chip (all, then each project shown)
  nextProject(cx) {
    const list = [null, ...[...new Set(this.cards.filter((t) => inScope(t.key)).map((t) => t.project))].sort()];
    this.filter = list[(list.indexOf(this.filter) + 1) % list.length];
    cx.notify();
  }

  // ⌘E on the board: back out of Focus or the search, else to the agent you came from (or the selected worktree)
  toggle(cx) {
    if (this.focus) { this.setFocus(cx, false); return; }
    if (this.searching) { this.grab(cx); return; }
    const f = focused()?.terminal;
    const t = this.cards.find((x) => x.key === this.sel);
    if (this.peek) this.setPeek(cx, false);
    if (f && agents().some((a) => a.address === f)) goToAgent(f);
    else if (t) goToWorktree(t);
  }

  command(c, cx) {
    const t = this.cards.find((x) => x.key === this.sel);
    if (c === "focus") this.setFocus(cx, !this.focus);
    else if (c === "unfocus") { if (this.focus) this.setFocus(cx, false); }
    else if (c === "toggle") this.toggle(cx);
    else if (c === "next") this.step(cx, 0, 1);
    else if (c === "prev") this.step(cx, 0, -1);
    else if (c === "left") this.step(cx, -1, 0);
    else if (c === "right") this.step(cx, 1, 0);
    else if (c === "peek") this.setPeek(cx, !this.peek);
    else if (c === "go" && t) this.goTo(cx, t);
    else if (c === "archive" && t) this.archive(t);
    else if (c === "delete" && t) deleteWorktree(t.key);
    else if (c === "stage" && t) openStagePicker(t.key, t.name, t.stage, false);
    else if (c === "add-agent" && t) newAgent(t.key);
    else if (c === "scope") setShared(SCOPE, allSpaces() ? "repo" : "all");
    else if (c === "stage-next") this.moveStage(cx, t, 1);
    else if (c === "stage-prev") this.moveStage(cx, t, -1);
    else if (c === "merge" && this.landMove(t)) this.ask(cx, t, this.landMove(t));
    else if (c === "yes" && this.confirm) this.confirmYes(cx);
    else if (c === "no") this.confirm = null;
  }

  confirmYes(cx) {
    const ct = this.cards.find((x) => x.key === this.confirm.key);
    if (ct) this.act(cx, ct, this.confirm.do);
  }

  // Esc backs out one step: the key list, the search, the peek, Focus, the marked column, the selection
  back(cx) {
    if (this.help) this.help = false;
    else if (this.query) { this.search.set_value(""); this.query = ""; }
    else if (this.peek) this.setPeek(cx, false);
    else if (this.focus) this.setFocus(cx, false);
    else if (this.col) setShared(COL, { kind: null, at: Date.now() });
    else this.sel = null;
    cx.notify();
  }

  key(e, cx) {
    const k = e.key, m = e.modifiers;
    // typing in the search: only Esc (clear and leave) and ↓ / ⏎ (to the cards) are the board's
    if (this.searching) {
      if (k === "escape") { this.search.set_value(""); this.query = ""; this.h.focus(); }
      else if (k === "down") { this.h.focus(); this.step(cx, 0, 0); }
      else return;
      cx.stop_propagation();
      cx.notify();
      return;
    }
    if (m.platform || m.control || m.alt) return; // ⌘ and ctrl keys stay the app's
    const t = this.cards.find((x) => x.key === this.sel);
    if (this.help && k !== "?" && !(k === "/" && m.shift)) { this.help = false; cx.notify(); if (k === "escape") { cx.stop_propagation(); return; } }
    if (this.confirm && (k === "y" || k === "enter")) { this.confirmYes(cx); cx.stop_propagation(); return; }
    if (this.confirm && (k === "n" || k === "escape")) { this.confirm = null; cx.notify(); cx.stop_propagation(); return; }
    if (m.shift && (k === "l" || k === "L" || k === "right")) this.moveStage(cx, t, 1);
    else if (m.shift && (k === "h" || k === "H" || k === "left")) this.moveStage(cx, t, -1);
    else if (m.shift && (k === "n" || k === "N")) { if (t) newAgent(t.key); }
    else if (k === "j" || k === "down") this.step(cx, 0, 1);
    else if (k === "k" || k === "up") this.step(cx, 0, -1);
    else if (k === "h" || k === "left") this.step(cx, -1, 0);
    else if (k === "l" || k === "right") this.step(cx, 1, 0);
    else if (/^[1-9]$/.test(k)) this.toColumn(cx, Number(k) - 1);
    else if ((k === "backspace" || k === "delete") && t) deleteWorktree(t.key);
    else if (k === "s" && t) openStagePicker(t.key, t.name, t.stage, false);
    else if (k === "enter" && t) this.goTo(cx, t);
    else if (k === "space") this.setPeek(cx, !this.peek);
    else if (k === "f") this.setFocus(cx, !this.focus, t?.needs.length ? t : undefined);
    else if (k === "escape") this.back(cx);
    else if (k === "?" || (k === "/" && m.shift)) { this.help = !this.help; cx.notify(); }
    else if (k === "/") this.search.focus();
    else if (k === "a" && t) { this.archive(t); cx.notify(); }
    else if (k === "r") toggleAsks();
    else if (k === "y" && t && this.recommended(t)) { const [q, o] = this.recommended(t); this.answerer.answer(q, o, cx); }
    else if (k === "m" && this.landMove(t)) this.ask(cx, t, this.landMove(t));
    else if (k === "o" && t?.pr?.url) cx.spawn(async () => { await exec("open", [t.pr.url]); });
    else if (k === "n" || k === "c") newAgent();
    else if (k === "v") setShared(SCOPE, allSpaces() ? "repo" : "all");
    else if (k === "p") this.nextProject(cx);
    else return;
    cx.stop_propagation();
  }

  // ?: every key, over the board's corner
  keyList() {
    const KEYS = [
      ["↑ ↓  j k", "move within a column"], ["← →  h l", "move across columns"], ["1 – 8", "first card of a stage"],
      ["S", "change the stage"], ["⇧← ⇧→", "stage before / after"], ["A", "archive / unarchive"], ["⌫", "delete the worktree"],
      ["⏎", "open the worktree's agent"], ["Space", "peek at it"], ["F", "Focus: answer what needs you"],
      ["Y", "answer with the recommended option"], ["R  ⌘⇧A", "Asks: every question, to answer"],
      ["N  C", "new agent, in a new worktree"], ["⇧N", "one more agent in this worktree"],
      ["M", "merge or ship the PR"], ["O", "open the PR in the browser"],
      ["/", "search"], ["V", "this repo / all"], ["P", "next project"],
      ["Esc", "back out one step"], ["⌘E", "board ↔ the agent you were on"], ["⌘]  ⌘[", "next / previous agent"],
    ];
    return v_flex().id("keys").absolute().right(16).bottom(12).w(350).p(14).gap(5).rounded(10)
      .bg("#18181b").border(1).border_color(C.line2).shadow_lg()
      .child(h_flex().pb(6).items_center()
        .child(div().flex_1().font_family(SANS).text_size(14).font_weight(600).text_color(C.text).child("Keyboard"))
        .child(mono(10, C.dim, "any key closes")))
      .children(KEYS.map(([keys, what]) => h_flex().gap(10).items_center()
        .child(div().w(90).flex_none().child(mono(11, C.accent, keys)))
        .child(div().flex_1().font_family(SANS).text_size(12).text_color(C.soft).child(what))));
  }

  // ---- drawing ------------------------------------------------------------------------------------------------

  render(cx) {
    if (this.part === "top") return this.top();
    if (this.part === "bottom") return this.bottom();
    if (this.part === "nav") return this.nav();
    if (this.part === "asks") return this.asksUi.render(cx);
    if (this.part === "new") return this.newDialog();
    if (this.part === "stage") return this.stagePicker();
    if (this.part === "cleanup") return this.cleanupDialog();
    if (this.part === "board") return this.board(cx);
    return div().child(`board-herdr: unknown part ${this.part}`);
  }

  // the moves a card offers: merge its open pull request, or push its branch and open one
  moves(t) {
    if (t.pr?.state === "OPEN") return !t.pr.draft && !["DIRTY", "BLOCKED", "BEHIND"].includes(t.pr.merge) ? ["land"] : [];
    if (t.git?.branch && t.git.branch !== t.git.base && t.git.ahead > 0 && !this.offGithub?.has(t.git.common)) return ["ship"];
    return [];
  }

  glyph(a) {
    const p = a.program;
    if (p?.icon) return p.tint ? svg(p.icon).size(12).flex_none().text_color(C.muted) : image(p.icon).w(12).h(12).flex_none();
    return div().w(12).h(12).flex_none().rounded(3).bg(C.raised).flex().items_center().justify_center()
      .font_family(MONO).text_size(8).text_color(C.muted).child((a.app ?? "?").slice(0, 1).toUpperCase());
  }

  btn(id, label, kind, onClick) {
    const [bg, fg, border] = kind === "new" ? [C.accent, "#0f0f11", C.accent] : kind === "you" ? [C.you, "#1a1300", C.you] : kind === "land" ? [C.land, "#08180f", C.land]
      : kind === "on" ? [C.you, "#1a1300", C.you] : [C.raised, C.text, C.line2];
    return div().id(id).flex_none().px(9).py(3).rounded(5).bg(bg).border(1).border_color(border).text_color(fg)
      .font_family(SANS).text_size(12).cursor_pointer().hover((st) => st.opacity(0.85))
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }).child(label);
  }

  stat(label, value, color, extra, win) {
    return v_flex().flex_1().min_w(0).px(12).py(9).rounded(8).border(1)
      .bg(win ? C.landBg : C.card).border_color(win ? C.landLine : C.line)
      .child(div().truncate().child(mono(10, C.dim, label)))
      .child(div().font_family(SANS).text_size(22).text_color(color).child(value))
      .children(extra ? [div().truncate().child(extra)] : []);
  }

  week() {
    const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const today = day(new Date(this.now));
    const counts = Array(7).fill(0);
    for (const ts of this.merged) {
      const ago = Math.round((today - day(new Date(ts))) / 86400000);
      if (ago >= 0 && ago < 7) counts[6 - ago]++;
    }
    return counts;
  }

  // the card's stage, as a button that opens the stage picker
  stageButton(t) {
    const [, name, color] = stageInfo(t.stage);
    return h_flex().id(`stage-${t.key}`).flex_none().h(20).px(6).gap(5).items_center().rounded(4).border(1)
      .border_color(`${color}55`).bg(`${color}14`).cursor_pointer().hover((st) => st.bg(`${color}2a`))
      .on_click((_e, cx) => { cx.stop_propagation(); openStagePicker(t.key, t.name, t.stage, true); })
      .child(div().w(7).h(7).rounded(4).bg(color))
      .child(div().font_family(SANS).text_size(11).text_color(C.soft).child(name))
      .child(div().text_size(9).text_color(C.dim).child("▾"));
  }

  // "2 waiting · 1 working": a list of statuses, counted
  counted(list, size) {
    return tally(list).map(([s, n]) => h_flex().flex_none().gap(4).items_center()
      .child(statusIcon(s, size - 4)).child(mono(size, s === "blocked" ? C.you : s === "working" ? C.work : s === "done" ? C.land : C.muted, `${n} ${WORD[s]}`)));
  }

  // one agent on a card: a click goes to it
  agentLine(t, x) {
    const a = x.a, tab = x.tab, now = this.now;
    const age = a.status === "blocked" ? (tab?.changed_at ? dur(now - tab.changed_at) : "")
      : a.status === "working" ? (tab?.working_since ? dur(now - tab.working_since) : "") : "";
    const subs = tally(x.subs.map(subStatus));
    return h_flex().id(`cl-${a.address}`).w_full().h(24).px(4).gap(7).items_center().rounded(4).cursor_pointer()
      .hover((st) => st.bg(C.raised))
      .on_click((_e, cx) => { cx.stop_propagation(); this.goTo(cx, t, a.address); })
      .child(div().w(12).flex_none().flex().justify_center().child(statusIcon(a.status, 7)))
      .child(this.glyph(a))
      .child(div().flex_1().min_w(0).truncate().font_family(SANS).text_size(12)
        .text_color(a.status === "blocked" || a.status === "done" ? C.text : C.soft)
        .child(cleanTitle(a.title) || (tab?.named ? tab.name : "") || a.program?.name || a.address))
      // its sub-agents, the most urgent status first
      .when(x.subs.length > 0, (el) => el.child(h_flex().flex_none().gap(3).items_center().px(5).rounded(8).bg(C.raised)
        .child(mono(10, subs[0]?.[0] === "blocked" ? C.you : subs[0]?.[0] === "working" ? C.work : C.muted, `+${x.subs.length}`))))
      .child(mono(10, a.status === "blocked" ? C.you : C.dim, age));
  }

  card(t) {
    const g = t.git, pr = t.pr, sel = t.key === this.sel;
    const facts = [];
    if (g?.ahead) facts.push([plural(g.ahead, "commit"), C.muted]);
    if (g?.dirty) facts.push([`${g.dirty} uncommitted`, C.muted]);
    if (g?.lines && (g.lines.added || g.lines.removed)) facts.push([`+${g.lines.added}`, C.land], [`−${g.lines.removed}`, C.red]);
    if (g?.unpushed) facts.push([`${g.unpushed} unpushed`, C.you]);
    if (pr) facts.push([`PR #${pr.number}${pr.draft ? " draft" : pr.state !== "OPEN" ? ` ${pr.state.toLowerCase()}` : ""}`, C.accent]);
    if (pr?.checks === "pass") facts.push(["✓ checks", C.land]);
    else if (pr?.checks === "FAIL") facts.push(["✗ checks", C.red]);
    else if (pr?.checks === "pending") facts.push(["checks running", C.you]);
    if (pr?.state === "OPEN" && pr.merge === "DIRTY") facts.push(["conflicts", C.red]);
    else if (pr?.state === "OPEN" && pr.merge === "BLOCKED") facts.push(["merge blocked", C.you]);
    else if (pr?.state === "OPEN" && pr.merge === "BEHIND") facts.push(["behind base", C.you]);
    const a = this.acts[t.key];
    const confirming = this.confirm?.key === t.key;
    const blocked = t.needs[0];
    const ask = blocked && this.asks[blocked.a.address];
    const qs = asksIn(t), q = qs[0]; // Asks: the question, with its options
    const asking = blocked || q;
    const nudge = this.nudge(t);
    const openPr = pr ? (el) => el.child(this.btn(`pr-${t.key}`, `PR #${pr.number} ↗`, "plain", (cx) => cx.spawn(async () => { await exec("open", [pr.url]); }))) : (el) => el;
    const subs = t.subs.map(subStatus);
    const left = this.doneLeft(t);
    if (left !== null) facts.push(g?.dirty ? ["uncommitted: won't auto-delete", C.you] : [left ? `deletes in ${dur(left)}` : "deleting…", C.muted]);

    let actions = null;
    if (a && a.state !== "done") {
      actions = h_flex().gap(6).items_center()
        .child(a.state === "running" ? icon("spinner", 11, C.work).spin(900) : div().child(""))
        .child(div().flex_1().min_w(0).truncate().child(mono(11, a.state === "failed" ? C.red : C.muted,
          a.state === "running" ? `${LABEL[a.do] ?? a.do}…` : `${LABEL[a.do] ?? a.do} failed: ${a.line}`)))
        .when(a.state === "failed", (el) => el.child(this.btn(`ok-${t.key}`, "OK", "plain", (cx) => { delete this.acts[t.key]; cx.notify(); })));
    } else if (confirming) {
      const q = this.confirm.do === "land" ? `Merge PR #${pr?.number}?` : `Push ${g?.branch} and open a PR?`;
      actions = h_flex().flex_wrap().gap(6).items_center()
        .child(mono(11, C.text, q))
        .child(this.btn(`yes-${t.key}`, "Yes  y", "land", (cx) => this.act(cx, t, this.confirm.do)))
        .child(this.btn(`no-${t.key}`, "No  n", "plain", (cx) => { this.confirm = null; cx.notify(); }));
    } else if (asking) {
      const addr = blocked?.a.address ?? q.address;
      actions = h_flex().flex_wrap().gap(6)
        .when(!!blocked, (el) => el.child(this.btn(`answer-${t.key}`, "Answer", "you", (cx) => this.setFocus(cx, true, t))))
        .when(!!q, (el) => el.child(this.btn(`asks-${t.key}`, pickable(q) ? "Asks  R" : "Reply  R", blocked ? "plain" : "you", () => toggleAsks(true))))
        .child(this.btn(`go-${t.key}`, "Go to agent", "plain", (cx) => this.goTo(cx, t, addr)))
        .child(this.btn(`add-${t.key}`, "+ Agent", "plain", () => newAgent(t.key)));
    } else {
      const mv = t.stage === "archived" ? [] : this.moves(t);
      actions = h_flex().flex_wrap().gap(6)
        .children(mv.map((w) => this.btn(`${w}-${t.key}`, LABEL[w], "land", (cx) => this.ask(cx, t, w))))
        .when(true, openPr)
        .when(!!nudge, (el) => el.child(this.btn(`nudge-${t.key}`, `→ ${stageInfo(nudge)[1]}`, "plain", () => setStage(t.key, nudge))))
        .child(this.btn(`go-${t.key}`, t.agents.length ? "Open" : "Open terminal", "plain", (cx) => this.goTo(cx, t)))
        .when(t.stage !== "done", (el) => el.child(this.btn(`add-${t.key}`, "+ Agent", "plain", () => newAgent(t.key))))
        .when(t.stage === "done" && isWorktree(t.space), (el) => el.child(this.btn(`del-${t.key}`, "Delete now", "plain", () => deleteWorktree(t.key))));
    }

    // a flex row (stretching, unlike h_flex) so the status bar on the left runs the card's full height
    return div().id(`card-${t.key}`).w_full().flex_none().flex().flex_row().rounded(6).overflow_hidden()
      .bg(asking ? C.youCard : C.card).border(1).border_color(sel ? C.accent : C.line)
      .cursor_pointer().hover((s) => s.bg(C.hover))
      .when(this.focus && !asking, (el) => el.opacity(0.18))
      .on_click((_e, cx) => this.pick(cx, t.key))
      .child(div().w(3).flex_none().bg(statusColor(t.status)))
      .child(v_flex().flex_1().min_w(0).px(11).py(9).gap(5)
      .child(h_flex().w_full().gap(6).items_center()
        .child(chip(t.project))
        .child(div().flex_1().min_w(0).truncate().font_family(MONO).text_size(11).text_color(C.dim).child(t.branch ?? ""))
        .child(this.stageButton(t)))
      .child(div().font_family(SANS).text_size(14).font_weight(600).text_color(C.text).child(t.name))
      // the agents, counted by status, then each one
      .child(h_flex().w_full().flex_wrap().gap(10).items_center()
        .when(!t.agents.length, (el) => el.child(mono(11, C.dim, "no agents")))
        .children(this.counted(t.agents.map((x) => x.a.status), 11))
        .when(subs.length > 0, (el) => el.child(mono(11, C.dim, `· ${plural(subs.length, "sub-agent")}`)).children(this.counted(subs, 10))))
      .when(t.agents.length > 0, (el) => el.child(v_flex().w_full().gap(1)
        .children(t.agents.slice(0, CARD_AGENTS).map((x) => this.agentLine(t, x)))
        .when(t.agents.length > CARD_AGENTS, (el) => el.child(div().px(4).child(mono(10, C.dim, `+${t.agents.length - CARD_AGENTS} more`))))))
      .when(!!q, (el) => el.child(this.askBox(t, q, qs.length - 1, sel)))
      .when(!!blocked && !q, (el) => el.child(v_flex().px(8).py(6).rounded(4).bg(C.youAsk)
        .child(mono(10, C.you, "ASKS YOU"))
        .child(div().font_family(SANS).text_size(12).text_color(C.soft).child(ask || "the agent is waiting for you"))))
      .when(facts.length > 0, (el) => el.child(h_flex().flex_wrap().gap(10).children(facts.map(([s, c]) => mono(11, c, s)))))
      .children(actions ? [actions] : []));
  }

  // Y: the selected worktree's question and the option its agent recommends (Yes, for a permission), if it has one
  recommended(t) {
    const q = asksIn(t).find(pickable);
    const i = q ? q.recommended ?? (q.kind === "APPROVAL" ? 0 : null) : null;
    return i != null && q.options[i] ? [q, q.options[i]] : null;
  }

  // a worktree's question (Asks) on its card: the kind, the question and each option to click; the recommended one is
  // also Y on the selected card. Several questions at once, or one to type, are answered in the panel (R).
  askBox(t, q, more, sel) {
    const sending = q.state === "sending", failed = q.state === "failed";
    const many = questionsOf(q).length;
    const rec = (i) => q.recommended === i || (q.recommended == null && q.kind === "APPROVAL" && i === 0);
    return v_flex().w_full().px(8).py(6).gap(5).rounded(4).bg(C.youAsk)
      .child(h_flex().w_full().gap(6).items_center()
        .child(mono(10, askColor(q.kind), q.kind))
        .child(div().flex_1().min_w(0).truncate().child(mono(10, C.dim, q.agent ?? "")))
        .when(sending, (el) => el.child(icon("spinner", 10, C.work).spin(900)).child(mono(10, C.work, "sending")))
        .when(more > 0, (el) => el.child(mono(10, C.you, `+${more} more`))))
      .child(div().font_family(SANS).text_size(12).text_color(C.soft)
        .child(q.question || (q.enriched ? "the agent is waiting for you" : "reading the question…")))
      .when(pickable(q) && many < 2, (el) => el.child(v_flex().w_full().gap(3).children(q.options.slice(0, 6).map((o, i) =>
        h_flex().id(`ao-${t.key}-${o.n}`).w_full().h(24).px(6).gap(7).items_center().rounded(4)
          .border(1).border_color(rec(i) ? C.accentDim : C.line2).bg(C.card)
          .cursor_pointer().hover((s) => s.bg(C.hover).border_color(C.accent))
          .on_click((_e, cx) => { cx.stop_propagation(); this.answerer.answer(q, o, cx); })
          .child(mono(10, C.muted, String(o.n)))
          .child(div().flex_1().min_w(0).truncate().font_family(SANS).text_size(12).text_color(C.text).tooltip(o.label).child(o.label.replace(/\s*\(recommended\)\s*$/i, "")))
          .when(rec(i), (el) => el.child(mono(10, C.accent, sel ? "recommended · Y" : "recommended")))))))
      .when(many > 1, (el) => el.child(mono(10, C.dim, `${many} questions: answer them in Asks (R)`)))
      .when(failed, (el) => el.child(h_flex().w_full().gap(6).items_center()
        .child(div().flex_1().min_w(0).child(mono(10, C.red, q.error ?? "it didn't go in")))
        .child(this.btn(`retry-${t.key}`, "Retry", "plain", (cx) => this.answerer.retry(q, cx)))));
  }

  board(cx) {
    // drawing means the stack shows the board (a hidden child doesn't draw, nor take commands): tell the top bar,
    // which can't see the stack, also after a keys.json layout.select brought the board back
    // (not right after the top bar sent a picked space to its terminal: the board can draw once more before the stack switches)
    if (shared(VIEW) === "work" && Date.now() - (shared(LEFT) ?? 0) > 1500) setShared(VIEW, "board");
    this.jump(cx);
    if (this.focus && !shared(FOCUS)) this.focus = false;
    // a stage picker or New agent over the board closed: the keys are the board's again (not in Focus, where they're
    // the answered terminal's)
    const rf = shared(REFOCUS) ?? 0;
    if (rf !== this.refocusAt) { this.refocusAt = rf; if (!this.focus) this.grab(cx); }
    const every = this.cards;
    const cards = every.filter((t) => inScope(t.key));
    const away = every.filter((t) => !inScope(t.key)).reduce((n, t) => n + t.needs.length, 0);
    if (this.filter && !cards.some((t) => t.project === this.filter)) this.filter = null;
    if (this.peek && !shared(PEEK)) this.peek = false;
    const cols = this.columns(false);
    const by = (k) => cols[STAGES.findIndex(([c]) => c === k)];
    const week = this.week();
    const maxW = Math.max(1, ...week);
    const openPrs = new Set(cards.filter((t) => t.pr?.state === "OPEN").map((t) => t.pr.url)).size;
    const dimmed = (el) => el.when(this.focus, (e) => e.opacity(0.18));
    const ags = cards.flatMap((t) => t.agents);
    const subs = cards.flatMap((t) => t.subs);
    // the oldest question
    const asked = cols.flat().flatMap((t) => t.needs.map((x) => ({ t, x })));
    const next = asked.sort((p, q) => (p.x.tab?.changed_at ?? 0) - (q.x.tab?.changed_at ?? 0))[0];
    const projects = [...new Set(cards.map((t) => t.project))].sort();
    // the leftover worktrees of the repos shown
    const leftover = this.orphans.filter((o) => allSpaces() || o.common === repoKey(activeSpace()?.id));

    const strip = dimmed(div().w_full().flex_none().flex().flex_row().gap(10)
      .child(this.stat("LANDED TODAY", String(week[6]), C.land,
        h_flex().h(22).mt(4).gap(4).items_end().children(week.map((n, i) =>
          div().flex_1().h(Math.max(2, Math.round(20 * n / maxW))).rounded(2).bg(C.land).opacity(i === 6 ? 1 : 0.3))), true))
      .child(this.stat("NEEDS YOU", String(ags.filter((x) => x.a.status === "blocked").length), C.you))
      .child(this.stat("WORKING", String(ags.filter((x) => x.a.status === "working").length), C.work,
        subs.length ? mono(10, C.dim, `+ ${subs.filter((s) => subStatus(s) === "working").length} of ${plural(subs.length, "sub-agent")}`) : null))
      .child(this.stat("IN REVIEW", String(cards.filter((t) => t.stage === "in_review").length), stageInfo("in_review")[2], mono(10, C.dim, "worktrees")))
      .child(this.stat("OPEN PRS", String(openPrs), C.text, mono(10, C.dim, "on these worktrees"))));

    const nextQ = next && (waitingAsks().find((a) => a.address === next.x.a.address)?.question || this.asks[next.x.a.address]);
    const nextAge = next?.x.tab?.changed_at ? `waiting ${dur(this.now - next.x.tab.changed_at)}` : null;
    const banner = next && h_flex().w_full().flex_none().gap(14).px(14).py(10).rounded(8).items_center()
      .bg(C.youBg).border(1).border_color(C.youLine)
      .child(mono(10, C.you, "NEXT MOVE"))
      .child(v_flex().flex_1().min_w(0)
        .child(div().font_family(SANS).text_size(15).text_color(C.text).truncate()
          .child(`${next.t.name} asks: ${nextQ ? `“${nextQ}”` : "it is waiting for you"}`))
        .child(mono(11, C.muted, [next.t.project, cleanTitle(next.x.a.title), nextAge].filter(Boolean).join(" · "))))
      .child(this.btn("next-answer", "Answer  ⏎", "you", (cx) => this.setFocus(cx, true, next.t)))
      .child(this.btn("next-go", "Go to agent", "plain", (cx) => this.goTo(cx, next.t, next.x.a.address)));

    const chips = h_flex().w_full().flex_none().flex_wrap().gap(6).items_center()
      .child(scopeSwitch("scope", false))
      .when(away > 0, (el) => el.child(elsewhere("away", away, 12)))
      .child(div().w(1).h(16).mx(4).bg(C.line2))
      .child(dimmed(h_flex().gap(6).items_center()
        .child(this.filterChip(null, "all", cards.length))
        .children(projects.map((p) => this.filterChip(p, p, cards.filter((t) => t.project === p).length,
          cards.some((t) => t.project === p && t.needs.length))))))
      .when(leftover.length > 0, (el) => el.child(this.btn("leftover", `${plural(leftover.length, "leftover worktree")} · clean up`, "plain",
        () => openOverlay({ mod: MOD, kind: "dialog", width: 640, height: 480, props: { part: "cleanup", orphans: leftover } }))))
      .child(div().flex_1())
      .child(h_flex().id("search").w(170).h(26).flex_none().px(8).gap(6).items_center().rounded(6).border(1)
        .border_color(this.searching ? C.accentDim : C.line2).bg(C.main)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(mono(11, C.dim, "/"))
        .child(Input.new(this.search).flex_1().min_w(0).h(24).font_family(SANS).text_size(12).text_color(C.text)))
      .child(mono(11, C.dim, this.focus ? "type in the terminal to answer · ⌘E back to the board"
        : this.peek ? "space closes the peek · ⏎ opens it" : "S stage · ? keys"))
      .child(this.btn("new-agent", "+ New agent  N", "new", () => newAgent()))
      .child(this.btn("focus", "◎ Focus  F", this.focus ? "on" : "plain", (cx) => this.setFocus(cx, !this.focus)));

    const column = ([k, label, color], i) => {
      const list = by(k);
      const folded = this.folded.has(k);
      const compact = folded || !list.length;
      const hot = this.col === k;
      const head = h_flex().id(`head-${k}`).w_full().h(22).flex_none().gap(7).items_center().cursor_pointer()
        .on_click((_e, cx) => { if (folded) this.folded.delete(k); else this.folded.add(k); cx.notify(); })
        .child(div().w(10).flex_none().text_size(9).text_color(C.dim).child(folded ? "▸" : "▾"))
        .child(div().w(8).h(8).flex_none().rounded(4).bg(color))
        .child(div().min_w(0).truncate().child(mono(11, hot ? color : list.length ? C.soft : C.dim, label.toUpperCase())))
        .child(div().flex_none().px(5).rounded(8).bg(C.raised).font_family(MONO).text_size(10).text_color(C.muted).child(String(list.length)));
      return v_flex().id(`col-${k}`).min_h(0).gap(8).p(6).rounded(8).border(1)
        .flex_none().w(compact ? (folded ? FOLDED_W : EMPTY_W) : colW)
        .border_color(hot ? `${color}66` : "#00000000").bg(hot ? `${color}0d` : "#00000000")
        .child(head)
        .when(!folded, (el) => el.child(v_flex().id(`list-${k}`).w_full().flex_1().min_h(0).gap(8).overflow_y_scrollbar().track_scroll(this.scroll[i])
          .children(list.map((t) => this.card(t)))));
    };

    // the columns with cards share what the folded and empty ones leave, but never below COL_MIN: narrower than that
    // (an agent open beside the board) only the columns scroll sideways; the numbers and filters above keep the width
    const fixed = 12 * (STAGES.length - 1) + STAGES.reduce((w, [k]) =>
      w + (this.folded.has(k) ? FOLDED_W : by(k).length ? 0 : EMPTY_W), 0);
    const open = STAGES.filter(([k]) => !this.folded.has(k) && by(k).length).length;
    const colW = Math.max(COL_MIN, Math.floor(((this.colsW ?? 0) - fixed) / Math.max(1, open)));
    return v_flex().id("board").relative().size_full().bg(C.main).px(16).pt(14).pb(10).gap(12)
      .track_focus(this.h).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.h.focus())
      .child(strip)
      .children(banner ? [banner] : [])
      .when(!!this.problem, (el) => el.child(mono(11, C.red, this.problem)))
      .child(chips)
      // a plain flex row: h_flex centres its children, which would shrink each column to its header
      .child(div().id("cols").w_full().flex_1().min_h(0).flex().flex_row().gap(12).overflow_x_scrollbar().track_scroll(this.hscroll)
        .on_size_change((size, cx) => { if (size.width !== this.colsW) { this.colsW = size.width; cx.notify(); } })
        .children(STAGES.map(column)))
      .when(this.help, (el) => el.child(this.keyList()));
  }

  // the sidebar opened the board on a column: mark it, select its first card and take the keyboard (after this draw:
  // focus can't move while drawing)
  jump(cx) {
    const j = shared(COL);
    if (!j?.at || j.at === this.colAt) return;
    this.colAt = j.at;
    this.col = STAGES.some(([k]) => k === j.kind) ? j.kind : null;
    if (this.col) this.folded.delete(this.col);
    if (this.focus && this.col) {
      this.focus = false;
      run("layout.hide", { id: "focus-term" });
      setShared(FOCUS, false);
    }
    const first = this.col && this.visible().find((t) => t.stage === this.col);
    if (first) this.sel = first.key;
    this.grab(cx);
  }

  filterChip(p, label, n, alert) {
    const on = this.filter === p;
    return h_flex().id(`chip-${label}`).flex_none().gap(6).px(8).py(2).rounded(5).items_center().cursor_pointer()
      .border(1).border_color(on ? C.accentDim : C.line2).bg(on ? "#1c1926" : "#00000000")
      .hover((st) => st.bg(C.hover))
      .on_click((_e, cx) => { this.filter = on ? null : p; cx.notify(); })
      .when(p !== null, (el) => el.child(div().w(7).h(7).rounded(4).bg(chipColor(p)[0])))
      .child(mono(11, on ? C.text : C.soft, label))
      .child(mono(11, C.dim, String(n)))
      .when(!!alert, (el) => el.child(div().w(6).h(6).rounded(3).bg(C.you)));
  }

  top() {
    const counts = shared(COUNTS) ?? {};
    const view = shared(VIEW) ?? "board";
    const focus = Boolean(shared(FOCUS));
    const space = spaces().find((s) => s.active);
    // a space picked in the sidebar or the picker shows its terminal, not the board (Focus moves the space itself;
    // with the side terminal open, the board stays and the side shows it)
    const side = findNode(layout(), "side");
    const sideOpen = Boolean(side && !side.hidden);
    const stay = Date.now() - (shared(STAY) ?? 0) < 3000;
    // filtered to the shown repo, the board stays: it now shows that repo's worktrees
    if (space && this.lastSpace && space.id !== this.lastSpace && !focus && view === "board" && !sideOpen && !stay && !shared(PEEK) && allSpaces()) {
      run("layout.select", { stack: "main", child: "work" });
      setShared(LEFT, Date.now());
      setShared(VIEW, "work");
    }
    this.lastSpace = space?.id;
    const mac = window()?.platform === "macos";
    const noDrag = (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation());
    const tabEl = (id, on, children, onClick, faded) => noDrag(h_flex().id(id).h_full().flex_none().px(11).items_center().gap(7).relative()
      .font_family(MONO).text_size(12).text_color(on ? C.text : C.muted).cursor_pointer()
      .hover((st) => st.text_color(C.text)).when(faded, (el) => el.opacity(0.25))
      .on_click(onClick)
      .children(children)
      .child(div().absolute().bottom(0).left(8).right(8).h(2).rounded(1).bg(on ? C.accent : "#00000000")));
    const boardTab = tabEl("tab-board", view === "board", [
      div().child("▦ Board"),
      ...(counts.needs ? [div().px(5).rounded(8).bg(C.you).text_color("#1a1300").text_size(10).font_weight(700).child(String(counts.needs))] : []),
    ], () => { run("layout.select", { stack: "main", child: "board" }); setShared(VIEW, "board"); }, false);
    const tabs = (space?.tabs ?? []).filter((t) => !t.settled || t.status === "blocked").map((t) =>
      tabEl(`tab-${t.id}`, view === "work" && t.active, [
        ...(t.status === "blocked" ? [div().w(7).h(7).rounded(4).bg(C.you)] : t.status === "working" ? [icon("spinner", 10, C.work).spin(900)] : []),
        div().child(t.name),
      ], () => { run("tab.select", { id: t.id }); run("layout.select", { stack: "main", child: "work" }); setShared(VIEW, "work"); },
      focus && t.status !== "blocked"));
    return h_flex().id("top").size_full().bg(C.top).border_b(1).border_color(C.line)
      .child(h_flex().w(mac ? 170 : 110).h_full().flex_none().pl(mac ? 84 : 16).items_center()
        .child(div().font_family(MONO).text_size(12).font_weight(700).text_color(C.accent).child("H E R D R")))
      .child(boardTab)
      .child(div().w(1).h(16).mx(4).bg(C.line2))
      .child(h_flex().id("tabs").flex_1().min_w(0).h_full().overflow_x_scrollbar().children(tabs))
      .child(h_flex().h_full().flex_none().pr(12).gap(6).items_center()
        .child(mono(11, C.muted, "commands"))
        .children((mac ? ["⌘", "⇧", "P"] : ["Ctrl", "Shift", "P"]).map((k) =>
          div().px(5).rounded(3).bg(C.raised).font_family(MONO).text_size(10).text_color(C.muted).child(k))));
  }

  // ---- the sidebar ---------------------------------------------------------------------------------------------

  // every worktree in the filter by stage, each most recently used first; every agent waiting for you, the oldest
  // question first; and how many wait in the worktrees the filter hides
  groups() {
    const by = Object.fromEntries(STAGES.map(([k]) => [k, []]));
    by.away = 0;
    by.needs = [];
    for (const w of worktrees()) {
      if (!inScope(w.key)) { by.away += w.needs.length; continue; }
      by[w.stage].push(w);
      by.needs.push(...w.needs);
    }
    for (const [k] of STAGES) by[k].sort((x, y) => y.at - x.at);
    by.needs.sort((x, y) => (x.tab?.changed_at ?? 0) - (y.tab?.changed_at ?? 0));
    return by;
  }

  // the agent you're on; the one you leave gets the time (not the one you click, so a row doesn't jump under the pointer)
  trackUse() {
    const f = focused()?.terminal ?? null;
    const cur = f && agents().some((a) => a.address === f) ? f : null;
    if (cur === this.cur) return cur;
    if (this.cur) {
      const now = Date.now(), live = new Set(agents().map((a) => a.address));
      const used = { ...(shared(USED) ?? {}), [this.cur]: now };
      for (const [k, at] of Object.entries(used)) if (!live.has(k) && now - at > 7 * 86400000) delete used[k];
      setShared(USED, used);
    }
    this.cur = cur;
    return cur;
  }

  // a worktree in the sidebar: a click goes to its agent (the one that needs you, else the one used last), a
  // right-click moves it to another stage
  worktreeRow(w, cur) {
    const on = w.agents.some((x) => x.a.address === cur) || (!w.agents.length && w.space.active);
    const st = w.agents.length ? w.status ?? "idle" : null;
    const waiting = w.needs.length, working = w.agents.filter((x) => x.a.status === "working").length;
    return h_flex().id(`wt-${w.key}`).w_full().h(30).flex_none().pl(8).pr(8).gap(8).items_center().rounded(6).cursor_pointer()
      .bg(on ? "#2c2838" : "#00000000").hover((s) => s.bg(on ? "#2c2838" : C.hover))
      .on_click(() => goToWorktree(w))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openStagePicker(w.key, w.name, w.stage, true); })
      .child(div().w(12).flex_none().flex().justify_center().child(st ? statusIcon(st, 8) : icon("columns", 10, C.dim)))
      .child(div().flex_1().min_w(0).truncate().font_family(SANS).text_size(13).font_weight(500)
        .text_color(on || waiting ? C.text : C.soft).child(w.name))
      .when(waiting > 0, (el) => el.child(mono(10, C.you, `${waiting}●`)))
      .when(working > 0, (el) => el.child(mono(10, C.work, `${working}◌`)))
      .when(w.subs.length > 0, (el) => el.child(mono(10, C.dim, `+${w.subs.length}`)));
  }

  // an agent under its worktree, when the worktree has more than one (with one, the worktree's row goes to it)
  agentRow(w, x, cur) {
    const a = x.a, on = a.address === cur, now = this.now, tab = x.tab;
    const age = a.status === "blocked" ? (tab?.changed_at ? dur(now - tab.changed_at) : "")
      : a.status === "working" ? (tab?.working_since ? dur(now - tab.working_since) : "") : x.at ? dur(now - x.at) : "";
    const name = cleanTitle(a.title) || (tab?.named ? tab.name : "") || a.program?.name || a.address;
    return h_flex().id(`ag-${a.address}`).w_full().h(26).flex_none().pl(28).pr(8).gap(7).items_center().rounded(6).cursor_pointer()
      .bg(on ? "#2c2838" : "#00000000").hover((s) => s.bg(on ? "#2c2838" : C.hover))
      .on_click(() => goToAgent(a.address))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openStagePicker(w.key, w.name, w.stage, true); })
      .child(div().w(10).flex_none().flex().justify_center().child(statusIcon(a.status, 7)))
      .child(div().flex_1().min_w(0).truncate().font_family(SANS).text_size(12)
        .text_color(on || a.status === "blocked" || a.status === "done" ? C.text : C.muted).child(name))
      .when(x.subs.length > 0, (el) => el.child(mono(10, C.dim, `+${x.subs.length}`)))
      .child(mono(10, a.status === "blocked" ? C.you : C.dim, age));
  }

  // New agent's stage, given to the worktree's space once it shows up (space.new doesn't say which it made)
  claimPending() {
    const p = shared(PENDING);
    if (!p?.folder) return;
    if (Date.now() - p.at > 120000) { setShared(PENDING, null); return; }
    const s = spaces().find((x) => x.folder === p.folder || place(x) === p.folder);
    if (!s) return;
    setShared(PENDING, null);
    setStage(s.id, p.stage);
    if (p.title) setShared(SPACE_TITLES, { ...(shared(SPACE_TITLES) ?? {}), [s.id]: p.title });
  }

  nav() {
    this.claimPending();
    const by = this.groups();
    const cur = this.trackUse();
    const view = shared(VIEW) ?? "board";
    const col = shared(COL)?.kind ?? null;
    const fold = shared(FOLD) ?? { archived: true };
    const narrow = (this.size?.width ?? 220) < 160;
    const live = STAGES.filter(([k]) => k !== "archived");
    // cmd-] / cmd-[ (agent.next / agent.prev) go down and up this list
    setAgentOrder(live.flatMap(([k]) => by[k].flatMap((w) => w.agents.map((x) => x.a.address))));
    const total = live.reduce((n, [k]) => n + by[k].length, 0);
    const pill = (n) => div().flex_none().min_w(24).px(6).rounded(10).flex().justify_center()
      .bg(n ? C.raised : "#00000000").font_family(MONO).text_size(12).text_color(n ? C.text : C.dim).child(String(n));
    const newBtn = h_flex().id("nav-new").h(36).mb(4).flex_none().rounded(7).items_center().justify_center().gap(8)
      .when(narrow, (el) => el.w(40)).when(!narrow, (el) => el.w_full())
      .bg(C.accent).text_color("#0f0f11").cursor_pointer().hover((st) => st.opacity(0.85))
      .on_click(() => newAgent())
      .child(div().font_family(SANS).text_size(17).child("+"))
      .when(!narrow, (el) => el.child(div().font_family(SANS).text_size(14).font_weight(600).child("New agent")));
    const boardOn = view === "board" && !col;
    const boardRow = h_flex().id("nav-board").h(36).flex_none().rounded(7).items_center().cursor_pointer()
      .when(narrow, (el) => el.w(40).justify_center().gap(4)).when(!narrow, (el) => el.w_full().px(10).gap(10))
      .bg(boardOn ? "#2c2838" : "#00000000").hover((st) => st.bg(boardOn ? "#2c2838" : C.hover))
      .on_click(() => openBoard(null))
      .child(div().w(16).flex_none().flex().justify_center().child(icon("columns", 15, C.accent)))
      .when(!narrow, (el) => el.child(div().flex_1().font_family(SANS).text_size(14).text_color(C.text).child("Board")).child(pill(total)))
      .when(narrow, (el) => el.child(mono(12, C.text, String(total))));
    // who's waiting for you, whatever the stage: a click goes to the oldest question
    const waiting = by.needs.length;
    const needsRow = (waiting || by.away) && h_flex().id("nav-needs").h(34).flex_none().rounded(7).items_center().cursor_pointer()
      .when(narrow, (el) => el.w(40).justify_center().gap(4)).when(!narrow, (el) => el.w_full().px(10).gap(8))
      .bg(C.youBg).border(1).border_color(C.youLine).hover((st) => st.opacity(0.85))
      .on_click(() => (waiting ? goToAgent(by.needs[0].a.address) : setShared(SCOPE, "all")))
      .child(div().w(8).h(8).flex_none().rounded(4).bg(C.you).loop("opacity", { from: 0.35, to: 1, period: 1200 }))
      .when(narrow, (el) => el.child(mono(12, C.you, String(waiting || by.away))))
      .when(!narrow, (el) => el
        .child(div().flex_1().min_w(0).truncate().font_family(SANS).text_size(13).font_weight(600).text_color(C.you)
          .child(waiting ? `${waiting} ${waiting === 1 ? "needs" : "need"} you` : "Needs you elsewhere"))
        .when(waiting > 0 && by.away > 0, (el) => el.child(elsewhere("nav-away", by.away, 11)))
        .when(!waiting, (el) => el.child(mono(11, C.you, String(by.away)))));
    // Asks: the questions waiting in scope, a click shows or hides the panel with them
    const asksOpen = findNode(layout(), "asks")?.hidden === false;
    const nAsks = waitingAsks().filter((a) => (a.space ? inScope(a.space) : allSpaces())).length;
    const asksRow = h_flex().id("nav-asks").h(34).flex_none().rounded(7).items_center().cursor_pointer()
      .when(narrow, (el) => el.w(40).justify_center().gap(4)).when(!narrow, (el) => el.w_full().px(10).gap(10))
      .bg(asksOpen ? "#2c2838" : "#00000000").hover((st) => st.bg(asksOpen ? "#2c2838" : C.hover))
      .on_click(() => toggleAsks())
      .child(div().w(16).flex_none().flex().justify_center().child(icon("asks", 15, nAsks ? C.you : C.accent)))
      .when(!narrow, (el) => el.child(div().flex_1().font_family(SANS).text_size(14).text_color(C.text).child("Asks"))
        .child(mono(10, C.dim, "⌘⇧A"))
        .child(div().flex_none().min_w(24).px(6).rounded(10).flex().justify_center().bg(nAsks ? C.you : "#00000000")
          .font_family(MONO).text_size(12).text_color(nAsks ? "#1a1300" : C.dim).child(String(nAsks))))
      .when(narrow, (el) => el.child(mono(12, nAsks ? C.you : C.dim, String(nAsks))));

    // the rail: each stage's dot and count, opening the board there
    if (narrow) {
      return v_flex().id("nav").size_full().bg(C.top).pt(10).pb(8).gap(3).items_center()
        .on_size_change((size, cx) => { this.size = size; cx.notify(); })
        .child(newBtn).child(boardRow).child(asksRow).children(needsRow ? [needsRow] : [])
        .children(live.map(([k, , color]) => h_flex().id(`nav-${k}`).w(40).h(30).flex_none().rounded(7).gap(4).items_center().justify_center()
          .bg(view === "board" && col === k ? "#2c2838" : "#00000000").cursor_pointer().hover((st) => st.bg(C.hover))
          .on_click(() => openBoard(view === "board" && col === k ? null : k))
          .child(div().w(8).h(8).rounded(4).bg(color).when(!by[k].length, (el) => el.opacity(0.35)))
          .child(mono(12, by[k].length ? C.text : C.dim, String(by[k].length)))));
    }

    const group = ([k, label, color]) => {
      const list = by[k];
      const open = !fold[k];
      const marked = view === "board" && col === k;
      const head = h_flex().id(`g-${k}`).w_full().h(30).flex_none().pl(4).pr(4).gap(6).items_center().rounded(6).cursor_pointer()
        .bg(marked ? "#2c2838" : "#00000000").hover((st) => st.bg(marked ? "#2c2838" : C.hover))
        .on_click(() => setShared(FOLD, { ...fold, [k]: open }))
        .child(div().w(12).flex_none().flex().justify_center().text_size(10).text_color(C.dim).child(open ? "▾" : "▸"))
        .child(div().flex_1().min_w(0).truncate().font_family(SANS).text_size(13).font_weight(600)
          .text_color(list.length ? C.soft : C.dim).child(label))
        .child(pill(list.length))
        // the column on the board
        .child(div().id(`gb-${k}`).w(22).h(22).flex_none().rounded(5).flex().items_center().justify_center()
          .text_color(marked ? C.text : C.dim).hover((st) => st.bg(C.raised).text_color(C.text))
          .on_click((_e, cx) => { cx.stop_propagation(); openBoard(marked ? null : k); })
          .child(svg(`mods/${MOD}/columns.svg`).size(13)));
      // a flex row (stretching, unlike h_flex) so the group's colour bar runs its full height
      return div().id(`group-${k}`).w_full().flex_none().flex().flex_row().gap(4)
        .child(div().w(3).flex_none().rounded(2).bg(color).when(!list.length, (el) => el.opacity(0.3)))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(head)
          .when(open, (el) => el.children(list.flatMap((w) => [this.worktreeRow(w, cur),
            ...(w.agents.length > 1 ? w.agents.map((x) => this.agentRow(w, x, cur)) : [])]))));
    };

    return v_flex().id("nav").size_full().bg(C.top).px(8).pt(10).pb(8).gap(3)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(newBtn).child(boardRow).child(asksRow)
      .child(div().pt(4).child(scopeSwitch("nav-scope", true)))
      .children(needsRow ? [div().pt(4).child(needsRow)] : [])
      .child(v_flex().id("nav-groups").w_full().flex_1().min_h(0).mt(4).gap(4).overflow_y_scrollbar()
        .children(STAGES.map(group))
        .child(div().px(8).pt(6).child(mono(10, C.dim, "right-click a worktree to change its stage"))));
  }

  // the stage picker and New agent, closing (Esc, a pick, a click beside): the board takes the keyboard back
  async close() {
    if (this.part === "stage" || this.part === "new" || this.part === "cleanup") setShared(REFOCUS, Date.now());
  }

  // ---- leftover worktrees -----------------------------------------------------------------------------------

  initCleanup(cx) {
    // each: what's at risk (uncommitted changes are lost; commits stay on the branch), then removing or opening it
    this.items = (props()?.orphans ?? []).map((o) => ({ ...o, dirty: null, local: null, state: "", arm: false }));
    this.h = cx.focus_handle();
    this.h.focus();
    cx.timer.after(300, () => this.h.focus());
    cx.spawn(async (cx) => {
      for (const it of this.items) {
        if (it.prunable) { it.dirty = 0; it.local = 0; continue; }
        try {
          const st = await exec("git", ["--no-optional-locks", "status", "--porcelain"], { cwd: it.path });
          it.dirty = st.code === 0 ? st.stdout.split("\n").filter(Boolean).length : null;
          // commits no remote has: they stay on the branch, but say so
          const lc = await exec("git", ["rev-list", "--count", "HEAD", "--not", "--remotes"], { cwd: it.path });
          it.local = lc.code === 0 ? Number(lc.stdout.trim()) : null;
        } catch { /* left unknown */ }
        cx.notify();
      }
    });
  }

  // git worktree remove (--force once you confirmed losing uncommitted changes); one whose folder is gone, prune
  removeTree(cx, it, force) {
    if (it.state === "removing" || it.state === "removed") return;
    it.state = "removing";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = it.prunable ? await exec("git", ["worktree", "prune"], { cwd: it.main })
          : await exec("git", ["worktree", "remove", ...(force ? ["--force"] : []), it.path], { cwd: it.main, timeout: 600000 });
        it.state = r.code === 0 ? "removed" : lastLine(r.stderr) || lastLine(r.stdout) || "git worktree remove failed";
      } catch (e) { it.state = String(e.message ?? e); }
      cx.notify();
    });
  }

  cleanupDialog() {
    const p = props() ?? {};
    const items = this.items;
    const clean = items.filter((it) => it.dirty === 0 && !it.state);
    const btn = (id, text, kind, onClick) => h_flex().id(id).flex_none().h(26).px(10).items_center().rounded(6).border(1)
      .border_color(kind === "danger" ? C.red : kind === "primary" ? C.accent : C.line2)
      .bg(kind === "primary" ? C.accent : kind === "danger" ? "#3b1d24" : C.raised)
      .text_color(kind === "primary" ? "#0f0f11" : kind === "danger" ? C.red : C.text)
      .font_family(SANS).text_size(12).cursor_pointer().hover((st) => st.opacity(0.85))
      .on_click((_e, cx) => onClick(cx)).child(text);
    const row = (it, n) => {
      const facts = it.prunable ? [["folder already gone", C.muted]]
        : [it.dirty === null ? ["reading…", C.dim] : it.dirty ? [`${plural(it.dirty, "uncommitted change")}: lost on remove`, C.you] : ["no uncommitted changes", C.land],
          ...(it.local ? [[`${plural(it.local, "commit")} on no remote (kept on the branch)`, C.muted]] : [])];
      const done = it.state === "removed";
      return h_flex().id(`orphan-${n}`).w_full().flex_none().px(10).py(8).gap(10).items_center().rounded(7).border(1).border_color(C.line)
        .bg(C.card).when(done, (el) => el.opacity(0.4))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().truncate().child(mono(12, C.text, it.branch ?? base(it.path))))
          .child(div().truncate().child(mono(10, C.dim, it.path.replace(home(), "~"))))
          .child(h_flex().flex_wrap().gap(10).children(facts.map(([t, c]) => mono(10, c, t))))
          .when(!!it.state && !done && it.state !== "removing", (el) => el.child(mono(10, C.red, it.state))))
        .when(done, (el) => el.child(mono(11, C.land, "removed")))
        .when(it.state === "removing", (el) => el.child(icon("spinner", 12, C.work).spin(900)))
        .when(!done && it.state !== "removing", (el) => el
          .when(!it.prunable, (el) => el.child(btn(`open-${n}`, "Open", "plain", () => {
            closeOverlay(p.overlay);
            run("space.new", { folder: it.path });
            run("layout.select", { stack: "main", child: "work" });
            setShared(LEFT, Date.now());
            setShared(VIEW, "work");
          })))
          .child(it.dirty && !it.arm ? btn(`rm-${n}`, "Remove…", "plain", (cx) => { it.arm = true; cx.notify(); })
            : btn(`rm-${n}`, it.dirty ? "Remove anyway" : "Remove", it.dirty ? "danger" : "plain", (cx) => this.removeTree(cx, it, Boolean(it.dirty)))));
    };
    return v_flex().id("cleanup").size_full().p(18).gap(10).bg("#18181b").text_color(C.text).track_focus(this.h)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .child(h_flex().items_center()
        .child(div().flex_1().font_family(SANS).text_size(16).font_weight(600).child("Leftover worktrees"))
        .child(mono(11, C.dim, "Esc")))
      .child(div().font_family(SANS).text_size(12).text_color(C.muted)
        .child("Worktrees under ~/.herdr/worktrees that no space shows (a space was closed). Removing one deletes its folder; its branch and commits stay in the repo."))
      .child(v_flex().id("orphans").w_full().flex_1().min_h(0).gap(6).overflow_y_scrollbar().children(items.map(row)))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().child(mono(11, C.dim, `${items.filter((it) => it.state === "removed").length} of ${items.length} removed`)))
        .when(clean.length > 0, (el) => el.child(btn("rm-clean", `Remove the ${plural(clean.length, "one")} without changes`, "primary",
          (cx) => { for (const it of clean) this.removeTree(cx, it, false); })))
        .child(btn("done", "Done", "plain", () => closeOverlay(p.overlay))));
  }

  // ---- the stage picker ---------------------------------------------------------------------------------------

  initStage(cx) {
    const p = props() ?? {};
    this.at = Math.max(0, STAGES.findIndex(([k]) => k === p.stage));
    this.h = cx.focus_handle();
    this.h.focus();
    cx.timer.after(300, () => this.h.focus());
  }

  choose(stage) {
    const p = props() ?? {};
    closeOverlay(p.overlay);
    if (stage === "delete") deleteWorktree(p.space);
    else if (stage !== p.stage) setStage(p.space, stage);
  }

  stagePicker() {
    const p = props() ?? {};
    const title = String(p.title ?? "");
    return v_flex().id("stage").size_full().p(5).bg("#18181b").track_focus(this.h)
      .on_key_down((e, cx) => {
        const k = e.key;
        const last = STAGES.length - (p.deletable ? 0 : 1); // Delete worktree comes after the stages
        if (/^[1-9]$/.test(k) && STAGES[Number(k) - 1]) this.choose(STAGES[Number(k) - 1][0]);
        else if (k === "down" || k === "j") this.at = Math.min(last, this.at + 1);
        else if (k === "up" || k === "k") this.at = Math.max(0, this.at - 1);
        else if (k === "enter") this.choose(STAGES[this.at]?.[0] ?? "delete");
        else if ((k === "backspace" || k === "delete") && p.deletable) this.choose("delete");
        else if (k === "escape") closeOverlay(p.overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(div().px(9).pt(6).pb(6).truncate().child(mono(10, C.dim, `MOVE ${trunc(title, 24)} TO`)))
      .children(STAGES.map(([k, label, color], i) => h_flex().id(`st-${k}`).h(30).flex_none().px(9).gap(10).items_center().rounded(6)
        .bg(i === this.at ? C.raised : "#00000000").cursor_pointer().hover((st) => st.bg(C.raised))
        .on_click(() => this.choose(k))
        .child(div().w(8).h(8).flex_none().rounded(4).bg(color))
        .child(div().flex_1().font_family(SANS).text_size(13).text_color(C.text).child(label))
        .child(mono(11, C.accent, k === p.stage ? "✓" : ""))
        .child(mono(11, C.dim, String(i + 1)))))
      .when(!!p.deletable, (el) => el
        .child(div().h(1).mx(6).my(4).bg(C.line2))
        .child(h_flex().id("st-delete").h(30).flex_none().px(9).gap(10).items_center().rounded(6)
          .bg(this.at === STAGES.length ? "#3b1d24" : "#00000000").cursor_pointer().hover((st) => st.bg("#3b1d24"))
          .on_click(() => this.choose("delete"))
          .child(div().w(8).flex_none().text_size(11).text_color(C.red).child("×"))
          .child(div().flex_1().font_family(SANS).text_size(13).text_color(C.red).child("Delete worktree…"))
          .child(mono(11, C.dim, "⌫"))));
  }

  // ---- New agent ------------------------------------------------------------------------------------------------

  initNew(cx) {
    const p = props() ?? {};
    this.choices = NEW_AGENTS;
    this.pickKey = shared(PICK) ?? "claude";
    this.stage = shared(NEW_STAGE) ?? DEFAULT_STAGE;
    // the worktree it's for: the one given (+ Agent), else the shown space, whose repo a new worktree comes from
    this.src = spaces().find((s) => s.id === (p.space ?? activeSpace()?.id)) ?? null;
    this.mode = p.space ? "here" : "worktree"; // "worktree": a new one; "here": one more agent in this.src
    this.repo = undefined; // undefined: looking, null: not in git, else {top, main, name, base, home}
    this.busy = false;
    this.error = "";
    this.text = "";
    this.branchText = "";
    this.task = InputState.new({ placeholder: "What should it do? Leave empty to type it in its terminal" });
    this.task.on("change", (_e, cx) => { this.text = this.task.value(); cx.notify(); });
    this.task.on("submit", (_e, cx) => this.start(cx));
    this.branch = InputState.new({ placeholder: "branch name" });
    this.branch.on("change", (_e, cx) => { this.branchText = this.branch.value(); this.error = ""; cx.notify(); });
    this.branch.on("submit", (_e, cx) => this.start(cx));
    // the references: what you paste or pick, kept as {kind, id, url, title?, branchName?}
    this.refs = [];
    this.refText = "";
    this.refFocused = false;
    this.issues = null; // your open Linear issues, when LINEAR_API_KEY is set; null: none (no key, or not read)
    this.found = null; // Linear's search for what you typed, when your own issues don't have it
    this.linearKey = null;
    this.ref = InputState.new({ placeholder: "Paste a Linear issue, PR or Slack link, or search your issues" });
    this.ref.on("change", (_e, cx) => { this.refText = this.ref.value(); this.found = null; this.searchLinear(cx); cx.notify(); });
    this.ref.on("submit", (_e, cx) => this.addRef(cx));
    this.ref.on("focus", (_e, cx) => { this.refFocused = true; cx.notify(); });
    this.ref.on("blur", (_e, cx) => { this.refFocused = false; cx.notify(); });
    this.ref.focus();
    cx.timer.after(600, () => this.ref.focus());
    cx.spawn(async (cx) => {
      try {
        // the key from Herdr's environment, else from your login shell (only the key is kept from what it prints)
        let r = await exec("sh", ["-c", 'printf %s "$LINEAR_API_KEY"']);
        let key = /lin_api_[A-Za-z0-9]+/.exec(r.stdout ?? "")?.[0];
        if (!key) {
          r = await exec("sh", ["-c", 'exec "${SHELL:-/bin/zsh}" -lic "$1"', "sh", 'printf "\n%s\n" "$LINEAR_API_KEY"'], { timeout: 8000 });
          key = /lin_api_[A-Za-z0-9]+/.exec(r.stdout ?? "")?.[0];
        }
        if (!key) return;
        this.linearKey = key;
        const d = await linear(key, `{ viewer { assignedIssues(first: 50, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { ${LINEAR_ISSUE} } } } }`);
        this.issues = d.viewer.assignedIssues.nodes;
      } catch (e) { this.linearError = String(e.message ?? e); }
      cx.notify();
    });
    const on = this.src?.machine ?? undefined;
    cx.spawn(async (cx) => {
      try {
        const known = await knownAgents({ on });
        this.choices = NEW_AGENTS.map((a) => {
          const k = known.find((x) => x.key === a.key);
          return k ? { ...a, ...k, icon: k.icon ?? a.icon } : { ...a, installed: false };
        });
      } catch { /* keep the defaults */ }
      cx.notify();
    });
    cx.spawn(async (cx) => {
      try {
        const dir = this.src ? place(this.src) : null;
        const r = dir ? await exec("sh", ["-c", REPO, "sh", dir], { on }) : null;
        const v = r?.code === 0 ? kv(r.stdout) : {};
        const main = v.common ? (v.common.endsWith("/.git") ? v.common.slice(0, -5) : v.common) : null;
        this.repo = v.top && main && v.home ? { top: v.top, main, name: base(main), base: v.base || null, home: v.home } : null;
      } catch { this.repo = null; }
      if (!this.repo && this.mode === "worktree") this.mode = "here";
      cx.notify();
    });
  }

  // your issues that match what you typed (by id or title), then Linear's search for it
  matches() {
    if (!this.issues) return [];
    const q = this.refText.trim().toLowerCase();
    if (/^https?:\/\//.test(q)) return [];
    const taken = new Set(this.refs.map((r) => r.id));
    const mine = this.issues.filter((i) => !taken.has(i.identifier) && (!q || `${i.identifier} ${i.title}`.toLowerCase().includes(q)));
    const more = (this.found ?? []).filter((i) => !taken.has(i.identifier) && !mine.some((x) => x.identifier === i.identifier));
    return [...mine, ...more].slice(0, 6);
  }

  // typing a few letters none of your issues has: Linear's search, a moment after you stop
  searchLinear(cx) {
    const q = this.refText.trim();
    const seq = (this.searchSeq = (this.searchSeq ?? 0) + 1);
    if (!this.linearKey || q.length < 3 || /^https?:\/\//.test(q) || this.matches().length >= 3) return;
    cx.timer.after(400, (cx) => {
      if (seq !== this.searchSeq) return;
      cx.spawn(async (cx) => {
        try {
          const d = await linear(this.linearKey, `query($t: String!) { searchIssues(term: $t, first: 8) { nodes { ${LINEAR_ISSUE} } } }`, { t: q });
          if (seq === this.searchSeq) { this.found = d.searchIssues.nodes; cx.notify(); }
        } catch { /* your own issues still show */ }
      });
    });
  }

  // ⏎ in the reference field: a link or id as it is (a Linear one with its title when it's among yours), else the
  // first issue that matches, else a note; empty, on to the message
  addRef(cx, issue) {
    if (!issue && !this.refText.trim()) { this.task.focus(); return; }
    let r;
    if (issue) r = { kind: "linear", id: issue.identifier, url: issue.url, title: issue.title, branchName: issue.branchName };
    else {
      r = classify(this.refText);
      const pick = r.kind === "note" ? this.matches()[0] : null;
      if (pick) r = { kind: "linear", id: pick.identifier, url: pick.url, title: pick.title, branchName: pick.branchName };
      const known = r.kind === "linear" && [...(this.issues ?? []), ...(this.found ?? [])].find((i) => i.identifier === r.id);
      if (known) r = { ...r, url: known.url, title: known.title, branchName: known.branchName };
    }
    if (!this.refs.some((x) => x.kind === r.kind && x.id === r.id && x.url === r.url)) this.refs.push(r);
    this.ref.set_value("");
    this.refText = "";
    this.found = null;
    this.ref.focus();
    cx.notify();
  }

  // the worktree's title on the board: the Linear issue's title, else the first sentence of your message, shortened
  title() {
    const issue = this.refs.find((r) => r.kind === "linear");
    return shortTitle(issue?.title || this.text) || (issue ? issue.id : "");
  }

  // the first message: what you wrote (or, with a Linear issue and nothing written, to start on it), then the
  // references as a Context block
  prompt() {
    const issue = this.refs.find((r) => r.kind === "linear");
    const ask = this.text.trim() || (issue ? `Start working on the Linear issue ${issue.id}.` : "");
    return this.refs.length ? [ask, "", "Context:", ...this.refs.map(refLine)].join("\n").trim() : ask;
  }

  // the new worktree's branch: what you typed, else the Linear issue's (Linear's own name for it), else made from the
  // first message, else agent-<month><day>-<time>
  branchName() {
    const typed = this.branchText.trim();
    if (typed) return typed;
    const issue = this.refs.find((r) => r.kind === "linear");
    if (issue?.branchName) return issue.branchName;
    if (issue) return [issue.id.toLowerCase(), branchFrom(issue.title || this.text)].filter(Boolean).join("-");
    const fromTask = branchFrom(this.text);
    if (fromTask) return fromTask;
    const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
    return `agent-${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  }

  // a new worktree (git worktree add, then a space in it with the agent as its first tab), or one more tab in the
  // worktree; with a first message the agent starts on it and the board stays, without one its terminal shows
  start(cx) {
    if (this.busy) return;
    const a = this.choices.find((x) => x.key === this.pickKey) ?? this.choices[0];
    if (!a || a.installed === false) return;
    if (this.mode === "worktree" && !this.repo) return;
    const task = this.prompt();
    const issue = this.refs.find((r) => r.kind === "linear");
    const name = issue ? trunc(`${issue.id}${issue.title ? ` ${issue.title}` : ""}`, 40) : this.text.trim() ? trunc(this.text.trim(), 40) : a.name;
    const args = launch(a, task);
    const done = () => {
      setShared(PICK, a.key);
      if (!task) {
        run("layout.select", { stack: "main", child: "work" });
        setShared(LEFT, Date.now());
        setShared(VIEW, "work");
      }
      closeOverlay(props().overlay);
    };
    if (this.mode === "here") {
      run("tab.new", { ...args, name, space: this.src?.id });
      done();
      return;
    }
    const branch = this.branchName();
    const repo = this.repo, on = this.src?.machine ?? undefined;
    const path = `${repo.home}/.herdr/worktrees/${repo.name}/${slugPath(branch)}`;
    this.busy = true;
    this.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        // the branch may have a worktree already (an earlier New agent, a space closed since): use that one
        const list = await exec("git", ["worktree", "list", "--porcelain"], { cwd: repo.main, on });
        let trees = parseTrees(list.stdout);
        // one whose folder is gone: git forgets it (the branch stays), and it's made again below
        if (trees.some((w) => w.prunable)) {
          await exec("git", ["worktree", "prune"], { cwd: repo.main, on });
          trees = trees.filter((w) => !w.prunable);
        }
        const known = trees.find((w) => w.branch === branch) ?? trees.find((w) => w.path === path);
        let folder = known?.path;
        if (!folder) {
          if ((await exec("test", ["-e", path], { on })).code === 0) throw new Error(`${path} exists and isn't a worktree of ${repo.name}: move it or pick another branch`);
          const exists = (await exec("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repo.main, on })).code === 0;
          // a new branch starts from the remote's default branch (else this checkout's HEAD), without tracking it
          const add = exists ? ["worktree", "add", path, branch] : ["worktree", "add", "--no-track", "-b", branch, path, repo.base || "HEAD"];
          const r = await exec("git", add, { cwd: repo.top, on, timeout: 600000 });
          if (r.code !== 0) throw new Error(lastLine(r.stderr) || lastLine(r.stdout) || "git worktree add failed");
          folder = path;
        }
        setShared(NEW_STAGE, this.stage);
        if (task) setShared(STAY, Date.now());
        // a space already showing that worktree gets the agent as one more tab; else a space opens in it, unnamed, so
        // it follows the checkout and nests under its repo in Spaces, as Herdr's own worktrees do
        const open = known && showing(folder, on);
        if (open) {
          run("tab.new", { ...args, name, space: open.id });
          if (!(shared(SPACE_TITLES) ?? {})[open.id] && this.title()) setShared(SPACE_TITLES, { ...(shared(SPACE_TITLES) ?? {}), [open.id]: this.title() });
        } else {
          setShared(PENDING, { stage: this.stage, folder, at: Date.now(), title: this.title() });
          run("space.new", { ...args, folder, tab: name, machine: on ?? "" });
        }
        this.busy = false;
        done();
      } catch (e) {
        this.busy = false;
        this.error = String(e.message ?? e);
        cx.notify();
      }
    });
  }

  newDialog() {
    const h = home();
    const tilde = (p) => (p && h && p.startsWith(h) ? "~" + p.slice(h.length) : p ?? "");
    const a = this.choices.find((x) => x.key === this.pickKey) ?? this.choices[0];
    const fresh = this.mode === "worktree";
    const label = (text) => div().pt(14).pb(7).child(mono(10, C.dim, text));
    const radio = (on) => div().w(14).h(14).flex_none().rounded(7).border(1).border_color(on ? C.accent : C.line2)
      .flex().items_center().justify_center().children(on ? [div().w(6).h(6).rounded(3).bg(C.accent)] : []);
    const agentCard = (x) => {
      const on = x.key === a.key, off = x.installed === false;
      return h_flex().id(`new-${x.key}`).flex_1().min_w(0).h(52).px(12).gap(10).items_center().rounded(8).border(1)
        .border_color(on ? C.accent : C.line2).bg(on ? "#1c1926" : C.card).cursor_pointer().hover((st) => st.bg(on ? "#1c1926" : C.hover))
        .when(off, (el) => el.opacity(0.45))
        .on_click((_e, cx) => { if (!off) { this.pickKey = x.key; this.task.focus(); cx.notify(); } })
        .child(x.tint ? svg(x.icon).size(22).flex_none().text_color(C.text) : image(x.icon).w(22).h(22).flex_none())
        .child(v_flex().flex_1().min_w(0)
          .child(div().font_family(SANS).text_size(14).text_color(C.text).child(x.name))
          .child(div().truncate().child(mono(10, off ? C.red : C.dim, off ? "not installed" : x.run.join(" ")))))
        .child(radio(on));
    };
    const where = (id, on, enabled, title, sub, onClick) => h_flex().id(id).w_full().h(42).px(12).gap(10).items_center().rounded(7).border(1)
      .border_color(on ? C.accentDim : C.line2).bg(on ? "#1c1926" : "#00000000").cursor_pointer().hover((st) => st.bg(on ? "#1c1926" : C.hover))
      .when(!enabled, (el) => el.opacity(0.45))
      .on_click((_e, cx) => { if (enabled) onClick(cx); })
      .child(radio(on))
      .child(div().flex_none().font_family(SANS).text_size(13).text_color(C.text).child(title))
      .child(div().flex_1().min_w(0).truncate().child(mono(11, C.dim, sub)));
    const button = (id, text, primary, enabled, onClick) => h_flex().id(id).h(34).px(16).items_center().rounded(8).border(1)
      .border_color(primary ? C.accent : C.line2).bg(primary ? C.accent : C.raised).text_color(primary ? "#0f0f11" : C.text)
      .font_family(SANS).text_size(13).font_weight(primary ? 600 : 400).cursor_pointer().hover((st) => st.opacity(0.85))
      .when(!enabled, (el) => el.opacity(0.4)).on_click(onClick).child(text);
    const repoSub = this.repo === undefined ? "looking for the repo…" : this.repo
      ? `${this.repo.name} · from ${this.repo.base ?? "HEAD"} · ~/.herdr/worktrees/${this.repo.name}/${slugPath(this.branchName())}`
      : "not in a git repo";
    const srcName = this.src ? (this.src.named ? this.src.name : this.src.branch || this.src.name) : "no space";
    const ready = a && a.installed !== false && !this.busy && (!fresh || this.repo);
    return v_flex().id("new").size_full().p(18).bg("#18181b").text_color(C.text)
      .child(h_flex().items_center()
        .child(div().flex_1().font_family(SANS).text_size(16).font_weight(600).child("New agent"))
        .child(mono(11, C.dim, "Esc")))
      .child(label("AGENT"))
      .child(h_flex().w_full().gap(8).children(this.choices.map(agentCard)))
      .child(label("WHERE"))
      .child(v_flex().w_full().gap(6)
        .child(where("new-worktree", fresh, Boolean(this.repo), "New worktree", repoSub,
          (cx) => { this.mode = "worktree"; this.branch.focus(); cx.notify(); }))
        .child(where("new-here", !fresh, Boolean(this.src), "In this worktree", `${srcName} · ${tilde(this.src ? place(this.src) : "")}`,
          (cx) => { this.mode = "here"; this.task.focus(); cx.notify(); })))
      .when(fresh, (el) => el
        .child(label("BRANCH"))
        .child(Input.new(this.branch).h(34).px(10).rounded(8).border(1).border_color(C.line2).bg(C.main).font_family(MONO).text_size(12).text_color(C.text))
        .when(!this.branchText.trim(), (el) => el.child(div().pt(4).child(mono(10, C.dim, `empty: ${this.branchName()}`))))
        .when(!!this.title(), (el) => el.child(div().pt(2).truncate().child(mono(10, C.dim, `on the board: ${this.title()}`))))
        .child(label("STAGE"))
        .child(h_flex().w_full().flex_wrap().gap(6).children(STAGES.map(([k, name, color]) => {
          const on = k === this.stage;
          return h_flex().id(`new-stage-${k}`).h(26).px(9).gap(6).items_center().rounded(6).border(1)
            .border_color(on ? color : C.line2).bg(on ? `${color}22` : "#00000000").cursor_pointer()
            .hover((st) => st.bg(on ? `${color}22` : C.hover))
            .on_click((_e, cx) => { this.stage = k; this.task.focus(); cx.notify(); })
            .child(div().w(7).h(7).rounded(4).bg(color))
            .child(div().font_family(SANS).text_size(12).text_color(on ? C.text : C.soft).child(name));
        }))))
      .child(label("CONTEXT"))
      .child(Input.new(this.ref).h(34).px(10).rounded(8).border(1).border_color(this.refFocused ? C.accentDim : C.line2).bg(C.main).font_family(SANS).text_size(12).text_color(C.text))
      .when(this.refFocused && this.matches().length > 0, (el) => el.child(v_flex().w_full().mt(4).p(3).rounded(7).border(1).border_color(C.line2).bg(C.card)
        .children(this.matches().map((i) => h_flex().id(`issue-${i.identifier}`).h(26).px(7).gap(8).items_center().rounded(5).cursor_pointer()
          .hover((st) => st.bg(C.raised))
          .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.addRef(cx, i); })
          .child(div().w(70).flex_none().child(mono(11, REF_KINDS.linear[1], i.identifier)))
          .child(div().flex_1().min_w(0).truncate().font_family(SANS).text_size(12).text_color(C.soft).child(i.title))
          .child(mono(10, C.dim, i.state?.name ?? ""))))))
      .child(h_flex().w_full().pt(6).flex_wrap().gap(6)
        .children(this.refs.map((r, n) => h_flex().id(`ref-${n}`).flex_none().max_w(470).h(24).pl(7).pr(4).gap(6).items_center().rounded(6)
          .border(1).border_color(`${REF_KINDS[r.kind][1]}55`).bg(`${REF_KINDS[r.kind][1]}14`)
          .child(mono(10, REF_KINDS[r.kind][1], r.kind === "linear" ? r.id : REF_KINDS[r.kind][0]))
          .child(div().min_w(0).truncate().font_family(SANS).text_size(12).text_color(C.soft)
            .child(r.kind === "linear" ? r.title ?? r.url ?? "" : r.kind === "pr" ? r.id : r.kind === "note" ? r.id : r.url.replace(/^https?:\/\//, "")))
          .child(div().id(`ref-x-${n}`).w(16).h(16).flex_none().rounded(4).flex().items_center().justify_center().cursor_pointer()
            .text_size(11).text_color(C.dim).hover((st) => st.bg(C.raised).text_color(C.text))
            .on_click((_e, cx) => { this.refs.splice(n, 1); cx.notify(); }).child("×"))))
        .when(!this.refs.length, (el) => el.child(mono(10, C.dim, this.issues ? "⏎ adds · your Linear issues show as you type"
          : "⏎ adds · set LINEAR_API_KEY in your shell to pick from your Linear issues"))))
      .child(label(this.refs.some((r) => r.kind === "linear") ? "MESSAGE (OPTIONAL: EMPTY STARTS ON THE ISSUE)" : "FIRST MESSAGE (OPTIONAL)"))
      .child(Input.new(this.task).h(38).px(10).rounded(8).border(1).border_color(C.line2).bg(C.main).font_family(SANS).text_size(13).text_color(C.text))
      .when(!!this.error, (el) => el.child(div().pt(8).child(mono(11, C.red, this.error))))
      .child(div().flex_1())
      .child(h_flex().pt(14).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().child(mono(11, C.dim, this.busy ? "creating the worktree…"
          : this.prompt() ? "it starts working; the board stays" : "its terminal opens, to type in")))
        .child(button("new-cancel", "Cancel", false, true, () => closeOverlay(props().overlay)))
        .child(button("new-start", this.busy ? "Creating…" : "Start  ⏎", true, ready, (_e, cx) => this.start(cx))));
  }

  bottom() {
    const c = shared(COUNTS) ?? {};
    const item = (text, color, dot) => h_flex().gap(5).items_center()
      .when(!!dot, (el) => el.child(div().w(6).h(6).rounded(3).bg(dot)))
      .child(mono(11, color, text));
    return h_flex().id("bottom").size_full().px(12).gap(16).items_center().bg(C.side).border_t(1).border_color(C.line)
      .child(div().flex_1())
      .when(!!c.problem, (el) => el.child(item(String(c.problem).slice(0, 80), C.red)))
      .child(item(c.when ? `read ${c.when}` : "reading…", C.dim))
      .child(item(new Date(this.now).toTimeString().slice(0, 5), C.muted));
  }
}
