// Board (Herdr): a board of worktrees, fed by Herdr's own spaces and agents. In Herdr a worktree is a space (the
// worktree mod makes one per checkout), so each card is a space: its stage, its repo and branch, every agent running in
// it and the sub-agents those started (hc run), counted by status. One mod draws every part; the layout says which with
// props().part: "top" (the pinned Board tab with its needs-you badge, then the shown space's tabs), "nav" (the top of
// the sidebar: + New agent, Board, who needs you, then every worktree grouped by stage, in the order you drag them to,
// its agents under it; a click goes to the worktree's main agent, not a sub-agent it started there, or straight to an
// agent, a right-click opens its menu: unread, stage, delete), "board"
// (today's numbers, the next move, project chips, with LINEAR_API_KEY a Linear column of your issues waiting to start,
// then one column per stage) and "bottom" (when the board last read, any git, gh or Linear problem, the clock). "new"
// is the New agent dialog: a new worktree of the shown repo with the agent in it,
// or one more agent in a worktree, started on your message plus a Context block of the references you add (a Linear
// issue or project, picked from Linear when LINEAR_API_KEY is set, a pull request, a Slack message, any link or note);
// with skills (board.json's "skills", installed for the machine and repo), the skill row (its stage's skill when
// opened from a Linear card, else the in-progress one with a Linear issue or project, yours to pick) starts Claude Code
// on `/<skill> …` and the Context, so its agents land in that worktree's space; "stage" is
// the stage picker; "cleanup" lists the worktrees left without a space, to open or remove. ⌘W (keys.json,
// board-herdr.close) on a worktree's last tab opens Herdr's own Remove worktree, so closed tasks don't pile up on disk. Both give the keyboard back to the board when they
// close (Herdr only does that for focusable mods).
// Two things kept apart: a worktree's stage (Perpétuo, Planning, In progress, In review, Watch, Temp, Done, Archived, Paused), which
// only you change (the stage picker, S, or dragging its card to another column), kept in shared state by space (Done removes the worktree after 3 days there, unless it has
// uncommitted changes); and each agent's status (working, waiting for you, done, idle), which the
// agent reports and the board only shows. A card suggests the next stage when its pull request says so (opened: In
// review; merged: Archived) but never moves by itself. Archived also puts the worktree's tabs away (tab.settle).
// The board and the sidebar show the worktrees of the shown space's repo, or every one (V on the board), and say when
// an agent elsewhere needs you.
// A Linear card dragged onto Planning or In progress (or S, or ⏎ for In progress) opens a short summary of the start;
// only its ⏎ makes the worktree and the agent, and Esc changes nothing.
// Keyboard, like Linear's: ↑↓/jk within a column, ←→/hl across columns, 0 the Linear column, 1-9 a stage, S the stage,
// ⇧←→ the stage before or after, ⏎ opens the worktree's agent, Space peeks at it beside the board, N a new worktree,
// ⇧N one more agent in this one, / searches, ? lists every key; ⌘E (keys.json, board-herdr.toggle) goes from an agent
// to the board and back.
// Data: spaces() and agents(); terminals() for the sub-agents; git in each worktree's folder for its repo, branch,
// commits ahead of the default branch, uncommitted files and +added −removed; gh for the branch's pull request and
// checks, and for what you merged this week. Merge PR runs `gh pr merge`, Ship PR runs `git push -u origin HEAD && gh
// pr create --fill`, New agent runs `git worktree add` into ~/.herdr/worktrees/<repo>/<branch>, where Herdr's own
// worktree mod puts them, and, only with LINEAR_API_KEY set in your shell, asks api.linear.app for your open issues.
// A click on a card (or an agent on it) shows that agent's live terminal beside the board, in the layout's hidden
// "focus-term" block; the board stays whole and clickable, so another click shows another agent (Esc or Space
// closes it). The side narrows the board: the columns pan so the selected card stays in view, centred. Focus (F) opens the same block on who needs you, with the keyboard, so the question can be answered
// in place. "agent-head" is the bar over an agent, beside the board or in its place: its Minimize gives the board back
// the screen and the keyboard. Going to an agent's whole screen closes the side first, so one agent shows once.
// Asks (github.com/sachin-philip/herdr-agent-ask, fitted here): the sidebar copy runs its engine (asks-engine.js), which
// turns every question an agent asks (a permission, a menu of options, a turn that ends asking in plain text, read with
// `claude -p` Haiku) into a record in shared("asks.state"). A card shows its worktree's question with the options to
// click (Y takes the recommended one); "asks" is the panel at the board's right with every question in scope, to answer
// or type a reply (⌘⇧A, R, the sidebar's Asks row). Answers go in with hc and are logged where asks.json's `log` says.
// PRs (⌘⇧G, the sidebar's PRs row; the main stack's "prs" child, prs.js): the open pull requests of the org in prs.json
// that wait on you, as two lanes, other people's (asking you, your team's repos, reviewed by you) and yours, each in the
// column of where it stands (prs-rules.js). The sidebar's copy reads them with `gh api graphql` (prs-data.js), read only;
// the gear ("prs-settings") edits prs.json's org and team repos. ⌁ on a card opens the worktree on the PR's branch.
import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle, Popup } from "gpui-base";
import { spaces, agents, panes, run, props, exec, shared, setShared, window, nextCommand, layout, openOverlay, closeOverlay,
  knownAgents, home, focused, setAgentOrder, terminals, notify, machines, readTextFile, writeTextFile, appHome, hc } from "herdr";
import { Engine } from "./asks-engine.js";
import { loadConfig } from "./asks-state.js";
import { AsksPanel, Answerer, pickable, waitingAsks, questionsOf } from "./asks.js";
import { PrsFeed, PRS, PR_ASK, PR_DRAFTS } from "./prs-data.js";
import { PrsBoard, PrsSettings, PRS_SHOWN } from "./prs.js";
import { lanes } from "./prs-rules.js";
import { planPage } from "./md-html.js";
import { checks, parseClonePrs, mergePrs, timedOut, ghStall, stallProblem, parseRepoPrs, prsByCommits, eachLimit } from "./worktree-prs.js";
import { mainAgent, addNew, moveKey, toFront, byOrder, seq } from "./nav-order.js";
import { appOf, resumeArgv, pickOpencodeSession, shellLine, parseClaudeSession, parkedCount } from "./park-rules.js";
import { normLabel, labelsOf, toggleLabel, allLabels, suggest, groupByLabel, dropGone } from "./labels-rules.js";
import { readBoardConfig, firstMessage, moveInLinear, todoColumn, canDrop, issueFromBranch, startedState } from "./linear-rules.js";

