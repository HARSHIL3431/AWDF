import { EventEmitter } from 'node:events';

/**
 * Practical 10 — shared event bus.
 *
 * A single, process-wide `EventEmitter` instance exported for the whole
 * backend: task controllers emit on it, notification listeners subscribe to
 * it. Creating separate emitter instances in routes and listeners would
 * silently split the bus and no notification would ever be observed.
 *
 * Deliberately built on Node's built-in `events` module — no Redis, BullMQ,
 * RabbitMQ or any other external messaging dependency is introduced. Events
 * are therefore in-memory only: they are not persisted and are not shared
 * between independent server instances. See docs/practical-10-events.md.
 */
class TaskEventBus extends EventEmitter {}

export const taskEvents = new TaskEventBus();

/**
 * Emit an application event without ever letting a listener failure reach the
 * HTTP layer.
 *
 * `EventEmitter.emit()` invokes registered listeners **synchronously**. A
 * listener that throws synchronously would bubble into the route's try/catch
 * and could trigger a second response attempt after a response has already
 * been sent (e.g. after `res.status(201).json(...)`). `safeEmit` isolates
 * that boundary so a notification failure can never change, duplicate, or
 * falsely report an already successful API result.
 *
 * @param {string} event Event name (e.g. 'task-created').
 * @param {unknown} payload Minimal notification payload.
 * @returns {boolean} true when every listener ran without throwing.
 */
export function safeEmit(event, payload) {
  try {
    taskEvents.emit(event, payload);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Notification] listener failure while emitting "${event}": ${message}`);
    return false;
  }
}

export default taskEvents;
