import taskEvents from './taskEvents.js';

/**
 * Practical 10 — notification listeners.
 *
 * All notification logic lives here, decoupled from the task routes: the
 * controllers only emit minimal payloads, and these handlers do the (slow)
 * notification work asynchronously.
 *
 * Two facts drive the design:
 *
 * 1. `EventEmitter.emit()` calls listeners synchronously — an `async` listener
 *    starts executing immediately up to its first `await`, but `emit()` does
 *    NOT wait for the returned Promise. The slow part here is therefore a
 *    non-blocking `setTimeout` timer that yields to the event loop, so the HTTP
 *    response is never delayed by the two-second simulated work.
 * 2. EventEmitter does not observe rejected Promises from `async` listeners.
 *    Every handler is fully wrapped in try/catch, so no rejection can escape
 *    and (through the process-level `unhandledRejection` handler in
 *    server.js) take the whole server down.
 */

/** Simulated slow notification processing for task creation (2 seconds). */
export const NOTIFICATION_DELAY_MS = 2000;

let listenersRegistered = false;
let handlingError = false;

const isoNow = () => new Date().toISOString();

/** Non-blocking wait: the timer releases the event loop instead of spinning it. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Report a notification failure through the bus `error` event.
 *
 * Registered `error` listener handles the log; if it is missing or itself
 * fails, the fallback logs directly. Nothing is ever rethrown: a throw here
 * would surface as a rejected Promise from the async listener, which
 * EventEmitter would never observe.
 */
function reportFailure(eventName, error) {
  try {
    taskEvents.emit('error', error instanceof Error ? error : new Error(String(error)));
  } catch (emitError) {
    try {
      console.error(`[Notification] could not report "${eventName}" failure: ${errorMessage(emitError)}`);
    } catch {
      // Logging itself is unavailable — give up quietly, never rethrow.
    }
  }
}

/**
 * `task-created` listener (async).
 *
 * Logs the task title, an ISO timestamp and the assigned user, then simulates
 * slow notification work with a two-second non-blocking delay before logging
 * completion. The task schema (src/models/taskModel.js) currently defines no
 * assignment field, so the "no assigned user" case is handled gracefully.
 */
export async function handleTaskCreated(payload = {}) {
  try {
    const title = typeof payload.title === 'string' && payload.title.trim()
      ? payload.title
      : '(untitled task)';
    const assignedUserId = payload.assignedUserId ?? null;
    const createdBy = payload.createdBy ?? null;

    console.log(`[Notification] Task-created handler started at ${isoNow()}`);
    if (assignedUserId) {
      console.log(`[Notification] Task "${title}" assigned to ${assignedUserId}`);
    } else {
      console.log(
        `[Notification] Task "${title}" has no assigned user (task schema defines no assignment field); requested by ${createdBy ?? 'unknown user'}`
      );
    }

    // Non-blocking simulated work: awaiting a timer yields to the event loop,
    // so other requests keep being served while this notification "sends".
    await delay(NOTIFICATION_DELAY_MS);

    console.log(
      `[Notification] Task-created handler completed at ${isoNow()} (taskId=${payload.taskId ?? 'unknown'})`
    );
  } catch (error) {
    reportFailure('task-created', error);
  }
}

/**
 * `task-deleted` listener (async).
 *
 * Distinct notification and timestamps for deletions. Only the information
 * needed for the notification is logged — no payload, credentials or tokens.
 */
export async function handleTaskDeleted(payload = {}) {
  try {
    const title = typeof payload.title === 'string' && payload.title.trim()
      ? payload.title
      : '(untitled task)';
    const deletedBy = payload.deletedBy ?? 'unknown user';

    console.log(`[Notification] Task-deleted handler started at ${isoNow()}`);
    console.log(
      `[Notification] Task "${title}" (taskId=${payload.taskId ?? 'unknown'}) deleted by ${deletedBy}`
    );
    console.log(`[Notification] Task-deleted handler completed at ${isoNow()}`);
  } catch (error) {
    reportFailure('task-deleted', error);
  }
}

/**
 * Bus-level `error` listener.
 *
 * Registered before any event can be emitted, so the special EventEmitter
 * `error` event (which throws when unhandled) can never crash the server.
 * The re-entrancy flag plus the inner try/catch guarantee the handler cannot
 * recurse or throw out of `emit()`.
 */
function onError(error) {
  if (handlingError) {
    return;
  }
  handlingError = true;
  try {
    console.error(`[Notification] async notification error: ${errorMessage(error)}`);
  } catch {
    // Logging failed: swallow it — the error path must never throw.
  } finally {
    handlingError = false;
  }
}

/**
 * Register all notification listeners exactly once on the shared emitter.
 *
 * Called once from server.js at startup (never per request). Safe to call
 * again — repeated calls (hot reload, repeated test setup, double import)
 * are no-ops and cannot duplicate listener execution.
 *
 * @returns {boolean} true when the listeners were registered by this call.
 */
export function registerTaskListeners() {
  if (listenersRegistered) {
    return false;
  }
  listenersRegistered = true;

  // 'error' first: the special error event must always have a listener in
  // place before any code path can emit it.
  taskEvents.on('error', onError);
  taskEvents.on('task-created', handleTaskCreated);
  taskEvents.on('task-deleted', handleTaskDeleted);
  return true;
}
