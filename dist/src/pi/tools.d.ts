import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export declare function registerPiTaskTools(pi: ExtensionAPI): void;
export declare function errorResult(error: unknown): {
    content: {
        type: "text";
        text: string;
    }[];
    details: Record<string, unknown>;
};
