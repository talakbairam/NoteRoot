/** Context keys, view IDs and state keys. */

export const ContextKeys = {
  /** One of {@link RootState}. Drives the `viewsWelcome` of the tree. */
  state: "noteRoot.state",
  /** True when the root folder is configured and exists (state `empty` or `ready`). */
  hasRoot: "noteRoot.hasRoot",
  /** True while the Advanced mode of the Quick Note box is on. Switches the title bar button. */
  advanced: "noteRoot.advanced",
  /** True while every note file is offered as a category. Switches the title bar button. */
  autoCategories: "noteRoot.autoCategories",
  /** True while text that matches a tag pattern becomes a tag. Switches the title bar button. */
  autoTagPatterns: "noteRoot.autoTagPatterns",
  /** True while the file in the active editor is a note of the notes folder. Shows "Move to…" in the editor menus. */
  activeInRoot: "noteRoot.activeInRoot",
  /** True while the Notes tree also shows the files and folders that the exclude patterns hide. Swaps Show Hidden Items and Hide Hidden Items in the menu. */
  showHidden: "noteRoot.showHidden",
  /** True while this notes folder is connected to a GitHub repository. Drives the Actions view and its buttons. */
  syncConnected: "noteRoot.syncConnected",
  /** True while the connected target is encrypted. Shows the key commands of the Actions menu. */
  syncEncrypted: "noteRoot.syncEncrypted",
  /** True while NoteRoot checks by itself whether the repository has a new commit. Swaps the two menu entries. */
  syncAutoCheck: "noteRoot.syncAutoCheck",
} as const;

export const ViewIds = {
  container: "noteRoot",
  tree: "noteRoot.tree",
  labels: "noteRoot.labels",
  settings: "noteRoot.settings",
  recent: "noteRoot.recent",
  quickNote: "noteRoot.quickNote",
  sync: "noteRoot.sync",
} as const;

/** Keys used in `globalState` (per machine). */
export const StateKeys = {
  treeState: "noteRoot.treeState",
  quickNoteDraft: "noteRoot.quickNoteDraft",
  recentNotes: "noteRoot.recentNotes",
  /** Whether the Advanced mode of the Quick Note box is on (per machine). */
  advancedMode: "noteRoot.advancedMode",
  /** Whether every note file is offered as a category (per machine). */
  autoCategories: "noteRoot.autoCategories",
  /** Whether text that matches a tag pattern becomes a tag (per machine). */
  autoTagPatterns: "noteRoot.autoTagPatterns",
  /** Set once the Get Started walkthrough was opened automatically. */
  /** Whether the Notes tree shows the hidden files and folders (per machine). */
  showHidden: "noteRoot.showHidden",
  walkthroughShown: "noteRoot.walkthroughShown",
  /** The GitHub repository of each notes folder and the last state that was synced (per machine). */
  sync: "noteRoot.sync",
  /** Whether the repository is checked for a new commit by itself (per machine). */
  syncAutoCheck: "noteRoot.syncAutoCheck",
} as const;

export const WALKTHROUGH_ID = "noteRoot.gettingStarted";

export const RootStates = {
  noRoot: "noRoot",
  missing: "missing",
  empty: "empty",
  ready: "ready",
} as const;

export type RootState = (typeof RootStates)[keyof typeof RootStates];
