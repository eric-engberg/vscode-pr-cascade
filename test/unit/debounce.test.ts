/**
 * test/unit/debounce.test.ts — debounce as a specification: a burst of calls becomes one
 * run of the action, after a quiet period counted from the last call; a pending run can be
 * withdrawn. Time is faked, so the tests take milliseconds and never depend on the
 * machine's clock or load.
 *
 * Layer: test, unit (plan §9.1 layer 1; Vitest, no git, no VS Code). Depends on:
 * src/core/debounce.ts. Depended on by: nothing. Plan: §7.14.2 ("We debounce"), §9.4 row
 * `unit/debounce.test.ts`, §10.1 item 12b, §11.3 (hand-rolled).
 */

// see primer §1 (import / export)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from '../../src/core/debounce';

// The quiet period every test uses. Only the relation matters — calls closer together
// than this collapse — so any value would do; a round one keeps the arithmetic readable.
// see primer §4 (const)
const DELAY_MS = 100;

// see primer §5 (arrow functions)
describe('debounce: one run per burst of calls (plan §7.14.2)', () => {
  // Fake timers for every test in this block: `setTimeout` inside debounce.ts still queues
  // its callback, but the clock only moves when a test says so — see primer §65.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the action once for a burst of calls, after the quiet period', () => {
    // arrange
    let runs = 0;
    const debounced = debounce(() => {
      runs += 1;
    }, DELAY_MS);

    // act: three calls in quick succession, then the quiet period passes
    debounced.schedule();
    debounced.schedule();
    debounced.schedule();
    vi.advanceTimersByTime(DELAY_MS);

    // assert
    expect(runs).toBe(1);
  });

  it('counts the quiet period from the last call, not the first — a trailing debounce', () => {
    // arrange
    let runs = 0;
    const debounced = debounce(() => {
      runs += 1;
    }, DELAY_MS);

    // act: a second call just before the deadline moves the deadline
    debounced.schedule();
    vi.advanceTimersByTime(DELAY_MS - 1);
    debounced.schedule();
    vi.advanceTimersByTime(DELAY_MS - 1);

    // assert: nothing yet — the first call's deadline passed unfired — then the run one
    // millisecond later, a full quiet period after the second call
    expect(runs).toBe(0);
    vi.advanceTimersByTime(1);
    expect(runs).toBe(1);
  });

  it('runs again for a call that comes after the action ran', () => {
    // arrange
    let runs = 0;
    const debounced = debounce(() => {
      runs += 1;
    }, DELAY_MS);

    // act: two bursts, a quiet period apart
    debounced.schedule();
    vi.advanceTimersByTime(DELAY_MS);
    debounced.schedule();
    vi.advanceTimersByTime(DELAY_MS);

    // assert
    expect(runs).toBe(2);
  });

  it('cancel() withdraws a pending run', () => {
    // arrange
    let runs = 0;
    const debounced = debounce(() => {
      runs += 1;
    }, DELAY_MS);

    // act
    debounced.schedule();
    debounced.cancel();
    vi.advanceTimersByTime(DELAY_MS);

    // assert
    expect(runs).toBe(0);
  });

  it('cancel() with nothing pending is harmless, and the next call schedules as usual', () => {
    // arrange
    let runs = 0;
    const debounced = debounce(() => {
      runs += 1;
    }, DELAY_MS);

    // act
    debounced.cancel();
    debounced.schedule();
    vi.advanceTimersByTime(DELAY_MS);

    // assert
    expect(runs).toBe(1);
  });
});
