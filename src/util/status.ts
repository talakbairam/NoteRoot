import * as vscode from "vscode";

let durationMs: () => number = () => 3000;

/** Wiring only: tells how long a status bar message stays (the setting can change, so it is asked each time). */
export function configureStatusMessages(getDurationMs: () => number): void {
  durationMs = getDurationMs;
}

/** Shows a short message in the status bar. `scale` makes it stay longer (2 = twice as long). */
export function showStatus(message: string, scale = 1): void {
  vscode.window.setStatusBarMessage(message, durationMs() * scale);
}
