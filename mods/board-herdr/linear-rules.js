// The Linear column's rules: board.json's skills, an issue's ID from a branch name, which stages a Linear card can be
// dropped on, the first message an agent gets, and what the column shows; plain rules, no Herdr or network calls, so
// test/linear-rules.test.mjs runs them with node.

const NAME = /^[\w.-]+$/;
const names = (v) => (Array.isArray(v) ? v : []).filter((n) => typeof n === "string" && NAME.test(n));
const mapOf = (v, ok) => Object.fromEntries(Object.entries(v && typeof v === "object" ? v : {})
  .filter(([k, val]) => typeof val === "string" && ok(k, val)));

// board.json read into skills (the picker's list), a skill per stage, skills that take the issue ID, a skill's flags,
// and the features still being built, each off unless board.json says `true` ({"features": {"prs": true}}: the PRs
// view); the old {orchestrate: "x"} still reads as x, started in progress
export function readBoardConfig(json) {
  const j = json && typeof json === "object" ? json : {};
  const cfg = {
    skills: names(j.skills),
    stageSkills: mapOf(j.stageSkills, (_, v) => NAME.test(v)),
    issueArg: names(j.issueArg),
    skillFlags: mapOf(j.skillFlags, (k) => NAME.test(k)),
    features: { prs: j.features?.prs === true },
  };
  if (typeof j.orchestrate === "string" && NAME.test(j.orchestrate) && !cfg.skills.length) {
    cfg.skills = [j.orchestrate];
    cfg.stageSkills = { in_progress: j.orchestrate };
  }
  return cfg;
}

// a branch's issue ID, upper-cased: <KEY>-<n> at the start of its last path segment, as Linear names branches
// (<user>/<key>-<n>-<slug> or <key>-<n>-<slug>); KEY must be a team's, and a branch-type folder (fix/, feat/...) means
// the segment is a description, not an issue ("fix/ops-64-overflow", "fix-utf-8" have no issue)
const BRANCH_TYPE = /^(fix|feat|feature|bugfix|hotfix|chore|refactor|docs|test|ci|build|perf|style|revert|release)$/i;
export function issueFromBranch(branch, teamKeys) {
  const parts = String(branch ?? "").split("/");
  if (parts.length > 1 && BRANCH_TYPE.test(parts[parts.length - 2])) return null;
  const m = parts[parts.length - 1].match(/^([a-z][a-z0-9]*)-(\d+)(?:-|$)/i);
  if (!m || !teamKeys.some((k) => k.toUpperCase() === m[1].toUpperCase())) return null;
  return `${m[1].toUpperCase()}-${m[2]}`;
}

// a Linear card can start work in Planning or In progress only
export const canDrop = (stage) => stage === "todo" || stage === "in_progress";

// the team's first "started" state, the one an issue moves to when work starts
export function startedState(states) {
  const started = states.filter((s) => s.type === "started").sort((a, b) => a.position - b.position);
  return started[0] ?? null;
}

// what the agent is told first: the skill's command (with the issue and its flags), or a plain sentence, then the context
export function firstMessage({ skill, cfg, issueId, stage, text, context }) {
  let msg;
  if (skill) {
    msg = [`/${skill}`, (cfg?.issueArg ?? []).includes(skill) && issueId, cfg?.skillFlags?.[skill], text]
      .filter(Boolean).join(" ").trim();
  } else if (text) {
    msg = text;
  } else if (!issueId) {
    msg = "";
  } else {
    msg = stage === "todo" ? `Plan the work for Linear issue ${issueId}. Don't change code yet.`
      : `Start working on the Linear issue ${issueId}.`;
  }
  return context?.length ? `${msg}\n\nContext:\n${context.join("\n")}`.trimStart() : msg;
}

// the Linear column: unstarted issues, minus ones with a worktree and ones started under two minutes ago (Linear may
// not show the move yet)
export function todoColumn(issues, { linked, starting, now }) {
  const idOf = (i) => i.identifier ?? i.id;
  return issues.filter((i) => i.state?.type === "unstarted" && !linked.has(idOf(i))
    && !(idOf(i) in starting && now - starting[idOf(i)] < 120000));
}

// the issue moves in Linear only when the card came from Linear and ends in progress
export const moveInLinear = (fromLinear, finalStage) => fromLinear === true && finalStage === "in_progress";
