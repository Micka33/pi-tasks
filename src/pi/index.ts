import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiTaskCommands } from "./commands.js";
import { registerPiTaskTools } from "./tools.js";

export default function piTasksExtension(pi: ExtensionAPI): void {
  registerPiTaskTools(pi);
  registerPiTaskCommands(pi);
}
