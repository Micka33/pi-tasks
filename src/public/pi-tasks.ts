import { hostname } from "node:os";
import { shortHash } from "../core/agent-id.js";
import {
  type CompactToolName,
  dispatchCompactTaskTool,
  getTaskHelp,
} from "../core/compact-tools.js";
import { resolveDbPath } from "../core/db.js";
import { TaskService } from "../core/service.js";
import type {
  AccessOptions,
  ActorContext,
  AddManyTasksInput,
  ClaimNextTaskInput,
  ClaimResult,
  CreateTaskInput,
  CreateTaskListInput,
  DeleteTaskInput,
  DeleteTaskListInput,
  DeleteTaskListResult,
  EnsureTaskListInput,
  FindTaskListsInput,
  FindTasksInput,
  GetTaskInput,
  GetTaskListInput,
  PrivateAccessEvent,
  PrivateAccessEventsGetInput,
  RefreshClaimInput,
  ReleaseExpiredClaimsInput,
  ReleaseExpiredClaimsResult,
  ReorderTasksInput,
  Task,
  TaskList,
  TaskListWithTasks,
  UpdateTaskInput,
  UpsertTaskInput,
} from "../core/types.js";

export type PiTasksSource = ActorContext["source"];

/** Options for bypassing private-list access checks after an explicit user confirmation. */
export interface PiTasksPrivateBypassOptions {
  /** Human-readable reason recorded in the private access audit log. */
  reason: string;
  /** Tool or integration name recorded in the private access audit log. */
  toolName: string;
}

/**
 * Constructor options for {@link PiTasks}, the public code API entrypoint.
 *
 * These comments are emitted to `dist/src/public/pi-tasks.d.ts`, so editors and
 * downstream TypeScript consumers receive the same documentation from the npm
 * package without needing the repository source files.
 */
export interface PiTasksOptions {
  /**
   * Absolute or cwd-relative SQLite database path.
   *
   * If omitted, `PI_TASKS_DB_PATH` is honored first, then pi-tasks uses
   * `<cwd>/.pi/pi-tasks/tasks.sqlite`.
   */
  dbPath?: string;
  /**
   * Base directory used when resolving the default database path or a relative
   * `dbPath`. Defaults to `process.cwd()`.
   */
  cwd?: string;
  /**
   * Stable id for the calling agent/integration.
   *
   * If omitted, `PI_TASKS_AGENT_ID` is honored first, then a process-scoped
   * fallback id is generated. Use a stable value when claims or private-list
   * ownership must survive process restarts.
   */
  agentId?: string;
  /**
   * Source label stored in access context and returned by `getAgentSummary()`.
   * Defaults to `"unknown"` for the public code API.
   */
  source?: PiTasksSource;
  /**
   * Optional default private-list bypass applied to calls from this instance.
   * Prefer per-call bypasses when the confirmation is specific to one action.
   */
  privateBypass?: PiTasksPrivateBypassOptions;
  /**
   * Clock override for deterministic tests or simulations.
   */
  now?: () => Date;
}

export interface PiTasksCallOptions {
  agentId?: string;
  source?: PiTasksSource;
  privateBypass?: PiTasksPrivateBypassOptions;
}

export type TaskHelpAction = "all" | "workflow" | "schemas" | "examples";

export class PiTasks {
  readonly dbPath: string;
  readonly agentId: string;
  readonly source: PiTasksSource;

  private readonly service: TaskService;
  private readonly privateBypass?: PiTasksPrivateBypassOptions;
  private readonly now?: () => Date;

  constructor(options: PiTasksOptions = {}) {
    const actor = resolvePublicActor(options);
    this.agentId = actor.agentId;
    this.source = actor.source;
    this.privateBypass = options.privateBypass;
    this.now = options.now;
    this.service = new TaskService({
      dbPath: options.dbPath,
      cwd: options.cwd,
      now: options.now,
    });
    this.dbPath = this.service.dbPath;
  }

  close(): void {
    this.service.close();
  }

  withActor(
    agentId: string,
    options: { source?: PiTasksSource } = {},
  ): PiTasks {
    return new PiTasks({
      dbPath: this.dbPath,
      agentId,
      source: options.source ?? this.source,
      privateBypass: this.privateBypass,
      now: this.now,
    });
  }

  withPrivateBypass(reason: string, toolName: string): PiTasks {
    return new PiTasks({
      dbPath: this.dbPath,
      agentId: this.agentId,
      source: this.source,
      privateBypass: { reason, toolName },
      now: this.now,
    });
  }

  getAgentSummary(options?: PiTasksCallOptions): {
    db_path: string;
    agent_id: string;
    source: string;
  } {
    return this.service.getAgentSummary(this.access(options).actor);
  }

  createTaskList(
    input: CreateTaskListInput,
    options?: PiTasksCallOptions,
  ): TaskList {
    return this.service.createTaskList(input, this.access(options));
  }

