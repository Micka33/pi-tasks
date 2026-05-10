import { z } from "zod/v4";
export declare const taskListsSchema: z.ZodObject<{
    action: z.ZodEnum<{
        create: "create";
        find: "find";
        get: "get";
        delete: "delete";
    }>;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const taskItemsSchema: z.ZodObject<{
    action: z.ZodEnum<{
        create: "create";
        delete: "delete";
        add_many: "add_many";
        update: "update";
        reorder: "reorder";
    }>;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const taskClaimsSchema: z.ZodObject<{
    action: z.ZodEnum<{
        claim_next: "claim_next";
        refresh: "refresh";
        release_expired: "release_expired";
    }>;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const taskAuditSchema: z.ZodObject<{
    action: z.ZodEnum<{
        get: "get";
    }>;
    params: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const taskHelpSchema: z.ZodObject<{
    action: z.ZodOptional<z.ZodEnum<{
        all: "all";
        workflow: "workflow";
        schemas: "schemas";
        examples: "examples";
    }>>;
}, z.core.$strip>;
