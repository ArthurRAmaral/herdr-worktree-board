// What becomes of an answer in flight; plain rules, no Herdr calls, so test/asks-rules.test.mjs runs them with node.

// The delivery of an answer lives in the copy of the board that sent it, the state in shared(): a reload or a quit while
// it runs leaves "sending" with nothing to finish it. Past this, no delivery can still be running (a form takes ~1 min).
export const STRANDED_MS = 3 * 60 * 1000;

// An answer sending or failed, against its terminal now (`t`: {turn, status, msg}, null once closed): the patch that
// settles it, or null to leave it. Taken means the turn moved on, or (a dialog) the dialog is gone.
export function inFlight(a, t, now) {
  if (a.state !== "sending" && a.state !== "failed") return null;
  const stranded = a.state === "sending" && now - (a.sent_at ?? a.detected_at ?? now) >= STRANDED_MS;
  if (!t) return stranded ? { state: "stale", note: "Agent closed", ended_at: now } : null;
  if (a.sent_turn == null) return null;
  const taken = (t.turn ?? 0) > a.sent_turn || (a.delivery !== "send" && !(t.status === "blocked" && t.msg === a.msg));
  if (taken && (a.state === "failed" || stranded)) return { state: "delivered", answered_at: now, error: null, note: "Picked up late" };
  if (stranded) return { state: "failed", error: "Sending stopped half way (the board reloaded). Retry sends it again." };
  return null;
}
