// The PRs view (the main stack's "prs" child, ⌘⇧G): the open pull requests that wait on you as two lanes, other
// people's on top and yours below, each PR in the column of where it stands (prs-rules.js). It only reads: the data is
// what the sidebar's PrsFeed keeps in shared state; ⏎ opens a PR in the browser, ⌁ the agent whose worktree is on the
// PR's branch. "prs-settings" is the gear's dialog: the org and the team's repos, written to prs.json.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import { exec, shared, setShared, props, closeOverlay } from "herdr";
import { THEIRS, MINE, lanes, blocker } from "./prs-rules.js";
import { PRS, PR_ASK, PR_DRAFTS, readPrsConfig, savePrsConfig } from "./prs-data.js";

export const PRS_SHOWN = "boardh.prsShown"; // shared: when the view was last opened (ms): it takes the keyboard

const C = {
  main: "#121214", card: "#1a1a1d", raised: "#242328", hover: "#1f1f23", line: "#1e1e20", line2: "#2a2a30",
  text: "#e4e4e7", soft: "#c8c8cc", muted: "#8a898e", dim: "#56555b", accent: "#b4a0db", accentDim: "#625187",
  you: "#ffb406", youBg: "#1f1a10", youLine: "#4a3a12", work: "#8f7fd1", land: "#53cf91", red: "#e0707f",
};
const MONO = "JetBrains Mono";
const SANS = "Geist";
const AVATAR = ["#e9a27a", "#7ac0e9", "#a5e97a", "#e97ad0", "#e9d77a", "#9d8ff0", "#7ae9c4"];
const LANES = [["theirs", "PRs de outros", THEIRS], ["mine", "Meus PRs", MINE]];
const COL_MIN = 220; // px: the narrowest a column with PRs gets; below that the lane scrolls sideways
const EMPTY_W = 150; // px: a column without PRs
const GAP = 8;

const mono = (size, color, text) => div().font_family(MONO).text_size(size).text_color(color).child(text);
const sans = (size, color, text) => div().font_family(SANS).text_size(size).text_color(color).child(text);
function dur(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
// the author's initials on a color of their own (an avatar picture would have to be downloaded first)
function avatar(login) {
  const color = AVATAR[[...login].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 0) % AVATAR.length];
  return div().w(15).h(15).flex_none().rounded(8).bg(color).flex().items_center().justify_center()
    .font_family(SANS).text_size(8).font_weight(700).text_color("#111").child(login.slice(0, 2).toUpperCase());
}
const open = (url) => exec("open", [url]);

export class PrsBoard {
  // refocused(): when a dialog over the view last closed (ms), to take the keyboard back
  constructor({ agentFor, openSpace, settings, refocused }) {
    this.agentFor = agentFor; this.openSpace = openSpace; this.settings = settings; this.refocused = refocused;
  }

  init(cx) {
    this.h = cx.focus_handle();
    this.sel = null; // the selected PR's url
    this.now = Date.now();
    this.shownAt = 0; // the first draw takes the keyboard: the copy starts when it's first shown
    this.refocusAt = this.refocused();
    // "lane:col" -> each column's list, to keep the selection in view (handles can't be made while drawing)
    this.scroll = Object.fromEntries(LANES.flatMap(([lane, , cols]) => cols.map((_c, ci) => [`${lane}:${ci}`, ScrollHandle.new()])));
    cx.timer.every(30000, (cx) => { this.now = Date.now(); cx.notify(); });
  }

  handle(key) { return this.scroll[key]; }

  // the lanes as a grid: grid[lane][col] is that column's PRs
  grid() {
    const l = lanes(shared(PRS)?.prs ?? [], shared(PR_DRAFTS) ?? {}, this.now);
    return LANES.map(([lane, , cols]) => cols.map(([k]) => l[lane][k]));
  }

