# pi-tasks

Persistent, ordered, shared task lists for Pi agents and MCP clients.

`pi-tasks` ships both:

1. a **Pi package/extension** exposing task tools directly inside Pi;
2. a **local stdio MCP server** exposing the same tool surface to MCP hosts.

The product specification is kept in [`pi-tasks.md`](./pi-tasks.md).

## Requirements

- Node.js >= 24, because the implementation uses the built-in `node:sqlite` module.
- Pi for the extension use case.
- An MCP-compatible host for the stdio server use case.

## Install for Pi

From this repository:

```bash
pi install git:git@github.com:Micka33/pi-tasks.git
```

For project-local installation:

```bash
pi install -l git:git@github.com:Micka33/pi-tasks.git
```

During development:

```bash
pi -e ./src/pi/index.ts
```

## SQLite storage

Default database path:

```text
.pi/pi-tasks/tasks.sqlite
```

Override it to share one queue between workspaces, Pi sessions, and MCP clients:

```bash
export PI_TASKS_DB_PATH=/absolute/path/to/tasks.sqlite
```

Same SQLite database + same `list_id` = same shared task list.

## Agent identity

### Pi

The Pi extension derives `agent_id` from the Pi session file:

```text
pi-session:<sha256(session-file)[0..16]>
```

You can override it with:

```bash
export PI_TASKS_AGENT_ID=my-agent
```

### MCP

MCP has no Pi session, so set a stable identity explicitly:

```bash
export PI_TASKS_AGENT_ID=mcp-worker-1
```

If omitted, the MCP server uses a process-scoped fallback; set `PI_TASKS_AGENT_ID` for stable claims across restarts.

## MCP stdio server

Build first:

```bash
npm install
npm run build
```

Run:

```bash
PI_TASKS_AGENT_ID=mcp-worker-1 \
PI_TASKS_DB_PATH=/absolute/path/to/tasks.sqlite \
node dist/src/mcp/cli.js
```

Example MCP config shape:

```json
{
  "mcpServers": {
    "pi-tasks": {
      "command": "node",
      "args": ["/absolute/path/to/pi-tasks/dist/src/mcp/cli.js"],
      "env": {
        "PI_TASKS_AGENT_ID": "mcp-worker-1",
        "PI_TASKS_DB_PATH": "/absolute/path/to/tasks.sqlite"
      }
    }
  }
}
```

## Pi TUI widget

The Pi extension shows a compact framed `pi-tasks` widget above the editor when visible task lists exist.

It summarizes visible lists, status counts, and tasks assigned to or claimed by the current Pi session. The widget puts the current agent's work first, uses readable counters such as `todo 2 · run 1 · blocked 0 · done 0`, and labels blocked tasks as `paused`. It never bypasses private-list protection automatically.

Control it with:

```text
/task-widget on
/task-widget off
/task-widget compact
/task-widget full
/task-widget refresh
```

Useful commands:

```text
/task-lists          # compact: only name + id
/task-lists full     # complete JSON metadata
/tasks <list_id>     # readable task details, including ids, agents, times, descriptions, notes, outcome
/tasks <list_id> full # complete JSON for the list and tasks
```

`/tasks <list_id>` supports Pi TUI autocomplete for visible task-list ids. Type `/tasks ` then trigger completion, or start typing a list id/name to filter suggestions. `/task-widget` also autocompletes its actions: `on`, `off`, `compact`, `full`, `refresh`.

The widget refreshes on session start, after `task_*` tool calls, and periodically every 10 seconds to catch updates made by other agents or MCP clients.

Pi currently renders at most 10 widget lines. `pi-tasks` stays under that limit itself to avoid Pi's generic `widget truncated` message: compact mode uses up to 8 lines, full mode uses up to 10 lines, and hidden content is summarized with explicit `… masquée(s)` lines plus `/tasks <list_id>` hints.

## Tools

- `task_list_create` — create a task list.
- `task_lists_find` — find visible lists by scope, visibility, owner, creator, or name.
- `task_list_get` — read a list and tasks in execution order.
- `task_create` — add one task.
- `task_add_many` — add several tasks transactionally.
- `task_claim_next` — atomically claim the next eligible `todo` task.
- `task_claim_refresh` — refresh a claim TTL without changing `started_at`.
- `task_update` — update task fields, `notes`, `outcome`, or status, except `in_progress`. `notes` are task-local working memory; `outcome` is required when closing a task as `done` or `canceled`. `status="blocked"` assigns the paused task to the acting agent by default; pass `assigned_to_agent_id: null` to release it.
- `task_reorder` — reorder active tasks.
- `task_release_expired_claims` — release expired claims back to `todo`.
- `task_delete` — soft-delete a task via `deleted_at`.

## Important workflow rule

`task_claim_next` is the only normal way to move a task to `in_progress`.

`task_update(status = "in_progress")` is rejected intentionally to avoid multi-agent conflicts.

For long tasks, call `task_claim_refresh` periodically. The default TTL is 2 hours.

When pausing a task with `task_update(status = "blocked")`, the active claim is cleared but responsibility is kept by default: if `assigned_to_agent_id` is omitted, `pi-tasks` sets it to the agent that paused the task. To fully release the paused task, pass `assigned_to_agent_id: null` in the same `task_update` call. To hand it off, pass another agent id.

Use `notes` as task-local working memory while a task is in progress: important context, choices in progress, blockers, assumptions, and next steps belong there.

`outcome` is the final deliverable, conclusion, or summary for a completed or canceled task. Closing a task with `status="done"` or `status="canceled"` requires a non-empty `outcome`; summarize the choices/decisions made, actions taken, and final state obtained.

## Privacy model

Private lists are enforced strictly:

- shared lists are visible to all agents using the database;
- private lists are accessible only to `owner_agent_id`, or to `created_by_agent_id` when no owner is set;
- Pi can bypass after an explicit user confirmation dialog;
- MCP tries form elicitation when the host supports it, otherwise returns an access error.

Bypasses are audited in SQLite in `private_access_events`.

## Development

```bash
npm install
npm run typecheck
npm test
npm run coverage
```

`npm run coverage` calls `scripts/check-coverage.mjs`, the same helper used by GitHub CI. It builds the project, runs the Node test runner with coverage enabled, and enforces 100% thresholds for lines, branches, and functions.

The test suite covers SQLite persistence, claim uniqueness, claim refresh, soft-delete, private-list enforcement, status rules, command formatting, widget formatting, and autocomplete helpers.

## Releases

A GitHub Release is created automatically when a semver tag is pushed. The package version used in the release artifact is derived from the tag.

```bash
git tag -a v0.1.1 -m "v0.1.1"
git push origin v0.1.1
```

The workflow builds, tests, runs `npm pack`, uploads the `.tgz` artifact, and uploads its SHA256 checksum.
