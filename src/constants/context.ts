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
  /** True while the Notes tree marks the items that are left out of automatic tagging. Swaps Show No-Tag Items and Hide No-Tag Items in the menu. */
  showNoTag: "noteRoot.showNoTag",
  /** True while the Notes tree marks the items that the sync encrypts. Swaps Show Encrypted Items and Hide Encrypted Items in the menu. */
  showEncrypted: "noteRoot.showEncrypted",
  /** True while the Notes tree marks the items that the sync leaves alone. Swaps Show Not-Synced Items and Hide Not-Synced Items in the menu. */
  showUnsynced: "noteRoot.showUnsynced",
  /** True while the Pinned group of the Notes tree shows its notes (it is on). Swaps its turn on and turn off buttons. */
  pinnedOn: "noteRoot.pinnedOn",
  /** True while the Recent group shows its notes and notes opened are remembered. Swaps its turn on and turn off buttons. */
  recentOn: "noteRoot.recentOn",
  /** True while the Favorites group of the Notes tree shows its items (it is on). Swaps its turn on and turn off buttons. */
  favoritesOn: "noteRoot.favoritesOn",
  /** True while this notes folder is connected to a GitHub repository. Drives the sync commands of the palette. */
  syncConnected: "noteRoot.syncConnected",
  /** True while the connected target is encrypted. Shows the key commands of the Actions menu. */
  syncEncrypted: "noteRoot.syncEncrypted",
  /** True while the connected target encrypts only the files the user chose. Shows Encrypt in Sync and Don't Encrypt in Sync in the tree menu. */
  syncCustom: "noteRoot.syncCustom",
  /** True while NoteRoot checks by itself whether the repository has a new commit. Swaps the two menu entries. */
  syncAutoCheck: "noteRoot.syncAutoCheck",
} as const;

export const ViewIds = {
  container: "noteRoot",
  tree: "noteRoot.tree",
  labels: "noteRoot.labels",
  quickNote: "noteRoot.quickNote",
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
  /** Whether the Notes tree marks the items left out of automatic tagging (per machine). */
  showNoTag: "noteRoot.showNoTag",
  /** Whether the Notes tree marks the items that the sync encrypts (per machine). */
  showEncrypted: "noteRoot.showEncrypted",
  /** Whether the Notes tree marks the items that the sync leaves alone (per machine). */
  showUnsynced: "noteRoot.showUnsynced",
  /** Whether the Pinned group shows its notes (per machine; on when nothing is stored). */
  pinnedOn: "noteRoot.pinnedOn",
  /** Whether the Recent group shows its notes and remembers new ones (per machine; on when nothing is stored). */
  recentOn: "noteRoot.recentOn",
  /** Whether the Favorites group shows its items (per machine; on when nothing is stored). */
  favoritesOn: "noteRoot.favoritesOn",
  /** Where the Google client of the user is kept when it is typed: `local` or `config` (per machine). */
  googleClientPlace: "noteRoot.googleClientPlace",
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
