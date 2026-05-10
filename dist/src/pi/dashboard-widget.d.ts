import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { type DashboardData } from "../core/dashboard.js";
type WidgetMode = "compact" | "full";
export declare function registerPiTasksDashboardWidget(pi: ExtensionAPI): void;
export declare function getTaskWidgetArgumentCompletions(prefix: string): AutocompleteItem[] | null;
export declare function formatDashboard(dashboard: DashboardData, mode: WidgetMode): string[];
export {};
