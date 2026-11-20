// A plan's Markdown as a page (md-html.js), run with `node --test test/` from the mod's folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mdToHtml, planPage } from "../md-html.js";

test("mdToHtml: headings, paragraphs and inline marks", () => {
  assert.equal(mdToHtml("# Plan\n\nShip **it** with `x` and *care*."),
    "<h1>Plan</h1>\n<p>Ship <strong>it</strong> with <code>x</code> and <em>care</em>.</p>");
});

test("mdToHtml: escapes HTML in text and code", () => {
  assert.equal(mdToHtml("a <b> & c"), "<p>a &lt;b&gt; &amp; c</p>");
  assert.equal(mdToHtml("```js\nif (a < b) {}\n```"), '<pre><code class="language-js">if (a &lt; b) {}</code></pre>');
});

test("mdToHtml: lists, ordered and not, and checkboxes", () => {
  assert.equal(mdToHtml("- one\n- [x] two\n\n1. a\n2. b"),
    "<ul>\n<li>one</li>\n<li>☑ two</li>\n</ul>\n<ol>\n<li>a</li>\n<li>b</li>\n</ol>");
});

test("mdToHtml: a table with its header", () => {
  assert.equal(mdToHtml("| Repo | Files |\n|---|---|\n| web | 3 |"),
    "<table>\n<thead><tr><th>Repo</th><th>Files</th></tr></thead>\n<tbody>\n<tr><td>web</td><td>3</td></tr>\n</tbody>\n</table>");
});

test("mdToHtml: links keep only http(s) and relative targets", () => {
  assert.equal(mdToHtml("[doc](https://acme.dev/a) [bad](javascript:alert)"),
    '<p><a href="https://acme.dev/a">doc</a> bad</p>');
});

test("mdToHtml: blockquote and rule", () => {
  assert.equal(mdToHtml("> note\n\n---"), "<blockquote>\n<p>note</p>\n</blockquote>\n<hr>");
});

test("planPage: a whole page titled after the plan, with the body inside", () => {
  const page = planPage("ENG-12 plan", "# Hi");
  assert.match(page, /^<!doctype html>/);
  assert.match(page, /<title>ENG-12 plan<\/title>/);
  assert.match(page, /<h1>Hi<\/h1>/);
});
