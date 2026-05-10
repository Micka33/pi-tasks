import { DatabaseSync } from "node:sqlite";
export declare const SCHEMA_VERSION = 2;
export declare function resolveDbPath(cwd?: string): string;
export declare function openTaskDatabase(dbPath?: string): DatabaseSync;
export declare function migrate(db: DatabaseSync): void;
export declare function withImmediateTransaction<T>(db: DatabaseSync, fn: () => T): T;
