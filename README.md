# Board (Herdr): your worktrees as a board

![Board (Herdr)](preview.png)

A layout for the [Herdr](https://herdr.dev) desktop app. Each git worktree you work in is a card on a Linear-style board,
in a stage you choose: Perpétuo (the agents you always keep open), Planning, In progress, In review, Watch, Temp, Done,
Archived, Paused. Stages are labels you pick; only two act: Done removes the worktree after 3 days, and Archived puts
its tabs away. A card shows:

- every agent working in that worktree, and the sub-agents they started, counted by status;
- its branch, commits, uncommitted lines, pull request and checks; when its agents opened more pull requests (in
  clones under the worktree's `repos/`, from another folder, or a review that checked someone's PR out under a
  name of its own), `3 PRs ▾` lists them all;
- the question an agent is waiting on, with every option in full to click (its column widens to fit them);
- the machine it is on, when that isn't this one: a dashed outline around the card, like a box, and a tag with the
  machine's name, such as `devbox`, and `devbox · offline` while Herdr can't reach it;
- the Linear issue it was started from (`↗ ENG-12`, which opens it), and in Planning, `📄 Plan ready` once a
  planning skill wrote its plan (below).

The sidebar lists the worktrees by stage, each with its agents, in the order you drag them to. A click on a worktree
goes to its main agent, not a sub-agent that agent started.

- **Right-click a card** for its menu: Mark as unread (the card stays green, as a finished agent, until you open one
  of its agents; `U` does it too), its pull requests when it has several, its labels, End agents / Restore agents, its
  stage, and Delete worktree (also on another machine; Herdr's own Remove worktree asks first). A Linear card's menu
  opens it in Linear or starts it.
- **New agent** (⌘N): pick the machine, then one of its Herdr spaces (a repo once, or a folder outside git), then a
  new worktree or an existing one of that repo. It opens on the last start's choice, not on where you are.
  `board.json`'s `linearRepo` makes every Linear card start in that repo, on whichever machine has it open.
- **Rename**: `⇧R` (or the card's menu) gives a card your own title; saved empty, it goes back to the automatic one
  (the issue's, the first message's, what the agent says it's doing, the branch).
- **Labels**: your own words for a worktree (pesquisa, feature, bug…): `T` opens a field where typing a new one makes
  it. Cards show them; the filter row filters by them, and `G` groups each column's cards by label.
- **Archive without the load**: archiving a worktree offers to end its Claude Code and OpenCode agents, to free the
  machine. Restore brings each one back in its terminal, in the same conversation (`claude --resume`, `opencode -s`).
- **Drag**: a card to another column changes its stage; within a column, it changes its place. Drag the board's
  background to scroll it sideways, as in Linear.
- **An agent beside the board**: a click on a card shows its agent's terminal at the right, and the board stays
  whole and clickable, panned so the card you picked stays in view, so another click shows another agent; a card with only terminals shows those. The bar over an
  agent, beside the board or in its place,
  has **Minimize**, which gives the board back the screen and the keyboard.
- **Machines**: with Herdr's ssh machines, the board and the sidebar filter by machine, and New agent asks where the
  agent runs.
- **New agent** (⌘N) makes a worktree of the shown repo and starts Claude Code or OpenCode in it. The agent's first
  message is yours plus a Context block: a Linear issue (picked from your own when `LINEAR_API_KEY` is set), a pull
  request, a Slack message, any link or note. The card gets the issue's title, the branch gets Linear's branch name.
- **A Linear column** (with `LINEAR_API_KEY`): the board's first column lists your Linear issues in Todo (assigned to
  you, not started). Drag one onto **Planning** or **In progress**: a short summary asks `Start ENG-12?` with the
  machine, agent and repo of your last New agent, the branch Linear suggests and the skill that column runs. ⏎ starts
  it (a worktree, the agent, the skill), E opens New agent with all of it filled in to change anything or add a first
  message, Esc cancels and nothing changes. Started onto In progress, the issue moves to In Progress in Linear; that
  is the only thing the board ever writes there. An issue that has a worktree shows as that worktree's card, never
  twice: the board knows it from the start, or from the issue ID at the start of the branch name. Only cards from the
  Linear column start anything; moving a worktree between stages only changes its label.
- **Skills** (optional): name the Claude Code skills you use on Linear issues in `~/.config/herdr-app/board.json`:

  ```json
  {
    "skills": ["orchestrator", "plan-skill", "build-skill"],
    "stageSkills": { "todo": "plan-skill", "in_progress": "orchestrator" },
    "issueArg": ["plan-skill", "build-skill"],
    "skillFlags": { "build-skill": "--sync-repos" }
  }
  ```

  - `skills`: what New agent offers, among those installed in `~/.claude/skills` or the repo's `.claude/skills`.
  - `stageSkills`: the skill a Linear card dropped on that column runs (`todo` is Planning).
  - `issueArg`: skills that take the issue ID as their first argument (`/plan-skill ENG-12`).
  - `skillFlags`: flags always passed to a skill.

  The agent starts as Claude Code on `/<skill> [ID] [flags] <your message>`, then the Context block with the issue;
  with an issue the message is optional. Where a column's skill isn't installed, the summary says so and won't start.
  Without the file, New agent and the Linear column work with no skill. The older `{ "orchestrate": "<skill>" }`
  still works.
- **Plans**: a card in Planning shows `📄 Plan ready` when its worktree has `tmp/<ID>/plan/report.md` (or
  `report.html`), as a planning skill may write. A click opens it in the browser, the Markdown as a readable page.
- **Asks** (⌘⇧A): every question your agents ask, answered from the card or the panel without opening the terminal.
  This covers permission prompts, menus of options and turns that end with a plain-text question. It is built on
  [herdr-agent-ask](https://github.com/sachin-philip/herdr-agent-ask).
- **Still being built, off by default**: a PRs view of the pull requests that wait on you on GitHub.
  `"features": { "prs": true }` in `board.json` turns it on (the sidebar's PRs row and ⌘⇧G); it is unfinished and may
  change.
- **Worktrees don't pile up on disk.**
  - Done removes a worktree after 3 days, unless it has uncommitted changes.
  - ⌘W on a worktree's last tab removes it.
  - `leftover worktrees · clean up` lists the ones a closed space left behind.
  - A removal keeps the branch and its commits.
- **Keyboard first**, like Linear:
  - ↑↓←→ / hjkl to move, 1–9 to jump to a stage, 0 to the Linear column;
  - S to change the stage, ⇧←→ to move it one stage;
  - ⏎ to open the agent (on a Linear issue: start it), Space to peek at it, F for Focus;
  - Y to answer with the recommended option, R for the Asks panel;
  - N for a new agent, M to merge or ship the PR, / to search, ? for every key.

## Install

Ask an agent in a Herdr terminal:

```
Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/ArthurRAmaral/herdr-worktree-board
```

By hand: copy `layouts/board-herdr.json` to `~/.config/herdr-app/layouts/` and `mods/board-herdr/` to
`~/.config/herdr-app/mods/`. Then merge `keys.json` into yours, which makes your keys file your own, and run
`herdr-app do layout.switch --name board-herdr`. `ctrl-shift-l` switches back; deleting the two copied items removes it.

## Keys

| Key | Where | What |
|---|---|---|
| ⌘⇧B | anywhere | the board (from another layout, switches to this one) |
| ⌘E | this layout | the keyboard between the board and an agent, opening and closing nothing: the agent beside the board when it's open, else the selected card's on the whole screen, and back |
| ⌘N | this layout | New agent |
| ⌘W | this layout | close the tab; on a worktree's last tab, remove the worktree |
| ⌘⇧A | this layout | the Asks panel |

## What it runs

Mods are trusted code. This one:

- runs `git` and `gh` on the machine a worktree is on: through `hc` for one of Herdr's ssh machines, as that
  machine's login (a machine Herdr can't reach is skipped until it's back);
- runs `git` in each worktree's folder: `status`, `rev-list` and `diff --shortstat`, plus
  `worktree add|list|remove|prune` from New agent, Done and the cleanup;
- runs `gh` for each branch's pull request and checks (also for the folders a worktree's agents work in, and `gh pr
  list` of your open PRs in each clone under its `repos/`), your PRs merged this week, and Merge PR / Ship PR
  (`gh pr merge`, `git push -u origin HEAD && gh pr create --fill`), only when you click or press M and confirm;
- with `features.prs` on (above), runs `gh api graphql` for the PRs view, every 3 minutes while the layout is shown.
  It searches the open PRs of the org in `prs.json` (yours, asking your review, reviewed by you, and your team
  repos'), and reads those repos' CODEOWNERS file. Nothing is sent anywhere but GitHub, as your `gh` login;
- runs `hc` to read agents' screens and type your answers into them;
- runs `claude -p` (Haiku) on each finished agent turn with a `?` in it, and on a dialog it can't read. **That sends the
  agent's last message to Anthropic through your own Claude Code login**, a few seconds and under a cent per call. Set
  `"trailing_questions": false` (dialogs only) or `"classify": "off"` (never) in `~/.config/herdr-app/asks.json` to
  limit or stop it;
- reads `LINEAR_API_KEY` from your login shell, if it is set, and sends it only to `api.linear.app`: to read your
  issues and projects, and to move an issue you started onto In progress to its team's started state;
- writes the plans it opens as pages under `~/.config/herdr-app/cache/plans/`;
- appends each answer to `~/.config/herdr-app/decisions.md`. The `log` setting in `asks.json` changes that file; a file
  inside the repo would leave every worktree dirty, and Done would never remove it.

Needs the Herdr desktop app (0.1.15) and git. gh, Claude Code, OpenCode and a Linear key are each optional; without
them, the part that needs them is empty.

`RECIPE.md` describes the whole build, for an agent to make it again from an empty folder.

## License

MIT, see `LICENSE`. `mods/board-herdr/asks*.js` and the `ask*.svg` icons come from herdr-agent-ask by sachin-philip
(MIT), whose notice is in `LICENSE` too.
