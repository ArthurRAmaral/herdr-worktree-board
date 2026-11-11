// Asks (github.com/sachin-philip/herdr-agent-ask, 0.3.0), fitted to the board: every question an agent waits on, as a
// card answered from here. Answerer delivers an answer to the agent's terminal with hc (the board's cards use it too,
// so an option is one click on the card); AsksPanel is the "asks" part, the panel at the board's right. Detection is
// in asks-engine.js, run by the sidebar. Its scope is the board's: this repo's worktrees, or all of them (V).
import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, hc, exec, nextCommand } from "herdr";
import { readState, update, stillAsking, stillIdle, liveTerminal, age, loadConfig } from "./asks-state.js";

// How long an answer waits for the agent to react. hc holds a paste or key press until nobody has typed in that
// terminal for ~3 s, and a turn takes a moment to start.
const SETTLE_MS = 8000;

export const KIND = { APPROVAL: "blocked", DECISION: "accent", QUESTION: "working", UNCLEAR: "dim" };
const stamp = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
export const one = (s) => (s ?? "").replace(/\s+/g, " ").trim();
// Questions of a multi-question card; older cards stored them as plain strings.
export const questionsOf = (ask) => (ask.questions ?? []).map((q) => typeof q === "string" ? { text: q, options: [], recommended: null } : { text: q.text, options: q.options ?? [], recommended: q.recommended ?? null });
// the asks still waiting on you (sending and failed ones stay on screen until they land)
export const waitingAsks = () => readState().asks.filter((a) => a.state === "pending" || a.state === "sending" || a.state === "failed");
// what a key or a click can answer at once: an ask with options to pick
export const pickable = (ask) => ask && ask.state === "pending" && ask.options.length > 0 && ask.kind !== "UNCLEAR";

