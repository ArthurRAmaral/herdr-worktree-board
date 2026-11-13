// The PRs view's data: ~/.config/herdr-app/prs.json (the org and the team's repos) and GitHub, read with `gh api graphql`
// as the logged-in user, never written to. The sidebar's copy runs PrsFeed (it is always drawn, the PRs view isn't) and
// keeps the PRs in shared("boardh.prs"), so the last good read survives a reload and shows while the next one runs.
import { exec, shared, setShared, readTextFile, writeTextFile, appHome } from "herdr";
import { parseConfig, searches, PR_QUERY, parseSearchPage, normalize, parseCodeowners, ownedBy, merge, pruneDrafts } from "./prs-rules.js";

export const PRS = "boardh.prs"; // shared: {at, me, org, prs, problem, reading}
export const PR_ASK = "boardh.prAsk"; // shared: when a read was last asked for (ms): opening the view, R, saving the settings
export const PR_DRAFTS = "boardh.prDrafts"; // shared: url -> "ideas" | "review", where each of my drafts sits

const PR_MS = 180000; // how often GitHub is read
const CONFIG_MS = 30000; // how often prs.json is read again (a hand edit shows without a restart)
const OWNERS_MS = 3600000; // how long a repo's CODEOWNERS is kept
const PAGES = 8; // pages per search at most
const OWNERS_AT = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

const configPath = () => `${appHome()}/prs.json`;
const lastLine = (s) => ((s ?? "").split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "").slice(0, 200);

export async function readPrsConfig() {
  const text = await readTextFile(configPath());
  const cfg = parseConfig(text);
  return cfg.error ? { cfg: { org: "", team_repos: [] }, text, error: cfg.error } : { cfg, text };
}

// writes only over the text read before (a file changed meanwhile rejects); returns what it wrote
export async function savePrsConfig(cfg, expected) {
  const text = JSON.stringify(cfg, null, 2) + "\n";
  await writeTextFile(configPath(), text, expected);
  return text;
}

export class PrsFeed {
  constructor() {
    this.cfg = null; this.cfgText = undefined; this.cfgError = null; this.cfgAt = 0;
    this.reading = false; this.startedAt = 0; this.askAt = shared(PR_ASK) ?? 0;
    this.owners = {}; // "org/repo" -> {rules, at}
  }

  tick(cx) {
    if (this.reading) return;
    const now = Date.now();
    if (now - this.cfgAt >= CONFIG_MS) { this.cfgAt = now; this.loadConfig(cx); return; }
    const ask = shared(PR_ASK) ?? 0;
    if (!this.cfg?.org) { if (ask > this.cfgAt) { this.cfgAt = now; this.loadConfig(cx); } return; } // the first org, saved
    // asked (the gear's Save among others): read prs.json first, so the read uses what was just saved
    if (ask > this.askAt && this.cfgAt < ask) { this.cfgAt = now; this.loadConfig(cx); return; }
    if (ask > this.askAt || now - this.startedAt >= PR_MS) { this.askAt = ask; this.read(cx); }
  }

  loadConfig(cx) {
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await readPrsConfig();
        if (r.error) this.cfgError = `prs.json: ${r.error}`; // keep the last good config
        else {
          this.cfgError = null;
          if (r.text !== this.cfgText) { this.cfg = r.cfg; this.startedAt = 0; } // changed: read GitHub now
        }
        this.cfgText = r.text;
        if (!this.cfg?.org) this.write({ org: "", reading: false, problem: this.cfgError });
        else if (this.cfgError) this.write({ problem: this.cfgError });
      } catch (e) { this.cfgError = `prs.json: ${String(e.message ?? e)}`; }
      finally { this.reading = false; }
      cx.notify();
    });
  }

  write(patch) {
    const before = shared(PRS) ?? { at: 0, me: null, org: "", prs: [], problem: null, reading: false };
    const next = { ...before, ...patch };
    if (JSON.stringify(next) !== JSON.stringify(before)) setShared(PRS, next);
  }

  read(cx) {
    this.reading = true;
    this.startedAt = Date.now();
    const cfg = this.cfg;
    this.write({ reading: true, org: cfg.org });
    cx.spawn(async (cx) => {
      try {
        const map = new Map();
        let me = null;
        for (const s of searches(cfg, "@me", Date.now())) {
          const rules = s.codeowners ? await this.codeowners(cfg.org, s.repo) : null;
          let after = null;
          for (let page = 0; page < PAGES; page++) {
            const args = ["api", "graphql", "-f", `query=${PR_QUERY}`, "-f", `q=${s.q}`, "-F", `files=${s.files}`, "-F", `first=${s.first}`,
              ...(after ? ["-f", `after=${after}`] : [])];
            let r = await exec("gh", args, { timeout: 60000 });
            if (r.code !== 0 && /HTTP 50[234]/.test(r.stderr ?? "")) r = await exec("gh", args, { timeout: 60000 }); // GitHub's busy: once more
            if (r.code !== 0) throw new Error(lastLine(r.stderr) || `gh exited ${r.code}`);
            const p = parseSearchPage(r.stdout);
            if (p.error) throw new Error(p.error);
            me = p.me ?? me;
            for (const n of p.nodes) {
              // a CODEOWNERS team's repo: only PRs that change a file under the team's folders are the team's
              const team = s.key === "team" && (!s.codeowners || ownedBy(rules ?? [], (n.files?.nodes ?? []).map((f) => f.path), cfg.org, s.codeowners));
              merge(map, normalize(n, me), s.key, team);
            }
            if (!p.next) break;
            after = p.next;
          }
        }
        const prs = [...map.values()];
        this.write({ at: Date.now(), me, org: cfg.org, prs, problem: this.cfgError, reading: false });
        const drafts = shared(PR_DRAFTS) ?? {};
        const kept = pruneDrafts(drafts, prs);
        if (JSON.stringify(kept) !== JSON.stringify(drafts)) setShared(PR_DRAFTS, kept);
      } catch (e) {
        this.write({ problem: `gh: ${String(e.message ?? e)}`, reading: false }); // the last good PRs stay
      } finally { this.reading = false; }
      cx.notify();
    });
  }

  // the repo's CODEOWNERS rules, read once an hour; none found reads as no rules (nothing is the team's); a failed read
  // fails the whole read (the last PRs stay, the problem shows) rather than hiding the team's PRs for an hour
  async codeowners(org, repo) {
    const key = `${org}/${repo}`;
    const had = this.owners[key];
    if (had && Date.now() - had.at < OWNERS_MS) return had.rules;
    let rules = had?.rules ?? [];
    for (const path of OWNERS_AT) {
      const r = await exec("gh", ["api", "-H", "Accept: application/vnd.github.raw", `repos/${org}/${repo}/contents/${path}`]);
      if (r.code === 0) { rules = parseCodeowners(r.stdout); break; }
      if (!/404|Not Found/i.test(r.stderr ?? "")) throw new Error(`CODEOWNERS of ${key}: ${lastLine(r.stderr) || `gh exited ${r.code}`}`);
    }
    this.owners[key] = { rules, at: Date.now() };
    return rules;
  }
}
