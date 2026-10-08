/**
 * test/unit/poll.test.ts — the wait after a fix as a specification: ask again every interval,
 * stop at the first yes, give up after the timeout, and stop at once — mid-sleep or between
 * questions — when told to. The clock is faked, so five minutes of polling take milliseconds
 * and the counts are exact.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code). Depends on:
 * src/core/poll.ts. Depended on by: nothing. Plan: §7.5 step 3 ("every 3 s for up to 5 min"),
 * §9.4 (`waitForLogin` … "stops polling when aborted"), §10.1 item 19a, §13.2 D57.
 */

// see primer §1 (import / export) and §9 (`import type`)
import { getEventListeners } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLL, sleep, waitUntil } from '../../src/core/poll';
import type { PollOutcome } from '../../src/core/poll';

/**
 * A `check` that answers from a script, one answer per call, and counts its calls; once the
 * script runs out it keeps answering its last answer (or `false` for an empty script).
 */
// see primer §9 (interface) and §33 (function types)
interface ScriptedCheck {
  check: () => Promise<boolean>;
  readonly calls: number;
}

// see primer §61 (a getter in an object literal), §30 (`??`), §5 (arrow functions) and §6 (`async`)
function scripted(answers: boolean[]): ScriptedCheck {
  let calls = 0;
  return {
    check: async () => {
      calls += 1;
      return answers[calls - 1] ?? answers[answers.length - 1] ?? false;
    },
    get calls() {
      return calls;
    },
  };
}

/**
 * A wait's outcome, or `'pending'` while it has not settled — so a test can look at a wait in
 * the middle without awaiting it (which, under fake timers, would never return).
 */
// see primer §63 (`.then`: a continuation without `await`)
function watch(wait: Promise<PollOutcome>): { readonly outcome: PollOutcome | 'pending' } {
  const state: { outcome: PollOutcome | 'pending' } = { outcome: 'pending' };
  void wait.then((outcome) => {
    state.outcome = outcome;
  });
  return state;
}

// Fake timers in every test: `setTimeout` inside poll.ts still queues its callback, but the
// clock only moves when a test says so (primer §65). The `Async` form of the advance is the
// one to use here — see primer §65 for why a loop that awaits between timers needs it.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

