import { registerPiTaskCommands } from "./commands.js";
import { registerPiTaskTools } from "./tools.js";
export default function piTasksExtension(pi) {
    registerPiTaskTools(pi);
    registerPiTaskCommands(pi);
}
//# sourceMappingURL=index.js.map