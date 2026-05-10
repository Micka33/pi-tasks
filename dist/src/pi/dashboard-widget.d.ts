import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type DashboardData } from "../core/dashboard.js";
type WidgetMode = "compact" | "full";
export declare function registerPiTasksDashboardWidget(pi: ExtensionAPI): void;
export declare function formatDashboard(dashboard: DashboardData, mode: WidgetMode): string[];
export {};
