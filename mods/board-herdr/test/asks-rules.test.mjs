// What becomes of an answer in flight (asks-rules.js), run with `node --test test/` from the mod's folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inFlight, STRANDED_MS } from "../asks-rules.js";

const T0 = 1_000_000;
const ask = (over = {}) => ({ state: "sending", msg: "answer: pick one", sent_turn: 4, sent_at: T0, detected_at: T0 - 60000, ...over });
const blocked = { turn: 4, status: "blocked", msg: "answer: pick one" };

test("inFlight: a send still within its time is left to the delivery", () => {
  assert.equal(inFlight(ask(), { turn: 8, status: "working", msg: "" }, T0 + 5000), null);
  assert.equal(inFlight(ask(), blocked, T0 + 5000), null);
});

test("inFlight: a stranded send whose agent moved on was delivered", () => {
  const p = inFlight(ask(), { turn: 8, status: "working", msg: "" }, T0 + STRANDED_MS);
  assert.equal(p.state, "delivered");
  assert.equal(p.answered_at, T0 + STRANDED_MS);
});

test("inFlight: a stranded send with the question still up failed, to retry", () => {
  const p = inFlight(ask(), blocked, T0 + STRANDED_MS);
  assert.equal(p.state, "failed");
  assert.match(p.error, /Retry/);
});

test("inFlight: a stranded send whose agent closed is stale", () => {
  const p = inFlight(ask(), null, T0 + STRANDED_MS);
  assert.equal(p.state, "stale");
  assert.equal(p.note, "Agent closed");
});

test("inFlight: a failed answer the agent took after all was delivered late", () => {
  const p = inFlight(ask({ state: "failed" }), { turn: 5, status: "working", msg: "" }, T0 + 10000);
  assert.equal(p.state, "delivered");
  assert.equal(p.note, "Picked up late");
  assert.equal(inFlight(ask({ state: "failed" }), blocked, T0 + 10000), null);
});

test("inFlight: a sent message (delivery send) counts as taken only once the turn moves", () => {
  const idle = { turn: 4, status: "idle", msg: "" };
  assert.equal(inFlight(ask({ delivery: "send" }), idle, T0 + STRANDED_MS).state, "failed");
  assert.equal(inFlight(ask({ delivery: "send" }), { ...idle, turn: 5 }, T0 + STRANDED_MS).state, "delivered");
});

test("inFlight: pending and answered asks aren't its business", () => {
  assert.equal(inFlight(ask({ state: "pending" }), null, T0 + STRANDED_MS), null);
  assert.equal(inFlight(ask({ state: "delivered" }), null, T0 + STRANDED_MS), null);
});
