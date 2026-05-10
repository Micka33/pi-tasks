import { z } from "zod/v4";
export declare const taskListCreateSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    scope_type: z.ZodEnum<{
        workspace: "workspace";
        thread: "thread";
        agent: "agent";
        global: "global";
        custom: "custom";
    }>;
    scope_key: z.ZodString;
    visibility: z.ZodOptional<z.ZodEnum<{
        private: "private";
        shared: "shared";
    }>>;
    owner_agent_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const taskListsFindSchema: z.ZodObject<{
    scope_type: z.ZodOptional<z.ZodEnum<{
        workspace: "workspace";
        thread: "thread";
        agent: "agent";
        global: "global";
        custom: "custom";
    }>>;
    scope_key: z.ZodOptional<z.ZodString>;
    visibility: z.ZodOptional<z.ZodEnum<{
        private: "private";
        shared: "shared";
    }>>;
    owner_agent_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    created_by_agent_id: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    include_deleted: z.ZodOptional<z.ZodBoolean>;
    include_inaccessible_private: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const taskListGetSchema: z.ZodObject<{
    list_id: z.ZodString;
    statuses: z.ZodOptional<z.ZodArray<z.ZodEnum<{
        todo: "todo";
        in_progress: "in_progress";
        blocked: "blocked";
        done: "done";
        canceled: "canceled";
    }>>>;
    include_deleted: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const taskCreateSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    list_id: z.ZodString;
    title: z.ZodString;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    notes: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    position: z.ZodOptional<z.ZodNumber>;
    assigned_to_agent_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const taskAddManySchema: z.ZodObject<{
    list_id: z.ZodString;
    tasks: z.ZodArray<z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        title: z.ZodString;
        description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        notes: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        assigned_to_agent_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const taskClaimNextSchema: z.ZodObject<{
    list_id: z.ZodString;
    claim_ttl_seconds: z.ZodOptional<z.ZodNumber>;
    release_expired_first: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const taskClaimRefreshSchema: z.ZodObject<{
    task_id: z.ZodString;
    claim_ttl_seconds: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const taskUpdateSchema: z.ZodObject<{
    task_id: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    notes: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodEnum<{
        todo: "todo";
        in_progress: "in_progress";
        blocked: "blocked";
        done: "done";
        canceled: "canceled";
    }>>;
    assigned_to_agent_id: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    result: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const taskReorderSchema: z.ZodObject<{
    list_id: z.ZodString;
    task_ids: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const taskReleaseExpiredClaimsSchema: z.ZodObject<{
    list_id: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const taskDeleteSchema: z.ZodObject<{
    task_id: z.ZodString;
}, z.core.$strip>;