  where(grid) {
    for (let li = 0; li < grid.length; li++) for (let ci = 0; ci < grid[li].length; ci++) {
      const ri = grid[li][ci].findIndex((p) => p.url === this.sel);
      if (ri >= 0) return [li, ci, ri];
    }
    return null;
  }

  pick(grid, li, ci, ri, cx) {
    const pr = grid[li]?.[ci]?.[ri];
    if (!pr) return;
    this.sel = pr.url;
    this.handle(`${LANES[li][0]}:${ci}`).scroll_to_item(ri);
    cx.notify();
  }

  // ↑↓ within a column (past its end, the other lane), ←→ across columns that have PRs
  step(cx, dc, dr) {
    const grid = this.grid();
    const at = this.where(grid);
    if (!at) {
      for (let li = 0; li < grid.length; li++) { const ci = grid[li].findIndex((c) => c.length); if (ci >= 0) return this.pick(grid, li, ci, 0, cx); }
      return;
    }
    let [li, ci, ri] = at;
    if (dr) {
      ri += dr;
      if (ri < 0 || ri >= grid[li][ci].length) {
        const other = 1 - li;
        if (!grid[other][ci].length) return;
        li = other; ri = dr > 0 ? 0 : grid[li][ci].length - 1;
      }
      return this.pick(grid, li, ci, ri, cx);
    }
    for (let c = ci + dc; c >= 0 && c < grid[li].length; c += dc) {
      if (grid[li][c].length) return this.pick(grid, li, c, Math.min(ri, grid[li][c].length - 1), cx);
    }
  }

  selected() { return (shared(PRS)?.prs ?? []).find((p) => p.url === this.sel) ?? null; }

  openAgent(pr) { const id = pr && this.agentFor(pr.repo, pr.branch); if (id) this.openSpace(id); }

  // d: one of my drafts, between "revisar para liberar" and "ideias"
  toggleDraft(pr) {
    if (!pr?.mine || !pr.draft) return;
    const drafts = { ...(shared(PR_DRAFTS) ?? {}) };
    drafts[pr.url] = drafts[pr.url] === "ideas" ? "review" : "ideas";
    setShared(PR_DRAFTS, drafts);
  }

  key(e, cx) {
    const k = e.key, m = e.modifiers;
    if (m.platform || m.control || m.alt) return;
    const pr = this.selected();
    if (k === "j" || k === "down") this.step(cx, 0, 1);
    else if (k === "k" || k === "up") this.step(cx, 0, -1);
    else if (k === "h" || k === "left") this.step(cx, -1, 0);
    else if (k === "l" || k === "right") this.step(cx, 1, 0);
    else if ((k === "enter" || k === "o") && pr) open(pr.url);
    else if (k === "a" && pr) this.openAgent(pr);
    else if (k === "d" && pr) { this.toggleDraft(pr); cx.notify(); }
    else if (k === "r") setShared(PR_ASK, Date.now());
    else if (k === ",") this.settings();
    else if (k === "escape") { this.sel = null; cx.notify(); }
    else return;
    cx.stop_propagation();
  }

