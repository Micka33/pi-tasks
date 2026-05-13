---
name: pi-tasks
description: >-
  Use when work should be tracked in persistent shared pi-tasks lists: multi-step
  plans, resumable work, handoffs, parallel agents, task claiming, task status
  updates, or when the user asks to create, list, claim, update, or close tasks.
  Explains when and how to use the pi-tasks extension tools.
---

# pi-tasks

Persistent shared task lists for Pi agents and MCP clients.

## When to use

- The user asks for task lists, todo queues, claims, assignments, handoffs, or status tracking.
- Work has multiple steps and should survive reload, compaction, or session changes.
- Multiple agents/sessions/MCP clients may coordinate on the same queue.
- You need to pick the next available unit of work instead of choosing manually.

## When not to use

- A one-shot answer or tiny edit needs no durable task state.
- A normal prose plan is enough and the user did not ask for persistent tracking.
- A private list is inaccessible, unless the user explicitly confirms a bypass.

## Minimal workflow

- Use `task_help` when unsure; its Pi UI output is concise and is the source of truth.
- Use `task_lists` action=`find|get|create|delete` to discover or manage lists.
- Use `task_items` action=`create|add_many` to populate a list.
- Use `task_claims` action=`claim_next` as the only normal way to move work to `in_progress`.
- A claim is a time-limited lock. `claim_expires_at` shows when it expires.
- Use `task_claims` action=`refresh` for long-running work so another agent cannot reclaim it.
- After expiry, the task still exists but the lock is stale; `release_expired` or a later `claim_next` clears that stale lock so the task can be claimed again.
- Use `task_items` action=`update` with `notes` for task-local working memory.
- Close tasks with `task_items` action=`update` and status `done` or `canceled`; `outcome` is required.
- Pause tasks with status `blocked`; omit `assigned_to_agent_id` to keep responsibility, pass `null` to release it.

## Tool map

- `task_lists`: create, find, get, delete lists.
- `task_items`: create, add_many, update, reorder, delete tasks.
- `task_claims`: claim_next, refresh, release_expired claims.
- `task_audit`: read visible private-list bypass audit events.
- `task_help`: show workflow, schemas, and examples.

## Common calls

Find lists for the current workspace:

```json
{ "action": "find", "params": { "scope_type": "workspace", "scope_key": "/repo" } }
```

Create a shared list:

```json
{ "action": "create", "params": { "name": "Release work", "scope_type": "workspace", "scope_key": "/repo" } }
```

Add several tasks:

```json
{ "action": "add_many", "params": { "list_id": "release", "tasks": [{ "title": "Run tests" }] } }
```

Claim next task:

```json
{ "action": "claim_next", "params": { "list_id": "release" } }
```

Complete a task:

```json
{ "action": "update", "params": { "task_id": "task-id", "status": "done", "outcome": "Decision: ship. Actions: tests. Final state: green." } }
```
