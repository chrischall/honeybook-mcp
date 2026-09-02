import type { HbMethod } from './client.js';

/**
 * HoneyBook's "client pending task" protocol.
 *
 * The client portal does not POST a message (or run any other multi-step
 * job) directly. It creates a **pending task** — `POST /api/v2/client_pending_task`
 * with `{task_type, task_data}` — gets back a `task_id`, then polls
 * `GET /api/v2/client_pending_tasks?task_ids[]=<id>` until the task reaches a
 * terminal state. That is what `ClientPendingTaskController` in the shipped
 * portal bundle (`public.honeybook.com/public_router_app_cp/<build>/cp.4171.*.js`,
 * read 2026-09-02) does: `createClientPendingTask` → `registerPendingTask` →
 * `pendingTasksTimeoutHandler` → `handlePendingTaskUpdate`.
 *
 * `send_workspace_message` is the task type behind the Activity tab's
 * composer; the same runner will carry any other task type the portal exposes.
 */

/** `pending_task_state_cd` values, from the enum module the controller switches on. */
export const PENDING_TASK_STATE = {
  Pending: 0,
  Started: 1,
  Finished: 2,
  Aborted: 3,
} as const;

export interface ClientPendingTask {
  _id: string;
  pending_task_state_cd: number;
  pending_task_result?: unknown;
  pending_task_error_message?: string | null;
  pending_task_progress?: unknown;
  task_type?: string;
}

/**
 * Poll cadence. Mutable so tests can drop the interval to 0 and cap the poll
 * count without faking timers. The app polls on a timer too (the interval is
 * its non-websocket fallback); one second is what a human waits at the
 * composer's spinner.
 */
export const pendingTaskPolling = { intervalMs: 1000, maxPolls: 60 };

/** The one method the runner needs from a client — keeps it mockable. */
export interface PendingTaskCaller {
  request<T>(method: HbMethod, path: string, body?: unknown): Promise<T>;
}

export interface PendingTaskOutcome<T> {
  task_id: string;
  result: T;
}

export async function runClientPendingTask<T = unknown>(
  client: PendingTaskCaller,
  taskType: string,
  taskData: Record<string, unknown>
): Promise<PendingTaskOutcome<T>> {
  const created = await client.request<{ task_id?: string } | null>(
    'POST',
    '/api/v2/client_pending_task',
    { task_type: taskType, task_data: taskData }
  );
  const taskId = created?.task_id;
  if (!taskId) {
    throw new Error(
      `HoneyBook accepted the "${taskType}" task but returned no task_id: ${JSON.stringify(created)}`
    );
  }

  for (let poll = 0; poll < pendingTaskPolling.maxPolls; poll++) {
    if (poll > 0 && pendingTaskPolling.intervalMs > 0) {
      await new Promise<void>((r) => setTimeout(r, pendingTaskPolling.intervalMs));
    }
    const raw = await client.request<ClientPendingTask[] | ClientPendingTask | null>(
      'GET',
      `/api/v2/client_pending_tasks?task_ids[]=${encodeURIComponent(taskId)}`
    );
    const tasks = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const task = tasks.find((t) => t._id === taskId);
    if (!task) {
      // The app rejects with "canceled" and logs "found a client pending task
      // which is not monitored on the server". Same reading here.
      throw new Error(
        `HoneyBook is no longer tracking task ${taskId} ("${taskType}"); it was canceled server-side before finishing.`
      );
    }
    const state = task.pending_task_state_cd;
    if (state === PENDING_TASK_STATE.Finished) {
      return { task_id: taskId, result: task.pending_task_result as T };
    }
    if (state === PENDING_TASK_STATE.Pending || state === PENDING_TASK_STATE.Started) continue;
    throw new Error(
      `HoneyBook task ${taskId} ("${taskType}") failed: ${
        task.pending_task_error_message || `state ${state}`
      }`
    );
  }
  throw new Error(
    `HoneyBook task ${taskId} ("${taskType}") timed out after ${pendingTaskPolling.maxPolls} polls without finishing.`
  );
}
