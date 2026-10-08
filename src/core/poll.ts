/**
 * core/poll.ts — waiting for a fix to take: ask a question again every few seconds until it
 * answers yes, until a time limit, or until told to stop. After the extension opens a terminal
 * for `gs auth login` or `gs repo init` (item 19b), nothing tells it when the user has finished
 * there; the only way to know is to ask again — plan §7.5 step 3's poll, "every 3 s for up to
 * 5 min". The question is the readiness probe itself (core/backends/gitspice.ts never
 * remembers a failure, so each ask is a fresh look, D56); for the gh login of item 23 it will
 * be `gh auth status`. This file knows neither: it asks whatever `check` it is handed.
 *
 * Layer: core (plan §4.1) — plain timers, no VS Code, no git. Hand-rolled (plan §11.3). Depends
 * on: the global `setTimeout`/`clearTimeout` and `AbortSignal` — the globals and never
 * `node:timers/promises`, because the globals are what Vitest's fake timers replace (primer
 * §65), and the tests count every question in fake time. Depended on by: src/vscode/login.ts
 * (item 19b), item 23's core/ghstatus.ts, test/unit/poll.test.ts. Plan: §4.2 (the poll half of
 * the `ghstatus.ts` line, generalised to both tools), §7.5 step 3, §7.6, §9.4, §10.1 item 19a,
 * §13.2 D57.
 */

/** How often to ask again, and for how long to keep asking, both in milliseconds. */
// see primer §9 (interface) and §14 (readonly)
export interface PollTiming {
  readonly intervalMs: number;
  readonly timeoutMs: number;
}

/** Plan §7.5 step 3: every 3 s, for up to 5 min. */
// see primer §4 (const) and §27 (`_` in a number literal: `300_000` is 300000)
export const DEFAULT_POLL: PollTiming = { intervalMs: 3_000, timeoutMs: 300_000 };

/** How a wait ended: `check` answered yes; the timeout was waited out; the signal aborted it. */
// see primer §10 (union types: exact strings as members)
export type PollOutcome = 'done' | 'timeout' | 'aborted';

/**
 * Sleeps one interval, asks `check`, and repeats — until `check` answers true (`'done'`), until
 * `timeoutMs` has been waited (`'timeout'`), or until `signal` aborts (`'aborted'`).
 *
 * Three rules, each pinned by a test. It never asks before the first interval: the caller has
 * only just started the fix, and the probe that led to it has just run. Time is counted in
 * intervals waited — `waited += intervalMs` — never read from the clock: the answer to "how
 * long have we waited" is then exact under fake timers, and a machine that sleeps for an hour
 * with VS Code open wakes up with the same number of questions left, not none (the user may
 * still be in the middle of the login). And an abort is noticed between questions — a sleep in
 * progress is cut short (`sleep` below) — but a question already being asked is answered first,
 * and a yes counts.
 *
 * It rejects only when `check` rejects: a probe that cannot run git (E17) is not something
 * waiting longer would fix, and the caller already reports such a failure.
 */
// see primer §71 (AbortSignal, and a loop counted in milliseconds), §38 (while loops) and §6 (async / await)
export async function waitUntil(check: () => Promise<boolean>, timing: PollTiming, signal?: AbortSignal): Promise<PollOutcome> {
  let waited = 0;
  while (waited < timing.timeoutMs) {
    await sleep(timing.intervalMs, signal);
    // see primer §70 (`?.`): no signal at all means "never aborted"
    if (signal?.aborted === true) {
      return 'aborted';
    }
    waited += timing.intervalMs;
    if (await check()) {
      return 'done';
    }
  }
  return 'timeout';
}

/**
 * A Promise that resolves after `ms` milliseconds — or at once when `signal` aborts first (or
 * already has). Whichever comes first also undoes the other: the timer is cleared, and the
 * abort listener removed, so a wait of a hundred intervals on one signal leaves nothing behind
 * on it, and an aborted wait leaves no timer running.
 */
// see primer §71 (a sleep the signal cuts short), §15 (new Promise) and §58 (setTimeout and clearTimeout)
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    // `finish` is written before `timer` exists, but only ever runs after: from the timer
    // itself, or from an abort that can only come once this function has returned.
    const finish = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}
