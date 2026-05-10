import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiTaskAutocomplete } from "./autocomplete.js";
import { registerPiTaskCommands } from "./commands.js";
import { registerPiTasksDashboardWidget } from "./dashboard-widget.js";
import { registerPiTaskTools } from "./tools.js";

export default function piTasksExtension(pi: ExtensionAPI): void {
  registerPiTaskTools(pi);
  registerPiTaskCommands(pi);
  registerPiTaskAutocomplete(pi);
  registerPiTasksDashboardWidget(pi);
}