  btn(id, label, onClick) {
    return div().id(id).flex_none().px(9).py(3).rounded(5).bg(C.raised).border(1).border_color(C.line2).text_color(C.text)
      .font_family(SANS).text_size(12).cursor_pointer().hover((st) => st.opacity(0.85))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }).child(label);
  }

  card(pr, lane, col) {
    const on = pr.url === this.sel;
    const agent = this.agentFor(pr.repo, pr.branch);
    const block = lane === "theirs" && col === "ready" ? blocker(pr) : null;
    const checks = pr.checks === "pass" ? ["✓", C.land] : pr.checks === "fail" ? ["✗", C.red] : pr.checks === "running" ? ["●", C.work] : null;
    const link = (id, label, color, onClick) => div().id(id).flex_none().px(3).rounded(3).cursor_pointer().hover((st) => st.bg(C.raised))
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(); }).child(mono(12, color, label));
    const who = pr.mine
      ? (pr.reviewers.length ? [mono(10.5, C.muted, `→ ${pr.reviewers.join(", ")}`)] : [])
      : [avatar(pr.author), mono(10.5, C.soft, pr.author)];
    return v_flex().id(`pr-${pr.url}`).w_full().flex_none().gap(5).px(9).py(8).rounded(6).border(1).cursor_pointer()
      .bg(on ? "#1c1926" : C.card).border_color(on ? C.accentDim : C.line2).hover((st) => st.bg(on ? "#1c1926" : C.hover))
      .on_click((e, cx) => { this.sel = pr.url; this.h.focus(); if (e.click_count === 2) open(pr.url); cx.notify(); })
      .child(div().w_full().max_h(36).overflow_hidden().font_family(SANS).text_size(12.5).text_color(C.text).child(pr.title))
      .child(h_flex().w_full().gap(6).items_center().flex_wrap()
        .children(who)
        .child(mono(10.5, C.muted, `${pr.repo}#${pr.number}`))
        .children(checks ? [mono(11, checks[1], checks[0])] : [])
        .children(pr.threads ? [mono(10.5, C.soft, `💬 ${pr.threads}`)] : [])
        .child(mono(10.5, C.dim, dur(this.now - pr.updatedAt)))
        .children(block ? [div().px(5).rounded(4).bg(C.youBg).border(1).border_color(C.youLine).child(mono(10, C.you, block))] : [])
        .child(div().flex_1())
        .children(agent ? [link(`agent-${pr.url}`, "⌁", C.accent, () => this.openSpace(agent))] : [])
        .child(link(`open-${pr.url}`, "↗", C.accent, () => open(pr.url))));
  }

  lane([lane, title, cols], lists) {
    const n = lists.reduce((s, l) => s + l.length, 0);
    // the columns with PRs share what the empty ones leave (text would otherwise widen a column past the others)
    const full = lists.filter((l) => l.length).length;
    const colW = Math.max(COL_MIN, Math.floor(((this.rowW ?? 0) - GAP * (cols.length - 1) - EMPTY_W * (cols.length - full)) / Math.max(1, full)));
    return v_flex().id(`lane-${lane}`).w_full().flex_1().min_h(0).gap(8)
      .child(h_flex().gap(8).items_center()
        .child(sans(13, C.text, title).font_weight(600))
        .child(mono(11, C.dim, `· ${n}`)))
      // a plain flex row: h_flex centres its children, which would shrink each column to its header
      .child(div().id(`cols-${lane}`).w_full().flex_1().min_h(0).flex().flex_row().gap(GAP).overflow_x_scrollbar()
        .on_size_change((size, cx) => { if (size.width !== this.rowW) { this.rowW = size.width; cx.notify(); } })
        .children(cols.map(([k, label, color], ci) => v_flex().id(`col-${lane}-${k}`).flex_none().w(lists[ci].length ? colW : EMPTY_W).min_h(0).gap(7).p(6)
          .rounded(8).border(1).border_color(C.line).bg("#141416")
          .child(h_flex().w_full().h(20).flex_none().gap(7).items_center()
            .child(div().w(8).h(8).flex_none().rounded(4).bg(color))
            .child(div().flex_1().min_w(0).truncate().child(mono(10.5, lists[ci].length ? C.soft : C.dim, label.toUpperCase())))
            .child(div().flex_none().px(5).rounded(8).bg(C.raised).child(mono(10, C.muted, String(lists[ci].length)))))
          .child(v_flex().id(`list-${lane}-${k}`).w_full().flex_1().min_h(0).gap(6).overflow_y_scrollbar()
            .track_scroll(this.handle(`${lane}:${ci}`))
            .children(lists[ci].map((pr) => this.card(pr, lane, k)))))));
  }

  render(cx) {
    const st = shared(PRS) ?? {};
    const shown = shared(PRS_SHOWN) ?? 0;
    const rf = this.refocused();
    if (shown !== this.shownAt || rf !== this.refocusAt) {
      this.shownAt = shown; this.refocusAt = rf;
      cx.timer.after(30, () => this.h.focus()); // focus can't move while drawing
    }
    const grid = this.grid();
    if (this.sel && !this.where(grid)) this.sel = null;
    const when = st.at ? new Date(st.at).toTimeString().slice(0, 5) : null;
    const head = h_flex().w_full().flex_none().gap(12).items_center()
      .child(sans(15, C.text, "PRs").font_weight(600))
      .child(mono(11, C.dim, st.reading ? "reading…" : when ? `read ${when}` : "not read yet"))
      .children(st.problem ? [div().min_w(0).truncate().child(mono(11, C.red, st.problem))] : [])
      .child(div().flex_1())
      .child(mono(11, C.dim, "hjkl move · ⏎ open · a agent · d draft"))
      .child(this.btn("prs-refresh", "↻ Refresh  R", () => setShared(PR_ASK, Date.now())))
      .child(this.btn("prs-settings", "⚙ Repos  ,", () => this.settings()));
    const root = v_flex().id("prs").relative().size_full().bg(C.main).px(16).pt(14).pb(10).gap(12)
      .track_focus(this.h).on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_down("left", () => this.h.focus())
      .child(head);
    if (!st.org) {
      return root.child(v_flex().flex_1().items_center().justify_center().gap(10)
        .child(sans(14, C.soft, "Set your GitHub org and team repos"))
        .child(this.btn("prs-setup", "⚙ Set up", () => this.settings())));
    }
    // GitHub answers an org it doesn't know (or can't show you) with no PRs, not an error: say which org was read
    if (st.at && !st.reading && !st.problem && !(st.prs ?? []).length) {
      return root.child(v_flex().flex_1().items_center().justify_center().gap(10)
        .child(sans(14, C.soft, `No open pull requests for you in ${st.org}`))
        .child(sans(12, C.dim, "Check the org's name, or that gh is logged in with access to it (gh auth status)."))
        .child(this.btn("prs-check", "⚙ Repos", () => this.settings())));
    }
    return root.children(LANES.map((l, li) => this.lane(l, grid[li])));
  }
}