  ensureTaskList(
    input: EnsureTaskListInput,
    options?: PiTasksCallOptions,
  ): TaskList {
    return this.service.ensureTaskList(input, this.access(options));
  }

  findTaskLists(
    input: FindTaskListsInput = {},
    options?: PiTasksCallOptions,
  ): TaskList[] {
    return this.service.findTaskLists(input, this.access(options));
  }

  getTaskList(
    input: GetTaskListInput | string,
    options?: PiTasksCallOptions,
  ): TaskListWithTasks {
    return this.service.getTaskList(
      normalizeTaskListInput(input),
      this.access(options),
    );
  }

  deleteTaskList(
    input: DeleteTaskListInput | string,
    options?: PiTasksCallOptions,
  ): DeleteTaskListResult {
    return this.service.deleteTaskList(
      normalizeDeleteTaskListInput(input),
      this.access(options),
    );
  }

  createTask(input: CreateTaskInput, options?: PiTasksCallOptions): Task {
    return this.service.createTask(input, this.access(options));
  }

  addManyTasks(input: AddManyTasksInput, options?: PiTasksCallOptions): Task[] {
    return this.service.addManyTasks(input, this.access(options));
  }

  getTask(input: GetTaskInput | string, options?: PiTasksCallOptions): Task {
    return this.service.getTask(
      normalizeTaskInput(input),
      this.access(options),
    );
  }

  findTasks(input: FindTasksInput = {}, options?: PiTasksCallOptions): Task[] {
    return this.service.findTasks(input, this.access(options));
  }

  updateTask(input: UpdateTaskInput, options?: PiTasksCallOptions): Task {
    return this.service.updateTask(input, this.access(options));
  }

  upsertTask(input: UpsertTaskInput, options?: PiTasksCallOptions): Task {
    return this.service.upsertTask(input, this.access(options));
  }

  reorderTasks(input: ReorderTasksInput, options?: PiTasksCallOptions): Task[] {
    return this.service.reorderTasks(input, this.access(options));
  }

  deleteTask(
    input: DeleteTaskInput | string,
    options?: PiTasksCallOptions,
  ): Task {
    return this.service.deleteTask(
      normalizeDeleteTaskInput(input),
      this.access(options),
    );
  }

  claimNextTask(
    input: ClaimNextTaskInput,
    options?: PiTasksCallOptions,
  ): ClaimResult {
    return this.service.claimNextTask(input, this.access(options));
  }

  refreshClaim(input: RefreshClaimInput, options?: PiTasksCallOptions): Task {
    return this.service.refreshClaim(input, this.access(options));
  }

  releaseExpiredClaims(
    input: ReleaseExpiredClaimsInput = {},
    options?: PiTasksCallOptions,
  ): ReleaseExpiredClaimsResult {
    return this.service.releaseExpiredClaims(input, this.access(options));
  }

  getPrivateAccessEvents(
    input: PrivateAccessEventsGetInput = {},
    options?: PiTasksCallOptions,
  ): PrivateAccessEvent[] {
    return this.service.getPrivateAccessEvents(input, this.access(options));
  }

  dispatchCompactTool(
    toolName: CompactToolName,
    input: unknown,
    options?: PiTasksCallOptions,
  ): unknown {
    return dispatchCompactTaskTool(
      this.service,
      toolName,
      input,
      this.access(options),
    );
  }

  getHelp(action: TaskHelpAction = "all"): Record<string, unknown> {
    return getTaskHelp({ action });
  }

  static resolveDbPath(cwd?: string): string {
    return resolveDbPath(cwd);
  }

  private access(options?: PiTasksCallOptions): AccessOptions {
    const privateBypass = options?.privateBypass ?? this.privateBypass;
    return {
      actor: {
        agentId: options?.agentId ?? this.agentId,
        source: options?.source ?? this.source,
      },
      ...(privateBypass ? { privateBypass } : {}),
    };
  }
}

function resolvePublicActor(
  options: Pick<PiTasksOptions, "agentId" | "source">,
): ActorContext {
  const envAgentId = process.env.PI_TASKS_AGENT_ID?.trim();
  return {
    agentId:
      options.agentId?.trim() ||
      envAgentId ||
      `pi-tasks-public:${shortHash(`${hostname()}:${process.pid}`)}`,
    source: options.source ?? "unknown",
  };
}

function normalizeTaskListInput(
  input: GetTaskListInput | string,
): GetTaskListInput {
  return typeof input === "string" ? { list_id: input } : input;
}

function normalizeDeleteTaskListInput(
  input: DeleteTaskListInput | string,
): DeleteTaskListInput {
  return typeof input === "string" ? { list_id: input } : input;
}

function normalizeTaskInput(input: GetTaskInput | string): GetTaskInput {
  return typeof input === "string" ? { task_id: input } : input;
}

function normalizeDeleteTaskInput(
  input: DeleteTaskInput | string,
): DeleteTaskInput {
  return typeof input === "string" ? { task_id: input } : input;
}
