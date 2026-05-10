import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { openTaskDatabase, resolveDbPath, withImmediateTransaction } from "./db.js";
import { ClaimConflictError, NotFoundError, PrivateListAccessError, ValidationError } from "./errors.js";
import {
  DEFAULT_CLAIM_TTL_SECONDS,
  SCOPE_TYPES,
  TASK_STATUSES,
  VISIBILITIES,
  type AccessOptions,
  type ActorContext,
  type AddManyTasksInput,
  type ClaimNextTaskInput,
  type ClaimResult,
  type CreateTaskInput,
  type CreateTaskListInput,
  type DeleteTaskInput,
  type DeleteTaskListInput,
  type DeleteTaskListResult,
  type FindTaskListsInput,
  type GetTaskListInput,
  type PrivateAccessEvent,
  type PrivateAccessEventsGetInput,
  type RefreshClaimInput,
  type ReleaseExpiredClaimsInput,
  type ReleaseExpiredClaimsResult,
  type ReorderTasksInput,
  type ScopeType,
  type Task,
  type TaskList,
  type TaskListWithTasks,
  type TaskStatus,
  type UpdateTaskInput,
  type Visibility,
} from "./types.js";

interface TaskServiceOptions {
  dbPath?: string;
  cwd?: string;
  now?: () => Date;
}

type Row = Record<string, unknown>;

export class TaskService {
  readonly dbPath: string;
  private readonly db: DatabaseSync;
  private readonly nowFn: () => Date;

  constructor(options: TaskServiceOptions = {}) {
    this.dbPath = options.dbPath ?? resolveDbPath(options.cwd);
    this.db = openTaskDatabase(this.dbPath);
    this.nowFn = options.now ?? (() => new Date());
  }

  close(): void {
    this.db.close();
  }

  getAgentSummary(actor: ActorContext): { db_path: string; agent_id: string; source: string } {
    return { db_path: this.dbPath, agent_id: actor.agentId, source: actor.source };
  }

