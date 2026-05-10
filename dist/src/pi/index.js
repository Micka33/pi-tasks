import { registerPiTaskCommands } from "./commands.js";
import { registerPiTasksDashboardWidget } from "./dashboard-widget.js";
import { registerPiTaskTools } from "./tools.js";
export default function piTasksExtension(pi) {
    registerPiTaskTools(pi);
    registerPiTaskCommands(pi);
    registerPiTasksDashboardWidget(pi);
}
//# sourceMappingURL=index.js.map