import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runClientPendingTask, pendingTaskPolling, PENDING_TASK_STATE } from '../src/pending-tasks.js';

describe('runClientPendingTask', () => {
  const request = vi.fn();
  const client = { request } as any;

  beforeEach(() => {
    request.mockReset();
    pendingTaskPolling.intervalMs = 0;
    pendingTaskPolling.maxPolls = 5;
  });
  afterEach(() => {
    pendingTaskPolling.intervalMs = 1000;
    pendingTaskPolling.maxPolls = 60;
  });

  it('exposes the state codes the shipped client-portal app switches on', () => {
    expect(PENDING_TASK_STATE).toEqual({ Pending: 0, Started: 1, Finished: 2, Aborted: 3 });
  });

  it('creates the task, polls until Finished, and returns pending_task_result', async () => {
    request
      .mockResolvedValueOnce({ task_id: 't1' })
      .mockResolvedValueOnce([{ _id: 't1', pending_task_state_cd: 0 }])
      .mockResolvedValueOnce([{ _id: 't1', pending_task_state_cd: 1, pending_task_progress: 50 }])
      .mockResolvedValueOnce([{ _id: 't1', pending_task_state_cd: 2, pending_task_result: { ok: 1 } }]);
    const out = await runClientPendingTask<{ ok: number }>(client, 'send_workspace_message', { a: 1 });
    expect(out).toEqual({ task_id: 't1', result: { ok: 1 } });
    expect(request.mock.calls[0]).toEqual(['POST', '/api/v2/client_pending_task', { task_type: 'send_workspace_message', task_data: { a: 1 } }]);
    expect(request.mock.calls[1]).toEqual(['GET', '/api/v2/client_pending_tasks?task_ids[]=t1']);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('rejects when the task is Aborted, carrying the server message', async () => {
    request
      .mockResolvedValueOnce({ task_id: 't2' })
      .mockResolvedValueOnce([{ _id: 't2', pending_task_state_cd: 3, pending_task_error_message: 'boom' }]);
    await expect(runClientPendingTask(client, 'x', {})).rejects.toThrow(/boom/);
  });

  it('rejects when the server stops reporting the task (the app treats that as canceled)', async () => {
    request.mockResolvedValueOnce({ task_id: 't3' }).mockResolvedValueOnce([]);
    await expect(runClientPendingTask(client, 'x', {})).rejects.toThrow(/no longer/i);
  });

  it('rejects after maxPolls without a terminal state', async () => {
    request.mockResolvedValueOnce({ task_id: 't4' });
    request.mockResolvedValue([{ _id: 't4', pending_task_state_cd: 1 }]);
    await expect(runClientPendingTask(client, 'x', {})).rejects.toThrow(/timed out/i);
    expect(request).toHaveBeenCalledTimes(1 + 5);
  });

  it('rejects when creation does not return a task_id', async () => {
    request.mockResolvedValueOnce({});
    await expect(runClientPendingTask(client, 'x', {})).rejects.toThrow(/task_id/);
  });
});
