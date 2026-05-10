import { Type } from "typebox";
export declare const TaskListCreateParams: Type.TObject<{
    id: Type.TOptional<Type.TString>;
    name: Type.TString;
    scope_type: Type.TUnsafe<"workspace" | "thread" | "agent" | "global" | "custom">;
    scope_key: Type.TString;
    visibility: Type.TOptional<Type.TUnsafe<"private" | "shared">>;
    owner_agent_id: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
}>;
export declare const TaskListsFindParams: Type.TObject<{
    scope_type: Type.TOptional<Type.TUnsafe<"workspace" | "thread" | "agent" | "global" | "custom">>;
    scope_key: Type.TOptional<Type.TString>;
    visibility: Type.TOptional<Type.TUnsafe<"private" | "shared">>;
    owner_agent_id: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
    created_by_agent_id: Type.TOptional<Type.TString>;
    name: Type.TOptional<Type.TString>;
    include_deleted: Type.TOptional<Type.TBoolean>;
    include_inaccessible_private: Type.TOptional<Type.TBoolean>;
}>;
export declare const TaskListGetParams: Type.TObject<{
    list_id: Type.TString;
    statuses: Type.TOptional<Type.TArray<Type.TUnsafe<"todo" | "in_progress" | "blocked" | "done" | "canceled">>>;
    include_deleted: Type.TOptional<Type.TBoolean>;
}>;
export declare const TaskCreateParams: Type.TObject<{
    id: Type.TOptional<Type.TString>;
    list_id: Type.TString;
    title: Type.TString;
    description: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
    notes: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
    position: Type.TOptional<Type.TNumber>;
    assigned_to_agent_id: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
}>;
export declare const TaskAddManyParams: Type.TObject<{
    list_id: Type.TString;
    tasks: Type.TArray<Type.TObject<{
        id: Type.TOptional<Type.TString>;
        title: Type.TString;
        description: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
        notes: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
        assigned_to_agent_id: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
    }>>;
}>;
export declare const TaskClaimNextParams: Type.TObject<{
    list_id: Type.TString;
    claim_ttl_seconds: Type.TOptional<Type.TNumber>;
    release_expired_first: Type.TOptional<Type.TBoolean>;
}>;
export declare const TaskClaimRefreshParams: Type.TObject<{
    task_id: Type.TString;
    claim_ttl_seconds: Type.TOptional<Type.TNumber>;
}>;
export declare const TaskUpdateParams: Type.TObject<{
    task_id: Type.TString;
    title: Type.TOptional<Type.TString>;
    description: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
    notes: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
    status: Type.TOptional<Type.TUnsafe<"todo" | "in_progress" | "blocked" | "done" | "canceled">>;
    assigned_to_agent_id: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
    outcome: Type.TOptional<Type.TUnion<[Type.TString, Type.TNull]>>;
}>;
export declare const TaskReorderParams: Type.TObject<{
    list_id: Type.TString;
    task_ids: Type.TArray<Type.TString>;
}>;
export declare const TaskReleaseExpiredClaimsParams: Type.TObject<{
    list_id: Type.TOptional<Type.TString>;
}>;
export declare const TaskDeleteParams: Type.TObject<{
    task_id: Type.TString;
}>;
