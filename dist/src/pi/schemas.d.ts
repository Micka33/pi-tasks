import { Type } from "typebox";
export declare const TaskListsParams: Type.TObject<{
    action: Type.TUnsafe<"create" | "find" | "get" | "delete">;
    params: Type.TOptional<Type.TAny>;
}>;
export declare const TaskItemsParams: Type.TObject<{
    action: Type.TUnsafe<"create" | "delete" | "add_many" | "update" | "reorder">;
    params: Type.TOptional<Type.TAny>;
}>;
export declare const TaskClaimsParams: Type.TObject<{
    action: Type.TUnsafe<"claim_next" | "refresh" | "release_expired">;
    params: Type.TOptional<Type.TAny>;
}>;
export declare const TaskAuditParams: Type.TObject<{
    action: Type.TUnsafe<"get">;
    params: Type.TOptional<Type.TAny>;
}>;
export declare const TaskHelpParams: Type.TObject<{
    action: Type.TOptional<Type.TUnsafe<"all" | "workflow" | "schemas" | "examples">>;
}>;
