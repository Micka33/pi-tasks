import { registerPiTaskAutocomplete } from "./autocomplete.js";
import { registerPiTaskCommands } from "./commands.js";
import { registerPiTasksDashboardWidget } from "./dashboard-widget.js";
import { registerPiTaskTools } from "./tools.js";
export default function piTasksExtension(pi) {
    registerPiTaskTools(pi);
    registerPiTaskCommands(pi);
    registerPiTaskAutocomplete(pi);
    registerPiTasksDashboardWidget(pi);
}
//# sourceMappingURL=index.js.map