// ---- the gear's dialog ---------------------------------------------------------------------------------------------

export class PrsSettings {
  init(cx) {
    this.h = cx.focus_handle();
    this.text = null; this.error = null; this.loaded = false; this.saving = false;
    this.org = InputState.new({ placeholder: "your-org" });
    this.add = InputState.new({ placeholder: "Add a repo: its name, ⏎" });
    this.add.on("submit", (_e, cx) => { const name = this.add.value().trim(); if (name) this.addRepo(name); this.add.set_value(""); cx.notify(); });
    this.repos = []; // [{repo, owners: boolean, team: InputState}]
    cx.spawn(async (cx) => {
      try {
        const r = await readPrsConfig();
        this.text = r.text;
        this.broken = Boolean(r.error);
        if (r.error) this.error = `prs.json isn't valid JSON (${r.error}): fix it by hand first`;
        this.org.set_value(r.cfg.org);
        for (const t of r.cfg.team_repos) this.addRepo(t.repo, t.codeowners);
      } catch (e) { this.error = String(e.message ?? e); }
      this.loaded = true;
      cx.notify();
      cx.timer.after(30, () => this.h.focus());
    });
  }

  addRepo(repo, codeowners) {
    if (this.repos.some((r) => r.repo === repo)) return;
    const team = InputState.new({ placeholder: "team-slug" });
    if (codeowners) team.set_value(codeowners);
    this.repos.push({ repo, owners: Boolean(codeowners), team });
  }

