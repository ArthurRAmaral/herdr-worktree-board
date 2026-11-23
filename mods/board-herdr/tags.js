// Sessions and tags: plain rules, no Herdr or network calls, so test/tags.test.mjs runs them with node.
//
// A session is an agent you started (its terminal), with the agents and sub-agents it started in the same worktree:
// those stay on its card. Its tags and its stage are core labels on its terminal, so every Herdr client sees them:
// - board.tags: its tags, comma-separated (a session has any number of them);
// - board.stage: its stage; without one, its worktree's;
// - board.tagged: set once the board gave it tags, so taking them all off doesn't bring the first ones back.
// Where tags come from, besides those you make on the board: board.json's "tags"; with board.json's "tagList", the
// names of another shared list (a mod's own groups, such as "hbl.groups"); and, with board.json's "tagLabel", a label
// the board copies once into a session that has no tags yet (such as "hbl.group").

export const TAGS_LABEL = "board.tags";
export const STAGE_LABEL = "board.stage";
export const TAGGED_LABEL = "board.tagged";
const PALETTE = ["#22a99a", "#e3814f", "#5b8def", "#8b7cf6", "#3fae6a", "#d9649a", "#e6c35c", "#6fb3f2"];
const HEX = /^#[0-9a-fA-F]{6}$/;

// a tag's name: one line, no commas (they part the tags in the label), at most 40 characters
export const cleanTag = (name) => String(name ?? "").replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);

// a tag's color when nobody gave it one: the same for the same name, everywhere
export function tagColor(name) {
  let h = 0;
  for (const c of String(name ?? "")) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// a list of tags as board.json or a shared value gives it: names, or {name, color}; [{name, color}] without repeats
export function readTagList(v) {
  const out = [];
  for (const x of Array.isArray(v) ? v : []) {
    const name = cleanTag(typeof x === "string" ? x : x?.name);
    if (!name || out.some((t) => t.name === name)) continue;
    out.push({ name, color: HEX.test(x?.color ?? "") ? x.color : tagColor(name) });
  }
  return out;
}

// board.json's tag settings: {tags: [{name, color}], tagLabel: "hbl.group" | null, tagList: "hbl.groups" | null}
const KEY = /^[\w.-]+$/;
export function readTagConfig(json) {
  const j = json && typeof json === "object" ? json : {};
  return {
    tags: readTagList(j.tags),
    tagLabel: typeof j.tagLabel === "string" && KEY.test(j.tagLabel) ? j.tagLabel : null,
    tagList: typeof j.tagList === "string" && KEY.test(j.tagList) ? j.tagList : null,
  };
}

// every tag, in order: lists first to last, then any tag a session has that no list names; the first color wins
export function catalog(lists, used = []) {
  return readTagList([...lists.flat(), ...used]);
}

// a board.tags label as a list, and back
export const parseTags = (v) => [...new Set(String(v ?? "").split(",").map(cleanTag).filter(Boolean))];
export const formatTags = (list) => parseTags(list.join(",")).join(",");

// a tag on or off
export function toggleTag(list, name) {
  const n = cleanTag(name);
  if (!n) return list;
  return list.includes(n) ? list.filter((t) => t !== n) : [...list, n];
}

// every tag of a few sessions, once each, in the order they come
export const unionTags = (lists) => [...new Set(lists.flat())];

// the sessions to tag now from tagLabel: live terminals the board never tagged, with a value there
// ([[address, [tag]]])
export function toSeed(terminals, tagLabel) {
  if (!tagLabel) return [];
  return terminals
    .filter((t) => (!t.state || t.state === "live") && !t.labels?.[TAGGED_LABEL] && !t.labels?.[TAGS_LABEL] && cleanTag(t.labels?.[tagLabel]))
    .map((t) => [t.address, [cleanTag(t.labels[tagLabel])]]);
}

// a session's stage: its own when it's a known one, else its worktree's
export const sessionStage = (label, worktreeStage, known) => (known(label) ? label : worktreeStage);

// the sessions of a worktree: each agent under the furthest agent of the same worktree up its chain of parents
// (parentOf: address -> parent, every terminal, so a chain can pass through a sub-agent); [{root, members}], in the
// order of the agents given, a root before the agents it started
export function sessions(addresses, parentOf) {
  const here = new Set(addresses);
  const rootOf = (a) => {
    let root = a, p = parentOf.get(a);
    for (let hops = 0; p && hops < 16; hops++) {
      if (here.has(p)) root = p;
      p = parentOf.get(p);
    }
    return root;
  };
  const groups = new Map();
  for (const a of addresses) {
    const r = rootOf(a);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(a);
  }
  return [...groups].map(([root, members]) => ({ root, members: [root, ...members.filter((m) => m !== root)] }));
}