// see primer §5 (arrow functions) and §6 (async / await)
describe('waitUntil (plan §7.5 step 3)', () => {
  it('waits every 3 s for up to 5 min by default', () => {
    // see primer §27 (`_` between digits: `3_000` is 3000)
    expect(DEFAULT_POLL).toStrictEqual({ intervalMs: 3_000, timeoutMs: 300_000 });
  });

  it('does not ask before the first interval has passed — the fix was only just started', async () => {
    // arrange
    const answers = scripted([true]);

    // act
    const wait = watch(waitUntil(answers.check, DEFAULT_POLL));
    await vi.advanceTimersByTimeAsync(2_999);

    // assert
    expect(answers.calls).toBe(0);
    expect(wait.outcome).toBe('pending');
  });

  it('is done at the first interval when the first answer is yes', async () => {
    // arrange
    const answers = scripted([true]);

    // act
    const wait = watch(waitUntil(answers.check, DEFAULT_POLL));
    await vi.advanceTimersByTimeAsync(3_000);

    // assert
    expect(wait.outcome).toBe('done');
    expect(answers.calls).toBe(1);
  });

  it('asks once per interval until the answer is yes, then stops asking', async () => {
    // arrange
    const answers = scripted([false, false, true]);

    // act
    const wait = watch(waitUntil(answers.check, DEFAULT_POLL));
    await vi.advanceTimersByTimeAsync(8_999);
    const before = { outcome: wait.outcome, calls: answers.calls };
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(30_000);

    // assert: two noes by 6 s, the yes at 9 s, nothing after it
    expect(before).toStrictEqual({ outcome: 'pending', calls: 2 });
    expect(wait.outcome).toBe('done');
    expect(answers.calls).toBe(3);
  });

  it('gives up after the timeout: exactly 100 questions in 5 min, the last one at 5 min, none after', async () => {
    // arrange
    const answers = scripted([false]);

    // act
    const wait = watch(waitUntil(answers.check, DEFAULT_POLL));
    await vi.advanceTimersByTimeAsync(299_999);
    const before = { outcome: wait.outcome, calls: answers.calls };
    await vi.advanceTimersByTimeAsync(1);
    const at = { outcome: wait.outcome, calls: answers.calls };
    await vi.advanceTimersByTimeAsync(60_000);

    // assert
    expect(before).toStrictEqual({ outcome: 'pending', calls: 99 });
    expect(at).toStrictEqual({ outcome: 'timeout', calls: 100 });
    expect(answers.calls).toBe(100);
  });

  it('counts the timeout in intervals waited: a timeout shorter than one interval still asks once', async () => {
    // arrange
    const answers = scripted([false]);

    // act
    const wait = watch(waitUntil(answers.check, { intervalMs: 50, timeoutMs: 20 }));
    await vi.advanceTimersByTimeAsync(50);

    // assert
    expect(wait.outcome).toBe('timeout');
    expect(answers.calls).toBe(1);
  });

  it('counts the wait in intervals, not by the clock: a laptop that slept for an hour still has its questions left', async () => {
    // arrange
    const answers = scripted([false]);
    const wait = watch(waitUntil(answers.check, DEFAULT_POLL));

    // act: the clock jumps an hour (the lid was closed), then one interval passes
    vi.setSystemTime(Date.now() + 3_600_000);
    await vi.advanceTimersByTimeAsync(3_000);

    // assert: one question so far, and still waiting — not timed out
    expect({ outcome: wait.outcome, calls: answers.calls }).toStrictEqual({ outcome: 'pending', calls: 1 });
  });

  // see primer §25 (arrays) and §22 (for ... of): one test per bad interval
  for (const intervalMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    it(`refuses an interval of ${intervalMs} ms, which would ask without pause or never ask at all`, async () => {
      // arrange
      const answers = scripted([false]);

      // act
      const wait = waitUntil(answers.check, { intervalMs, timeoutMs: 1_000 });

      // assert: rejected before any question
      await expect(wait).rejects.toThrow(`waitUntil: intervalMs must be a positive, finite number of milliseconds, got ${intervalMs}`);
      expect(answers.calls).toBe(0);
    });
  }

  it('stops at once, asking nothing, when the signal was aborted before it began', async () => {
    // arrange
    const answers = scripted([true]);
    // see primer §71 (AbortController and its signal)
    const controller = new AbortController();
    controller.abort();

    // act: no time passes — only the callbacks already due run
    const wait = watch(waitUntil(answers.check, DEFAULT_POLL, controller.signal));
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(wait.outcome).toBe('aborted');
    expect(answers.calls).toBe(0);
  });

  it('cuts the sleep short when the signal aborts in the middle of an interval', async () => {
    // arrange
    const answers = scripted([true]);
    const controller = new AbortController();
    const wait = watch(waitUntil(answers.check, DEFAULT_POLL, controller.signal));
    await vi.advanceTimersByTimeAsync(1_500);

    // act: abort, and let pending callbacks run without moving the clock
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    // assert: aborted half way through the first interval; the timer is gone, nothing asked
    expect(wait.outcome).toBe('aborted');
    expect(answers.calls).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets an answer already being asked count: aborted while the check runs, a yes is still done', async () => {
    // arrange: a check that answers only when the test says so
    let answer: (value: boolean) => void = () => undefined;
    const controller = new AbortController();
    // see primer §15 (new Promise: keeping `resolve` to call later)
    const check = (): Promise<boolean> =>
      new Promise((resolve) => {
        answer = resolve;
      });
    const wait = watch(waitUntil(check, DEFAULT_POLL, controller.signal));
    await vi.advanceTimersByTimeAsync(3_000);

    // act: the abort lands while the question is out, then the answer comes back yes
    controller.abort();
    answer(true);
    await vi.advanceTimersByTimeAsync(0);

    // assert: the question was asked and answered — the wait reports what it learned
    expect(wait.outcome).toBe('done');
  });

  it('stops after the answer it is waiting for when the signal aborts during a no', async () => {
    // arrange
    let answer: (value: boolean) => void = () => undefined;
    let calls = 0;
    const controller = new AbortController();
    const check = (): Promise<boolean> =>
      new Promise((resolve) => {
        calls += 1;
        answer = resolve;
      });
    const wait = watch(waitUntil(check, DEFAULT_POLL, controller.signal));
    await vi.advanceTimersByTimeAsync(3_000);

    // act
    controller.abort();
    answer(false);
    await vi.advanceTimersByTimeAsync(10_000);

    // assert: one question, then aborted — no second interval was slept
    expect(wait.outcome).toBe('aborted');
    expect(calls).toBe(1);
  });

  it('rejects with the check\'s own error when a check rejects, and asks nothing more', async () => {
    // arrange: git could not run (E17) — not something waiting longer would fix
    let calls = 0;
    const check = async (): Promise<boolean> => {
      calls += 1;
      throw new Error('git: ENOENT');
    };

    // act: the expectation is attached before the clock moves, so the rejection is handled
    const wait = waitUntil(check, DEFAULT_POLL);
    const rejected = expect(wait).rejects.toThrow('git: ENOENT');
    await vi.advanceTimersByTimeAsync(3_000);
    await rejected;
    await vi.advanceTimersByTimeAsync(30_000);

    // assert
    expect(calls).toBe(1);
  });

  it('leaves no listener on the signal once it has finished, however many intervals it slept', async () => {
    // arrange: one signal for a whole wait of ten intervals
    const answers = scripted([false, false, false, false, false, false, false, false, false, true]);
    const controller = new AbortController();

    // act
    const wait = watch(waitUntil(answers.check, DEFAULT_POLL, controller.signal));
    await vi.advanceTimersByTimeAsync(30_000);

    // assert: every sleep took its abort listener away again; `getEventListeners` is Node's
    // way to list what is subscribed to an event target such as a signal
    expect(wait.outcome).toBe('done');
    expect(getEventListeners(controller.signal, 'abort')).toStrictEqual([]);
  });
});

describe('sleep', () => {
  it('resolves after the given time, not before', async () => {
    // arrange
    let woke = false;
    void sleep(1_000).then(() => {
      woke = true;
    });

    // act
    await vi.advanceTimersByTimeAsync(999);
    const before = woke;
    await vi.advanceTimersByTimeAsync(1);

    // assert
    expect(before).toBe(false);
    expect(woke).toBe(true);
  });

  it('resolves at once, with no timer left behind, when the signal is already aborted', async () => {
    // arrange
    const controller = new AbortController();
    controller.abort();

    // act
    let woke = false;
    void sleep(60_000, controller.signal).then(() => {
      woke = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    // assert
    expect(woke).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timer when the signal aborts first', async () => {
    // arrange
    const controller = new AbortController();
    let woke = false;
    void sleep(60_000, controller.signal).then(() => {
      woke = true;
    });

    // act
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    // assert: woken with no time passed, and the fake clock holds no timer — clearTimeout ran
    expect(woke).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