  createTaskList(input: CreateTaskListInput, access: AccessOptions): TaskList {
    const now = this.nowIso();
    const visibility = input.visibility ?? "shared";
    validateScopeType(input.scope_type);
    validateVisibility(visibility);
    validateRequiredString(input.name, "name");
    validateRequiredString(input.scope_key, "scope_key");

    const id = input.id?.trim() || randomUUID();
    const ownerAgentId = input.owner_agent_id === undefined ? (visibility === "private" ? access.actor.agentId : null) : input.owner_agent_id;

    return withImmediateTransaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO task_lists
            (id, name, scope_type, scope_key, visibility, owner_agent_id, created_by_agent_id, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(id, input.name.trim(), input.scope_type, input.scope_key.trim(), visibility, ownerAgentId, access.actor.agentId, now, now);

      return this.getTaskListRow(id, { includeDeleted: true });
    });
  }

  findTaskLists(input: FindTaskListsInput, access: AccessOptions): TaskList[] {
    if (input.scope_type !== undefined) validateScopeType(input.scope_type);
    if (input.visibility !== undefined) validateVisibility(input.visibility);

    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    if (!input.include_deleted) conditions.push("deleted_at IS NULL");
    if (input.scope_type !== undefined) {
      conditions.push("scope_type = ?");
      params.push(input.scope_type);
    }
    if (input.scope_key !== undefined) {
      conditions.push("scope_key = ?");
      params.push(input.scope_key);
    }
    if (input.visibility !== undefined) {
      conditions.push("visibility = ?");
      params.push(input.visibility);
    }
    if (input.owner_agent_id !== undefined) {
      if (input.owner_agent_id === null) conditions.push("owner_agent_id IS NULL");
      else {
        conditions.push("owner_agent_id = ?");
        params.push(input.owner_agent_id);
      }
    }
    if (input.created_by_agent_id !== undefined) {
      conditions.push("created_by_agent_id = ?");
      params.push(input.created_by_agent_id);
    }
    if (input.name !== undefined) {
      conditions.push("lower(name) LIKE lower(?)");
      params.push(`%${input.name}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM task_lists ${where} ORDER BY updated_at DESC, created_at DESC`).all(...params) as Row[];
    const lists = rows.map(rowToTaskList);
    const visible: TaskList[] = [];

    for (const list of lists) {
      if (this.canAccessList(list, access.actor)) {
        visible.push(list);
        continue;
      }

      if (!input.include_inaccessible_private) continue;
      this.assertListAccess(list, access);
      visible.push(list);
    }

    return visible;
  }

  getTaskList(input: GetTaskListInput, access: AccessOptions): TaskListWithTasks {
    const list = this.getTaskListForAccess(input.list_id, access, { includeDeleted: input.include_deleted });
    const tasks = this.getTasksForList(list.id, {
      statuses: input.statuses,
      includeDeleted: input.include_deleted,
    });
    return { list, tasks };
  }

  createTask(input: CreateTaskInput, access: AccessOptions): Task {
    validateRequiredString(input.title, "title");
    return withImmediateTransaction(this.db, () => {
      this.getTaskListForAccess(input.list_id, access);
      const now = this.nowIso();
      const id = input.id?.trim() || randomUUID();
      const position = this.nextPosition(input.list_id, input.position);

      this.db
        .prepare(
          `INSERT INTO tasks
            (id, list_id, position, title, description, notes, status, assigned_to_agent_id, claimed_by_agent_id,
             claim_expires_at, outcome, created_at, updated_at, started_at, completed_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, 'todo', ?, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL)`,
        )
        .run(
          id,
          input.list_id,
          position,
          input.title.trim(),
          normalizeNullableString(input.description),
          normalizeNullableString(input.notes),
          normalizeNullableString(input.assigned_to_agent_id),
          now,
          now,
        );

      return this.getTaskRow(id);
    });
  }

  addManyTasks(input: AddManyTasksInput, access: AccessOptions): Task[] {
    if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
      throw new ValidationError("tasks must contain at least one task");
    }

    return withImmediateTransaction(this.db, () => {
      this.getTaskListForAccess(input.list_id, access);
      const now = this.nowIso();
      let position = this.maxActivePosition(input.list_id);
      const created: Task[] = [];

      const insert = this.db.prepare(
        `INSERT INTO tasks
          (id, list_id, position, title, description, notes, status, assigned_to_agent_id, claimed_by_agent_id,
           claim_expires_at, outcome, created_at, updated_at, started_at, completed_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, 'todo', ?, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL)`,
      );

      for (const item of input.tasks) {
        validateRequiredString(item.title, "tasks[].title");
        const id = item.id?.trim() || randomUUID();
        position += 1;
        insert.run(
          id,
          input.list_id,
          position,
          item.title.trim(),
          normalizeNullableString(item.description),
          normalizeNullableString(item.notes),
          normalizeNullableString(item.assigned_to_agent_id),
          now,
          now,
        );
        created.push(this.getTaskRow(id));
      }

      return created;
    });
  }

  claimNextTask(input: ClaimNextTaskInput, access: AccessOptions): ClaimResult {
    return withImmediateTransaction(this.db, () => {
      this.getTaskListForAccess(input.list_id, access);
      const now = this.nowIso();
      if (input.release_expired_first ?? true) {
        this.releaseExpiredClaimsInternal({ list_id: input.list_id }, access, now);
      }

      const task = this.db
        .prepare(
          `SELECT * FROM tasks
           WHERE list_id = ?
             AND deleted_at IS NULL
             AND status = 'todo'
             AND (assigned_to_agent_id IS NULL OR assigned_to_agent_id = ?)
           ORDER BY position ASC, created_at ASC
           LIMIT 1`,
        )
        .get(input.list_id, access.actor.agentId) as Row | undefined;

      if (!task) return { task: null };

      const taskId = String(task.id);
      const ttlSeconds = normalizeTtl(input.claim_ttl_seconds);
      const expiresAt = this.addSecondsIso(ttlSeconds);

      this.db
        .prepare(
          `UPDATE tasks
           SET status = 'in_progress',
               claimed_by_agent_id = ?,
               claim_expires_at = ?,
               started_at = COALESCE(started_at, ?),
               completed_at = NULL,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(access.actor.agentId, expiresAt, now, now, taskId);

      return { task: this.getTaskRow(taskId) };
    });
  }

  refreshClaim(input: RefreshClaimInput, access: AccessOptions): Task {
    return withImmediateTransaction(this.db, () => {
      const initialTask = this.getTaskRow(input.task_id);
      this.getTaskListForAccess(initialTask.list_id, access);
      const now = this.nowIso();
      this.releaseExpiredClaimsInternal({ list_id: initialTask.list_id }, access, now);
      const task = this.getTaskRow(input.task_id);

      if (task.status !== "in_progress") {
        throw new ClaimConflictError("Cannot refresh a task that is not in_progress", {
          task_id: task.id,
          status: task.status,
        });
      }
      if (task.claimed_by_agent_id !== access.actor.agentId) {
        throw new ClaimConflictError("Cannot refresh a claim held by another agent", {
          task_id: task.id,
          claimed_by_agent_id: task.claimed_by_agent_id,
          actor_agent_id: access.actor.agentId,
        });
      }

      const ttlSeconds = normalizeTtl(input.claim_ttl_seconds);
      const expiresAt = this.addSecondsIso(ttlSeconds);
      this.db
        .prepare("UPDATE tasks SET claim_expires_at = ?, updated_at = ? WHERE id = ?")
        .run(expiresAt, now, task.id);
      return this.getTaskRow(task.id);
    });
  }

  updateTask(input: UpdateTaskInput, access: AccessOptions): Task {
    return withImmediateTransaction(this.db, () => {
      const task = this.getTaskRow(input.task_id);
      if (task.deleted_at) throw new NotFoundError("task", input.task_id);
      this.getTaskListForAccess(task.list_id, access);

      if (input.status === "in_progress") {
        throw new ValidationError("task_items action=update cannot set status to in_progress; use task_claims action=claim_next instead", {
          task_id: input.task_id,
        });
      }

      if (task.claimed_by_agent_id && task.claimed_by_agent_id !== access.actor.agentId) {
        const protectedFields = input.status !== undefined || input.outcome !== undefined;
        if (protectedFields) {
          throw new ClaimConflictError("Cannot complete or change outcome for a task claimed by another agent", {
            task_id: task.id,
            claimed_by_agent_id: task.claimed_by_agent_id,
            actor_agent_id: access.actor.agentId,
          });
        }
      }

      const sets: string[] = [];
      const params: SQLInputValue[] = [];
      const now = this.nowIso();

      if (input.title !== undefined) {
        validateRequiredString(input.title, "title");
        sets.push("title = ?");
        params.push(input.title.trim());
      }
      if (input.description !== undefined) {
        sets.push("description = ?");
        params.push(normalizeNullableString(input.description));
      }
      if (input.notes !== undefined) {
        sets.push("notes = ?");
        params.push(normalizeNullableString(input.notes));
      }
      const explicitAssignmentProvided = input.assigned_to_agent_id !== undefined;
      if (explicitAssignmentProvided) {
        sets.push("assigned_to_agent_id = ?");
        params.push(normalizeNullableString(input.assigned_to_agent_id));
      }
      let normalizedOutcome: string | null | undefined;
      if (input.outcome !== undefined) {
        const outcomeValue = normalizeNullableString(input.outcome);
        normalizedOutcome = outcomeValue;
        sets.push("outcome = ?");
        params.push(outcomeValue);
      }
      if (input.status !== undefined) {
        validateTaskStatus(input.status);
        sets.push("status = ?");
        params.push(input.status);

        if (input.status === "done" || input.status === "canceled") {
          const finalOutcome = normalizedOutcome !== undefined ? normalizedOutcome : task.outcome;
          if (!finalOutcome) {
            throw new ValidationError("outcome is required when closing a task with status done or canceled", {
              task_id: task.id,
              status: input.status,
            });
          }
          sets.push("completed_at = ?", "claimed_by_agent_id = NULL", "claim_expires_at = NULL");
          params.push(now);
        } else if (input.status === "blocked" || input.status === "todo") {
          sets.push("completed_at = NULL", "claimed_by_agent_id = NULL", "claim_expires_at = NULL");
          if (input.status === "blocked" && !explicitAssignmentProvided) {
            sets.push("assigned_to_agent_id = ?");
            params.push(access.actor.agentId);
          }
        }
      }

      if (sets.length === 0) return task;
      sets.push("updated_at = ?");
      params.push(now, task.id);

      this.db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);
      return this.getTaskRow(task.id);
    });
  }

  reorderTasks(input: ReorderTasksInput, access: AccessOptions): Task[] {
    return withImmediateTransaction(this.db, () => {
      this.getTaskListForAccess(input.list_id, access);
      if (!Array.isArray(input.task_ids)) throw new ValidationError("task_ids must be an array");

      const activeTasks = this.getTasksForList(input.list_id, { includeDeleted: false });
      const byId = new Map(activeTasks.map((task) => [task.id, task]));
      const seen = new Set<string>();
      const ordered: Task[] = [];

      for (const id of input.task_ids) {
        if (seen.has(id)) throw new ValidationError(`Duplicate task id in reorder: ${id}`);
        seen.add(id);
        const task = byId.get(id);
        if (!task) throw new NotFoundError("active task in list", id);
        ordered.push(task);
      }

      for (const task of activeTasks) {
        if (!seen.has(task.id)) ordered.push(task);
      }

      const now = this.nowIso();
      const update = this.db.prepare("UPDATE tasks SET position = ?, updated_at = ? WHERE id = ?");
      let position = 1;
      for (const task of ordered) {
        update.run(position++, now, task.id);
      }

      return this.getTasksForList(input.list_id, { includeDeleted: false });
    });
  }

  releaseExpiredClaims(input: ReleaseExpiredClaimsInput, access: AccessOptions): ReleaseExpiredClaimsResult {
    return withImmediateTransaction(this.db, () => {
      const now = this.nowIso();
      return { released: this.releaseExpiredClaimsInternal(input, access, now) };
    });
  }

  deleteTaskList(input: DeleteTaskListInput, access: AccessOptions): DeleteTaskListResult {
    return withImmediateTransaction(this.db, () => {
      const list = this.getTaskListForAccess(input.list_id, access, { includeDeleted: true });
      if (list.deleted_at) return { list, deleted_tasks: [] };

      const now = this.nowIso();
      const activeTasks = this.getTasksForList(list.id, { includeDeleted: false });

      this.db
        .prepare(
          `UPDATE tasks
           SET deleted_at = ?, updated_at = ?, claimed_by_agent_id = NULL, claim_expires_at = NULL
           WHERE list_id = ? AND deleted_at IS NULL`,
        )
        .run(now, now, list.id);

      this.db
        .prepare("UPDATE task_lists SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
        .run(now, now, list.id);

      return {
        list: this.getTaskListRow(list.id, { includeDeleted: true }),
        deleted_tasks: activeTasks.map((task) => this.getTaskRow(task.id)),
      };
    });
  }

  deleteTask(input: DeleteTaskInput, access: AccessOptions): Task {
    return withImmediateTransaction(this.db, () => {
      const task = this.getTaskRow(input.task_id);
      if (task.deleted_at) return task;
      this.getTaskListForAccess(task.list_id, access);
      const now = this.nowIso();
      this.db
        .prepare(
          `UPDATE tasks
           SET deleted_at = ?, updated_at = ?, claimed_by_agent_id = NULL, claim_expires_at = NULL
           WHERE id = ?`,
        )
        .run(now, now, task.id);
      return this.getTaskRow(task.id);
    });
  }

  getPrivateAccessEvents(input: PrivateAccessEventsGetInput, access: AccessOptions): PrivateAccessEvent[] {
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    if (input.list_id !== undefined) {
      this.getTaskListForAccess(input.list_id, access, { includeDeleted: true });
      conditions.push("list_id = ?");
      params.push(input.list_id);
    } else {
      const visibleLists = this.findTaskLists({ include_deleted: true }, access);
      if (visibleLists.length === 0) return [];
      conditions.push(`list_id IN (${visibleLists.map(() => "?").join(", ")})`);
      params.push(...visibleLists.map((list) => list.id));
    }

    if (input.actor_agent_id !== undefined) {
      validateRequiredString(input.actor_agent_id, "actor_agent_id");
      conditions.push("actor_agent_id = ?");
      params.push(input.actor_agent_id.trim());
    }
    if (input.tool_name !== undefined) {
      validateRequiredString(input.tool_name, "tool_name");
      conditions.push("tool_name = ?");
      params.push(input.tool_name.trim());
    }
    if (input.since !== undefined) {
      validateIsoDate(input.since, "since");
      conditions.push("created_at >= ?");
      params.push(input.since);
    }

    const limit = normalizeLimit(input.limit, 100, 1000, "limit");
    params.push(limit);
    const rows = this.db
      .prepare(`SELECT * FROM private_access_events WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
      .all(...params) as Row[];
    return rows.map(rowToPrivateAccessEvent);
  }

  private releaseExpiredClaimsInternal(input: ReleaseExpiredClaimsInput, access: AccessOptions, now: string): Task[] {
    const conditions = ["tasks.status = 'in_progress'", "tasks.claim_expires_at IS NOT NULL", "tasks.claim_expires_at <= ?", "tasks.deleted_at IS NULL"];
    const params: SQLInputValue[] = [now];
    if (input.list_id !== undefined) {
      this.getTaskListForAccess(input.list_id, access);
      conditions.push("tasks.list_id = ?");
      params.push(input.list_id);
    }

    const rows = this.db
      .prepare(
        `SELECT tasks.* FROM tasks
         JOIN task_lists ON task_lists.id = tasks.list_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY tasks.claim_expires_at ASC`,
      )
      .all(...params) as Row[];

    const candidates = rows.map(rowToTask);
    const released: Task[] = [];
    const update = this.db.prepare(
      "UPDATE tasks SET status = 'todo', claimed_by_agent_id = NULL, claim_expires_at = NULL, updated_at = ? WHERE id = ?",
    );

    for (const task of candidates) {
      const list = this.getTaskListRow(task.list_id);
      if (!this.canAccessList(list, access.actor)) continue;
      update.run(now, task.id);
      released.push(this.getTaskRow(task.id));
    }

    return released;
  }

  private getTaskListForAccess(
    listId: string,
    access: AccessOptions,
    options: { includeDeleted?: boolean } = {},
  ): TaskList {
    const list = this.getTaskListRow(listId, { includeDeleted: options.includeDeleted });
    this.assertListAccess(list, access);
    return list;
  }

  private getTaskListRow(listId: string, options: { includeDeleted?: boolean } = {}): TaskList {
    const row = this.db.prepare("SELECT * FROM task_lists WHERE id = ?").get(listId) as Row | undefined;
    if (!row) throw new NotFoundError("task_list", listId);
    const list = rowToTaskList(row);
    if (list.deleted_at && !options.includeDeleted) throw new NotFoundError("task_list", listId);
    return list;
  }

  private getTaskRow(taskId: string): Task {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Row | undefined;
    if (!row) throw new NotFoundError("task", taskId);
    return rowToTask(row);
  }

  private getTasksForList(
    listId: string,
    options: { statuses?: TaskStatus[]; includeDeleted?: boolean } = {},
  ): Task[] {
    const conditions = ["list_id = ?"];
    const params: SQLInputValue[] = [listId];

    if (!options.includeDeleted) conditions.push("deleted_at IS NULL");
    if (options.statuses !== undefined && options.statuses.length > 0) {
      for (const status of options.statuses) validateTaskStatus(status);
      conditions.push(`status IN (${options.statuses.map(() => "?").join(", ")})`);
      params.push(...options.statuses);
    }

    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE ${conditions.join(" AND ")} ORDER BY position ASC, created_at ASC`)
      .all(...params) as Row[];
    return rows.map(rowToTask);
  }

  private nextPosition(listId: string, requestedPosition?: number): number {
    if (requestedPosition === undefined) return this.maxActivePosition(listId) + 1;
    if (!Number.isInteger(requestedPosition) || requestedPosition < 1) {
      throw new ValidationError("position must be a positive integer", { position: requestedPosition });
    }

    this.db
      .prepare(
        `UPDATE tasks
         SET position = position + 1
         WHERE list_id = ? AND deleted_at IS NULL AND position >= ?`,
      )
      .run(listId, requestedPosition);
    return requestedPosition;
  }

  private maxActivePosition(listId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(position), 0) AS max_position FROM tasks WHERE list_id = ? AND deleted_at IS NULL")
      .get(listId) as { max_position: number };
    return row.max_position;
  }

  private canAccessList(list: TaskList, actor: ActorContext): boolean {
    if (list.visibility === "shared") return true;
    if (list.owner_agent_id) return list.owner_agent_id === actor.agentId;
    return list.created_by_agent_id === actor.agentId;
  }

  private assertListAccess(list: TaskList, access: AccessOptions): void {
    if (this.canAccessList(list, access.actor)) return;
    if (!access.privateBypass) {
      throw new PrivateListAccessError(list, access.actor.agentId);
    }
    const privateBypass = access.privateBypass;
    validateRequiredString(privateBypass.reason, "privateBypass.reason");
    this.logPrivateAccess(list, { ...access, privateBypass });
  }

  private logPrivateAccess(list: TaskList, access: AccessOptions & { privateBypass: NonNullable<AccessOptions["privateBypass"]> }): void {
    this.db
      .prepare(
        `INSERT INTO private_access_events (id, list_id, actor_agent_id, tool_name, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), list.id, access.actor.agentId, access.privateBypass.toolName, access.privateBypass.reason, this.nowIso());
  }

  private nowIso(): string {
    return this.nowFn().toISOString();
  }

  private addSecondsIso(seconds: number): string {
    return new Date(this.nowFn().getTime() + seconds * 1000).toISOString();
  }
}

function rowToTaskList(row: Row): TaskList {
  return {
    id: stringField(row, "id"),
    name: stringField(row, "name"),
    scope_type: stringField(row, "scope_type") as ScopeType,
    scope_key: stringField(row, "scope_key"),
    visibility: stringField(row, "visibility") as Visibility,
    owner_agent_id: nullableStringField(row, "owner_agent_id"),
    created_by_agent_id: stringField(row, "created_by_agent_id"),
    created_at: stringField(row, "created_at"),
    updated_at: stringField(row, "updated_at"),
    deleted_at: nullableStringField(row, "deleted_at"),
  };
}

function rowToTask(row: Row): Task {
  return {
    id: stringField(row, "id"),
    list_id: stringField(row, "list_id"),
    position: numberField(row, "position"),
    title: stringField(row, "title"),
    description: nullableStringField(row, "description"),
    notes: nullableStringField(row, "notes"),
    status: stringField(row, "status") as TaskStatus,
    assigned_to_agent_id: nullableStringField(row, "assigned_to_agent_id"),
    claimed_by_agent_id: nullableStringField(row, "claimed_by_agent_id"),
    claim_expires_at: nullableStringField(row, "claim_expires_at"),
    outcome: nullableStringField(row, "outcome"),
    created_at: stringField(row, "created_at"),
    updated_at: stringField(row, "updated_at"),
    started_at: nullableStringField(row, "started_at"),
    completed_at: nullableStringField(row, "completed_at"),
    deleted_at: nullableStringField(row, "deleted_at"),
  };
}

function rowToPrivateAccessEvent(row: Row): PrivateAccessEvent {
  return {
    id: stringField(row, "id"),
    list_id: stringField(row, "list_id"),
    actor_agent_id: stringField(row, "actor_agent_id"),
    tool_name: stringField(row, "tool_name"),
    reason: stringField(row, "reason"),
    created_at: stringField(row, "created_at"),
  };
}

function stringField(row: Row, field: string): string {
  const value = row[field];
  if (typeof value !== "string") throw new Error(`Expected string field ${field}`);
  return value;
}

function nullableStringField(row: Row, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Expected nullable string field ${field}`);
  return value;
}

function numberField(row: Row, field: string): number {
  const value = row[field];
  if (typeof value !== "number") throw new Error(`Expected number field ${field}`);
  return value;
}

function validateRequiredString(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${field} is required`);
  }
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function validateScopeType(value: string): void {
  if (!(SCOPE_TYPES as readonly string[]).includes(value)) {
    throw new ValidationError(`Invalid scope_type: ${value}`, { allowed: SCOPE_TYPES });
  }
}

function validateVisibility(value: string): void {
  if (!(VISIBILITIES as readonly string[]).includes(value)) {
    throw new ValidationError(`Invalid visibility: ${value}`, { allowed: VISIBILITIES });
  }
}

function validateTaskStatus(value: string): void {
  if (!(TASK_STATUSES as readonly string[]).includes(value)) {
    throw new ValidationError(`Invalid task status: ${value}`, { allowed: TASK_STATUSES });
  }
}

function validateIsoDate(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || !Number.isFinite(Date.parse(value))) {
    throw new ValidationError(`${field} must be a valid ISO date string`, { [field]: value });
  }
}

function normalizeLimit(value: number | undefined, defaultValue: number, maxValue: number, field: string): number {
  const limit = value ?? defaultValue;
  if (!Number.isInteger(limit) || limit <= 0 || limit > maxValue) {
    throw new ValidationError(`${field} must be a positive integer <= ${maxValue}`, { [field]: value });
  }
  return limit;
}

function normalizeTtl(value: number | undefined): number {
  const ttl = value ?? DEFAULT_CLAIM_TTL_SECONDS;
  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new ValidationError("claim_ttl_seconds must be a positive number", { claim_ttl_seconds: value });
  }
  return Math.floor(ttl);
}
