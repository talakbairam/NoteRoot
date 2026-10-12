import * as vscode from "vscode";
import { PathGuard } from "../services/PathGuard";
import { uriOfTab } from "../util/tabUri";

/**
 * Closes the editor tabs of deleted files. VS Code only does this by itself when the user enabled
 * `workbench.editor.closeOnFileDelete`. Tabs with unsaved changes stay open: closing them would
 * ask to save, which would bring the deleted file back.
 */
export async function closeTabsOf(
  deleted: readonly vscode.Uri[],
  pathGuard: PathGuard
): Promise<void> {
  const tabs = vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => {
      const uri = uriOfTab(tab);
      return (
        !tab.isDirty &&
        uri !== undefined &&
        deleted.some((gone) => pathGuard.isSameOrInside(gone, uri))
      );
    });
  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs, true);
  }
}