function iconOf(p, size, color) {
  if (!p?.icon) return div().size(size).rounded(4).bg(color).opacity(0.3);
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export class Answerer {
  loadConfig(cx) {
    const config = (cx) => cx.spawn(async (cx) => { this.config = await loadConfig(); cx.notify(); });
    config(cx);
    cx.timer.every(30000, config);
  }

  set(id, patch) { update((s) => { const a = s.asks.find((x) => x.id === id); if (a) Object.assign(a, patch); }); }

  stale(ask) { this.set(ask.id, { state: "stale", note: "Resolved in terminal", ended_at: Date.now() }); }

  dismiss(ask) { this.set(ask.id, { state: "dismissed", ended_at: Date.now() }); }

  async probe(address) {
    const r = await hc(["get", address, "--json"]);
    if (r.code !== 0) return null;
    const g = JSON.parse(r.stdout);
    const st = typeof g.status === "string" ? g.status : g.status?.state ?? null;
    return { state: g.state === "live" ? st : "gone", msg: typeof g.status === "object" ? g.status?.msg ?? "" : "", turn: g.turn ?? 0 };
  }

  // Probe every 400 ms until `done(g)` or the time is up; returns the last probe.
  async settle(address, sleep, done, ms = SETTLE_MS) {
    const until = Date.now() + ms;
    let g = null;
    for (;;) {
      g = await this.probe(address);
      if (!g || g.state === "gone" || done(g)) return g;
      if (Date.now() >= until) return g;
      await sleep(400);
    }
  }

  // Press the option's number; Enter only if the dialog is still there (Claude Code selects on the number alone).
  answer(ask, option, cx) {
    // A prose question: the option is sent as a message, not pressed as a key.
    if (ask.delivery === "send") return this.sendText(ask, option.label.replace(/\s*\(recommended\)\s*$/i, ""), cx);
    if (!stillAsking(ask)) return this.stale(ask);
    const sentTurn = liveTerminal(ask.address)?.turn ?? ask.turn ?? 0;
    this.set(ask.id, { state: "sending", answer: option.label, chosen: option, error: null, sent_turn: sentTurn, sent_at: Date.now() });
    const same = (g) => g.state === "blocked" && g.msg === ask.msg && g.turn <= sentTurn;
    this.deliver(ask, cx, async (sleep) => {
      let r = await hc(["keys", ask.address, String(option.n)]);
      if (r.code !== 0) throw new Error(one(r.stderr) || "Could not press the key");
      let g = await this.settle(ask.address, sleep, (g) => !same(g), 1500);
      if (g && same(g)) {
        r = await hc(["keys", ask.address, "enter"]);
        if (r.code !== 0) throw new Error(one(r.stderr) || "Could not press Enter");
        g = await this.settle(ask.address, sleep, (g) => !same(g));
      }
      return g;
    });
  }

  // Free text into a dialog (Claude Code's question dialog takes typed text as its own answer) or to an idle agent.
  sendText(ask, text, cx) {
    const live = stillAsking(ask);
    if (!live && !stillIdle(ask)) return this.set(ask.id, { state: "stale", note: ask.delivery === "send" ? "Answered in terminal" : "Resolved in terminal", ended_at: Date.now() });
    const sentTurn = liveTerminal(ask.address)?.turn ?? ask.turn ?? 0;
    this.set(ask.id, { state: "sending", answer: text, chosen: { text }, error: null, sent_turn: sentTurn, sent_at: Date.now() });
    this.sent?.();
    // Taken: the turn moved on, or (idle agent) it is no longer idle, or (dialog) the dialog is gone.
    const taken = (g) => g.turn > sentTurn || (live ? !(g.state === "blocked" && g.msg === ask.msg) : !(g.state === "idle" || g.state === "done"));
    this.deliver(ask, cx, async (sleep) => {
      const r = await hc(live ? ["send", "--force", ask.address, text] : ["send", ask.address, text]);
      if (r.code !== 0) throw new Error(one(r.stderr) || "Could not send the answer");
      const g = await this.settle(ask.address, sleep, taken);
      if (g && !taken(g)) return { state: "blocked", msg: ask.msg };
      return g;
    });
  }

  deliver(ask, cx, act) {
    cx.spawn(async (cx) => {
      const sleep = (ms) => new Promise((res) => cx.timer.after(ms, () => res()));
      try {
        const g = await act(sleep);
        if (g && g.state === "blocked" && g.msg === ask.msg) throw new Error(`No reaction from the agent in ${SETTLE_MS / 1000} s. It may still take it; Retry sends it again.`);
        const now = Date.now();
        this.set(ask.id, { state: "delivered", answered_at: now, error: null });
        await this.log(ask, now);
      } catch (e) {
        this.set(ask.id, { state: "failed", error: String(e?.message ?? e) });
      } finally { cx.notify(); }
    });
  }

  // one line per answer in the `log` file of asks.json (here: outside the worktrees, so they stay clean for Done)
  async log(ask, at) {
    const rel = this.config?.log ?? "~/.config/herdr-app/decisions.md";
    if (!rel || !ask.cwd) return;
    const path = rel.startsWith("/") || rel.startsWith("~/") ? rel : `${ask.cwd}/${rel}`;
    const answer = readState().asks.find((a) => a.id === ask.id)?.answer ?? ask.answer ?? "";
    const line = `- ${stamp(new Date(at))} · ${one(ask.agent)} · ${ask.kind} · ${one(ask.question)} → ${one(answer)}`;
    try { await exec("sh", ["-c", 'case "$2" in "~/"*) p="$HOME/${2#\\~/}";; *) p="$2";; esac; d=$(dirname "$p"); mkdir -p "$d" && printf "%s\\n" "$1" >> "$p"', "asks", line, path]); } catch {}
  }

  retry(ask, cx) {
    // The earlier answer may have landed after the panel gave up: never send it twice.
    const t = liveTerminal(ask.address);
    if (t && ask.sent_turn != null && (t.turn ?? 0) > ask.sent_turn) return this.set(ask.id, { state: "delivered", answered_at: Date.now(), error: null, note: "Picked up late" });
    if (ask.chosen?.text) return this.sendText(ask, ask.chosen.text, cx);
    if (ask.chosen) return this.answer(ask, ask.chosen, cx);
    this.set(ask.id, { state: "pending", error: null });
  }
}

// the panel. `board` gives it the board's scope and ways out: {inScope(spaceId), scopeName(), all(), setAll(on), open(ask)}
export class AsksPanel extends Answerer {
  constructor(board) { super(); this.board = board; }

  init(cx) {
    this.showAnswered = false;
    this.other = null; this.otherText = "";
    // Multi-question cards: which question is unfolded, and the answers drafted so far
    // ({ [ask.id]: { [index]: text } }). Sent together with "Send answers".
    this.openQ = null; this.otherQ = null; this.drafts = {};
    this.input = InputState.new({ placeholder: "Type a different answer, Enter to send" });
    this.input.on("change", (_e, cx) => { this.otherText = this.input.value(); cx.notify(); });
    this.input.on("submit", (_e, cx) => {
      const text = this.otherText.trim();
      if (this.otherQ) { if (text) this.draft(this.otherQ.id, this.otherQ.i, text); this.otherQ = null; this.input.set_value(""); this.otherText = ""; cx.notify(); return; }
      const ask = readState().asks.find((a) => a.id === this.other); if (ask && text) this.sendText(ask, text, cx);
    });
    this.sent = () => { this.other = null; this.input.set_value(""); this.otherText = ""; };
    this.config = null;
    this.loadConfig(cx);
    // board-herdr.asks-accept (keys.json): the newest waiting ask in scope, with the option its agent recommends (or
    // the first, for an approval)
    cx.spawn(async (cx) => {
      for (;;) {
        const c = String(await nextCommand()).replace(/^board-herdr\./, "");
        if (c === "asks-accept") {
          const ask = readState().asks.find((a) => pickable(a) && this.board.inScope(a.space));
          if (ask) this.answer(ask, ask.options[ask.recommended ?? 0], cx);
        }
        cx.notify();
      }
    });
  }

  draft(id, i, text) { (this.drafts[id] ??= {})[i] = text; this.openQ = null; }

  // One message with every drafted answer, numbered like the agent's questions.
  sendDrafts(ask, cx) {
    const d = this.drafts[ask.id] ?? {};
    const qs = questionsOf(ask);
    const lines = qs.map((q, i) => d[i] ? `${i + 1}. ${q.text} → ${d[i]}` : null).filter(Boolean);
    if (!lines.length) return;
    delete this.drafts[ask.id];
    this.sendText(ask, lines.join("\n"), cx);
  }

  card(ask, t, now) {
    const sending = ask.state === "sending", failed = ask.state === "failed";
    const questions = questionsOf(ask), drafts = this.drafts[ask.id] ?? {}, drafted = Object.keys(drafts).length;
    const color = t[KIND[ask.kind] ?? "dim"];
    const chip = (text, c) => div().px(5).h(16).flex_none().flex().items_center().rounded(4).text_size(10).font_semibold().bg(c).opacity(0.9).text_color(t.background).child(text);
    const action = (id, icon, label, fn, primary) => h_flex().id(id).h(26).px(8).gap(5).items_center().rounded(7).flex_none().text_size(11.5).cursor_pointer()
      .border_1().border_color(primary ? t.input : t.border).bg(primary ? t.raised : t.surface).text_color(primary ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => fn(cx)).child(svg(icon).size(12)).child(label);
    const option = (o, i) => v_flex().id(`opt-${ask.id}-${o.n}`).w_full().px(10).py(6).gap(2).rounded(8).border_1().border_color(ask.recommended === i ? t.accent : t.border).bg(t.background)
      .when(!sending, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover).border_color(t.input)).on_click((_e, cx) => this.answer(ask, o, cx)))
      .child(h_flex().gap(8).items_center()
        .child(div().w(18).h(18).flex_none().rounded(4).flex().items_center().justify_center().text_size(10.5).font_semibold().bg(t.raised).text_color(t.muted).child(String(o.n)))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).tooltip(o.label).child(o.label))
        .when(ask.recommended === i, (el) => el.child(div().text_size(10).flex_none().text_color(t.accent).child("recommends"))))
      .when(Boolean(o.detail), (el) => el.child(div().pl(26).text_size(11).text_color(t.dim).truncate().child(o.detail)));
    return v_flex().id(`ask-${ask.id}`).w_full().p(12).gap(8).rounded(10).bg(t.surface).border_1().border_color(failed ? t.blocked : t.border)
      .child(h_flex().gap(8).items_center()
        .child(iconOf(ask.program, 16, t.muted))
        .child(div().min_w(0).truncate().font_semibold().text_size(12.5).child(ask.agent))
        .when(Boolean(ask.space_name), (el) => el.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(`· ${ask.space_name}`)))
        .child(div().flex_1())
        .when(sending, (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(age(now - ask.detected_at))))
      .child(h_flex().gap(8).items_center().child(chip(ask.kind, color))
        .when(Boolean(ask.context), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).tooltip(ask.context).child(ask.context))))
      .child(div().w_full().text_size(13).text_color(t.foreground).child(ask.question || (ask.enriched ? "Needs you in the terminal" : "Reading the dialog…")))
      .when(ask.options.length > 0 && ask.kind !== "UNCLEAR", (el) => el.child(v_flex().w_full().gap(5).children(ask.options.map(option))))
      .when(questions.length > 1, (el) => el.child(v_flex().w_full().gap(4).children(questions.map((q, i) => {
        const key = `${ask.id}:${i}`, open = this.openQ === key, chosen = drafts[i];
        const pick = (text) => (_e, cx) => { this.draft(ask.id, i, text); this.otherQ = null; cx.notify(); };
        return v_flex().id(`q-${ask.id}-${i}`).w_full().gap(4).rounded(8).px(6).py(4).when(open, (el) => el.bg(t.background))
          .child(h_flex().id(`qh-${ask.id}-${i}`).w_full().gap(8).items_start().cursor_pointer().hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { this.openQ = open ? null : key; if (this.otherQ && this.otherQ.i !== i) this.otherQ = null; cx.notify(); })
            .child(div().w(18).h(18).flex_none().rounded(4).flex().items_center().justify_center().text_size(10.5).font_semibold().bg(chosen ? t.accent : t.raised).text_color(chosen ? t.background : t.muted).child(String(i + 1)))
            .child(v_flex().flex_1().min_w(0).gap(1)
              .child(div().text_size(12).text_color(chosen || open ? t.foreground : t.muted).child(q.text))
              .when(Boolean(chosen), (el) => el.child(div().text_size(11.5).text_color(t.accent).child(`→ ${chosen}`)))))
          .when(open && !sending, (el) => el.child(v_flex().w_full().pl(26).gap(3)
            .children(q.options.map((o, j) => h_flex().id(`qo-${ask.id}-${i}-${j}`).w_full().px(8).py(4).gap(6).items_center().rounded(6).border_1()
              .border_color(q.recommended === j ? t.accent : t.border).bg(t.surface).cursor_pointer().hover((s) => s.bg(t.hover).border_color(t.input))
              .on_click(pick(o.label))
              .child(div().flex_1().min_w(0).text_size(12).child(o.label))
              .when(q.recommended === j, (el) => el.child(div().text_size(10).flex_none().text_color(t.accent).child("recommends")))))
            .child(this.otherQ?.id === ask.id && this.otherQ.i === i
              ? Input.new(this.input).w_full().h(30).px(10).rounded(6).border_1().border_color(t.accent).bg(t.surface).text_size(12).text_color(t.foreground)
              : h_flex().id(`qt-${ask.id}-${i}`).px(8).py(4).rounded(6).text_size(11.5).text_color(t.muted).cursor_pointer().hover((s) => s.text_color(t.foreground))
                  .on_click((_e, cx) => { this.otherQ = { id: ask.id, i }; this.other = null; this.input.set_value(""); this.otherText = ""; this.input.focus(); cx.notify(); })
                  .child(q.options.length ? "Other answer…" : "Type an answer…"))));
      }))))
      .when(ask.kind === "UNCLEAR" && ask.enriched, (el) => el.child(div().text_size(11.5).text_color(t.dim).child("Asks could not read this dialog. Open the terminal to answer it.")))
      .when(this.other === ask.id, (el) => el.child(Input.new(this.input).w_full().h(32).px(10).rounded(8).border_1().border_color(t.accent).bg(t.background).text_size(12.5).text_color(t.foreground)))
      .when(failed, (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(ask.error ?? "Failed")))
      .child(h_flex().gap(6).items_center().flex_wrap()
        .when(failed, (el) => el.child(action(`retry-${ask.id}`, "mods/board-herdr/ask-send.svg", "Retry", (cx) => this.retry(ask, cx), true)))
        .when(!sending && drafted > 0, (el) => el.child(action(`send-${ask.id}`, "mods/board-herdr/ask-send.svg", `Send answers (${drafted}/${questions.length})`, (cx) => this.sendDrafts(ask, cx), true)))
        .when(!sending && ask.kind !== "UNCLEAR" && ask.kind !== "APPROVAL", (el) => el.child(action(`other-${ask.id}`, "mods/board-herdr/ask-send.svg", this.other === ask.id ? "Cancel" : ask.options.length ? "Other answer" : "Answer", (cx) => {
          this.other = this.other === ask.id ? null : ask.id;
          if (this.other) this.input.focus();
          cx.notify();
        })))
        .child(action(`open-${ask.id}`, "mods/board-herdr/ask-terminal.svg", "Open terminal", () => this.board.open(ask)))
        .child(div().flex_1())
        .when(!sending, (el) => el.child(action(`dismiss-${ask.id}`, "mods/board-herdr/ask-x.svg", "Dismiss", () => this.dismiss(ask)))));
  }

  receipt(ask, t, now) {
    const delivered = ask.state === "delivered";
    return h_flex().id(`rc-${ask.id}`).w_full().h(26).px(8).gap(7).items_center().rounded(7).text_size(11.5).text_color(t.muted).hover((s) => s.bg(t.hover))
      .cursor_pointer().on_click(() => this.board.open(ask))
      .child(svg(delivered ? "mods/board-herdr/ask-check.svg" : "mods/board-herdr/ask-x.svg").size(11).flex_none().text_color(delivered ? t.done : t.dim))
      .child(div().flex_none().max_w(90).truncate().text_color(t.foreground).child(ask.agent))
      .child(div().flex_1().min_w(0).truncate().child(delivered ? `→ ${one(ask.answer)}` : ask.note ?? ask.state))
      .child(div().flex_none().text_color(t.dim).child(age(now - (ask.answered_at ?? ask.ended_at ?? ask.detected_at))));
  }

  render(cx) {
    const t = theme(), now = Date.now(), all = this.board.all();
    const asks = readState().asks.filter((a) => this.board.inScope(a.space));
    const pending = asks.filter((a) => a.state === "pending" || a.state === "sending" || a.state === "failed");
    const done = asks.filter((a) => !pending.includes(a) && a.state !== "dismissed");
    const today = done.filter((a) => a.state === "delivered" && now - a.answered_at < 86400000).length;
    const toggle = (id, label, on, fn) => div().id(id).h(20).px(7).flex_none().flex().items_center().rounded(5).text_size(11).cursor_pointer()
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.dim).hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { fn(); cx.notify(); }).child(label);
    return v_flex().id("asks").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/board-herdr/asks.svg").size(14).text_color(t.accent))
        .child(div().font_semibold().child(this.config?.label ?? "Asks"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(all ? "All worktrees" : this.board.scopeName()))
        .child(toggle("asks-all", "All", all, () => this.board.setAll(!all)))
        .child(div().id("asks-close").w(20).h(20).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
          .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.board.close())
          .child(svg("mods/board-herdr/ask-x.svg").size(12))))
      .child(div().px(14).py(7).flex_none().text_size(11.5).text_color(t.dim).child(`${pending.length} waiting · ${today} answered today · ⌘⇧A hides`))
      .child(v_flex().id("asks-list").flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8).gap(8)
        .children(pending.map((a) => this.card(a, t, now)))
        .when(pending.length === 0, (el) => el.child(div().p(10).text_size(12).text_color(t.dim).child(`No asks waiting in ${all ? "any worktree" : this.board.scopeName()}. Agents show up here when they stop to ask you something.`)))
        .when(done.length > 0, (el) => el.child(v_flex().w_full().gap(2).pt(6)
          .child(h_flex().id("asks-done").h(24).px(8).gap(6).items_center().text_size(11).font_medium().text_color(t.dim).cursor_pointer().hover((s) => s.text_color(t.foreground))
            .on_click((_e, cx) => { this.showAnswered = !this.showAnswered; cx.notify(); })
            .child(div().child("Answered")).child(div().child(String(done.length))).child(div().flex_1())
            .child(svg(`mods/workspace-chrome/chevron-${this.showAnswered ? "down" : "right"}.svg`).size(11).text_color(t.dim)))
          .when(this.showAnswered, (el) => el.children(done.slice(0, 30).map((a) => this.receipt(a, t, now)))))));
  }
}