const MOD = "board-herdr";
const C = {
  top: "#101012", side: "#0f0f11", main: "#121214", card: "#1a1a1d", raised: "#242328", hover: "#1f1f23",
  line: "#1e1e20", line2: "#2a2a30", text: "#e4e4e7", soft: "#c8c8cc", muted: "#8a898e", dim: "#56555b",
  accent: "#b4a0db", accentDim: "#625187",
  you: "#ffb406", youBg: "#1f1a10", youCard: "#1b1912", youAsk: "#241f12", youLine: "#4a3a12",
  remote: "#9a99a0", // the dashed outline of a card on another machine
  selBg: "#262139", selAsk: "#2d2615", // the selected card: tinted, the one waiting for you still amber
  work: "#8f7fd1", land: "#53cf91", landBg: "#12201a", landLine: "#1d3a2c", done: "#6fb3f2", red: "#e0707f",
};
// the stages a worktree goes through, in order: the board's columns and the sidebar's groups
const STAGES = [
  ["perpetual", "Perpétuo", "#c084fc"], // agents you always keep open: nothing nudges them out
  ["todo", "Planning", "#8a8f98"], // work being planned, not yet carried on (the key stays todo)
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
const stageInfo = (k) => STAGES.find(([s]) => s === k) ?? STAGES[2];
const CHIPS = [
  ["#e0707f", "#3b1d24"], ["#3ec9b4", "#11302d"], ["#f0a050", "#3a2410"], ["#a690e8", "#2a2245"],
  ["#e6c35c", "#352c10"], ["#6fb3f2", "#152a40"], ["#e88cc8", "#3a1a30"], ["#8fd18a", "#1c321c"],
];
const COL_MIN = 260; // px: the narrowest a column with cards gets; below that the columns scroll sideways
const FOLDED_W = 140; // px: a folded column (just its header)
const EMPTY_W = 118; // px: a column without cards
const CARD_AGENTS = 4; // agents listed on a card; the rest are counted
const ASK_MAX_W = 480; // px: the widest a column gets so a card's question options read on one line each (longer ones wrap)
const MONO = "JetBrains Mono";
const SANS = "Geist";
const GIT_MS = 10000; // how often each worktree's folder is read with git (also when an agent changes status)
const GH_MS = 60000; // how often each branch's pull request is asked of GitHub
const WEEK_MS = 300000; // how often the merged pull requests of the week are counted
const LINEAR_MS = 60000; // how often the Linear column asks Linear for your issues waiting to start
const LINEAR_WAIT = 20000; // how long a Linear request may take before it's given up
const KEY_BACKOFF = [300000, 900000, 3600000]; // with no key, the waits before looking it up again (then hourly)
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
const LAST = "boardh.last"; // shared: {machine, agent, repo}: where and with what New agent last started, from either door
// what New agent offers, until knownAgents() says how this machine runs them and whether they're installed
const NEW_AGENTS = [
  { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false, run: ["claude"], installed: null },
  { key: "opencode", name: "OpenCode", icon: "icons/opencode.svg", tint: true, run: ["opencode"], installed: null },
];
const USED = "boardh.used"; // shared: address -> when you last left that agent (ms), how recently a worktree was used
const ORDER = "boardh.order"; // shared: the sidebar's order, space ids and agent addresses, as you dragged them
const FOLD = "boardh.fold"; // shared: the sidebar's folded groups
const SCOPE = "boardh.scope"; // shared: "all", or anything else for the shown space's repo
const MACHINE = "boardh.machine"; // shared: the machine filter: null for every one, "" this computer, else a machine's name
const UNREAD = "boardh.unread"; // shared: space id -> when you marked that worktree unread, to see later (green until opened)
const SHOWN = "boardh.shown"; // shared: the agent the board last showed beside it, for the bar over it
const PARKED = "boardh.parked"; // shared: space id -> {at, agents: [{address, app, session, cwd, argv, title}]}: agents
// ended to free the machine, to bring back where they left off
const LABELS = "boardh.labels"; // shared: space id -> its labels, your words for it (pesquisa, feature, bug…)
const GROUP = "boardh.group"; // shared: true: each column's cards under their first label
const FEATURES = "boardh.features"; // shared: board.json's features still being built ({prs}), read by the sidebar's copy
const PEEK = "boardh.peek"; // shared: Space shows the selected agent beside the board (the top bar then keeps the board)
const COL = "boardh.col"; // shared: {kind, at}, the stage the sidebar last opened the board on (kind null: none)
const REFOCUS = "boardh.refocus"; // shared: when a dialog over the board closed (ms): the board takes the keyboard back
const NEW_STAGE = "boardh.newStage"; // shared: the stage New agent last gave
const PENDING = "boardh.pending"; // shared: {stage, folder, at}: New agent's stage, for the space that opens in folder
const SPACE_STAGES = "boardh.spaceStages"; // shared: space id -> its stage
const STAGE_AT = "boardh.stageAt"; // shared: space id -> when it last changed stage (ms): Done's 3 days count from it
const SPACE_TITLES = "boardh.spaceTitles"; // shared: space id -> the title New agent gave its worktree
const BRANCHES = "boardh.branches"; // shared: [{space, project, branch}]: each worktree's branch, for the PRs view's ⌁
const STARTING = "boardh.starting"; // shared: Linear issue ID -> when its start was confirmed (ms): the column hides it while Linear catches up
const LINEAR_ORG = "boardh.linearOrg"; // shared: {urlKey, teamKeys}: your Linear workspace, as the board last read it
const SPACE_ISSUES = "boardh.spaceIssues"; // shared: space id -> {id, url}: the Linear issue its worktree was started for
const LINEAR_MOVES = "boardh.linearMoves"; // shared: [{uuid, teamId, id, at}]: issues New agent started in progress, for the board to move in Linear
const MOVE_MS = 600000; // a queued move older than this is dropped, not made late

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
  if [ -n "$mb" ]; then
    echo "ahead=$(git rev-list --count "$mb"..HEAD)"; echo "diff=$(git diff --shortstat "$mb" 2>/dev/null)"
    # its commits over the default branch: a pull request whose head is one of them is this folder's, whatever the
    # branch is called here (a review's rev/123)
    echo "commits=$(git rev-list --max-count=200 "$mb"..HEAD | tr '\\n' ' ')"
  fi
fi
echo "unpushed=$(git rev-list --count @{u}..HEAD 2>/dev/null)"
# the newest plan a planning skill left in the worktree (tmp/<issue>/plan/report.*), its HTML when it wrote one
r=$(git rev-parse --show-toplevel)
f=$(ls -t "$r"/tmp/*/plan/report.md "$r"/tmp/*/plan/report.html 2>/dev/null | head -n 1)
[ -n "$f" ] && [ -f "\${f%/*}/report.html" ] && f="\${f%/*}/report.html"
echo "plan=$f"
# its own clones under repos/ (a folder of their own, not a worktree), whose branches can have pull requests too
# (an if, not &&: a last folder that isn't a clone would end the script non-zero, and the board drops such a read)
for c in "$r"/repos/*/; do if [ -d "$c.git" ]; then echo "clone=\${c%/}"; fi; done`;

// New agent's: the repo a folder is in, the branch a new worktree starts from, and the home the worktrees go under
// a reference New agent puts in the agent's first message: what it is, from what you paste
const REF_KINDS = { linear: ["Linear issue", "#8b93f8"], project: ["Linear project", "#b48cf2"], pr: ["Pull request", "#53cf91"], slack: ["Slack message", "#e88cc8"],
  link: ["Link", "#6fb3f2"], note: ["Note", "#8a898e"] };
function classify(raw) {
  const s = raw.trim();
  let m;
  if (!s) return null;
  if ((m = /linear\.app\/[^/\s]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/.exec(s))) return { kind: "linear", id: m[1].toUpperCase(), url: s };
  // a project's link ends in its name and its slug id: linear.app/<workspace>/project/<name>-<slugId>
  if ((m = /linear\.app\/[^/\s]+\/project\/([^/\s?#]+)/.exec(s))) return { kind: "project", id: m[1].split("-").pop(), url: s, title: null };
  if ((m = /^([A-Za-z][A-Za-z0-9]*-\d+)$/.exec(s))) return { kind: "linear", id: m[1].toUpperCase(), url: null };
  if ((m = /github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/.exec(s))) return { kind: "pr", id: `${m[1]}#${m[2]}`, url: s };
  if (/slack\.com\/archives\//.test(s)) return { kind: "slack", id: "", url: s };
  if (/^https?:\/\//.test(s)) return { kind: "link", id: "", url: s };
  return { kind: "note", id: s, url: null };
}
// how a reference reads in the first message
function refLine(r) {
  if (r.kind === "linear") return `- Linear issue: ${r.id}${r.title ? ` — ${r.title}` : ""}${r.url ? ` (${r.url})` : ""}`;
  if (r.kind === "project") return `- Linear project: ${r.title ?? r.id}${r.url ? ` (${r.url})` : ""}`;
  if (r.kind === "pr") return `- Pull request: ${r.id} (${r.url})`;
  if (r.kind === "note") return `- Note: ${r.id}`;
  return `- ${REF_KINDS[r.kind][0]}: ${r.url}`;
}
const LINEAR_ISSUE = "identifier title url branchName state { name }";
const LINEAR_PROJECT = "name url slugId status { name }";
const OPEN_PROJECTS = `projects(first: 50, orderBy: updatedAt, filter: { status: { type: { nin: ["completed", "canceled"] } } }) { nodes { ${LINEAR_PROJECT} } }`;
// a Linear project picked from the list, as a reference
const projectRef = (p) => ({ kind: "project", id: p.slugId, url: p.url, title: p.name });
// the Linear API with your key (it never leaves this machine but for api.linear.app); Herdr's fetch can't be
// aborted, so a request that hangs is given up after LINEAR_WAIT and the caller's run ends with the reason
async function linear(cx, key, query, variables) {
  const j = await new Promise((resolve, reject) => {
    cx.sleep(LINEAR_WAIT).then(() => reject(new Error("Linear didn't answer")), () => {});
    fetch("https://api.linear.app/graphql", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: key }, body: JSON.stringify({ query, variables }),
    }).then((r) => r.json()).then(resolve, reject);
  });
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data;
}
// your LINEAR_API_KEY: from Herdr's environment, else from your login shell (only the key is kept from what it
// prints, and it's never shown); null without one
async function linearKey() {
  let r = await exec("sh", ["-c", 'printf %s "$LINEAR_API_KEY"']);
  let key = /lin_api_[A-Za-z0-9]+/.exec(r.stdout ?? "")?.[0];
  if (!key) {
    r = await exec("sh", ["-c", 'exec "${SHELL:-/bin/zsh}" -lic "$1"', "sh", 'printf "\n%s\n" "$LINEAR_API_KEY"'], { timeout: 8000 });
    key = /lin_api_[A-Za-z0-9]+/.exec(r.stdout ?? "")?.[0];
  }
  return key ?? null;
}
// the Linear column: your issues waiting to start (by the state's type, whatever the team calls it), and the
// workspace's URL key and team keys, to know an issue's ID in a branch name and link to it
const LINEAR_TODO = `{ viewer { assignedIssues(first: 100, orderBy: updatedAt, filter: { state: { type: { eq: "unstarted" } } }) {
    nodes { id identifier title url branchName priorityLabel state { type } team { id key name } project { name } } } }
  organization { urlKey } teams { nodes { key } } }`;
// a team's workflow states, to find its first "started" one; and the one write: an issue's state
const TEAM_STATES = "query($t: String!) { team(id: $t) { states { nodes { id type position } } } }";
const MOVE_ISSUE = "mutation($id: String!, $s: String!) { issueUpdate(id: $id, input: { stateId: $s }) { success } }";
// a Linear card's issue, as the summary (startIssue) takes it
const issueRef = (i) => ({ id: i.identifier, url: i.url, title: i.title, branchName: i.branchName, uuid: i.id, teamId: i.team?.id });
// a worktree's Linear issue: the one it was started for, else an ID of one of your teams in its branch; null: none
// a plan opened in the browser: an HTML one on this computer as it is; else (Markdown, or from another machine) a page
// written under ~/.config/herdr-app/cache/plans, Markdown made readable
async function openPlan(path, on, title) {
  if (!on && path.endsWith(".html")) { await exec("open", [path]); return; }
  const text = await readTextFile(path, { on });
  if (text === null) throw new Error(`${path} is gone`);
  const dir = `${appHome()}/cache/plans`;
  const out = `${dir}/${`${on ?? "local"}${path}`.replace(/[^\w.-]+/g, "-").replace(/^-+/, "")}${path.endsWith(".html") ? "" : ".html"}`;
  await exec("mkdir", ["-p", dir]);
  await writeTextFile(out, path.endsWith(".html") ? text : planPage(title, text), await readTextFile(out));
  await exec("open", [out]);
}

function issueOf(spaceId, branch) {
  const kept = (shared(SPACE_ISSUES) ?? {})[spaceId];
  if (kept) return kept;
  const org = shared(LINEAR_ORG);
  const id = issueFromBranch(branch, org?.teamKeys ?? []);
  return id && org?.urlKey ? { id, url: `https://linear.app/${org.urlKey}/issue/${id}` } : null;
}

// a clone's local branches, then your open pull requests in its repo (parseClonePrs keeps the ones from those branches)
const CLONE_PRS = `cd "$1" 2>/dev/null || exit 3
git for-each-ref --format='%(refname:short)' refs/heads
echo ---
gh pr list --author @me --state open --limit 50 --json number,url,title,isDraft,headRefName,statusCheckRollup 2>/dev/null`;

const REPO = `cd "$1" 2>/dev/null || exit 3
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
echo "top=$(git rev-parse --show-toplevel)"
echo "common=$(git rev-parse --path-format=absolute --git-common-dir)"
echo "base=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)"
echo "home=$HOME"`;

const findNode = (node, id) => node?.id === id ? node : (node?.children ?? []).reduce((f, c) => f ?? findNode(c, id), null);
const shownView = () => findNode(layout(), "main")?.active ?? shared(VIEW) ?? "board";
// the PRs view is still being built: shown only with {"features": {"prs": true}} in board.json
const prsFeature = () => shared(FEATURES)?.prs === true;
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
  // never wider than a third of a card: a long name (a space's, before git is read) mustn't push the stage button out
  return div().flex_none().max_w(140).truncate().px(5).rounded(3).bg(bg).text_color(fg).font_family(SANS).text_size(11).child(name);
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
    plan: v.plan || null,
    commits: (v.commits ?? "").split(" ").filter(Boolean),
    clones: String(stdout ?? "").split("\n").filter((l) => l.startsWith("clone=")).map((l) => l.slice(6).trim()).filter(Boolean),
  };
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
// one you can remove by hand: also on another machine (its ~/.herdr/worktrees, whatever its home); Herdr's Remove
// worktree runs git there and refuses a main checkout itself. Done's automatic removal stays with this computer's
const removable = (s) => isWorktree(s) || Boolean(s.machine && [place(s), s.folder].some((d) => d?.includes("/.herdr/worktrees/")));
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
// board or the PRs view it does nothing: the tab it would close isn't the one you see.
function closeTab() {
  if (shownView() !== "work") return;
  const s = spaces().find((x) => x.id === focused()?.space) ?? activeSpace();
  if (s && s.tabs.length <= 1 && removable(s)) deleteWorktree(s.id);
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

// moves a worktree to a stage (at the top of it in the sidebar); Archived puts its tabs away (they keep running and come back when they need you),
// leaving Archived brings them back
function setStage(spaceId, stage) {
  const was = worktrees().find((w) => w.key === spaceId)?.stage;
  if ((shared(SPACE_STAGES) ?? {})[spaceId] !== stage) {
    setShared(STAGE_AT, { ...(shared(STAGE_AT) ?? {}), [spaceId]: Date.now() });
    setShared(ORDER, toFront(shared(ORDER) ?? [], spaceId)); // it comes in at the top of the stage in the sidebar
  }
  setShared(SPACE_STAGES, { ...(shared(SPACE_STAGES) ?? {}), [spaceId]: stage });
  for (const t of spaces().find((s) => s.id === spaceId)?.tabs ?? []) {
    if (stage === "archived" && !t.settled) run("tab.settle", { id: t.id });
    else if (stage !== "archived" && t.settled) run("tab.unsettle", { id: t.id });
  }
  // archived: its agents can be ended, to free the machine; out of Archived, the ones ended come back
  if (stage === "archived" && was !== "archived") openPark(spaceId, "end", true);
  else if (was === "archived" && stage !== "archived") openPark(spaceId, "restore", true);
}

// every space as a worktree: its agents (the most urgent first, then the one used last), each with the sub-agents it
// started, all of them counted, its main agent (where a click on it goes) and its stage
function worktrees() {
  const list = agents();
  const parentOf = new Map(terminals().filter((t) => t.parent).map((t) => [t.address, t.parent]));
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
    const mainAt = mainAgent(ags.map((x) => x.a.address), parentOf);
    const main = ags.find((x) => x.a.address === mainAt) ?? null;
    return {
      key: s.id, space: s, agents: ags, main, subs: ags.flatMap((x) => x.subs), needs: ags.filter((x) => x.a.status === "blocked"),
      status: s.status, stage: stageOf(s),
      at: Math.max(0, ...ags.map((x) => x.at), ...s.tabs.map((t) => t.changed_at ?? 0)),
      // one you gave the space, else New agent's title, else what its agent says it's doing, else the branch
      name: s.named ? s.name : titles[s.id] || shortTitle(agentTitle(main?.a) ?? "") || s.branch || s.name,
    };
  });
}

// ---- scope, navigation --------------------------------------------------------------------------------------------

const activeSpace = () => spaces().find((s) => s.active) ?? null;
const allSpaces = () => shared(SCOPE) === "all";
// a space's repo by name (as the board last read it), so the same repo on two machines is one; or the space itself
// when it isn't in one
const repoKey = (id) => (shared(REPOS) ?? {})[id]?.name ?? `space:${id}`;
// the machines with spaces, this computer (null) first; what one is called; the machine filter, when that machine is here
const machineList = () => [...new Set(spaces().map((s) => s.machine ?? null))]
  .sort((x, y) => (x === null ? -1 : y === null ? 1 : x.localeCompare(y)));
const machineLabel = (m) => m ?? (window()?.platform === "macos" ? "This Mac" : "This computer");
function machineFilter() {
  const m = shared(MACHINE);
  return m == null || !machineList().includes(m === "" ? null : m) ? null : m;
}
// whether the board and the sidebar show this space: on the machine picked (or any), and the shown space's repo (or every one)
function inScope(spaceId) {
  const m = machineFilter();
  if (m !== null && (spaces().find((s) => s.id === spaceId)?.machine ?? "") !== m) return false;
  return allSpaces() || repoKey(spaceId) === repoKey(activeSpace()?.id);
}
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

// shows the PRs view (the main stack's "prs" child), reads GitHub again and gives it the keyboard
function openPrs() {
  if (!prsFeature()) return;
  run("layout.select", { stack: "main", child: "prs" });
  setShared(VIEW, "prs");
  setShared(PR_ASK, Date.now());
  setShared(PRS_SHOWN, Date.now());
}
const openPrsSettings = () => prsFeature() && openOverlay({ mod: MOD, kind: "dialog", width: 620, height: 520, props: { part: "prs-settings" } });
// the worktree here on a PR's branch: its repo and branch first, else the only worktree on that branch
function worktreeOn(repo, branch) {
  const list = (shared(BRANCHES) ?? []).filter((b) => b.branch === branch);
  return (list.find((b) => b.project === repo) ?? (list.length === 1 ? list[0] : null))?.space ?? null;
}

// New agent's skills: Claude Code starts on `/<skill>` (with the issue and flags board.json gives it), your message and
// the Context. Which skills, and which one each stage runs, are yours to name in ~/.config/herdr-app/board.json
// ({ skills, stageSkills, issueArg, skillFlags }, or the old { orchestrate }); without it no skill is offered
async function boardConfig() {
  try {
    return readBoardConfig(JSON.parse(await readTextFile(`${appHome()}/board.json`)));
  } catch { return readBoardConfig(null); } // no board.json
}
// the skills ($2…) installed for the repo at $1: a SKILL.md in ~/.claude/skills/<name>/ or the repo's .claude/skills/<name>/
const SKILLS = `TOP="$1"; shift
for s in "$@"; do
  if test -f "$HOME/.claude/skills/$s/SKILL.md" || { test -n "$TOP" && test -f "$TOP/.claude/skills/$s/SKILL.md"; }; then echo "$s"; fi
done`;

// how to start an agent on a first message: Herdr's task puts it last on the command line, as Claude Code takes it;
// OpenCode's first argument is a folder, so it gets --prompt
const launch = (a, task) => (!task ? { argv: a.run } : a.key === "opencode" ? { argv: [...a.run, "--prompt", task] } : { argv: a.run, task });

// New agent: a new worktree of the shown repo, or (space) one more agent in that worktree
const newAgent = (space) => openOverlay({ mod: MOD, props: { part: "new", space: space ?? null }, kind: "dialog", width: 540, height: 770 });
// a Linear card's start: New agent's short summary (⏎ starts, E the full dialog, Esc nothing), on the machine, agent and
// repo of the last start, else the shown space's (a start outside git remembered no repo: nothing to go on)
function startIssue(issue, stage) {
  const last = shared(LAST), s = activeSpace();
  const from = last?.repo?.main ? { machine: last.machine ?? null, dir: last.repo.main, agent: last.agent }
    : { machine: s?.machine ?? null, dir: null };
  return openOverlay({ mod: MOD, kind: "dialog", width: 420, height: 330,
    props: { part: "new", summary: true, fromLinear: true, issue, stage, ...from } });
}
// E in the summary: the same start in the full New agent dialog, to change any of it (its Esc comes back to the summary)
function editIssue(p) {
  const { overlay, ...rest } = p;
  closeOverlay(overlay);
  // a bit taller than New agent: it may offer the shown space's repo under WHERE
  return openOverlay({ mod: MOD, kind: "dialog", width: 540, height: 802, props: { ...rest, summary: false, wasSummary: true } });
}

// the stage picker: at the pointer for a click, centered for a key; for a Linear card (issue), only the stages it can
// start in (only), and a pick opens its summary
// menu: a right-click's, with an action on top: Mark as unread / read for a worktree, Open in Linear for an issue
function openStagePicker(space, title, stage, pointer, { only, issue, menu, prs, end, restore } = {}) {
  const deletable = !issue && Boolean(spaces().find((s) => s.id === space && removable(s)));
  // the actions on top: Mark as unread / read or Open in Linear, a worktree's pull requests when it has several, its
  // labels, and End agents (those that can come back) or Restore (those ended)
  const actions = menu ? [issue ? (issue.url ? "open" : null) : "unread", prs?.length > 1 ? "prs" : null, issue ? null : "labels",
    end ? "park" : null, restore ? "restore" : null].filter(Boolean) : [];
  openOverlay({ mod: MOD, props: { part: "stage", space, title, stage, deletable, only, issue, actions, end, restore,
    prs: actions.includes("prs") ? prs : null },
    kind: pointer ? "popup" : "dialog",
    width: 250, height: 44 + (only?.length ?? STAGES.length) * 30 + (deletable ? 40 : 0) + (actions.length ? actions.length * 30 + 10 : 0) });
}

// a worktree's pull requests, when it has more than one: a list at the pointer (or centered), each opens on GitHub
function openPrList(title, prs, pointer) {
  openOverlay({ mod: MOD, props: { part: "prlist", title, prs }, kind: pointer ? "popup" : "dialog",
    width: 420, height: Math.min(380, 44 + prs.length * 46) });
}

// unread: your own mark on a worktree, to come back to it; opening any of its agents clears it
const isUnread = (spaceId) => Boolean((shared(UNREAD) ?? {})[spaceId]);
function setUnread(spaceId, on) {
  const u = shared(UNREAD) ?? {};
  if (!spaceId || Boolean(u[spaceId]) === on) return;
  const { [spaceId]: _, ...rest } = u;
  setShared(UNREAD, on ? { ...rest, [spaceId]: Date.now() } : rest);
}
// an agent opened (beside the board, in its place, or to answer): its worktree is read
const seen = (address) => setUnread(agents().find((a) => a.address === address)?.space, false);

// Delete worktree: Herdr's own Remove worktree (it warns about uncommitted changes, closes the space and runs git
// worktree remove; the branch and its commits stay). Only for worktrees under ~/.herdr/worktrees, never a main checkout.
function deleteWorktree(spaceId) {
  const s = spaces().find((x) => x.id === spaceId);
  if (s && removable(s)) openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space: s.id, action: "remove" } });
}

// ---- ending a worktree's agents, and bringing them back -------------------------------------------------------------

// a terminal's agent: its shell's children (the agent is one: the shell runs it, then stays), and Claude Code's record
// of the session the agent is in (~/.claude/sessions/<pid>.json), after ---
const AGENT_PROC = `for c in $(pgrep -P "$1"); do
  echo "child=$c"
  f="$HOME/.claude/sessions/$c.json"
  if [ -f "$f" ]; then echo ---; cat "$f"; exit 0; fi
done
exit 0`;

// a worktree's agents and the sub-agents they started, each with the program that can bring it back (null: none)
function parkable(w) {
  return [...(w?.agents ?? []).map((x) => ({ address: x.a.address, app: appOf(x.a.app ?? x.a.program?.name), title: x.a.title })),
    ...(w?.subs ?? []).map((s) => ({ address: s.address, app: appOf(s.agent ?? s.report?.app), title: s.title }))];
}

// ends a worktree's agents that can come back: each one's session read first (Claude Code's record, OpenCode's
// session list of its folder), then its process ended, only its: the terminal's shell stays, to bring it back in.
// Keeps each one ended in PARKED; returns {ended, kept: [{address, why}]}
async function parkAgents(spaceId, progress) {
  const w = worktrees().find((x) => x.key === spaceId);
  const ended = [], kept = [];
  for (const a of parkable(w)) {
    if (!a.app) { kept.push({ ...a, why: "can't be resumed" }); continue; }
    progress?.(a);
    try {
      const g = JSON.parse((await hc(["get", a.address, "--json"])).stdout);
      const on = a.address.includes("/") ? a.address.split("/")[0] : null;
      const r = await exec("sh", ["-c", AGENT_PROC, "sh", String(g.pid)], { on });
      const [procs, record = ""] = String(r.stdout ?? "").split(/^---$/m);
      let pid = Number(/^child=(\d+)/m.exec(procs)?.[1]) || null, session = null;
      if (a.app === "claude") {
        const c = parseClaudeSession(record);
        session = c?.session ?? null;
        pid = c?.pid ?? null;
      } else {
        const l = await exec("opencode", ["session", "list", "--format", "json"], { cwd: g.cwd, on, timeout: 30000 });
        session = pickOpencodeSession(JSON.parse(l.stdout || "[]"), g.cwd, g.title ?? a.title);
      }
      const argv = resumeArgv(a.app, g.foreground?.argv ?? [], session);
      if (!argv || !pid) { kept.push({ ...a, why: "no session found" }); continue; }
      const k = await exec("kill", ["-TERM", String(pid)], { on });
      if (k.code !== 0) { kept.push({ ...a, why: lastLine(k.stderr) || "not ended" }); continue; }
      ended.push({ address: a.address, app: a.app, session, cwd: g.cwd, argv, title: a.title });
      const all = shared(PARKED) ?? {}, rec = all[spaceId] ?? { at: Date.now(), agents: [] };
      setShared(PARKED, { ...all, [spaceId]: { ...rec, agents: [...rec.agents.filter((x) => x.address !== a.address), ended.at(-1)] } });
    } catch (e) { kept.push({ ...a, why: String(e.message ?? e) }); }
  }
  return { ended, kept };
}

// brings a worktree's ended agents back where they left off: typed in its terminal's shell (cd, then the agent with
// its flags and the session), or in a new tab of the space when that terminal is gone. Returns the ones that didn't
async function restoreAgents(spaceId) {
  const rec = (shared(PARKED) ?? {})[spaceId];
  const left = [];
  for (const e of rec?.agents ?? []) {
    try {
      if (agents().some((a) => a.address === e.address)) continue; // running again already
      if (terminals().some((x) => x.address === e.address && (!x.state || x.state === "live"))) {
        const r = await hc(["send", e.address, shellLine(e.cwd, e.argv)]);
        if (r.code !== 0) throw new Error(lastLine(r.stderr) || "couldn't type in its terminal");
      } else run("tab.new", { space: spaceId, folder: e.cwd, argv: e.argv });
    } catch (err) { left.push({ ...e, why: String(err.message ?? err) }); }
  }
  const { [spaceId]: _, ...rest } = shared(PARKED) ?? {};
  setShared(PARKED, left.length ? { ...rest, [spaceId]: { ...rec, agents: left } } : rest);
  return left;
}

// End agents (mode "end", for a worktree with agents that can come back) or Restore (mode "restore", for one with
// agents ended); offer: opened by a stage change, so only when there is something to do
function openPark(spaceId, mode, offer) {
  const w = worktrees().find((x) => x.key === spaceId);
  if (!w) return;
  const n = mode === "end" ? parkable(w).filter((a) => a.app).length : parkedCount((shared(PARKED) ?? {})[spaceId]);
  if (!n && offer) return;
  openOverlay({ mod: MOD, kind: "dialog", width: 460, height: 250, props: { part: "park", space: spaceId, name: w.name, mode } });
}

// a worktree's labels: a field to type one (an existing one, or a new one), the list to turn them on and off
function openLabels(spaceId, name, pointer) {
  openOverlay({ mod: MOD, kind: pointer ? "popup" : "dialog", width: 300, height: 320, props: { part: "labels", space: spaceId, name } });
}
const labelMap = () => shared(LABELS) ?? {};

// Minimize on the bar over an agent: beside the board (Peek or Focus), the side closes; in the board's place, the board
// comes back; either way the board takes the keyboard, so another card or agent is a click or a key away
function minimize(side) {
  if (side) { closeSide(); setShared(REFOCUS, Date.now()); } else openBoard(null);
}

// the agent beside the board (a card's click, Space or Focus) put away: going to an agent's whole screen closes it
// first, or it would show that same agent next to it, and pane.focus (which prefers a visible layout block) would send
// the keyboard there instead
function closeSide() {
  run("layout.hide", { id: "focus-term" });
  if (shared(PEEK)) setShared(PEEK, false);
  if (shared(FOCUS)) setShared(FOCUS, false);
}

// the shown space's terminals in the board's place, the whole screen
function showWork() {
  closeSide();
  run("layout.select", { stack: "main", child: "work" });
  setShared(LEFT, Date.now());
  setShared(VIEW, "work");
}

// an agent's terminal, with the keyboard
function goToAgent(address) {
  closeSide();
  seen(address);
  run("agent.focus", { terminal: address });
  setShared(SHOWN, address);
  run("pane.focus", { terminal: address });
  showWork();
}

// a worktree: its main agent (not a sub-agent it started there); a worktree without agents shows its terminals
function goToWorktree(w) {
  if (w.main) { goToAgent(w.main.a.address); return; }
  closeSide();
  setUnread(w.key, false);
  run("space.select", { id: w.key });
  showWork();
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
    .on_click((_e, cx) => { cx.stop_propagation(); setShared(SCOPE, "all"); setShared(MACHINE, null); })
    .child(div().w(6).h(6).rounded(3).bg(C.you))
    .child(div().font_family(SANS).text_size(size).text_color(C.you).child(`${n} elsewhere`));
}

// All / each machine, for the board and the sidebar: only when spaces are on more than one machine
function machineSwitch(id, wide) {
  const list = machineList();
  if (list.length < 2) return null;
  const cur = machineFilter();
  const seg = (key, on, label, value) => h_flex().id(`${id}-${key}`).h(wide ? 26 : 24).px(wide ? 6 : 9).gap(5).items_center()
    .when(wide, (el) => el.flex_1().min_w(0).justify_center()).flex_none().rounded(5).cursor_pointer()
    .bg(on ? C.raised : "#00000000").hover((st) => st.bg(on ? C.raised : C.hover))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click(() => setShared(MACHINE, value))
    .children(key === "all" ? [] : [icon("machine", 11, on ? C.text : C.dim)])
    .child(div().min_w(0).truncate().font_family(SANS).text_size(12).text_color(on ? C.text : C.muted).child(label));
  return h_flex().id(id).flex_none().p(2).gap(2).rounded(7).border(1).border_color(C.line2).bg(C.main)
    .when(wide, (el) => el.w_full())
    .child(seg("all", cur === null, "All machines", null))
    .children(list.map((m) => seg(`m-${m ?? "local"}`, cur === (m ?? ""), machineLabel(m), m ?? "")));
}

// the machine a space on another computer is on, beside its name
// ("offline" while Herdr can't reach it)
const machineTag = (m) => {
  const down = (shared(COUNTS)?.offline ?? []).includes(m);
  return h_flex().flex_none().h(16).px(5).gap(4).items_center().rounded(4).border(1).border_color(C.line2)
    .bg(C.raised).child(icon("machine", 10, down ? C.dim : C.muted)).child(mono(10, down ? C.dim : C.muted, down ? `${m} · offline` : m));
};

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
    if (this.part === "prs-settings") { this.prsSet = new PrsSettings(); this.prsSet.init(cx); return; }
    if (this.part === "prlist") { this.at = 0; this.h = cx.focus_handle(); this.h.focus(); cx.timer.after(300, () => this.h.focus()); return; }
    if (this.part === "park") { this.run = null; this.h = cx.focus_handle(); this.h.focus(); cx.timer.after(300, () => this.h.focus()); return; }
    if (this.part === "labels") { this.initLabels(cx); return; }
    if (this.part === "prs") {
      this.prsUi = new PrsBoard({ agentFor: worktreeOn, settings: openPrsSettings, refocused: () => shared(REFOCUS) ?? 0,
        openSpace: (id) => { const w = worktrees().find((x) => x.key === id); if (w) goToWorktree(w); } });
      this.prsUi.init(cx);
      return;
    }
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
        // board.json's features: off, the PRs view and its row go, and GitHub isn't read for it
        const features = (cx) => cx.spawn(async (cx) => {
          const f = (await boardConfig()).features;
          if (JSON.stringify(f) !== JSON.stringify(shared(FEATURES))) setShared(FEATURES, f);
          if (!f.prs && shownView() === "prs") openBoard(null);
          cx.notify();
        });
        features(cx);
        cx.timer.every(30000, features);
        // the PRs view's data: read here, where it is always drawn, so the sidebar can count it
        this.prsFeed = new PrsFeed();
        cx.timer.every(1000, (cx) => { if (prsFeature()) this.prsFeed.tick(cx); });
      }
      if (this.part === "nav") cx.spawn(async (cx) => {
        for (;;) {
          const c = String(await nextCommand()).replace(/^board-herdr\./, "");
          const k = c === "open-board" ? null : c.startsWith("open-") && STAGES.some(([s]) => s === c.slice(5)) ? c.slice(5) : undefined;
          if (k !== undefined) openBoard(k);
          else if (c === "new-agent") newAgent();
          else if (c === "close") closeTab();
          else if (c === "asks") toggleAsks(); // ⌘⇧A
          else if (c === "prs") { if (shownView() === "prs") openBoard(null); else openPrs(); } // ⌘⇧G
          else if (c === "prs-settings") openPrsSettings(); // the PRs view's gear
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
    this.clonePrs = {}; // a clone under a worktree's repos/ -> its open pull requests from its branches
    this.cloneAt = {}; // and when they were last asked
    this.repoPrs = {}; // a repo (git common dir) -> its open pull requests, anyone's, with the commit each is at
    this.repoAt = {}; // and when they were last asked
    this.prChecks = {}; // a pull request found by its commits (url) -> its checks
    this.checksAt = {}; // and when they were last asked
    this.offGithub = new Set(); // repos (git common dir) whose remotes aren't on GitHub
    this.stalls = {}; // machine -> gh calls in a row that GitHub didn't answer in time
    this.merged = []; // closedAt (ms) of my pull requests merged in the last 7 days
    this.problem = null; // the last git or gh error
    this.linearProblem = null; // the last Linear move that failed: "<ID> not moved in Linear: <reason>"
    this.moving = false; // a moveIssues run is under way
    this.offline = []; // the machines Herdr couldn't reach on the last read
    this.reading = false;
    this.lastRead = 0;
    this.sig = null; // the agents' statuses and the spaces' folders, to read again when one changes
    this.asks = {}; // address -> the question on its screen
    this.asking = false;
    this.filter = null; // a project, or null for all
    this.labelFilter = null; // a label, or null for all
    this.sel = null; // the selected worktree (space id)
    this.focus = false;
    this.peek = false; // Space: the selected worktree's agent beside the board, following the selection
    this.help = false; // ?: every key
    // each column's list (the Linear one's too), to keep the selected card in view
    this.scroll = Object.fromEntries([["linear"], ...STAGES].map(([k]) => [k, ScrollHandle.new()]));
    this.linear = { issues: [], error: null, at: 0 }; // the Linear column's last good read, and why the last one failed
    this.panX = 0; // how far the columns are scrolled sideways (px): a drag on the background, the wheel, the trackpad
    this.pan = null; // a drag on the background: {x, from, moved}
    // the selected card brought into view on the next draw, when the columns' widths are known: "reveal" (whole, the
    // least move) after a click, "center" when the board's width changed (the side opened, closed or was resized)
    this.toSel = null;
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
    cx.timer.every(LINEAR_MS, (cx) => this.readLinear(cx));
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
      // every pull request of the worktree: its own, its clones', its agents' folders'
      const prOf = (d) => { const x = this.git[d]; return x?.branch ? this.prs[`${x.common}|${x.branch}`] ?? null : null; };
      const folders = [...new Set(w.agents.map((x) => paneList.find((p) => p.pane === x.a.pane)?.cwd).filter((d) => d && d !== cwd))];
      const prList = mergePrs(pr, [folders.map(prOf), this.byCommits(g), ...folders.map((d) => this.byCommits(this.git[d])),
        ...(g?.clones ?? []).map((c) => this.clonePrs[c] ?? [])])
        .filter((p) => p.state === "OPEN");
      return { ...w, cwd, git: g, pr, prList, machine: w.space.machine ?? null, project: g?.project ?? w.space.name,
        branch: g?.branch ?? w.space.branch ?? null };
    });
  }

  // a folder whose branch has no pull request of that name (a review's rev/123, or no branch at all): the open ones of
  // its repo whose head is among its commits
  byCommits(g) {
    if (!g?.commits?.length || (g.branch && this.prs[`${g.common}|${g.branch}`] !== null)) return [];
    return prsByCommits(this.repoPrs[g.common], g.commits).map((p) => ({ ...p, checks: this.prChecks[p.url] ?? null }));
  }

  tick(cx) {
    if ((shared(LINEAR_MOVES) ?? []).length) this.moveIssues(cx);
    const sig = agents().map((a) => `${a.address}:${a.status}`).join(" ") + "|" + spaces().map((s) => `${s.id}:${place(s)}`).join(" ");
    if (sig !== this.sig) {
      this.sig = sig;
      this.refresh(cx, false);
    } else if (!this.reading && Date.now() - this.lastRead >= GIT_MS) this.refresh(cx, false);
  }

  // git in every worktree's folder, then gh for the branches whose pull request is due
  refresh(cx, force) {
    if (force) this.readLinear(cx, true);
    if (this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const paneList = panes();
        const where = new Map();
        for (const s of spaces()) { const d = place(s, paneList); if (d) where.set(d, s.machine ?? null); }
        // the folders its agents work in, when not the worktree's own (an implementer in another repo's worktree):
        // their branch's pull request is the worktree's too
        const machineOf = new Map(spaces().map((s) => [s.id, s.machine ?? null]));
        const cwdOf = new Map(paneList.map((p) => [p.pane, p.cwd]));
        for (const a of agents()) { const d = cwdOf.get(a.pane); if (d && !where.has(d)) where.set(d, machineOf.get(a.space) ?? null); }
        let problem = null;
        // a machine Herdr can't reach is a state, not an error to fix here: no git or gh there this round (each try
        // waits out its timeout), and its cards keep what was last read
        const down = new Set(machines().filter((m) => m.name && m.layout === "unavailable").map((m) => m.name));
        const cut = (on, e) => on && /unreachable|cannot reach/i.test(String(e?.message ?? e)) && down.add(on);
        const heard = (on, slow) => { this.stalls = ghStall(this.stalls, on, slow); };
        // a few at a time: on another machine each one is a round trip
        await eachLimit([...where], 8, async ([dir, on]) => {
          if (on && down.has(on)) return;
          try {
            const r = await exec("sh", ["-c", GIT, "sh", dir], { on });
            this.git[dir] = r.code === 0 ? parseGit(r.stdout) : null;
          } catch (e) { if (!cut(on, e)) problem = `git${on ? ` on ${on}` : ""}: ${String(e.message ?? e)}`; }
        });
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
        // each worktree's clones under repos/: your open pull requests from their branches, as often as a branch's
        const clones = new Map();
        for (const [dir, on] of where) for (const c of this.git[dir]?.clones ?? []) clones.set(c, on);
        await eachLimit([...clones], 4, async ([c, on]) => {
          if (on && down.has(on)) return;
          if (!force && this.clonePrs[c] && Date.now() - (this.cloneAt[c] ?? 0) < GH_MS) return;
          this.cloneAt[c] = Date.now();
          try {
            const r = await exec("sh", ["-c", CLONE_PRS, "sh", c], { on, timeout: 30000 });
            heard(on, false);
            if (r.code === 0) this.clonePrs[c] = parseClonePrs(r.stdout);
          } catch (e) { if (!cut(on, e) && timedOut(e)) heard(on, true); }
        });
        // one pull request lookup per branch that isn't the default one
        const branches = new Map();
        for (const [dir, on] of where) {
          const g = this.git[dir];
          if (g?.branch && g.branch !== g.base) branches.set(`${g.common}|${g.branch}`, { g, on });
        }
        await eachLimit([...branches], 4, async ([key, { g, on }]) => {
          if (on && down.has(on)) return;
          if (!force && this.prs[key] !== undefined && Date.now() - (this.prAt[key] ?? 0) < GH_MS) return;
          this.prAt[key] = Date.now();
          try {
            const r = await exec("gh", ["pr", "view", g.branch, "--json", "number,url,title,state,isDraft,mergeStateStatus,statusCheckRollup"], { cwd: g.root, on });
            heard(on, false);
            if (r.code === 0) {
              const p = JSON.parse(r.stdout);
              this.prs[key] = { number: p.number, url: p.url, title: p.title, state: p.state, draft: p.isDraft, merge: p.mergeStateStatus, checks: checks(p.statusCheckRollup) };
            } else if (/no pull requests found/i.test(r.stderr ?? "")) this.prs[key] = null;
            // a repo whose remotes aren't on GitHub: no pull requests to look for, and nothing to ship
            else if (/known GitHub host|no git remotes/i.test(r.stderr ?? "")) { this.prs[key] = null; this.offGithub.add(g.common); }
            // which machine's gh said it: another machine's login may not reach a repo this one does
            else problem = `gh${on ? ` on ${on}` : ""}: ${lastLine(r.stderr)}`;
          } catch (e) {
            // GitHub not answering in time keeps the card's last pull request; tried again when it's next due
            if (timedOut(e)) heard(on, true);
            else if (!cut(on, e)) problem = `gh${on ? ` on ${on}` : ""}: ${String(e.message ?? e)}`;
          }
        });
        // the folders whose branch has no pull request of its name: their repo's open pull requests (anyone's: a
        // review's are someone else's), to match by commit; one list per repo, as often as a branch's
        const repos = new Map();
        for (const [dir, on] of where) {
          const g = this.git[dir];
          if (g?.commits?.length && !(g.branch && this.prs[`${g.common}|${g.branch}`] !== null) && !this.offGithub.has(g.common)) {
            repos.set(g.common, { root: g.root, on });
          }
        }
        await eachLimit([...repos], 4, async ([common, { root, on }]) => {
          if (on && down.has(on)) return;
          if (!force && this.repoPrs[common] && Date.now() - (this.repoAt[common] ?? 0) < GH_MS) return;
          this.repoAt[common] = Date.now();
          try {
            // without checks: those of a busy repo's every open pull request take GitHub seconds; asked below for the
            // ones found
            const r = await exec("gh", ["pr", "list", "--state", "open", "--limit", "300", "--json",
              "number,url,title,isDraft,headRefName,headRefOid"], { cwd: root, on, timeout: 30000 });
            heard(on, false);
            if (r.code === 0) this.repoPrs[common] = parseRepoPrs(r.stdout);
          } catch (e) { if (!cut(on, e) && timedOut(e)) heard(on, true); }
        });
        // the checks of the pull requests found by commit
        const found = new Map();
        for (const [dir, on] of where) for (const p of this.byCommits(this.git[dir])) found.set(p.url, on);
        await eachLimit([...found], 4, async ([url, on]) => {
          if (on && down.has(on)) return;
          if (!force && this.checksAt[url] && Date.now() - this.checksAt[url] < GH_MS) return;
          this.checksAt[url] = Date.now();
          try {
            const r = await exec("gh", ["pr", "view", url, "--json", "statusCheckRollup"], { on, timeout: 30000 });
            heard(on, false);
            if (r.code === 0) this.prChecks[url] = checks(JSON.parse(r.stdout).statusCheckRollup);
          } catch (e) { if (!cut(on, e) && timedOut(e)) heard(on, true); }
        });
        this.problem = problem ?? stallProblem(this.stalls);
        this.offline = [...down].sort();
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

  // the Linear column's issues (with LINEAR_API_KEY), and your workspace's URL key and team keys; a failed read keeps
  // the last good one and says why in the bottom bar. A found key is kept; a missing one is looked up once per board
  // start, again on a forced refresh, and otherwise after 5 minutes, 15, then hourly (the lookup runs a login shell)
  readLinear(cx, force) {
    if (this.linearReading) return;
    this.linearReading = true;
    cx.spawn(async (cx) => {
      try {
        const wait = KEY_BACKOFF[Math.min(this.lkeyMisses ?? 0, KEY_BACKOFF.length) - 1] ?? 0;
        if (!this.lkey && (force || this.lkey === undefined || Date.now() - this.lkeyAt > wait)) {
          this.lkeyAt = Date.now();
          this.lkey = await linearKey();
          this.lkeyMisses = this.lkey ? 0 : (this.lkeyMisses ?? 0) + 1;
        }
        if (!this.lkey) return;
        const d = await linear(cx, this.lkey, LINEAR_TODO);
        this.linear = { issues: d.viewer.assignedIssues.nodes, error: null, at: Date.now() };
        const org = { urlKey: d.organization.urlKey, teamKeys: d.teams.nodes.map((t) => t.key) };
        if (JSON.stringify(org) !== JSON.stringify(shared(LINEAR_ORG) ?? null)) setShared(LINEAR_ORG, org);
      } catch (e) {
        if (this.lkey) this.linear = { ...this.linear, error: String(e.message ?? e) };
      } finally { this.linearReading = false; }
      this.share();
      cx.notify();
    });
  }

  // the issues New agent started in progress move to their team's first "started" state; each queued entry is taken off
  // whether it moved or not (one try), and a failure shows in the bottom bar
  moveIssues(cx) {
    if (this.moving || this.lkey === undefined) return; // one run at a time; the key's first lookup comes first
    this.moving = true;
    cx.spawn(async (cx) => {
      const queue = shared(LINEAR_MOVES) ?? [];
      let problem = null;
      try {
        for (const m of queue) {
          try {
            if (!this.lkey) throw new Error("no LINEAR_API_KEY");
            if (Date.now() - m.at > MOVE_MS) throw new Error("queued over 10 minutes ago");
            const d = await linear(cx, this.lkey, TEAM_STATES, { t: m.teamId });
            const state = startedState(d.team?.states?.nodes ?? []);
            if (!state) throw new Error("its team has no started state");
            const r = await linear(cx, this.lkey, MOVE_ISSUE, { id: m.uuid, s: state.id });
            if (r.issueUpdate?.success !== true) throw new Error("Linear didn't accept the update");
          } catch (e) { problem = `${m.id} not moved in Linear: ${String(e.message ?? e)}`; }
        }
      } finally {
        // what was taken goes, entries queued meanwhile stay
        const done = new Set(queue.map((m) => `${m.uuid}|${m.at}`));
        setShared(LINEAR_MOVES, (shared(LINEAR_MOVES) ?? []).filter((m) => !done.has(`${m.uuid}|${m.at}`)));
        this.moving = false;
      }
      this.linearProblem = problem;
      this.share();
      cx.notify();
      this.readLinear(cx);
    });
  }

  // what the top bar and the sidebar need from git: the count, and each space's repo; written only when it changed
  share() {
    const cards = this.cards;
    const counts = { tasks: cards.filter((t) => t.stage !== "archived").length, needs: cards.reduce((n, t) => n + t.needs.length, 0),
      when: new Date().toTimeString().slice(0, 5), problem: this.problem, offline: this.offline, linear: this.linear.error,
      linearProblem: this.linearProblem };
    if (JSON.stringify(counts) !== JSON.stringify(shared(COUNTS) ?? {})) setShared(COUNTS, counts);
    const repos = Object.fromEntries(cards.filter((t) => t.git).map((t) => [t.key, { common: t.git.common, name: t.git.project }]));
    if (JSON.stringify(repos) !== JSON.stringify(shared(REPOS) ?? {})) setShared(REPOS, repos);
    // a space that no longer exists drops its issue link (no spaces at all: Herdr is still starting, keep them)
    const kept = shared(SPACE_ISSUES) ?? {}, live = new Set(spaces().map((s) => s.id));
    const alive = Object.fromEntries(Object.entries(kept).filter(([id]) => live.has(id)));
    if (live.size && Object.keys(alive).length !== Object.keys(kept).length) setShared(SPACE_ISSUES, alive);
    // and its labels, and its ended agents
    for (const key of [LABELS, PARKED]) {
      const m = shared(key) ?? {}, left = dropGone(m, live);
      if (live.size && Object.keys(left).length !== Object.keys(m).length) setShared(key, left);
    }
    const branches = cards.filter((t) => t.git?.branch).map((t) => ({ space: t.key, project: t.git.project, branch: t.git.branch }));
    if (JSON.stringify(branches) !== JSON.stringify(shared(BRANCHES) ?? [])) setShared(BRANCHES, branches);
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

  // a nudge, never a move: an open pull request on a card still in Planning or In progress, or a merged one not archived
  nudge(t) {
    if (t.pr?.state === "OPEN" && (t.stage === "todo" || t.stage === "in_progress")) return "in_review";
    if (t.pr?.state === "MERGED" && t.stage !== "archived" && t.stage !== "perpetual") return "archived";
    return null;
  }

  // ---- moving around ------------------------------------------------------------------------------------------

  // the board's columns: the Linear one first when you have a LINEAR_API_KEY, then the stages
  linearCols() { return this.lkey ? [["linear", "Linear · Todo", "#8b93f8"], ...STAGES] : STAGES; }

  // the Linear column's cards ({key: "linear:<ID>", issue}): your issues waiting to start, minus those a worktree
  // already is (on any card, whatever the filters) and those just started
  linearList(cards = this.cards) {
    const linked = new Set(cards.map((t) => issueOf(t.key, t.branch)?.id).filter(Boolean));
    return todoColumn(this.linear.issues, { linked, starting: shared(STARTING) ?? {}, now: Date.now() })
      .map((i) => ({ key: `linear:${i.identifier}`, issue: i }));
  }

  // the selected Linear card's issue (as Linear gives it), else null
  linearSel() {
    return this.sel?.startsWith("linear:") ? this.linearList().find((x) => x.key === this.sel)?.issue ?? null : null;
  }

  // the cards the board shows, column by column (linearCols()): the repo, project and search filters, in your order;
  // the Linear column only takes the search
  columns() {
    const q = this.query.trim().toLowerCase();
    const has = (list) => !q || list.some((v) => String(v ?? "").toLowerCase().includes(q));
    const lm = labelMap();
    const hit = (t) => has([t.name, t.branch, t.project, t.space.name, ...t.agents.map((x) => cleanTitle(x.a.title)),
      ...t.needs.map((x) => this.asks[x.a.address]), ...labelsOf(lm, t.key)]);
    const cards = this.cards;
    const shown = cards.filter((t) => inScope(t.key) && (!this.filter || t.project === this.filter)
      && (!this.labelFilter || labelsOf(lm, t.key).includes(this.labelFilter)) && hit(t));
    // grouped by label: each column's cards in their groups' order, so the keys walk them as they show
    const grouped = (list) => (shared(GROUP) ? groupByLabel(list, lm).flatMap(([, cs]) => cs) : list);
    // in the order you dragged them to, the same as the sidebar's
    const order = shared(ORDER) ?? [];
    return this.linearCols().map(([k]) => (k === "linear"
      ? this.linearList(cards).filter(({ issue: i }) => has([i.identifier, i.title, i.team?.name, i.project?.name]))
      : grouped(byOrder(shown.filter((t) => t.stage === k), (t) => t.key, order))));
  }

  // what the keys move through: folded columns count as empty
  navCols() {
    const lc = this.linearCols();
    return this.columns().map((l, i) => (this.folded.has(lc[i][0]) ? [] : l));
  }

  visible() { return this.navCols().flat(); }

  // selects a card; a click (open) also shows its agent beside the board, and while the side is open it follows the
  // selection: in Focus the one waiting for you (else the main one) with the keyboard, else the main one
  pick(cx, key, open) {
    this.sel = key;
    if (key.startsWith("linear:") && this.peek) this.setPeek(cx, false); // no worktree's agent beside an issue
    const t = this.cards.find((x) => x.key === key);
    const x = this.focus ? t?.needs[0] ?? t?.main : t?.main;
    if (x && (open || this.focus || this.peek)) this.peekAt(cx, x.a.address);
    else if (t && !t.issue && !t.agents.length && (open || this.focus || this.peek)) this.peekSpace(cx, t);
    if (open) this.toSel ??= "reveal";
    cx.notify();
  }

  // one agent beside the board (the side opens if it's closed); the board stays shown, its cards still clickable
  peekAt(cx, address) {
    if (!this.focus && !this.peek) {
      this.peek = true;
      setShared(PEEK, true);
      run("layout.show", { id: "focus-term" });
    }
    if (this.focus) this.answerIn(address); else this.show(cx, address);
    cx.notify();
  }

  // a worktree without agents: its terminals beside the board, as its space arranges them (the side's agent block
  // shows only agents), the keyboard staying on the board
  peekSpace(cx, t) {
    if (!this.focus && !this.peek) {
      this.peek = true;
      setShared(PEEK, true);
      run("layout.show", { id: "focus-term" });
    }
    setUnread(t.key, false);
    setShared(SHOWN, null);
    // the tab block first: while the side's agent block still shows the last card's agent, the shown space goes back
    // to that agent's, and the first click showed the last card's tab; checked again after this draw for that reason
    run("layout.select", { stack: "focus-body", child: "focus-tab" });
    run("space.select", { id: t.key });
    cx.timer.after(60, () => {
      if (activeSpace()?.id !== t.key && findNode(layout(), "focus-body")?.active === "focus-tab") run("space.select", { id: t.key });
    });
    this.grab(cx);
    cx.notify();
  }

  // the board takes the keyboard, just after this draw or command (focus can't move while drawing, nor from a task)
  grab(cx) {
    cx.timer.after(30, () => this.h.focus());
  }

  // an agent in the focus-term block, the keyboard staying on the board
  show(cx, address) {
    seen(address);
    run("layout.select", { stack: "focus-body", child: "focus-agent" });
    run("agent.focus", { terminal: address });
    setShared(SHOWN, address);
    this.grab(cx);
  }

  // shows the agent in the focus-term block and gives that block the keyboard (pane.focus prefers a visible layout
  // terminal block showing the address), so typing answers it
  answerIn(address) {
    seen(address);
    run("layout.select", { stack: "focus-body", child: "focus-agent" });
    run("agent.focus", { terminal: address });
    setShared(SHOWN, address);
    run("pane.focus", { terminal: address });
  }

  // ↑↓ within the column (dr), ←→ to the nearest column with cards (dc), keeping the row as near as it can;
  // with nothing selected, the first card (of the column the sidebar marked, else the first one with cards)
  step(cx, dc, dr) {
    const cols = this.navCols();
    let c = cols.findIndex((l) => l.some((t) => t.key === this.sel));
    if (c < 0) {
      const marked = this.linearCols().findIndex(([k]) => k === this.col);
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
    this.reveal(c);
    this.scroll[this.linearCols()[c][0]].scroll_to_item(r);
    this.pick(cx, cols[c][r].key);
  }

  // scrolls the columns sideways so column c shows whole
  reveal(c) {
    const x = this.colX?.[c], w = this.colWs?.[c], view = this.colsW ?? 0;
    if (x == null) return;
    if (x < this.panX) this.panX = x;
    else if (x + w > this.panX + view) this.panX = Math.min(this.panMax ?? 0, x + w - view);
  }

  // the selected card in view: its column scrolled sideways (centred, or just whole) and the card within its column
  bringSel(lc, by, how) {
    const c = lc.findIndex(([k]) => !this.folded.has(k) && by(k)?.some((t) => t.key === this.sel));
    if (c < 0) return;
    if (how === "center") {
      const mid = this.colX[c] + this.colWs[c] / 2 - (this.colsW ?? 0) / 2;
      this.panX = Math.max(0, Math.min(this.panMax ?? 0, Math.round(mid)));
    } else this.reveal(c);
    this.scroll[lc[c][0]].scroll_to_item(by(lc[c][0]).findIndex((t) => t.key === this.sel));
  }

  panTo(cx, x) {
    const to = Math.max(0, Math.min(this.panMax ?? 0, x));
    if (to !== this.panX) { this.panX = to; cx.notify(); }
  }

  // 0 (the Linear column), 1-9 (a stage): that column's first card (unfolding it)
  toColumn(cx, k) {
    const c = this.linearCols().findIndex(([x]) => x === k);
    if (c < 0) return;
    this.folded.delete(k);
    const cols = this.navCols();
    if (cols[c]?.length) this.select(cx, cols, c, 0);
    cx.notify();
  }

  // a drag whose release the board never saw (it happened over an agent, or another view): forgotten, so the next
  // move over a column doesn't carry the card along
  cancelDrag() { this.dragCard = null; this.dropCol = null; this.dropNear = null; this.pan = null; }

  goTo(cx, t, address) {
    if (!t) return;
    this.cancelDrag();
    if (this.focus) this.setFocus(cx, false);
    if (this.peek) this.setPeek(cx, false);
    if (address) goToAgent(address); else goToWorktree(t);
  }

  setFocus(cx, on, task) {
    this.focus = on;
    if (on) {
      this.peek = false; // Focus shows the same block, with the keyboard
      setShared(PEEK, false);
      const needs = this.visible().filter((x) => !x.issue); // a Linear card has no agent to answer
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
      if (t?.main) this.show(cx, t.main.a.address);
      else if (t && !t.issue && !t.agents.length) this.peekSpace(cx, t);
    } else run("layout.hide", { id: "focus-term" });
    cx.notify();
  }

  // a card dragged onto another column: that stage (as the stage picker would set it), the card stays selected;
  // a card dropped by another one goes above or below it; in an empty part of another column, at its end
  // a Linear card only opens its summary (Planning or In progress; nothing starts before its ⏎), and stays in its column
  dropCard(cx) {
    const key = this.dragCard, to = this.dropCol, near = this.dropNear;
    this.dragCard = null; this.dropCol = null; this.dropNear = null;
    if (key?.startsWith("linear:")) {
      const it = to && canDrop(to) ? this.linearList().find((x) => x.key === key) : null;
      if (it) startIssue(issueRef(it.issue), to);
      this.sel = key;
      cx.notify();
      return;
    }
    if (!key || (!to && !near)) return;
    const end = !near && to ? this.columns()[this.linearCols().findIndex(([k]) => k === to)].filter((t) => t.key !== key).pop() : null;
    if (to) setStage(key, to);
    const place = near ?? (end ? { key: end.key, after: true } : null);
    if (place) {
      const known = new Set([...spaces().map((s) => s.id), ...agents().map((a) => a.address)]);
      setShared(ORDER, moveKey((shared(ORDER) ?? []).filter((k) => known.has(k)), key, place.key, place.after));
    }
    this.sel = key;
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
    // the selected worktree, or (t undefined) the selected Linear card's issue: it only starts (⏎, S) or opens (O)
    const t = this.cards.find((x) => x.key === this.sel), li = this.linearSel();
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
    else if (k === "0") this.toColumn(cx, "linear");
    else if (/^[1-9]$/.test(k)) this.toColumn(cx, STAGES[Number(k) - 1]?.[0]);
    else if ((k === "backspace" || k === "delete") && t) deleteWorktree(t.key);
    else if (k === "s" && li) openStagePicker(null, li.identifier, null, false, { only: ["todo", "in_progress"], issue: issueRef(li) });
    else if (k === "s" && t) openStagePicker(t.key, t.name, t.stage, false);
    else if (k === "enter" && li) { if (!e.is_held) startIssue(issueRef(li), "in_progress"); } // a held ⏎ would start it
    else if (k === "enter" && t) this.goTo(cx, t);
    else if (k === "space") this.setPeek(cx, !this.peek);
    else if (k === "f") this.setFocus(cx, !this.focus, t?.needs.length ? t : undefined);
    else if (k === "escape") this.back(cx);
    else if (k === "?" || (k === "/" && m.shift)) { this.help = !this.help; cx.notify(); }
    else if (k === "/") this.search.focus();
    else if (k === "a" && t) { this.archive(t); cx.notify(); }
    else if (k === "u" && t) { setUnread(t.key, !isUnread(t.key)); cx.notify(); }
    else if (k === "t" && t) openLabels(t.key, t.name, false);
    else if (k === "g") { setShared(GROUP, !shared(GROUP)); cx.notify(); }
    else if (k === "r") toggleAsks();
    else if (k === "y" && t && this.recommended(t)) { const [q, o] = this.recommended(t); this.answerer.answer(q, o, cx); }
    else if (k === "m" && this.landMove(t)) this.ask(cx, t, this.landMove(t));
    else if (k === "o" && li?.url) cx.spawn(async () => { await exec("open", [li.url]); });
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
      ["↑ ↓  j k", "move within a column"], ["← →  h l", "move across columns"], ["1 – 9", "first card of a stage"],
      ["0", "the Linear column"],
      ["S  drag", "change the stage, or the order"], ["⇧← ⇧→", "stage before / after"], ["A", "archive / unarchive"], ["U  right-click", "mark unread / the card's menu"], ["T", "labels"], ["G", "group by label"], ["⌫", "delete the worktree"],
      ["Click", "its agent beside the board"], ["⏎  double-click", "open the worktree's agent"],
      ["⏎ on an issue", "start it"], ["Space", "show / hide the side"],
      ["F", "Focus: answer what needs you"],
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
    if (this.part === "agent-head") return this.agentHead();
    if (this.part === "bottom") return this.bottom();
    if (this.part === "nav") return this.nav();
    if (this.part === "asks") return this.asksUi.render(cx);
    if (this.part === "prs") {
      // drawing means the stack shows it: tell the top bar, as board() does
      if (shared(VIEW) === "work" && Date.now() - (shared(LEFT) ?? 0) > 1500) setShared(VIEW, "prs");
      return this.prsUi.render(cx);
    }
    if (this.part === "prs-settings") return this.prsSet.render(cx);
    if (this.part === "new") return this.summary ? this.summaryDialog() : this.newDialog();
    if (this.part === "stage") return this.stagePicker();
    if (this.part === "prlist") return this.prListView();
    if (this.part === "park") return this.parkDialog();
    if (this.part === "labels") return this.labelsView();
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
      // a press here isn't the card's drag: the click below stops the release, which would leave that drag going
      // (the board still takes the keyboard, as a press anywhere on it does)
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); if (this.part === "board") this.h?.focus(); })
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }).child(label);
  }

  // a small link on a card (the Linear issue, the plan): a press on it isn't the card's drag, a click isn't its pick
  // a label on a card: its color from its name, as a project's; a click filters the board to it (again: all)
  labelPill(id, l) {
    const [fg] = chipColor(l);
    const on = this.labelFilter === l;
    return div().id(id).flex_none().h(20).px(7).flex().items_center().rounded(10).border(1).border_color(on ? fg : `${fg}55`)
      .bg(`${fg}${on ? "33" : "14"}`).cursor_pointer().hover((st) => st.bg(`${fg}2a`))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.labelFilter = on ? null : l; cx.notify(); })
      .child(div().font_family(SANS).text_size(11).text_color(fg).child(l));
  }

  linkPill(id, label, color, onClick) {
    return div().id(id).flex_none().h(20).px(7).flex().items_center().rounded(4).border(1).border_color(`${color}55`)
      .bg(`${color}14`).cursor_pointer().hover((st) => st.bg(`${color}2a`))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .child(mono(10, color, label));
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
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()) // not the card's drag (see btn)
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

  // one agent on a card: a click shows it beside the board, a double-click goes to it
  agentLine(t, x) {
    const a = x.a, tab = x.tab, now = this.now;
    const age = a.status === "blocked" ? (tab?.changed_at ? dur(now - tab.changed_at) : "")
      : a.status === "working" ? (tab?.working_since ? dur(now - tab.working_since) : "") : "";
    const subs = tally(x.subs.map(subStatus));
    return h_flex().id(`cl-${a.address}`).w_full().h(24).px(4).gap(7).items_center().rounded(4).cursor_pointer()
      .hover((st) => st.bg(C.raised))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()) // not the card's drag (see btn)
      .on_click((e, cx) => {
        cx.stop_propagation();
        if (e.click_count === 2) { this.goTo(cx, t, a.address); return; }
        this.sel = t.key;
        this.toSel ??= "reveal";
        this.peekAt(cx, a.address);
      })
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
    const iss = issueOf(t.key, t.branch);
    const unread = isUnread(t.key);
    const others = t.prList.filter((p) => p.url !== pr?.url);
    const labels = labelsOf(labelMap(), t.key);
    const parked = parkedCount((shared(PARKED) ?? {})[t.key]);
    if (parked) facts.push([`${plural(parked, "agent")} ended`, C.muted]);
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
        .when(!!q, (el) => el.child(this.btn(`asks-${t.key}`, pickable(q) || q.form ? "Asks  R" : "Reply  R", blocked ? "plain" : "you", () => toggleAsks(true))))
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
        .when(t.stage === "done" && isWorktree(t.space), (el) => el.child(this.btn(`del-${t.key}`, "Delete now", "plain", () => deleteWorktree(t.key))))
        .when(parked > 0, (el) => el.child(this.btn(`restore-${t.key}`, `↺ Restore ${plural(parked, "agent")}`, "land", () => openPark(t.key, "restore"))));
    }

    // a flex row (stretching, unlike h_flex) so the status bar on the left runs the card's full height
    const near = this.dropNear?.key === t.key ? this.dropNear : null;
    return div().id(`card-${t.key}`).relative().w_full().flex_none().flex().flex_row().rounded(6).overflow_hidden()
      // selected: a tinted background and a solid 2 px outline in the accent, so the keys' place is plain; else, on
      // another machine, a dashed outline, like a box around it
      .bg(sel ? (asking ? C.selAsk : C.selBg) : asking ? C.youCard : C.card)
      .border(sel || t.machine ? 2 : 1).border_color(sel ? C.accent : t.machine ? C.remote : C.line)
      .when(!!t.machine && !sel, (el) => el.border_dashed())
      .cursor_pointer().hover((s) => s.bg(sel ? (asking ? C.selAsk : C.selBg) : C.hover))
      // a click shows its agent beside the board, a double-click goes to it; a drag to another column moves its stage
      // a drag over another card lands above or below it (a line shows where), in its column
      .on_mouse_down("left", () => { this.dragCard = t.key; this.dropCol = null; this.dropNear = null; })
      .on_mouse_move((e, cx) => {
        if (!this.dragCard || this.dragCard.startsWith("linear:")) return; // a Linear card has no place among them
        const n = t.key === this.dragCard ? null : { key: t.key, after: e.local_position.y > e.bounds.height / 2 };
        if (JSON.stringify(n) !== JSON.stringify(this.dropNear)) { this.dropNear = n; cx.notify(); }
      })
      .on_hover((on, cx) => { if (!on && this.dropNear?.key === t.key) { this.dropNear = null; cx.notify(); } })
      .when(this.dragCard === t.key && Boolean(this.dropCol || this.dropNear), (el) => el.opacity(0.45))
      .on_click((e, cx) => (e.click_count === 2 ? this.goTo(cx, t) : this.pick(cx, t.key, true)))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.cancelDrag(); this.sel = t.key; cx.notify();
        openStagePicker(t.key, t.name, t.stage, true, { menu: true, prs: t.prList, end: parkable(t).filter((a) => a.app).length,
          restore: parkedCount((shared(PARKED) ?? {})[t.key]) }); })
      .child(div().w(3).flex_none().bg(statusColor(unread ? "done" : t.status)))
      .child(v_flex().flex_1().min_w(0).px(11).py(9).gap(5)
      .child(h_flex().w_full().gap(6).items_center()
        .child(chip(t.project))
        .when(!!t.machine, (el) => el.child(machineTag(t.machine)))
        .child(div().flex_1().min_w(0).truncate().font_family(MONO).text_size(11).text_color(C.dim).child(t.branch ?? ""))
        .child(this.stageButton(t)))
      .child(h_flex().w_full().gap(8).items_start()
        .child(div().flex_1().min_w(0).font_family(SANS).text_size(14).font_weight(600).text_color(C.text).child(t.name))
        // marked unread: green, as a finished agent, until one of its agents is opened
        .when(unread, (el) => el.child(h_flex().flex_none().pt(3).gap(5).items_center()
          .child(div().w(7).h(7).rounded(4).bg(C.land)).child(mono(10, C.land, "unread")))))
      // its links, on a row of their own so the stage button above always fits: the Linear issue, and in Planning the
      // plan its skill wrote, to read in the browser
      .when(!!iss || (t.stage === "todo" && !!g?.plan) || others.length > 0 || labels.length > 0, (el) => el.child(h_flex().w_full().flex_wrap().gap(6).items_center()
        // its labels: a click shows only the cards with that one
        .children(labels.map((l) => this.labelPill(`lbl-${t.key}-${l}`, l)))
        .when(!!iss, (el) => el.child(this.linkPill(`iss-${t.key}`, `↗ ${iss.id}`, REF_KINDS.linear[1],
          (cx) => cx.spawn(async () => { await exec("open", [iss.url]); }))))
        // the pull requests it has besides its own branch's (that one is in the facts): one opens, more list
        .when(others.length === 1 && !pr, (el) => el.child(this.linkPill(`prs-${t.key}`, `↗ ${others[0].repo?.split("/").pop() ?? "PR"}#${others[0].number}`,
          C.accent, (cx) => cx.spawn(async () => { await exec("open", [others[0].url]); }))))
        .when(t.prList.length > 1, (el) => el.child(this.linkPill(`prs-${t.key}`, `${t.prList.length} PRs ▾`, C.accent,
          () => openPrList(t.name, t.prList, true))))
        .when(t.stage === "todo" && !!g?.plan, (el) => el.child(this.linkPill(`plan-${t.key}`, "📄 Plan ready", C.land,
          (cx) => cx.spawn(async () => {
            try { await openPlan(g.plan, t.machine, `${iss?.id ?? t.name} plan`); }
            catch (e) { notify({ title: "Couldn't open the plan", body: String(e.message ?? e), level: "error" }); }
          }))))))
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
      .children(actions ? [actions] : []))
      .when(Boolean(near), (el) => el.child(div().absolute().left(0).right(0).h(3).bg(C.accent)
        .when(!near.after, (l) => l.top(0)).when(near.after, (l) => l.bottom(0))));
  }

  // a Linear card: its ID, title, team (or project) and priority, and ↗ Linear; dragged onto Planning or In progress
  // (the only columns that light up for it) it opens its summary, and stays here until that starts it
  linearCard(it) {
    const i = it.issue, sel = it.key === this.sel;
    const where = [i.project?.name ?? i.team?.name, i.priorityLabel && i.priorityLabel !== "No priority" ? i.priorityLabel : null]
      .filter(Boolean).join(" · ");
    return div().id(`card-${it.key}`).w_full().flex_none().flex().flex_row().rounded(6).overflow_hidden()
      .bg(sel ? C.selBg : C.card).border(sel ? 2 : 1).border_color(sel ? C.accent : C.line)
      .cursor_pointer().hover((s) => s.bg(sel ? C.selBg : C.hover))
      .on_mouse_down("left", () => { this.dragCard = it.key; this.dropCol = null; this.dropNear = null; })
      .when(this.dragCard === it.key && Boolean(this.dropCol), (el) => el.opacity(0.45))
      .on_click((_e, cx) => this.pick(cx, it.key))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.cancelDrag(); this.sel = it.key; cx.notify();
        openStagePicker(null, i.identifier, null, true, { only: ["todo", "in_progress"], issue: issueRef(i), menu: true }); })
      .child(div().w(3).flex_none().bg(REF_KINDS.linear[1]))
      .child(v_flex().flex_1().min_w(0).px(11).py(9).gap(5)
        .child(h_flex().w_full().gap(6).items_center()
          .child(div().flex_1().min_w(0).truncate().child(mono(11, REF_KINDS.linear[1], i.identifier)))
          .child(this.btn(`lin-${it.key}`, "↗ Linear", "plain", (cx) => cx.spawn(async () => { await exec("open", [i.url]); }))))
        .child(div().font_family(SANS).text_size(14).font_weight(600).text_color(C.text).child(i.title ?? ""))
        .when(Boolean(where), (el) => el.child(div().truncate().child(mono(11, C.dim, where)))));
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
      // every option whole: a long one wraps, its detail (when the agent gave one) under it
      .when(pickable(q) && many < 2, (el) => el.child(v_flex().w_full().gap(3).children(q.options.map((o, i) =>
        h_flex().id(`ao-${t.key}-${o.n}`).w_full().min_h(24).px(6).py(4).gap(7).items_start().rounded(4)
          .border(1).border_color(rec(i) ? C.accentDim : C.line2).bg(C.card)
          .cursor_pointer().hover((s) => s.bg(C.hover).border_color(C.accent))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation()) // not the card's drag (see btn)
          .on_click((_e, cx) => { cx.stop_propagation(); this.answerer.answer(q, o, cx); })
          .child(div().pt(1).flex_none().child(mono(10, C.muted, String(o.n))))
          .child(v_flex().flex_1().min_w(0).gap(1)
            .child(div().font_family(SANS).text_size(12).text_color(C.text).child(o.label.replace(/\s*\(recommended\)\s*$/i, "")))
            .when(Boolean(o.detail), (el) => el.child(div().font_family(SANS).text_size(11).text_color(C.muted).child(o.detail)))
            .when(rec(i), (el) => el.child(mono(10, C.accent, sel ? "recommended · Y" : "recommended"))))))))
      .when(!q.form && many > 1, (el) => el.child(mono(10, C.dim, `${many} questions: answer them in Asks (R)`)))
      .when(Boolean(q.form) && !sending, (el) => el.child(mono(10, C.dim, q.form.length > 1
        ? `${q.form.length} questions in one form: answer them in Asks (R)` : "takes several answers: pick them in Asks (R)")))
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
    if (rf !== this.refocusAt) { this.refocusAt = rf; this.cancelDrag(); if (!this.focus) this.grab(cx); }
    const every = this.cards;
    const cards = every.filter((t) => inScope(t.key));
    const away = every.filter((t) => !inScope(t.key)).reduce((n, t) => n + t.needs.length, 0);
    if (this.filter && !cards.some((t) => t.project === this.filter)) this.filter = null;
    if (this.labelFilter && !cards.some((t) => labelsOf(labelMap(), t.key).includes(this.labelFilter))) this.labelFilter = null;
    if (this.peek && !shared(PEEK)) this.peek = false;
    const lc = this.linearCols(), cols = this.columns();
    const by = (k) => cols[lc.findIndex(([c]) => c === k)];
    const week = this.week();
    const maxW = Math.max(1, ...week);
    const openPrs = new Set(cards.filter((t) => t.pr?.state === "OPEN").map((t) => t.pr.url)).size;
    const ags = cards.flatMap((t) => t.agents);
    const subs = cards.flatMap((t) => t.subs);
    // the oldest question
    const asked = cols.flat().flatMap((t) => (t.needs ?? []).map((x) => ({ t, x })));
    const next = asked.sort((p, q) => (p.x.tab?.changed_at ?? 0) - (q.x.tab?.changed_at ?? 0))[0];
    const projects = [...new Set(cards.map((t) => t.project))].sort();
    const lm = labelMap(), labelsAll = allLabels(Object.fromEntries(cards.map((t) => [t.key, labelsOf(lm, t.key)]).filter(([, l]) => l.length)));
    // the leftover worktrees of the repos shown
    const leftover = (machineFilter() ?? "") !== "" ? [] // they're this computer's
      : this.orphans.filter((o) => allSpaces() || o.repo === repoKey(activeSpace()?.id));

    const strip = (div().w_full().flex_none().flex().flex_row().gap(10)
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
      .children([machineSwitch("machine", false)].filter(Boolean))
      .when(away > 0, (el) => el.child(elsewhere("away", away, 12)))
      .child(div().w(1).h(16).mx(4).bg(C.line2))
      .child((h_flex().gap(6).items_center()
        .child(this.filterChip(null, "all", cards.length))
        .children(projects.map((p) => this.filterChip(p, p, cards.filter((t) => t.project === p).length,
          cards.some((t) => t.project === p && t.needs.length))))))
      // the labels in use: a click shows only that one's cards; Group puts each column's cards under their first label
      .when(labelsAll.length > 0, (el) => el.child(div().w(1).h(16).mx(4).bg(C.line2))
        .children(labelsAll.map((l) => this.labelFilterChip(l, cards.filter((t) => labelsOf(lm, t.key).includes(l)).length)))
        .child(this.labelFilterChip(null, 0)))
      .when(leftover.length > 0, (el) => el.child(this.btn("leftover", `${plural(leftover.length, "leftover worktree")} · clean up`, "plain",
        () => openOverlay({ mod: MOD, kind: "dialog", width: 640, height: 480, props: { part: "cleanup", orphans: leftover } }))))
      .child(div().flex_1())
      .child(h_flex().id("search").w(170).h(26).flex_none().px(8).gap(6).items_center().rounded(6).border(1)
        .border_color(this.searching ? C.accentDim : C.line2).bg(C.main)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(mono(11, C.dim, "/"))
        .child(Input.new(this.search).flex_1().min_w(0).h(24).font_family(SANS).text_size(12).text_color(C.text)))
      .child(mono(11, C.dim, this.focus ? "type in the terminal to answer · ⌘E back to the board"
        : this.peek ? "click a card to see its agent · esc closes the side · ⏎ opens it" : "S stage · ? keys"))
      .child(this.btn("new-agent", "+ New agent  N", "new", () => newAgent()))
      .child(this.btn("focus", "◎ Focus  F", this.focus ? "on" : "plain", (cx) => this.setFocus(cx, !this.focus)));

    const column = ([k, label, color], i) => {
      const list = by(k);
      const folded = this.folded.has(k);
      const hot = this.col === k;
      const head = h_flex().id(`head-${k}`).w_full().h(22).flex_none().gap(7).items_center().cursor_pointer()
        .on_click((_e, cx) => { if (folded) this.folded.delete(k); else this.folded.add(k); cx.notify(); })
        .child(div().w(10).flex_none().text_size(9).text_color(C.dim).child(folded ? "▸" : "▾"))
        .child(div().w(8).h(8).flex_none().rounded(4).bg(color))
        .child(div().min_w(0).truncate().child(mono(11, hot ? color : list.length ? C.soft : C.dim, label.toUpperCase())))
        .child(div().flex_none().px(5).rounded(8).bg(C.raised).font_family(MONO).text_size(10).text_color(C.muted).child(String(list.length)));
      const drop = this.dropCol === k;
      return v_flex().id(`col-${k}`).min_h(0).gap(8).p(6).rounded(8).border(1)
        .flex_none().w(widths[i])
        .border_color(drop ? color : hot ? `${color}66` : "#00000000").bg(drop ? `${color}1a` : hot ? `${color}0d` : "#00000000")
        // a card dragged over another column lands there on release; a Linear card only on Planning or In progress, and
        // nothing on the Linear column
        .on_mouse_move((_e, cx) => {
          if (!this.dragCard) return;
          const from = this.cards.find((x) => x.key === this.dragCard)?.stage;
          const to = this.dragCard.startsWith("linear:") ? (canDrop(k) ? k : null) : k !== "linear" && from && from !== k ? k : null;
          if (to !== this.dropCol) { this.dropCol = to; cx.notify(); }
        })
        .on_mouse_up("left", (_e, cx) => this.dropCard(cx))
        .child(head)
        .when(!folded, (el) => el.child(v_flex().id(`list-${k}`).w_full().flex_1().min_h(0).gap(8).overflow_y_scrollbar().track_scroll(this.scroll[k])
          .children(list.map((t, i) => {
            if (k === "linear") return this.linearCard(t);
            // grouped by label: the group's name over its first card (in the card's own slot, so scrolling to the
            // n-th card still lands on it)
            const l = labelsOf(labelMap(), t.key)[0] ?? null;
            if (!shared(GROUP) || (i > 0 && (labelsOf(labelMap(), list[i - 1].key)[0] ?? null) === l)) return this.card(t);
            return v_flex().w_full().flex_none().gap(6)
              .child(div().pt(i ? 6 : 0).child(mono(10, l ? chipColor(l)[0] : C.dim, l ? `# ${l.toUpperCase()}` : "NO LABEL")))
              .child(this.card(t));
          }))));
    };

    // the columns with cards share what the folded and empty ones leave, but never below COL_MIN: narrower than that
    // (an agent open beside the board) only the columns scroll sideways; the numbers and filters above keep the width
    const fixed = 12 * (lc.length - 1) + lc.reduce((w, [k]) =>
      w + (this.folded.has(k) ? FOLDED_W : by(k).length ? 0 : EMPTY_W), 0);
    const open = lc.filter(([k]) => !this.folded.has(k) && by(k).length).length;
    const colW = Math.max(COL_MIN, Math.floor(((this.colsW ?? 0) - fixed) / Math.max(1, open)));
    // the columns scroll sideways by hand (a drag on the background, as Linear does, or the wheel): where each starts
    // a column whose card asks a question widens to fit its options (up to ASK_MAX_W; the columns then scroll sideways)
    const askW = (t) => {
      const q = !t.issue && asksIn(t)[0];
      if (!q) return 0;
      const longest = Math.max(0, ...(pickable(q) ? q.options : []).map((o) => o.label.length), (q.question ?? "").length / 3);
      return Math.min(ASK_MAX_W, Math.round(longest * 6.6 + 100));
    };
    const widths = lc.map(([k]) => (this.folded.has(k) ? FOLDED_W : by(k).length ? Math.max(colW, ...by(k).map(askW)) : EMPTY_W));
    this.colWs = widths;
    this.colX = widths.map((_w, i) => widths.slice(0, i).reduce((a, b) => a + b, 0) + 12 * i);
    const contentW = widths.reduce((a, b) => a + b, 0) + 12 * (lc.length - 1), view = this.colsW ?? 0;
    this.panMax = Math.max(0, contentW - view);
    this.panX = Math.min(this.panX, this.panMax);
    if (this.toSel) { this.bringSel(lc, by, this.toSel); this.toSel = null; }
    return v_flex().id("board").relative().size_full().bg(C.main).px(16).pt(14).pb(10).gap(12)
      .track_focus(this.h).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.h.focus())
      .child(strip)
      .children(banner ? [banner] : [])
      .when(!!this.problem, (el) => el.child(mono(11, C.red, this.problem)))
      .when(this.offline.length > 0, (el) => el.child(mono(11, C.muted, `${this.offline.join(", ")} offline · its cards show the last read`)))
      .child(chips)
      .child(div().id("cols").relative().w_full().flex_1().min_h(0).overflow_hidden()
        .on_size_change((size, cx) => { if (size.width !== this.colsW) { this.colsW = size.width; this.toSel = "center"; cx.notify(); } })
        // sideways: a trackpad's or a tilted wheel's horizontal scroll, or the wheel with Shift
        .on_scroll_wheel((e, cx) => {
          const dx = Math.abs(e.delta.x) > Math.abs(e.delta.y) ? e.delta.x : e.modifiers.shift ? e.delta.y : 0;
          if (dx) this.panTo(cx, this.panX - dx);
        })
        // a press on the background (not on a card, which drags the card) drags the columns sideways
        .on_mouse_down("left", (e) => { if (!this.dragCard) this.pan = { x: e.position.x, from: this.panX, moved: false }; })
        .on_mouse_move((e, cx) => {
          if (!this.pan) return;
          const d = e.position.x - this.pan.x;
          if (!this.pan.moved && Math.abs(d) < 4) return; // a click stays a click
          if (!this.pan.moved) { this.pan.moved = true; cx.notify(); }
          this.panTo(cx, this.pan.from - d);
        })
        // a release between the columns drops where the highlight is; leaving the columns drops nothing
        .on_mouse_up("left", (_e, cx) => { if (this.pan) { const moved = this.pan.moved; this.pan = null; if (moved) cx.notify(); } this.dropCard(cx); })
        .on_hover((on, cx) => {
          if (on) return;
          this.pan = null;
          if (this.dragCard) { this.dragCard = null; this.dropCol = null; this.dropNear = null; cx.notify(); }
        })
        .when(Boolean(this.pan?.moved), (el) => el.cursor_grabbing())
        // a plain flex row: h_flex centres its children, which would shrink each column to its header
        .child(div().absolute().top(0).bottom(8).left(-this.panX).flex().flex_row().gap(12).children(lc.map(column)))
        // where the view is along the columns
        .when(this.panMax > 0 && contentW > 0, (el) => el.child(div().absolute().bottom(0).h(4).rounded(2).bg(C.line2)
          .left(Math.round((view * this.panX) / contentW)).w(Math.max(24, Math.round((view * view) / contentW))))))
      .when(this.help, (el) => el.child(this.keyList()));
  }

  // the sidebar opened the board on a column: mark it, select its first card and take the keyboard (after this draw:
  // focus can't move while drawing)
  jump(cx) {
    const j = shared(COL);
    if (!j?.at || j.at === this.colAt) return;
    this.colAt = j.at;
    this.cancelDrag(); // the board shown again: no drag from before it was left carries on
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

  // a label in the filters (null: Group by label, on or off)
  labelFilterChip(l, n) {
    const on = l === null ? Boolean(shared(GROUP)) : this.labelFilter === l;
    return h_flex().id(`lchip-${l ?? "group"}`).flex_none().gap(6).px(8).py(2).rounded(10).items_center().cursor_pointer()
      .border(1).border_color(on ? C.accentDim : C.line2).bg(on ? "#1c1926" : "#00000000")
      .hover((st) => st.bg(C.hover))
      .on_click((_e, cx) => { if (l === null) setShared(GROUP, !on); else this.labelFilter = on ? null : l; cx.notify(); })
      .when(l !== null, (el) => el.child(div().w(7).h(7).rounded(4).bg(chipColor(l)[0])).child(mono(11, on ? C.text : C.soft, l))
        .child(mono(11, C.dim, String(n))))
      .when(l === null, (el) => el.child(mono(11, on ? C.text : C.soft, on ? "▤ grouped  G" : "▤ group  G")));
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
    if (space && this.lastSpace && space.id !== this.lastSpace && !focus && (view === "board" || view === "prs") && !sideOpen && !stay && !shared(PEEK) && allSpaces()) {
      showWork();
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
      ], () => { run("tab.select", { id: t.id }); showWork(); },
      false));
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

  // every worktree in the filter by stage, in the order you dragged them to (a new one on top), its agents too (a new
  // one last, the main one first until you move it); every agent waiting for you, the oldest question first; and how
  // many wait in the worktrees the filter hides
  groups() {
    const by = Object.fromEntries(STAGES.map(([k]) => [k, []]));
    by.away = 0;
    by.needs = [];
    const all = worktrees();
    const saved = shared(ORDER) ?? [];
    let order = addNew(saved, [...all].sort((x, y) => y.at - x.at).map((w) => w.key), "top");
    order = addNew(order, all.flatMap((w) => w.agents.map((x) => x.a.address).sort((x, y) => seq(x) - seq(y))), "end");
    if (order !== saved) setShared(ORDER, order);
    for (const w of all) {
      if (!inScope(w.key)) { by.away += w.needs.length; continue; }
      by[w.stage].push({ ...w, agents: byOrder(w.agents, (x) => x.a.address, order) });
      by.needs.push(...w.needs);
    }
    for (const [k] of STAGES) by[k] = byOrder(by[k], (w) => w.key, order);
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

  // drag to reorder: a press picks a row up, the row under the pointer shows where it lands (a line above or below
  // it), the release puts it there. A worktree goes among the worktrees (onto another stage's, or its title, it
  // changes stage too), an agent among its worktree's agents. Leaving the list drops nothing.
  draggable(el, it) {
    return el.relative()
      .on_mouse_down("left", () => { this.drag = it; this.over = null; })
      .on_mouse_move((e, cx) => {
        const o = this.dropAt(it, e.local_position.y > e.bounds.height / 2);
        if (JSON.stringify(o) !== JSON.stringify(this.over)) { this.over = o; cx.notify(); }
      })
      .on_mouse_up("left", (_e, cx) => this.drop(cx));
  }

  // where the dragged row would land with the pointer on this one (it: {kind: "wt" | "ag" | "head", key, space, stage})
  dropAt(it, low) {
    const d = this.drag;
    if (!d || it.key === d.key) return null;
    if (d.kind === "ag") return it.kind === "ag" && it.space === d.space ? { key: it.key, after: low } : null;
    if (it.kind === "head") return { head: true, stage: it.stage };
    if (it.kind === "ag") return it.space === d.key ? null : { key: it.space, after: true, stage: it.stage };
    return { key: it.key, after: low, stage: it.stage };
  }

  drop(cx) {
    const d = this.drag, o = this.over;
    this.drag = null; this.over = null;
    if (!d || !o) return;
    if (d.kind === "wt" && o.stage !== d.stage) setStage(d.key, o.stage); // at the top of the new stage
    if (!o.head) {
      const known = new Set([...spaces().map((s) => s.id), ...agents().map((a) => a.address)]);
      setShared(ORDER, moveKey((shared(ORDER) ?? []).filter((k) => known.has(k)), d.key, o.key, o.after));
    }
    cx.notify();
  }

  // the line where the dragged row would land: above or below this row
  dropLine(el, above, below) {
    return el.when(above || below, (el) => el.child(div().absolute().left(4).right(4).h(2).rounded(1).bg(C.accent)
      .when(above, (l) => l.top(0)).when(below, (l) => l.bottom(0))));
  }

  // a worktree in the sidebar: a click goes to its main agent, a right-click moves it to another stage, a drag
  // moves it in the list
  worktreeRow(w, cur) {
    const on = w.agents.some((x) => x.a.address === cur) || (!w.agents.length && w.space.active);
    const st = isUnread(w.key) ? "done" : w.agents.length ? w.status ?? "idle" : null; // unread: green until opened
    const waiting = w.needs.length, working = w.agents.filter((x) => x.a.status === "working").length;
    const row = h_flex().id(`wt-${w.key}`).w_full().h(30).flex_none().pl(8).pr(8).gap(8).items_center().rounded(6).cursor_pointer()
      .bg(on ? "#2c2838" : "#00000000").hover((s) => s.bg(on ? "#2c2838" : C.hover))
      .on_click(() => goToWorktree(w))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openStagePicker(w.key, w.name, w.stage, true, { menu: true }); })
      .when(this.drag?.key === w.key && Boolean(this.over), (el) => el.opacity(0.45))
      .child(div().w(12).flex_none().flex().justify_center().child(st ? statusIcon(st, 8) : icon("columns", 10, C.dim)))
      .child(div().flex_1().min_w(0).truncate().font_family(SANS).text_size(13).font_weight(500)
        .text_color(on || waiting ? C.text : C.soft).child(w.name))
      .when(!!w.space.machine, (el) => el.child(machineTag(w.space.machine)))
      .when(waiting > 0, (el) => el.child(mono(10, C.you, `${waiting}●`)))
      .when(working > 0, (el) => el.child(mono(10, C.work, `${working}◌`)))
      .when(w.subs.length > 0, (el) => el.child(mono(10, C.dim, `+${w.subs.length}`)));
    const o = this.over, here = this.drag?.kind === "wt" && o?.key === w.key;
    return this.dropLine(this.draggable(row, { kind: "wt", key: w.key, stage: w.stage }),
      here && !o.after, here && o.after && !(w.agents.length > 1));
  }

  // an agent under its worktree, when the worktree has more than one (with one, the worktree's row goes to it)
  agentRow(w, x, cur) {
    const a = x.a, on = a.address === cur, now = this.now, tab = x.tab;
    const age = a.status === "blocked" ? (tab?.changed_at ? dur(now - tab.changed_at) : "")
      : a.status === "working" ? (tab?.working_since ? dur(now - tab.working_since) : "") : x.at ? dur(now - x.at) : "";
    const name = cleanTitle(a.title) || (tab?.named ? tab.name : "") || a.program?.name || a.address;
    const row = h_flex().id(`ag-${a.address}`).w_full().h(26).flex_none().pl(28).pr(8).gap(7).items_center().rounded(6).cursor_pointer()
      .bg(on ? "#2c2838" : "#00000000").hover((s) => s.bg(on ? "#2c2838" : C.hover))
      .on_click(() => goToAgent(a.address))
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openStagePicker(w.key, w.name, w.stage, true, { menu: true }); })
      .when(this.drag?.key === a.address && Boolean(this.over), (el) => el.opacity(0.45))
      .child(div().w(10).flex_none().flex().justify_center().child(statusIcon(a.status, 7)))
      .child(div().flex_1().min_w(0).truncate().font_family(SANS).text_size(12)
        .text_color(on || a.status === "blocked" || a.status === "done" ? C.text : C.muted).child(name))
      .when(x.subs.length > 0, (el) => el.child(mono(10, C.dim, `+${x.subs.length}`)))
      .child(mono(10, a.status === "blocked" ? C.you : C.dim, age));
    // an agent dragged lands by this row; a worktree dragged below this worktree, under its last agent
    const o = this.over, mine = this.drag?.kind === "ag" && o?.key === a.address;
    const wtBelow = this.drag?.kind === "wt" && o?.key === w.key && o.after && w.agents[w.agents.length - 1] === x;
    return this.dropLine(this.draggable(row, { kind: "ag", key: a.address, space: w.key, stage: w.stage }),
      mine && !o.after, (mine && o.after) || wtBelow);
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
    if (p.issue) setShared(SPACE_ISSUES, { ...(shared(SPACE_ISSUES) ?? {}), [s.id]: p.issue });
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
      .on_click(() => { if (waiting) goToAgent(by.needs[0].a.address); else { setShared(SCOPE, "all"); setShared(MACHINE, null); } })
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
    // PRs: what waits on you on GitHub (to review, comments on yours, drafts to release), a click shows the view
    const prsOn = view === "prs";
    const nPrs = lanes(shared(PRS)?.prs ?? [], shared(PR_DRAFTS) ?? {}, Date.now()).count;
    const prsRow = h_flex().id("nav-prs").h(34).flex_none().rounded(7).items_center().cursor_pointer()
      .when(narrow, (el) => el.w(40).justify_center().gap(4)).when(!narrow, (el) => el.w_full().px(10).gap(10))
      .bg(prsOn ? "#2c2838" : "#00000000").hover((st) => st.bg(prsOn ? "#2c2838" : C.hover))
      .on_click(() => (prsOn ? openBoard(null) : openPrs()))
      .child(div().w(16).flex_none().flex().justify_center().child(icon("prs", 15, nPrs ? C.you : C.accent)))
      .when(!narrow, (el) => el.child(div().flex_1().font_family(SANS).text_size(14).text_color(C.text).child("PRs"))
        .child(mono(10, C.dim, "⌘⇧G"))
        .child(div().flex_none().min_w(24).px(6).rounded(10).flex().justify_center().bg(nPrs ? C.you : "#00000000")
          .font_family(MONO).text_size(12).text_color(nPrs ? "#1a1300" : C.dim).child(String(nPrs))))
      .when(narrow, (el) => el.child(mono(12, nPrs ? C.you : C.dim, String(nPrs))));

    // the rail: each stage's dot and count, opening the board there
    if (narrow) {
      return v_flex().id("nav").size_full().bg(C.top).pt(10).pb(8).gap(3).items_center()
        .on_size_change((size, cx) => { this.size = size; cx.notify(); })
        .child(newBtn).child(boardRow).child(asksRow).children(prsFeature() ? [prsRow] : []).children(needsRow ? [needsRow] : [])
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
          .child(svg(`mods/${MOD}/columns.svg`).size(13)))
        // a worktree dropped on the title goes to the top of this stage
        .on_mouse_move((_e, cx) => {
          const o = this.drag?.kind === "wt" ? this.dropAt({ kind: "head", stage: k }) : null;
          if (JSON.stringify(o) !== JSON.stringify(this.over)) { this.over = o; cx.notify(); }
        })
        .on_mouse_up("left", (_e, cx) => this.drop(cx));
      const headOn = this.over?.head && this.over.stage === k;
      // a flex row (stretching, unlike h_flex) so the group's colour bar runs its full height
      return div().id(`group-${k}`).w_full().flex_none().flex().flex_row().gap(4)
        .child(div().w(3).flex_none().rounded(2).bg(color).when(!list.length, (el) => el.opacity(0.3)))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(this.dropLine(head.relative(), false, headOn))
          .when(open, (el) => el.children(list.flatMap((w) => [this.worktreeRow(w, cur),
            ...(w.agents.length > 1 ? w.agents.map((x) => this.agentRow(w, x, cur)) : [])]))));
    };

    return v_flex().id("nav").size_full().bg(C.top).px(8).pt(10).pb(8).gap(3)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(newBtn).child(boardRow).child(asksRow).children(prsFeature() ? [prsRow] : [])
      .child(div().pt(4).child(scopeSwitch("nav-scope", true)))
      .children(machineList().length > 1 ? [machineSwitch("nav-machine", true)] : [])
      .children(needsRow ? [div().pt(4).child(needsRow)] : [])
      .child(v_flex().id("nav-groups").w_full().flex_1().min_h(0).mt(4).gap(4).overflow_y_scrollbar()
        // a release between rows still drops (where the line shows); leaving the list drops nothing
        .on_mouse_up("left", (_e, cx) => this.drop(cx))
        .on_hover((on, cx) => { if (!on && this.drag) { this.drag = null; this.over = null; cx.notify(); } })
        .children(STAGES.map(group))
        .child(div().px(8).pt(6).child(mono(10, C.dim, "drag to reorder · right-click for the menu"))));
  }

  // the stage picker, New agent and the pull requests list, closing (Esc, a pick, a click beside): the board takes the keyboard back, unless
  // another dialog takes over from this one (a Linear card's stage, the summary's E, the dialog's Esc back)
  async close() {
    if (this.handoff) return;
    if (["stage", "new", "cleanup", "prs-settings", "prlist", "park", "labels"].includes(this.part)) setShared(REFOCUS, Date.now());
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
            showWork();
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
    this.at = Math.max(0, this.stages().findIndex(([k]) => k === p.stage)); // -1: the action row on top
    this.h = cx.focus_handle();
    this.h.focus();
    cx.timer.after(300, () => this.h.focus());
  }

  // a worktree's pull requests: repo#number, title, draft or open, checks; ⏎ or a click opens one
  prListView() {
    const p = props() ?? {}, list = p.prs ?? [];
    const open = (x) => { closeOverlay(p.overlay); exec("open", [x.url]); };
    const check = (c) => (c === "pass" ? ["✓ checks", C.land] : c === "FAIL" ? ["✗ checks", C.red] : c === "pending" ? ["checks running", C.you] : null);
    return v_flex().id("prlist").size_full().p(5).bg("#18181b").track_focus(this.h)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "down" || k === "j") this.at = Math.min(list.length - 1, this.at + 1);
        else if (k === "up" || k === "k") this.at = Math.max(0, this.at - 1);
        else if (k === "enter" && list[this.at]) open(list[this.at]);
        else if (k === "escape") closeOverlay(p.overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(div().px(9).pt(6).pb(6).truncate().child(mono(10, C.dim, `PULL REQUESTS · ${trunc(String(p.title ?? ""), 30)}`)))
      .child(v_flex().id("prlist-rows").max_h(330).overflow_y_scrollbar().children(list.map((x, i) => {
        const c = check(x.checks);
        return v_flex().id(`pr-${i}`).w_full().flex_none().px(9).py(5).gap(2).rounded(6).cursor_pointer()
          .bg(i === this.at ? C.raised : "#00000000").hover((st) => st.bg(C.raised))
          .on_click(() => open(x))
          .child(h_flex().w_full().gap(8).items_center()
            .child(mono(11, C.accent, `${x.repo ?? ""}#${x.number}`))
            .when(!!x.draft, (el) => el.child(mono(10, C.dim, "draft")))
            .child(div().flex_1())
            .when(!!c, (el) => el.child(mono(10, c[1], c[0])))
            .child(mono(11, C.dim, "↗")))
          .child(div().w_full().truncate().font_family(SANS).text_size(12).text_color(C.text).child(x.title ?? x.url));
      })));
  }

  // End agents / Restore: what can come back, how; ⏎ does it, and the dialog closes once every one did
  parkDialog() {
    const p = props() ?? {};
    const end = p.mode === "end";
    const list = end ? parkable(worktrees().find((x) => x.key === p.space)) : (shared(PARKED) ?? {})[p.space]?.agents ?? [];
    const can = end ? list.filter((a) => a.app) : list;
    const others = list.length - can.length;
    const kinds = [["claude", "Claude Code"], ["opencode", "OpenCode"]]
      .map(([k, l]) => [can.filter((a) => a.app === k).length, l]).filter(([n]) => n).map(([n, l]) => `${n} ${l}`).join(" · ");
    const run = this.run, busy = run?.state === "running";
    const failed = (run?.kept ?? []).filter((a) => a.app);
    const go = (cx) => {
      if (busy || !can.length) return;
      this.run = { state: "running", at: null };
      cx.notify();
      cx.spawn(async (cx) => {
        const kept = end ? (await parkAgents(p.space, (a) => { this.run.at = a.title; cx.notify(); })).kept : await restoreAgents(p.space);
        this.run = { state: "done", kept: end ? kept : kept.map((a) => ({ ...a, app: a.app ?? "?" })) };
        if (!this.run.kept.some((a) => a.app)) closeOverlay(p.overlay);
        cx.notify();
      });
    };
    const btn = (id, text, primary, onClick) => h_flex().id(id).flex_none().h(28).px(12).items_center().rounded(6).border(1)
      .border_color(primary ? C.accent : C.line2).bg(primary ? C.accent : C.raised).text_color(primary ? "#0f0f11" : C.text)
      .font_family(SANS).text_size(12).cursor_pointer().hover((st) => st.opacity(0.85))
      .when(busy, (el) => el.opacity(0.5)).on_click((_e, cx) => onClick(cx)).child(text);
    return v_flex().id("park").size_full().p(18).gap(10).bg("#18181b").text_color(C.text).track_focus(this.h)
      .on_key_down((e, cx) => {
        if (e.key === "enter" && !e.is_held && !run) go(cx);
        else if (e.key === "escape" && !busy) closeOverlay(p.overlay);
        else return;
        cx.stop_propagation();
      })
      .child(div().font_family(SANS).text_size(16).font_weight(600)
        .child(end ? `End the agents of ${trunc(String(p.name ?? ""), 34)}?` : `Bring back the agents of ${trunc(String(p.name ?? ""), 30)}?`))
      .child(div().font_family(SANS).text_size(12).text_color(C.muted).child(end
        ? "Archived. Ending them frees the machine; Restore brings each one back in its terminal, in the same conversation."
        : "Each one resumes in its terminal, in the conversation it was in when it was ended."))
      .child(mono(11, C.soft, can.length ? kinds || plural(can.length, "agent") : end ? "No agent here can be resumed." : "Nothing to restore."))
      .when(others > 0, (el) => el.child(mono(11, C.dim, `${plural(others, "other agent")} keep${others === 1 ? "s" : ""} running: no way to resume ${others === 1 ? "it" : "them"}`)))
      .when(busy, (el) => el.child(h_flex().gap(8).items_center().child(icon("spinner", 12, C.work).spin(900))
        .child(div().min_w(0).truncate().child(mono(11, C.muted, end ? `Ending ${trunc(String(run.at ?? ""), 40)}…` : "Restoring…")))))
      .when(failed.length > 0, (el) => el.child(v_flex().gap(3).children(failed.slice(0, 4).map((a) =>
        div().truncate().child(mono(11, C.red, `${trunc(cleanTitle(a.title ?? a.address) ?? a.address, 30)}: ${a.why}`))))))
      .child(div().flex_1())
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1())
        .child(btn("park-no", run?.state === "done" ? "Close" : end ? "Keep them running" : "Not now", false, () => { if (!busy) closeOverlay(p.overlay); }))
        .when(can.length > 0 && !run, (el) => el.child(btn("park-go", `${end ? "End" : "Restore"} ${plural(can.length, "agent")}  ⏎`, true, go))));
  }

  // a worktree's labels: type to find one, ⏎ turns the first on or off (or makes the one typed, when it's new);
  // a click turns any on or off
  initLabels(cx) {
    this.lq = "";
    this.lin = InputState.new({ placeholder: "Find or add a label" });
    this.lin.on("change", (_e, cx) => { this.lq = this.lin.value(); cx.notify(); });
    this.lin.on("submit", (_e, cx) => {
      const { list, create } = suggest(allLabels(labelMap()), this.lq);
      const pick = create ?? list[0];
      if (pick) this.toggleLabel(pick, cx);
    });
    this.lin.focus();
    cx.timer.after(300, () => this.lin.focus());
  }

  toggleLabel(label, cx) {
    setShared(LABELS, toggleLabel(labelMap(), (props() ?? {}).space, label));
    this.lin.set_value("");
    this.lq = "";
    cx.notify();
  }

  labelsView() {
    const p = props() ?? {};
    const map = labelMap(), mine = labelsOf(map, p.space);
    const { list, create } = suggest(allLabels(map), this.lq);
    const row = (id, l, on, text) => h_flex().id(id).w_full().flex_none().h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .hover((st) => st.bg(C.raised))
      .on_click((_e, cx) => this.toggleLabel(l, cx))
      .child(div().w(12).flex_none().child(mono(11, C.accent, on ? "✓" : "")))
      .child(div().w(8).h(8).flex_none().rounded(4).bg(chipColor(l)[0]))
      .child(div().flex_1().min_w(0).truncate().font_family(SANS).text_size(13).text_color(C.text).child(text ?? l));
    return v_flex().id("labels").size_full().p(6).gap(4).bg("#18181b")
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(p.overlay); cx.stop_propagation(); } })
      .child(div().px(4).pt(2).truncate().child(mono(10, C.dim, `LABELS · ${trunc(String(p.name ?? ""), 26)}`)))
      .child(Input.new(this.lin).h(30).px(8).rounded(6).border(1).border_color(C.accentDim).bg(C.main).font_family(SANS).text_size(12).text_color(C.text))
      .child(v_flex().id("labels-rows").max_h(240).overflow_y_scrollbar()
        .when(!!create, (el) => el.child(row("label-new", create, false, `+ Create "${create}"`)))
        .children(list.map((l, i) => row(`label-${i}`, l, mine.includes(l))))
        .when(!list.length && !create, (el) => el.child(div().px(8).py(6).child(mono(11, C.dim, "Type a label: pesquisa, feature, bug…")))));
  }

  // the stages it offers: a Linear card's (only), else every one
  stages() {
    const only = (props() ?? {}).only;
    return only ? STAGES.filter(([k]) => only.includes(k)) : STAGES;
  }

  // a Linear card's stage opens its summary there; a worktree's stage is set
  choose(stage) {
    const p = props() ?? {};
    if (stage === "unread") { closeOverlay(p.overlay); setUnread(p.space, !isUnread(p.space)); return; }
    if (stage === "open") { closeOverlay(p.overlay); if (p.issue?.url) exec("open", [p.issue.url]); return; }
    if (stage === "prs") { this.handoff = true; closeOverlay(p.overlay); openPrList(p.title, p.prs ?? [], false); return; }
    if (stage === "labels") { this.handoff = true; closeOverlay(p.overlay); openLabels(p.space, p.title, false); return; }
    if (stage === "park" || stage === "restore") { this.handoff = true; closeOverlay(p.overlay); openPark(p.space, stage === "park" ? "end" : "restore"); return; }
    if (p.issue) {
      if (!stage || stage === "delete") return;
      this.handoff = true;
      closeOverlay(p.overlay);
      startIssue(p.issue, stage);
      return;
    }
    closeOverlay(p.overlay);
    if (stage === "delete") deleteWorktree(p.space);
    else if (stage !== p.stage) setStage(p.space, stage);
  }

  stagePicker() {
    const p = props() ?? {};
    const title = String(p.title ?? "");
    const list = this.stages();
    return v_flex().id("stage").size_full().p(5).bg("#18181b").track_focus(this.h)
      .on_key_down((e, cx) => {
        const k = e.key;
        const last = list.length - (p.deletable ? 0 : 1); // Delete worktree comes after the stages
        const acts = p.actions ?? [], first = -acts.length;
        if (e.is_held && p.issue && (k === "enter" || /^[1-9]$/.test(k))) { cx.stop_propagation(); return; } // a held key would start it
        if (/^[1-9]$/.test(k) && list[Number(k) - 1]) this.choose(list[Number(k) - 1][0]);
        else if (k === "down" || k === "j") this.at = Math.min(last, this.at + 1);
        else if (k === "up" || k === "k") this.at = Math.max(first, this.at - 1);
        else if (k === "enter") this.choose(this.at < 0 ? acts[acts.length + this.at] : list[this.at]?.[0] ?? "delete");
        else if (k === "u" && acts.includes("unread")) this.choose("unread");
        else if (k === "o" && acts.includes("open")) this.choose("open");
        else if (k === "p" && acts.includes("prs")) this.choose("prs");
        else if (k === "t" && acts.includes("labels")) this.choose("labels");
        else if (k === "e" && acts.includes("park")) this.choose("park");
        else if (k === "r" && acts.includes("restore")) this.choose("restore");
        else if ((k === "backspace" || k === "delete") && p.deletable) this.choose("delete");
        else if (k === "escape") closeOverlay(p.overlay);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .when((p.actions ?? []).length > 0, (el) => {
        const acts = p.actions;
        const look = (a) => (a === "open" ? ["↗", "Open in Linear", "O", REF_KINDS.linear[1]]
          : a === "prs" ? ["⇅", `Pull requests (${p.prs?.length ?? 0})`, "P", C.accent]
          : a === "labels" ? ["#", "Labels…", "T", C.accent]
          : a === "park" ? ["■", `End agents (${p.end})`, "E", C.muted]
          : a === "restore" ? ["↺", `Restore agents (${p.restore})`, "R", C.land]
          : isUnread(p.space) ? ["○", "Mark as read", "U", C.land] : ["●", "Mark as unread", "U", C.land]);
        return el
          .children(acts.map((a, i) => {
            const [mark, label, key, color] = look(a);
            return h_flex().id(`st-${a}`).h(30).flex_none().px(9).gap(10).items_center().rounded(6)
              .bg(this.at === i - acts.length ? C.raised : "#00000000").cursor_pointer().hover((st) => st.bg(C.raised))
              .on_click(() => this.choose(a))
              .child(div().w(8).flex_none().text_size(11).text_color(color).child(mark))
              .child(div().flex_1().font_family(SANS).text_size(13).text_color(C.text).child(label))
              .child(mono(11, C.dim, key));
          }))
          .child(div().h(1).mx(6).my(4).bg(C.line2));
      })
      .child(div().px(9).pt(6).pb(6).truncate().child(mono(10, C.dim, p.issue ? `START ${trunc(title, 24)} IN` : `MOVE ${trunc(title, 24)} TO`)))
      .children(list.map(([k, label, color], i) => h_flex().id(`st-${k}`).h(30).flex_none().px(9).gap(10).items_center().rounded(6)
        .bg(i === this.at ? C.raised : "#00000000").cursor_pointer().hover((st) => st.bg(C.raised))
        .on_click(() => this.choose(k))
        .child(div().w(8).h(8).flex_none().rounded(4).bg(color))
        .child(div().flex_1().font_family(SANS).text_size(13).text_color(C.text).child(label))
        .child(mono(11, C.accent, k === p.stage ? "✓" : ""))
        .child(mono(11, C.dim, String(i + 1)))))
      .when(!!p.deletable, (el) => el
        .child(div().h(1).mx(6).my(4).bg(C.line2))
        .child(h_flex().id("st-delete").h(30).flex_none().px(9).gap(10).items_center().rounded(6)
          .bg(this.at === list.length ? "#3b1d24" : "#00000000").cursor_pointer().hover((st) => st.bg("#3b1d24"))
          .on_click(() => this.choose("delete"))
          .child(div().w(8).flex_none().text_size(11).text_color(C.red).child("×"))
          .child(div().flex_1().font_family(SANS).text_size(13).text_color(C.red).child("Delete worktree…"))
          .child(mono(11, C.dim, "⌫"))));
  }

  // ---- New agent ------------------------------------------------------------------------------------------------

  initNew(cx) {
    const p = props() ?? {};
    this.choices = NEW_AGENTS;
    this.summary = p.summary === true; // a Linear card's short summary, before the full dialog (E)
    this.pickKey = p.agent ?? shared(PICK) ?? "claude";
    this.stage = p.stage ?? shared(NEW_STAGE) ?? DEFAULT_STAGE;
    // the worktree it's for: the one given (+ Agent), else the shown space, whose repo a new worktree comes from
    this.src = spaces().find((s) => s.id === (p.space ?? activeSpace()?.id)) ?? null;
    this.mode = p.space ? "here" : "worktree"; // "worktree": a new one; "here": one more agent in this.src
    this.fixed = Boolean(p.space); // + Agent on a worktree: its machine and space, no picking
    this.machine = this.src?.machine ?? null; // where the agent runs: null this computer, else a machine's name
    // from a Linear card: the machine and repo folder it starts from (the shown space only counts on that machine)
    if (p.machine !== undefined) {
      this.machine = p.machine;
      if ((this.src?.machine ?? null) !== p.machine) this.src = null;
    }
    this.dir = p.dir ?? null; // the repo folder probed, in place of the space's
    this.fromLinear = p.fromLinear === true;
    this.linearCard = p.issue ?? null; // the Linear card it came from, whole ({id, url, title, branchName, uuid, teamId})
    // the skills: board.json's, those installed for this machine and repo, and yours (undefined: automatic, see skillOn)
    this.cfg = readBoardConfig(null);
    this.installed = undefined; // undefined: still asking the machine (a Linear card's start waits for it)
    this.skillPick = p.skill;
    this.followStage = Boolean(p.stage); // opened on a stage (a Linear drag): the skill follows the stage you give
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
    const issue = this.linearCard;
    this.refs = issue ? [{ kind: "linear", id: issue.id, url: issue.url, title: issue.title, branchName: issue.branchName }] : [];
    this.refText = "";
    this.refFocused = false;
    this.issues = null; // your open Linear issues, when LINEAR_API_KEY is set; null: none (no key, or not read)
    this.projects = []; // the workspace's open Linear projects, the most recently updated first
    this.found = null; // Linear's search for what you typed, when your own issues don't have it
    this.foundProjects = null; // and the projects it finds
    this.linearKey = null;
    this.ref = InputState.new({ placeholder: "Paste a Linear issue or project, a PR or Slack link, or search Linear" });
    this.ref.on("change", (_e, cx) => { this.refText = this.ref.value(); this.found = null; this.foundProjects = null; this.searchLinear(cx); cx.notify(); });
    this.ref.on("submit", (_e, cx) => this.addRef(cx));
    this.ref.on("focus", (_e, cx) => { this.refFocused = true; cx.notify(); });
    this.ref.on("blur", (_e, cx) => { this.refFocused = false; cx.notify(); });
    if (this.summary) {
      // the summary only has keys: ⏎, E, Esc
      this.h = cx.focus_handle();
      this.h.focus();
      cx.timer.after(300, () => this.h.focus());
    } else {
      this.ref.focus();
      cx.timer.after(600, () => this.ref.focus());
    }
    if (!this.summary) cx.spawn(async (cx) => {
      try {
        const key = await linearKey();
        if (!key) return;
        this.linearKey = key;
        const d = await linear(cx, key, `{ viewer { assignedIssues(first: 50, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { ${LINEAR_ISSUE} } } } ${OPEN_PROJECTS} }`);
        this.issues = d.viewer.assignedIssues.nodes;
        this.projects = d.projects?.nodes ?? [];
      } catch (e) { this.linearError = String(e.message ?? e); }
      cx.notify();
    });
    this.probe(cx);
  }

  // what the machine the agent runs on has: its agents, the repo of the space it starts from, and the skills installed
  // for both; asked again when you pick another machine (an answer for the one before is dropped)
  probe(cx) {
    const gen = (this.gen = (this.gen ?? 0) + 1), stale = () => gen !== this.gen;
    this.choices = NEW_AGENTS;
    this.installed = undefined;
    this.repo = undefined;
    const on = this.machine ?? undefined;
    cx.spawn(async (cx) => {
      try {
        const known = await knownAgents({ on });
        if (stale()) return;
        this.choices = NEW_AGENTS.map((a) => {
          const k = known.find((x) => x.key === a.key);
          return k ? { ...a, ...k, icon: k.icon ?? a.icon } : { ...a, installed: false };
        });
      } catch { /* keep the defaults */ }
      if (!stale()) cx.notify();
    });
    cx.spawn(async (cx) => {
      try {
        const dir = this.dir ?? (this.src ? place(this.src) : null);
        const r = dir ? await exec("sh", ["-c", REPO, "sh", dir], { on }) : null;
        const v = r?.code === 0 ? kv(r.stdout) : {};
        const main = v.common ? (v.common.endsWith("/.git") ? v.common.slice(0, -5) : v.common) : null;
        if (stale()) return;
        this.repo = v.top && main && v.home ? { top: v.top, main, name: base(main), base: v.base || null, home: v.home } : null;
      } catch { if (stale()) return; this.repo = null; }
      if (!this.repo && this.mode === "worktree") this.mode = "here";
      cx.notify();
      // then the skills, once the repo is known: a repo's own skills only count in that repo
      try {
        const cfg = await boardConfig();
        if (stale()) return;
        this.cfg = cfg;
        const r = cfg.skills.length ? await exec("sh", ["-c", SKILLS, "sh", this.repo?.top ?? "", ...cfg.skills], { on }) : null;
        if (stale()) return;
        this.installed = new Set((r?.stdout ?? "").split("\n").filter((s) => cfg.skills.includes(s)));
      } catch { if (!stale()) this.installed = new Set(); } // none installed
      if (!stale()) cx.notify();
    });
  }

  // another machine: it starts from the space there in the same repo (the shown one, else the one used last), else
  // any space there, and what that machine has is asked again
  pickMachine(cx, m) {
    if (m === this.machine) return;
    const repos = shared(REPOS) ?? {}, name = this.src ? repos[this.src.id]?.name : null;
    const there = spaces().filter((s) => (s.machine ?? null) === m);
    const used = (s) => Math.max(0, ...s.tabs.map((t) => t.changed_at ?? 0));
    const best = (list) => list.find((s) => s.active) ?? [...list].sort((x, y) => used(y) - used(x))[0];
    const same = there.filter((s) => name && repos[s.id]?.name === name);
    this.machine = m;
    this.dir = null; // a folder given for the machine before
    this.src = best(same.filter((s) => !isWorktree(s) && !s.folder?.includes("/.herdr/worktrees/"))) ?? best(same) ?? best(there) ?? null;
    this.mode = "worktree";
    this.probe(cx);
    cx.notify();
  }

  // what the list under the field offers for what you typed: your issues (by id or title) and the open projects (by
  // name), then Linear's search for both; projects carry `project: true`. Empty, your latest issues and a couple of
  // the latest projects
  matches() {
    if (!this.issues) return [];
    const q = this.refText.trim().toLowerCase();
    if (/^https?:\/\//.test(q)) return [];
    const taken = new Set(this.refs.map((r) => r.id));
    const issue = (i) => !taken.has(i.identifier) && (!q || `${i.identifier} ${i.title}`.toLowerCase().includes(q));
    const project = (p) => !taken.has(p.slugId) && (!q || p.name.toLowerCase().includes(q));
    const mine = this.issues.filter(issue);
    const projects = this.projects.filter(project).map((p) => ({ ...p, project: true }));
    const more = (this.found ?? []).filter((i) => issue(i) && !mine.some((x) => x.identifier === i.identifier));
    const moreProjects = (this.foundProjects ?? []).filter((p) => !taken.has(p.slugId) && !projects.some((x) => x.slugId === p.slugId))
      .map((p) => ({ ...p, project: true }));
    if (!q) return [...mine.slice(0, 4), ...projects.slice(0, 2)];
    return [...mine, ...projects, ...more, ...moreProjects].slice(0, 6);
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
          const d = await linear(cx, this.linearKey, `query($t: String!) { searchIssues(term: $t, first: 8) { nodes { ${LINEAR_ISSUE} } } searchProjects(term: $t, first: 4) { nodes { ${LINEAR_PROJECT} } } }`, { t: q });
          if (seq === this.searchSeq) { this.found = d.searchIssues.nodes; this.foundProjects = d.searchProjects?.nodes ?? []; cx.notify(); }
        } catch { /* your own issues still show */ }
      });
    });
  }

  // ⏎ in the reference field: a link or id as it is (a Linear one with its title when it's among yours, a project's
  // with its name when it's open), else the first issue or project that matches, else a note; empty, on to the message
  addRef(cx, item) {
    if (!item && !this.refText.trim()) { this.task.focus(); return; }
    const asRef = (i) => (i.project ? projectRef(i) : { kind: "linear", id: i.identifier, url: i.url, title: i.title, branchName: i.branchName });
    let r;
    if (item) r = asRef(item);
    else {
      r = classify(this.refText);
      const pick = r.kind === "note" ? this.matches()[0] : null;
      if (pick) r = asRef(pick);
      const known = r.kind === "linear" && [...(this.issues ?? []), ...(this.found ?? [])].find((i) => i.identifier === r.id);
      if (known) r = { ...r, url: known.url, title: known.title, branchName: known.branchName };
      const project = r.kind === "project" && !r.title && [...this.projects, ...(this.foundProjects ?? [])].find((p) => p.slugId === r.id);
      if (project) r = { ...r, title: project.name };
    }
    if (!this.refs.some((x) => x.kind === r.kind && x.id === r.id && x.url === r.url)) this.refs.push(r);
    this.ref.set_value("");
    this.refText = "";
    this.found = null;
    this.foundProjects = null;
    this.ref.focus();
    cx.notify();
  }

  // the Linear issue and project among the references, if any
  linearIssue() { return this.refs.find((r) => r.kind === "linear"); }

  // from a Linear card the dialog starts in the last start's repo (dir); when the shown space is another repo, a new
  // worktree of that one is a click away, and the remembered repo a click back: {name, go} or null
  otherRepo() {
    if (!this.fromLinear || this.summary || this.fixed) return null;
    if (!this.dir) {
      const b = this.backTo;
      return b ? { name: b.name, go: (cx) => { Object.assign(this, { machine: b.machine, src: b.src, dir: b.dir, backTo: null }); this.reprobe(cx); } } : null;
    }
    const s = activeSpace(), r = s ? (shared(REPOS) ?? {})[s.id] : null;
    if (!r || !this.repo || ((s.machine ?? null) === this.machine && r.common.replace(/\/\.git$/, "") === this.repo.main)) return null;
    return { name: r.name, go: (cx) => {
      this.backTo = { machine: this.machine, src: this.src, dir: this.dir, name: this.repo.name };
      Object.assign(this, { machine: s.machine ?? null, src: s, dir: null });
      this.reprobe(cx);
    } };
  }
  reprobe(cx) { this.mode = "worktree"; this.error = ""; this.probe(cx); this.branch.focus(); cx.notify(); }
  linearProject() { return this.refs.find((r) => r.kind === "project"); }

  // the worktree's title on the board: the Linear issue's title, else the project's name, else the first sentence of
  // your message, shortened
  title() {
    const issue = this.linearIssue(), project = this.linearProject();
    return shortTitle(issue?.title || project?.title || this.text) || (issue ? issue.id : "");
  }

  // the skill it starts on: the one you picked, else the stage's when opened on a stage (a Linear drag), else the
  // in-progress one with a Linear issue or project; only when installed for this machine and repo
  skillOn() {
    const s = this.skillPick !== undefined ? this.skillPick
      : this.followStage ? this.cfg.stageSkills[this.stage]
      : this.linearIssue() || this.linearProject() ? this.cfg.stageSkills.in_progress : null;
    return s && this.installed?.has(s) ? s : null;
  }

  // with a skill on and nothing to start from, your message is required
  needsText() {
    return Boolean(this.skillOn()) && !this.refs.length && !this.text.trim();
  }

  // why ⏎ can't start, else null: the machine is offline; or (a Linear card, a stage or skill given) the repo and skills
  // aren't known yet; or the summary has no git repo for a worktree; or the stage's skill isn't installed there, since a
  // Linear card never starts without it (a skill you pick in the dialog is your call)
  blocker() {
    if (machines().find((m) => (m.name ?? null) === this.machine)?.layout === "unavailable") return `${machineLabel(this.machine)} is offline`;
    const waits = this.fromLinear || this.followStage || this.skillPick !== undefined;
    if (waits && (this.repo === undefined || this.installed === undefined)) return "still checking…";
    if (this.summary && !this.repo) return "no git repo here to make a worktree in";
    const want = this.cfg.stageSkills[this.stage];
    if (this.fromLinear && this.skillPick === undefined && want && !this.installed.has(want)) {
      return `${want} isn't installed for ${this.repo?.name ?? "this folder"}`;
    }
    return null;
  }

  // a Linear card's worktree shows where the card was: the board drops a repo or machine filter it would fall outside of
  showOnBoard() {
    if (shared(SCOPE) !== "all" && this.repo?.name !== (shared(REPOS) ?? {})[activeSpace()?.id]?.name) setShared(SCOPE, "all");
    const m = shared(MACHINE);
    if (m != null && m !== (this.machine ?? "")) setShared(MACHINE, null);
  }

  // the agent it starts: the one picked, but always Claude Code for a skill (skills run only there)
  agent() {
    const key = this.skillOn() ? "claude" : this.pickKey;
    return this.choices.find((x) => x.key === key) ?? this.choices[0];
  }

  // the first message (linear-rules' firstMessage): the skill's command, or what you wrote (with a Linear issue or
  // project and nothing written, to start on it), then the references as a Context block. The stage only counts for a
  // new worktree: one more agent in a worktree keeps today's sentence
  prompt() {
    const skill = this.skillOn(), issue = this.linearIssue(), project = this.linearProject();
    const text = this.text.trim()
      || (!skill && !issue && project ? `Start working on the Linear project ${project.title ?? project.url}.` : "");
    return firstMessage({ skill, cfg: this.cfg, issueId: issue?.id ?? null, stage: this.mode === "worktree" ? this.stage : null,
      text, context: this.refs.map(refLine) });
  }

  // the new worktree's branch: what you typed, else the Linear issue's (Linear's own name for it), else made from the
  // first message, else agent-<month><day>-<time>
  branchName() {
    const typed = this.branchText.trim();
    if (typed) return typed;
    const issue = this.linearIssue(), project = this.linearProject();
    if (issue?.branchName) return issue.branchName;
    if (issue) return [issue.id.toLowerCase(), branchFrom(issue.title || this.text)].filter(Boolean).join("-");
    const fromProject = project?.title ? branchFrom(project.title) : "";
    if (fromProject) return fromProject;
    const fromTask = branchFrom(this.text);
    if (fromTask) return fromTask;
    const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
    return `agent-${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
  }

  // a new worktree (git worktree add, then a space in it with the agent as its first tab), or one more tab in the
  // worktree; with a first message the agent starts on it and the board stays, without one its terminal shows
  start(cx) {
    if (this.busy) return;
    const a = this.agent(), skill = this.skillOn();
    if (!a || a.installed === false) return;
    if (this.mode === "worktree" ? !this.repo : !this.src) return;
    if (this.needsText()) { this.task.focus(); return; }
    if (this.blocker()) return; // the summary and the footer say why
    const issue = this.linearIssue(), project = this.linearProject();
    // a Linear issue starts once: another summary or dialog for it, or a repeated key, is refused while it's starting
    // (its start, below, writes STARTING; a failed one takes it back)
    if (this.fromLinear && issue && Date.now() - ((shared(STARTING) ?? {})[issue.id] ?? 0) < 120000) {
      this.error = `${issue.id} is already starting`;
      cx.notify();
      return;
    }
    if (this.fromLinear) this.showOnBoard();
    const task = this.prompt();
    const name = issue ? trunc(`${issue.id}${issue.title ? ` ${issue.title}` : ""}`, 40) : project?.title ? trunc(project.title, 40)
      : this.text.trim() ? trunc(this.text.trim(), 40) : a.name;
    const args = launch(a, task);
    const done = () => {
      if (!skill) setShared(PICK, a.key); // the agent you pick next time stays yours
      setShared(LAST, { machine: this.machine, agent: a.key, repo: this.repo }); // where the Linear summary starts next
      // a Linear card's start: its column hides it until Linear says it started (or its worktree shows), 2 minutes at most
      if (this.fromLinear && issue) {
        const now = Date.now();
        const kept = Object.entries(shared(STARTING) ?? {}).filter(([, at]) => now - at < 120000);
        setShared(STARTING, { ...Object.fromEntries(kept), [issue.id]: now });
        // started in progress: the board moves it in Linear (never this dialog); only for the card's own issue, still
        // referenced (a removed chip means no write), and known by Linear's ids
        const card = this.linearCard;
        if (moveInLinear(this.fromLinear, this.stage) && card?.uuid && card.teamId && issue.id === card.id) {
          const queue = (shared(LINEAR_MOVES) ?? []).filter((m) => now - m.at < MOVE_MS && m.uuid !== card.uuid);
          setShared(LINEAR_MOVES, [...queue, { uuid: card.uuid, teamId: card.teamId, id: card.id, at: now }]);
        }
      }
      if (!task) {
        showWork();
      }
      closeOverlay(props().overlay);
    };
    if (this.mode === "here") {
      run("tab.new", { ...args, name, space: this.src?.id });
      done();
      return;
    }
    const branch = this.branchName();
    const repo = this.repo, on = this.machine ?? undefined;
    const path = `${repo.home}/.herdr/worktrees/${repo.name}/${slugPath(branch)}`;
    // a Linear card's start begins: its column hides it from now (a failed start takes this back)
    const link = issue?.url ? { id: issue.id, url: issue.url } : null;
    if (this.fromLinear && issue) {
      const now = Date.now();
      const kept = Object.entries(shared(STARTING) ?? {}).filter(([, at]) => now - at < 120000);
      setShared(STARTING, { ...Object.fromEntries(kept), [issue.id]: now });
    }
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
        if (!this.followStage) setShared(NEW_STAGE, this.stage); // a Linear card's stage isn't the next New agent's
        if (task) setShared(STAY, Date.now());
        // a space already showing that worktree gets the agent as one more tab; else a space opens in it, unnamed, so
        // it follows the checkout and nests under its repo in Spaces, as Herdr's own worktrees do
        const open = known && showing(folder, on);
        if (open) {
          run("tab.new", { ...args, name, space: open.id });
          if (link) setShared(SPACE_ISSUES, { ...(shared(SPACE_ISSUES) ?? {}), [open.id]: link });
          if (!(shared(SPACE_TITLES) ?? {})[open.id] && this.title()) setShared(SPACE_TITLES, { ...(shared(SPACE_TITLES) ?? {}), [open.id]: this.title() });
        } else {
          setShared(PENDING, { stage: this.stage, folder, at: Date.now(), title: this.title(), issue: link });
          run("space.new", { ...args, folder, tab: name, machine: on ?? "" });
        }
        this.busy = false;
        done();
      } catch (e) {
        if (this.fromLinear && issue) {
          const { [issue.id]: _gone, ...rest } = shared(STARTING) ?? {};
          setShared(STARTING, rest);
        }
        this.busy = false;
        this.error = String(e.message ?? e);
        cx.notify();
      }
    });
  }

  // the summary's keys: ⏎ starts (when nothing blocks it; a held ⏎ that opened the summary doesn't), E the full
  // dialog (always), Esc closes and nothing changes
  summaryKey(cx, k, held) {
    const p = props() ?? {};
    if (k === "enter") { if (!held) this.start(cx); }
    else if (k === "e" || k === "E") this.edit();
    else if (k === "escape") { if (!this.busy) closeOverlay(p.overlay); } // a start under way finishes first
    else return false;
    return true;
  }

  // E: the full dialog takes over from the summary (not while a start is under way)
  edit() {
    if (this.busy) return;
    this.handoff = true;
    editIssue(props() ?? {});
  }

  // Esc in the full dialog opened from the summary goes back to the summary
  newKey(cx, k) {
    const p = props() ?? {};
    if (k !== "escape" || !p.fromLinear || !p.wasSummary || this.busy) return false;
    this.handoff = true;
    closeOverlay(p.overlay);
    startIssue(p.issue, p.stage);
    return true;
  }

  // a Linear card dropped on a stage: what ⏎ starts (where, with what, which skill, what happens in Linear), or why not
  summaryDialog() {
    const issue = this.linearCard ?? {}, a = this.agent(), skill = this.skillOn(), want = this.cfg.stageSkills[this.stage] ?? null;
    const why = this.blocker(), ready = Boolean(a) && a.installed !== false && !this.busy && !why;
    const row = (k, v, color) => h_flex().h(24).flex_none().gap(12).items_center()
      .child(div().w(64).flex_none().child(mono(10, C.dim, k.toUpperCase())))
      .child(div().flex_1().min_w(0).truncate().child(mono(12, color ?? C.text, v)));
    const button = (id, key, text, primary, enabled, onClick) => h_flex().id(id).h(32).px(12).gap(7).items_center().rounded(8).border(1)
      .border_color(primary ? C.accent : C.line2).bg(primary ? C.accent : C.raised).text_color(primary ? "#0f0f11" : C.text)
      .cursor_pointer().hover((st) => st.opacity(0.85)).when(!enabled, (el) => el.opacity(0.4))
      .on_click((_e, cx) => { if (enabled) onClick(cx); })
      .child(div().font_family(MONO).text_size(11).opacity(0.7).child(key))
      .child(div().font_family(SANS).text_size(13).font_weight(primary ? 600 : 400).child(text));
    const p = props() ?? {};
    return v_flex().id("summary").size_full().p(18).bg("#18181b").text_color(C.text).track_focus(this.h)
      .on_key_down((e, cx) => {
        const m = e.modifiers;
        if (m.platform || m.control || m.alt) return;
        if (this.summaryKey(cx, e.key, e.is_held)) { cx.stop_propagation(); cx.notify(); }
      })
      .child(div().truncate().font_family(SANS).text_size(16).font_weight(600).child(`Start ${issue.id ?? "the issue"}?`))
      .child(div().pt(2).pb(10).truncate().font_family(SANS).text_size(12).text_color(C.muted).child(issue.title ?? ""))
      .child(row("Machine", machineLabel(this.machine)))
      .child(row("Agent", a?.name ?? "…", a?.installed === false ? C.red : C.text))
      .child(row("Repo", this.repo === undefined ? "looking…" : this.repo ? this.repo.name : "not in a git repo", this.repo ? C.text : C.dim))
      .child(row("Branch", this.branchName()))
      .child(row("Skill", skill ?? want ?? "none", skill || !want ? C.text : C.dim))
      .child(row("Linear", moveInLinear(true, this.stage) ? "Todo → In Progress" : "stays in Todo"))
      .child(div().pt(8).truncate().child(this.error ? mono(11, C.red, this.error)
        : mono(11, C.dim, this.busy ? "creating the worktree…" : why ?? (skill ? `it starts on /${skill}; the board stays` : "it starts on the issue; the board stays"))))
      .child(div().flex_1())
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1())
        .child(button("sum-start", "⏎", this.busy ? "Creating…" : "Start", true, ready, (cx) => this.start(cx)))
        .child(button("sum-edit", "E", "Edit", false, !this.busy, () => this.edit()))
        .child(button("sum-cancel", "Esc", "Cancel", false, !this.busy, () => closeOverlay(p.overlay))));
  }

  newDialog() {
    const h = home();
    const tilde = (p) => (p && h && p.startsWith(h) ? "~" + p.slice(h.length) : p ?? "");
    const a = this.agent(), skill = this.skillOn(), needsText = this.needsText();
    const fresh = this.mode === "worktree";
    const label = (text) => div().pt(14).pb(7).child(mono(10, C.dim, text));
    const radio = (on) => div().w(14).h(14).flex_none().rounded(7).border(1).border_color(on ? C.accent : C.line2)
      .flex().items_center().justify_center().children(on ? [div().w(6).h(6).rounded(3).bg(C.accent)] : []);
    const agentCard = (x) => {
      // with a skill, only Claude Code: the others dim, as an agent that isn't installed
      const on = x.key === a.key, off = x.installed === false || (Boolean(skill) && x.key !== a.key);
      return h_flex().id(`new-${x.key}`).flex_1().min_w(0).h(52).px(12).gap(10).items_center().rounded(8).border(1)
        .border_color(on ? C.accent : C.line2).bg(on ? "#1c1926" : C.card).cursor_pointer().hover((st) => st.bg(on ? "#1c1926" : C.hover))
        .when(off, (el) => el.opacity(0.45))
        .on_click((_e, cx) => { if (!off) { this.pickKey = x.key; this.task.focus(); cx.notify(); } })
        .child(x.tint ? svg(x.icon).size(22).flex_none().text_color(C.text) : image(x.icon).w(22).h(22).flex_none())
        .child(v_flex().flex_1().min_w(0)
          .child(div().font_family(SANS).text_size(14).text_color(C.text).child(x.name))
          .child(div().truncate().child(mono(10, x.installed === false ? C.red : C.dim,
            x.installed === false ? "not installed" : off ? "a skill runs in Claude Code" : x.run.join(" ")))))
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
    const repoSub = !this.src && !this.dir ? `no space on ${machineLabel(this.machine)} to start from`
      : this.repo === undefined ? "looking for the repo…" : this.repo
      ? `${this.repo.name} · from ${this.repo.base ?? "HEAD"} · ~/.herdr/worktrees/${this.repo.name}/${slugPath(this.branchName())}`
      : "not in a git repo";
    const srcName = this.src ? (this.src.named ? this.src.name : this.src.branch || this.src.name) : "no space";
    const why = this.blocker();
    const ready = a && a.installed !== false && !this.busy && (fresh ? this.repo : this.src) && !needsText && !why;
    const issue = this.linearIssue(), project = this.linearProject(), other = this.otherRepo();
    return v_flex().id("new").size_full().p(18).bg("#18181b").text_color(C.text)
      .on_key_down((e, cx) => { if (this.newKey(cx, e.key)) cx.stop_propagation(); })
      .child(h_flex().items_center()
        .child(div().flex_1().font_family(SANS).text_size(16).font_weight(600).child("New agent"))
        .child(mono(11, C.dim, "Esc")))
      .child(label("AGENT"))
      .child(h_flex().w_full().gap(8).children(this.choices.map(agentCard)))
      .child(this.fixed || machineList().length < 2 ? label("WHERE") : h_flex().w_full().items_center()
        .child(div().flex_1().child(label("WHERE")))
        // the machine it runs on: the worktree and the agent are made there
        .child(h_flex().id("new-machines").mt(6).flex_none().p(2).gap(2).rounded(7).border(1).border_color(C.line2).bg(C.main)
          .children(machineList().map((m) => {
            const on = m === this.machine;
            return h_flex().id(`new-m-${m ?? "local"}`).h(22).px(8).gap(5).items_center().rounded(5).cursor_pointer()
              .bg(on ? C.raised : "#00000000").hover((st) => st.bg(on ? C.raised : C.hover))
              .on_click((_e, cx) => this.pickMachine(cx, m))
              .child(icon("machine", 11, on ? C.text : C.dim))
              .child(div().font_family(SANS).text_size(12).text_color(on ? C.text : C.muted).child(machineLabel(m)));
          }))))
      .child(v_flex().w_full().gap(6)
        .child(where("new-worktree", fresh, Boolean(this.repo), "New worktree", repoSub,
          (cx) => { this.mode = "worktree"; this.branch.focus(); cx.notify(); }))
        .child(where("new-here", !fresh, Boolean(this.src), "In this worktree", `${srcName} · ${tilde(this.src ? place(this.src) : "")}`,
          (cx) => { this.mode = "here"; this.task.focus(); cx.notify(); }))
        // from a Linear card: the shown space's repo instead of the last start's (and back)
        .when(!!other, (el) => el.child(h_flex().id("new-other").w_full().h(26).px(12).gap(8).items_center().rounded(7).cursor_pointer()
          .hover((st) => st.bg(C.hover)).on_click((_e, cx) => other.go(cx))
          .child(mono(11, C.accent, "↪"))
          .child(div().flex_none().font_family(SANS).text_size(12).text_color(C.soft).child(`New worktree of ${other.name}`))
          .child(div().flex_1().min_w(0).truncate().child(mono(10, C.dim, this.dir ? "the shown space's repo" : "the repo of the last start"))))))
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
      // the issues that match drop down over what's below, in a layer of their own, so the dialog keeps its size
      .child(Popup.new("new-issues", Input.new(this.ref).h(34).px(10).rounded(8).border(1).border_color(this.refFocused ? C.accentDim : C.line2).bg(C.main).font_family(SANS).text_size(12).text_color(C.text))
        .w_full().anchor("top_left")
        .when(this.refFocused && this.matches().length > 0, (el) => el.content(v_flex().w(504).mt(4).p(3).rounded(7).border(1).border_color(C.line2).bg(C.card)
        .children(this.matches().map((i) => h_flex().id(`issue-${i.project ? i.slugId : i.identifier}`).h(26).px(7).gap(8).items_center().rounded(5).cursor_pointer()
          .hover((st) => st.bg(C.raised))
          .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.addRef(cx, i); })
          .child(div().w(70).flex_none().child(i.project ? mono(10, REF_KINDS.project[1], "PROJECT") : mono(11, REF_KINDS.linear[1], i.identifier)))
          .child(div().flex_1().min_w(0).truncate().font_family(SANS).text_size(12).text_color(C.soft).child(i.project ? i.name : i.title))
          .child(mono(10, C.dim, (i.project ? i.status?.name : i.state?.name) ?? "")))))))
      .child(h_flex().w_full().pt(6).flex_wrap().gap(6)
        .children(this.refs.map((r, n) => h_flex().id(`ref-${n}`).flex_none().max_w(470).h(24).pl(7).pr(4).gap(6).items_center().rounded(6)
          .border(1).border_color(`${REF_KINDS[r.kind][1]}55`).bg(`${REF_KINDS[r.kind][1]}14`)
          .child(mono(10, REF_KINDS[r.kind][1], r.kind === "linear" ? r.id : r.kind === "project" ? "Project" : REF_KINDS[r.kind][0]))
          .child(div().min_w(0).truncate().font_family(SANS).text_size(12).text_color(C.soft)
            .child(r.kind === "linear" ? r.title ?? r.url ?? "" : r.kind === "project" ? r.title ?? r.url.replace(/^https?:\/\//, "")
              : r.kind === "pr" ? r.id : r.kind === "note" ? r.id : r.url.replace(/^https?:\/\//, "")))
          .child(div().id(`ref-x-${n}`).w(16).h(16).flex_none().rounded(4).flex().items_center().justify_center().cursor_pointer()
            .text_size(11).text_color(C.dim).hover((st) => st.bg(C.raised).text_color(C.text))
            .on_click((_e, cx) => { this.refs.splice(n, 1); cx.notify(); }).child("×"))))
        .when(!this.refs.length, (el) => el.child(mono(10, C.dim, this.issues ? "⏎ adds · your Linear issues and projects show as you type"
          : "⏎ adds · set LINEAR_API_KEY in your shell to pick from Linear"))))
      // the skills installed for this machine and repo, and None: the one on is automatic until you click one
      .when(this.installed?.size > 0, (el) => el
        .child(label("SKILL · RUNS IN CLAUDE CODE"))
        .child(h_flex().w_full().flex_wrap().gap(6).children([null, ...this.cfg.skills.filter((s) => this.installed.has(s))].map((s) => {
          const on = s === skill;
          return h_flex().id(`new-skill-${s ?? "none"}`).h(26).px(9).items_center().rounded(6).border(1)
            .border_color(on ? C.accent : C.line2).bg(on ? "#1c1926" : "#00000000").cursor_pointer()
            .hover((st) => st.bg(on ? "#1c1926" : C.hover))
            .on_click((_e, cx) => { this.skillPick = s; this.task.focus(); cx.notify(); })
            .child(s ? mono(12, on ? C.text : C.soft, s) : div().font_family(SANS).text_size(12).text_color(on ? C.text : C.soft).child("None"));
        }))))
      .child(label(needsText ? "WHAT THE SKILL SHOULD DO (REQUIRED)"
        : (skill ? this.refs.length > 0 : Boolean(issue || project)) ? `MESSAGE (OPTIONAL: EMPTY STARTS ON THE ${issue ? "ISSUE" : project ? "PROJECT" : "CONTEXT"})`
        : "FIRST MESSAGE (OPTIONAL)"))
      .child(Input.new(this.task).h(38).px(10).rounded(8).border(1).border_color(C.line2).bg(C.main).font_family(SANS).text_size(13).text_color(C.text))
      .when(!!this.error, (el) => el.child(div().pt(8).child(mono(11, C.red, this.error))))
      .child(div().flex_1())
      .child(h_flex().pt(14).gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().child(mono(11, C.dim, this.busy ? "creating the worktree…"
          : why ?? (needsText ? "say what the skill should do"
          : skill ? `it starts on /${skill}; the board stays`
          : this.prompt() ? "it starts working; the board stays" : "its terminal opens, to type in"))))
        .child(button("new-cancel", "Cancel", false, true, () => closeOverlay(props().overlay)))
        .child(button("new-start", this.busy ? "Creating…" : "Start  ⏎", true, ready, (_e, cx) => this.start(cx))));
  }

  // the bar over an agent, beside the board (where: "side", the focus-term block) or in its place ("main", the work
  // block): which agent, and Minimize, which puts the agent away and gives the board the screen and the keyboard
  agentHead() {
    const side = props()?.where === "side";
    // beside the board: the agent it last showed there, else the one the block shows by itself (Focus with no question)
    const f = focused();
    // beside the board it may show a worktree's terminals instead (one without agents): its space's shown tab
    const sideTab = side && findNode(layout(), "focus-body")?.active === "focus-tab";
    const a = sideTab ? null
      : (side ? [shared(SHOWN), f?.agent] : [f?.terminal]).map((x) => agents().find((y) => y.address === x)).find(Boolean);
    const tab = !a && (!side || sideTab) ? activeSpace()?.tabs?.find((t) => t.active) : null;
    const title = a ? agentTitle(a) ?? a.program?.name ?? a.address : tab?.name ?? activeSpace()?.name ?? "";
    const where = a ? a.space_name : tab ? activeSpace()?.name : null;
    const sp = a ? spaces().find((x) => x.id === a.space) : activeSpace();
    const iss = sp ? issueOf(sp.id, (shared(BRANCHES) ?? []).find((b) => b.space === sp.id)?.branch ?? sp.branch ?? null) : null;
    return h_flex().id("agent-head").size_full().px(10).gap(8).items_center().bg(C.top).border_b(1).border_color(C.line)
      .children(a ? [statusIcon(a.status, 8)] : [])
      .child(div().min_w(0).flex_shrink_1().font_family(SANS).text_size(12).text_color(C.text).child(trunc(title, 80)))
      .children(where && where !== title ? [div().min_w(0).flex_1().child(mono(10, C.dim, trunc(where, 40)))] : [div().flex_1()])
      .when(!!iss, (el) => el.child(h_flex().id("head-linear").flex_none().h(22).px(8).items_center().rounded(5).cursor_pointer()
        .border(1).border_color(C.line2).hover((st) => st.bg(C.hover))
        .on_click((_e, cx) => cx.spawn(async () => { await exec("open", [iss.url]); }))
        .child(div().font_family(SANS).text_size(12).text_color(C.soft).child("↗ Linear"))))
      .child(h_flex().id("minimize").flex_none().h(22).px(8).gap(6).items_center().rounded(5).cursor_pointer()
        .border(1).border_color(C.line2).hover((st) => st.bg(C.hover))
        .on_click(() => minimize(side))
        .child(icon("minimize", 12, C.muted))
        .child(div().font_family(SANS).text_size(12).text_color(C.soft).child("Minimize"))
        .when(!side, (el) => el.child(mono(10, C.dim, "⌘E"))));
  }

  bottom() {
    const c = shared(COUNTS) ?? {};
    const item = (text, color, dot) => h_flex().gap(5).items_center()
      .when(!!dot, (el) => el.child(div().w(6).h(6).rounded(3).bg(dot)))
      .child(mono(11, color, text));
    return h_flex().id("bottom").size_full().px(12).gap(16).items_center().bg(C.side).border_t(1).border_color(C.line)
      .child(div().flex_1())
      .when(!!c.problem, (el) => el.child(item(String(c.problem).slice(0, 80), C.red)))
      .when(!!c.linearProblem, (el) => el.child(item(String(c.linearProblem).slice(0, 80), C.red)))
      .when(!!c.linear, (el) => el.child(item(`linear: ${c.linear}`.slice(0, 80), C.red))) // the column keeps its last read
      .when(!!c.offline?.length, (el) => el.child(item(`${c.offline.join(", ")} offline`, C.muted, C.dim)))
      .child(item(c.when ? `read ${c.when}` : "reading…", C.dim))
      .child(item(new Date(this.now).toTimeString().slice(0, 5), C.muted));
  }
}