  save(cx) {
    if (this.broken || this.saving) return;
    // a repo typed but not yet added goes in too; a CODEOWNERS row needs its team, or it would bring the whole repo
    const typed = this.add.value().trim();
    if (typed) { this.addRepo(typed); this.add.set_value(""); }
    const noTeam = this.repos.find((r) => r.owners && !r.team.value().trim());
    if (noTeam) { this.error = `${noTeam.repo}: type the CODEOWNERS team, or pick Whole repo`; cx.notify(); return; }
    const cfg = { org: this.org.value().trim(),
      team_repos: this.repos.map((r) => (r.owners ? { repo: r.repo, codeowners: r.team.value().trim() } : { repo: r.repo })) };
    this.saving = true;
    cx.spawn(async (cx) => {
      try {
        await savePrsConfig(cfg, this.text);
        setShared(PR_ASK, Date.now());
        closeOverlay(props().overlay);
      } catch {
        this.error = "prs.json changed on disk — reopen to edit";
        this.saving = false;
        cx.notify();
      }
    });
  }

  render(cx) {
    const field = (input, w) => h_flex().h(28).px(8).rounded(6).border(1).border_color(C.line2).bg("#161618")
      .when(Boolean(w), (el) => el.w(w)).when(!w, (el) => el.flex_1())
      .child(Input.new(input).flex_1().min_w(0).h(26).font_family(SANS).text_size(12.5).text_color(C.text));
    const seg = (id, on, label, onClick) => div().id(id).px(8).py(3).rounded(5).cursor_pointer()
      .bg(on ? C.raised : "#00000000").hover((st) => st.bg(C.hover))
      .on_click((_e, cx) => { onClick(); cx.notify(); }).child(sans(11.5, on ? C.text : C.muted, label));
    const button = (id, label, primary, onClick) => div().id(id).px(12).py(5).rounded(6).cursor_pointer()
      .bg(primary ? C.accent : C.raised).border(1).border_color(primary ? C.accent : C.line2).hover((st) => st.opacity(0.85))
      .on_click((_e, cx) => onClick(cx)).child(sans(12.5, primary ? "#0f0f11" : C.text, label));
    return v_flex().id("prs-settings").size_full().bg("#18181b").p(18).gap(12)
      .track_focus(this.h)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(sans(15, C.text, "PRs: org and team repos").font_weight(600))
      .child(sans(12, C.muted, "Only this org's pull requests show. A team repo brings in its PRs nobody asked you about: all of them, or only the ones that change a CODEOWNERS team's folders."))
      .child(h_flex().gap(10).items_center().child(div().w(60).child(sans(12.5, C.soft, "Org"))).child(field(this.org)))
      .child(v_flex().id("prs-repos").flex_1().min_h(0).gap(6).overflow_y_scrollbar()
        .children(this.repos.map((r, i) => h_flex().id(`repo-${r.repo}`).w_full().gap(8).items_center().px(8).py(5).rounded(6).bg(C.card)
          .child(div().w(130).flex_none().truncate().child(mono(12, C.text, r.repo)))
          .child(h_flex().flex_none().p(2).gap(2).rounded(6).border(1).border_color(C.line2)
            .child(seg(`whole-${i}`, !r.owners, "Whole repo", () => { r.owners = false; }))
            .child(seg(`owners-${i}`, r.owners, "CODEOWNERS team", () => { r.owners = true; })))
          .children(r.owners ? [field(r.team, 210)] : [])
          .child(div().flex_1())
          .child(div().id(`rm-${i}`).px(6).rounded(4).cursor_pointer().hover((st) => st.bg(C.raised))
            .on_click((_e, cx) => { this.repos.splice(i, 1); cx.notify(); }).child(mono(13, C.muted, "×")))))
        .children(this.loaded && !this.repos.length ? [sans(12, C.dim, "No team repos yet.")] : []))
      .child(field(this.add).w_full().flex_none())
      .children(this.error ? [sans(12, C.red, this.error)] : [])
      .child(h_flex().gap(8).justify_end()
        .child(button("prs-cancel", "Cancel", false, () => closeOverlay(props().overlay)))
        .child(button("prs-save", this.saving ? "Saving…" : "Save", true, (cx) => this.save(cx))));
  }
}
