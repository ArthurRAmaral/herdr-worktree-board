// A plan's Markdown as a page to read in the browser: the common blocks (headings, lists, tables, code, quotes) and
// inline marks, everything escaped; pure (nothing from herdr), so `node --test test/*.test.mjs` runs it.

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// inline marks on escaped text: code first (its content stays as is), then links, bold, italic
function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_m, c) => `\u0000${codes.push(c) - 1}\u0000`);
  // only web and relative links: anything else (javascript:, data:) keeps just its text
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) =>
    /^(https?:\/\/|\/|\.|#)/.test(href) || !/^[a-z][\w+.-]*:/i.test(href) ? `<a href="${href}">${label}</a>` : label);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>").replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[i]}</code>`);
}

const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const isRule = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
const item = (t) => inline(t.replace(/^\[ \]\s+/, "☐ ").replace(/^\[[xX]\]\s+/, "☑ "));

export function mdToHtml(md) {
  const lines = String(md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    let m;
    if (!line.trim()) { i++; continue; }
    if ((m = /^```\s*([\w+-]*)/.exec(line))) {
      const body = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code${m[1] ? ` class="language-${esc(m[1])}"` : ""}>${esc(body.join("\n"))}</code></pre>`);
    } else if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      i++;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr>");
      i++;
    } else if (/^\s*>/.test(line)) {
      const body = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) body.push(lines[i].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>\n${mdToHtml(body.join("\n"))}\n</blockquote>`);
    } else if (line.includes("|") && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) rows.push(cells(lines[i]));
      out.push(["<table>", `<thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>`, "<tbody>",
        ...rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`), "</tbody>", "</table>"].join("\n"));
    } else if ((m = /^\s*([-*+]|\d+[.)])\s+/.exec(line))) {
      const ordered = /\d/.test(m[1]);
      const marker = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
      const items = [];
      for (; i < lines.length && (marker.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length)); i++) {
        if (marker.test(lines[i])) items.push(lines[i].replace(marker, ""));
        else items[items.length - 1] += " " + lines[i].trim(); // a wrapped item's next line
      }
      const tag = ordered ? "ol" : "ul";
      out.push([`<${tag}>`, ...items.map((t) => `<li>${item(t)}</li>`), `</${tag}>`].join("\n"));
    } else {
      const body = [];
      for (; i < lines.length && lines[i].trim() && !/^(```|#{1,6}\s|\s*>|\s*([-*+]|\d+[.)])\s)/.test(lines[i]); i++) body.push(lines[i].trim());
      out.push(`<p>${inline(body.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}

// the whole page: readable width, light and dark
export function planPage(title, md) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { color-scheme: light dark; --fg: #1f2328; --bg: #fff; --muted: #59636e; --line: #d1d9e0; --code: #f6f8fa; }
@media (prefers-color-scheme: dark) { :root { --fg: #e6edf3; --bg: #0d1117; --muted: #9198a1; --line: #3d444d; --code: #151b23; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 32px 20px 64px; }
h1, h2 { border-bottom: 1px solid var(--line); padding-bottom: .3em; }
code { background: var(--code); padding: .15em .35em; border-radius: 5px; font: 85% ui-monospace, Menlo, monospace; }
pre { background: var(--code); padding: 14px 16px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--line); padding: 6px 12px; text-align: left; }
blockquote { margin: 0; padding: 0 1em; color: var(--muted); border-left: 4px solid var(--line); }
a { color: #4493f8; }
hr { border: 0; border-top: 1px solid var(--line); }
</style></head>
<body><main>
${mdToHtml(md)}
</main></body></html>
`;
}
