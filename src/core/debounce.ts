/**
 * core/debounce.ts — one run for a burst of calls: `schedule()` any number of times, and
 * the action runs once, a quiet period after the last call (a *trailing* debounce). Used
 * for the refresh that the built-in Git extension's "a git status completed" events ask for
 * (plan §7.14.2): they come per repository, and in bursts from the Git extension's own
 * operations, and every one of them means the same thing — redraw the view.
 *
 * Layer: core (plan §4.1) — plain timers, no VS Code, no git. Hand-rolled (plan §11.3: ten
 * lines are not worth a dependency). Depends on: nothing. Depended on by: src/extension.ts
 * (the refresh), test/unit/debounce.test.ts. Plan: §7.14.2, §9.4 row `unit/debounce.test.ts`,
 * §10.1 item 12b.
 */

/** A debounced action: `schedule()` asks for one run soon; `cancel()` withdraws a pending one. */
// see primer §9 (interface)
export interface Debounced {
  /** Runs the action once the quiet period has passed with no further call; a call while a run is pending moves the deadline. */
  schedule(): void;
  /** Drops the pending run, if any — for shutdown, so nothing fires into a disposed view. */
  cancel(): void;
}

/**
 * Wraps `action` so that a burst of `schedule()` calls becomes one run, `delayMs` after
 * the last of them. Why one pending timer and nothing else — no counter, no flag:
 * `clearTimeout` on the pending handle *is* "forget the earlier calls", and a fresh
 * `setTimeout` *is* "start the quiet period again", so the whole rule is those two
 * standard calls (primer §58).
 */
// see primer §64 (debounce: a pending timer as a queue of one) and §33 (function types)
export function debounce(action: () => void, delayMs: number): Debounced {
  // The one pending run, or none. `Timeout` is Node's type for the handle `setTimeout`
  // returns (primer §58); `let`, because it changes on every call (primer §4).
  let pending: NodeJS.Timeout | undefined;
  return {
    schedule(): void {
      if (pending !== undefined) {
        clearTimeout(pending);
      }
      pending = setTimeout(() => {
        // Nothing is pending once the run starts, and the variable should say so — that
        // is all this is (clearTimeout on a handle that has fired does nothing). It goes
        // *before* the action, so a `schedule()` from inside the action, which stores a
        // new handle, is not overwritten by it.
        pending = undefined;
        action();
      }, delayMs);
    },
    cancel(): void {
      if (pending !== undefined) {
        clearTimeout(pending);
        pending = undefined;
      }
    },
  };
}
