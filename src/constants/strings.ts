/**
 * All user-facing text shown from code. Keeping it here makes a later
 * localization pass a single-file job. (Texts in package.json, such as
 * titles and welcome views, are handled by package.nls.json later.)
 */

/** An example of what a tag pattern finds: `*`, `#` and `[...]` become 123, `@` becomes abc (`ab-#` gives `ab-123`). */
function patternExample(pattern: string): string {
  return pattern.replace(/\[[^\]]*\]|[*#]/g, "123").replace(/@/g, "abc");
}

export const Strings = {
  extensionName: "NoteRoot",

  common: {
    showLogs: "Show Logs",
    genericFailure: "NoteRoot could not complete that action. See the logs for details.",
  },

  root: {
    openDialogTitle: "Select Notes Folder",
    openDialogLabel: "Select Notes Folder",
    selectFolderAction: "Select Notes Folder",
    noRootSelected: "No notes folder is selected.",
    notFound:
      "The notes folder was not found. It may have been moved or deleted, or its drive may be disconnected.",
    invalidPath: (path: string): string =>
      `The notes folder path "${path}" is not an absolute path.`,
    unsupportedLocation: "The notes folder must be a regular folder on disk.",
    recreateConfirm: (path: string): string => `Create the notes folder again at "${path}"?`,
    recreateDetail:
      "If this folder is on an external drive, connect the drive first. Otherwise the folder is created on the wrong disk.",
    recreateAction: "Create Folder",
    recreateNotNeeded: "The notes folder already exists.",
    recreated: (path: string): string => `Notes folder created at "${path}".`,
  },

  config: {
    openConfigAction: "Open Config File",
    corrupt:
      "The NoteRoot config file is invalid. NoteRoot keeps working with default values and will not change the file.",
    unreadable:
      "The NoteRoot config file could not be read. NoteRoot keeps working with default values.",
    newer:
      "The NoteRoot config file was created by a newer version of NoteRoot. It will not be modified.",
    invalidJson: "The config file does not contain valid JSON.",
    invalidShape: "The config file does not have the expected structure.",
  },

  syncRow: {
    label: (service: string): string => `${service} Sync`,
    notConnected: "Not connected",
    connectTip: "Sync: not connected. Right-click to connect",
    cleanTip: "Sync: everything is in sync. Right-click for the actions",
    dirtyTip: "Sync: there are changes. Right-click to push",
  },
  pinnedRecent: {
    pinned: "Pinned",
    recent: "Recent",
    off: "off",
    separator: "Separator",
    pinnedOn: "Pinned notes are shown again.",
    pinnedOff: "Pinned notes are hidden. They stay pinned.",
    recentOn: "Recent notes are shown again and new ones are remembered.",
    recentOff: "Recent notes are hidden and new ones are not remembered.",
  },
  tree: {
    open: "Open",
    openAnyway: "Open",
    largeFileConfirm: (size: string): string =>
      `This file is ${size}. Opening it may slow down VS Code. Open anyway?`,
    hiddenMark: "hidden",
    noTagMark: "no tags",
    unsyncedMark: "not synced",
    encryptedMark: "encrypted",
    encryptedShown: 'Items that the sync encrypts are marked "encrypted".',
    encryptedHidden: 'The "encrypted" marks are hidden again.',
    unsyncedShown: 'Items that the sync leaves alone are marked "not synced".',
    unsyncedHidden: 'The "not synced" marks are hidden again.',
    hiddenShown: 'Hidden items are shown, marked "hidden".',
    hiddenHidden: "Hidden items are hidden again.",
    noTagShown: 'Items left out of automatic tagging are marked "no tags".',
    noTagHidden: 'The "no tags" marks are hidden again.',
    tooltipPath: "Path",
    tooltipSize: "Size",
    tooltipModified: "Modified",
    tooltipSymlink: "Symbolic link to a folder (not expanded)",
    expandAllLimit: (count: number): string =>
      `Expanded the first ${count} folders. The notes folder has more; expand the rest by hand.`,
  },

  sort: {
    title: "Sort Notes By",
    name: "Name",
    nameDetail: "A to Z, numbers in natural order",
    modified: "Date modified",
    modifiedDetail: "Newest first",
    current: "current",
  },

  /** The Tags & Categories page: what the view has, in an editor tab, to review and change. */
  labelsPage: {
    title: "NoteRoot Tags & Categories",
    intro:
      "Review and change your categories, tags and the automatic features. A change is saved as soon as you make it.",
    refresh: "Refresh",
    searchLabel: "Search categories, tags and patterns",
    searchPlaceholder: "Search",
    noMatches: "Nothing matches.",
    needsAdvanced:
      "The Advanced options of the Quick Note panel are off. Categories, tags and the automatic features only work while they are on.",
    counting: "Counting…",
    categories: "Categories",
    newCategory: "New category…",
    noCategories: "No categories yet.",
    usesQuickNoteFile: "Quick Note file",
    notCreated: "not created yet",
    everyFile: "Every file",
    everyFileSwitch: "Category for every file",
    everyFileHint: "Every note file is a category that writes to that file.",
    everyFileNone: "No note files yet.",
    everyFileMore: "More files exist than are listed.",
    tags: "Tags",
    newTag: "New tag…",
    noTags: "No tags yet.",
    patterns: "Tag Patterns",
    patternsSwitch: "Tag from pattern",
    patternsHint:
      "Text of a note that matches a pattern becomes a tag when the note is saved. The tag is written in the note only.",
    newPattern: "Add pattern…",
    noPatterns: "No patterns yet.",
    noMatchesYet: "No matches yet.",
    keyword: "Keyword",
    changeFile: "Change file…",
    removeFile: "Remove file",
    setKeyword: "Keyword…",
    removeKeyword: "Remove keyword",
    rename: "Rename…",
    delete: "Delete",
    edit: "Change…",
    noteOne: "1 note",
    noteMany: "{n} notes",
    tagOne: "1 tag",
    tagMany: "{n} tags",
    on: "On",
    off: "Off",
  },
  /** The Settings page: every setting in an editor tab, to review and change. */
  settingsPage: {
    title: "NoteRoot Settings",
    intro: "Review and change every NoteRoot setting. A change is saved as soon as you make it.",
    advancedNote:
      "Limits and fine tuning that most people never change. The defaults are fine; they are here for when you need them.",
    searchLabel: "Search settings",
    searchPlaceholder: "Search settings",
    onlyChanged: "Only changed",
    noMatches: "No settings match.",
    changed: "changed",
    sourceFolder: "this folder",
    sourceUser: "your settings",
    reset: "Reset",
    forgetKey: "Forget",
    change: "Change…",
    apply: "Apply",
    listHint: "One entry per line.",
    on: "On",
    off: "Off",
    defaultNone: "none",
    units: { mb: "MB", ms: "ms", px: "px", s: "s", count: "" },
    saved: "Saved",
    defaultLabel: "Default:",
    toolsTitle: "Files and logs",
    tools: {
      openConfigFile: {
        label: "Config file",
        description:
          "The file .noteroot/config.json in the notes folder, where the categories, tags, pins and the settings that travel with the notes are kept.",
        button: "Open",
      },
      showLogs: {
        label: "Logs",
        description: "The NoteRoot output, to see what it did and why something failed.",
        button: "Show",
      },
      openAllSettings: {
        label: "All settings in VS Code",
        description: "Opens the VS Code Settings editor with the NoteRoot settings.",
        button: "Open",
      },
    },
  },
  settingsView: {
    groups: {
      notes: "Notes",
      tree: "Tree & Search",
      quickNote: "Quick Note",
      tags: "Tags & Categories",
      sync: "Sync & Encryption",
      advanced: "Advanced",
    },
    subgroups: {
      synced: "What is synced",
      accounts: "Accounts",
      saved: "Saved sign-ins and keys",
      limits: "Limits",
      tuning: "Fine tuning",
      startup: "On at the start",
    },
    items: {
      rootPath: {
        label: "Notes folder",
        description: "The folder where all your notes are stored. Click to choose another one.",
      },
      sortOrder: {
        label: "Sort notes by",
        description:
          "How the notes tree orders the items inside a folder. Folders always come first.",
      },
      defaultExtension: {
        label: "Default extension",
        description:
          "Added to a new file when its name has no extension. It starts with a dot, for example .md.",
      },
      excludePatterns: {
        label: "Hidden files and folders",
        description:
          "Names and patterns (with * and ?) of files and folders that the notes tree hides.",
      },
      largeFileThresholdMB: {
        label: "Large file warning",
        description:
          "Ask before opening a file bigger than this many MB. 0 turns the question off.",
      },
      quickNoteFile: {
        label: "Quick Note file",
        description: "The file that receives Quick Notes. Click to choose another one.",
      },
      quickNotePosition: {
        label: "Where new notes go",
        description: "Each new Quick Note is added at the end of its file or at the start of it.",
      },
      quickNoteHeadingLevel: {
        label: "Heading level",
        description:
          "How the heading above each Quick Note is written: as a Markdown heading of this level (# to ####), or as plain text.",
      },
      quickNoteTimestampFormat: {
        label: "Date and time format",
        description:
          "The date and time in the heading above each Quick Note. YYYY, MM, DD, HH, mm and ss stand for the parts of the date. Empty means no heading.",
      },
      quickNoteTagLine: {
        label: "Line with the tags",
        description:
          "The line that carries the tags of a Quick Note. {tags} stands for the tags, for example **Tags:** {tags}.",
      },
      tagOnSave: {
        label: "Tag when saving",
        description:
          "When you save a note (Ctrl+S, not the automatic save), the tags it gets by itself are written into the notes you changed. In a file of Quick Notes, only the entries you changed.",
      },
      noteFileTypes: {
        label: "File types that count as notes",
        description:
          "The extensions (without a dot, for example md or txt) of the files that Category for every file offers as categories. Saved with the notes folder.",
      },
      maxRecentNotes: {
        label: "Recent notes to keep",
        description:
          "How many notes the Recent group of the Notes tree remembers (1 to 100). Saved with the notes folder.",
      },
      maxTextFileSizeMB: {
        label: "Largest file to read",
        description:
          "The search, the tag scan and Tag when saving skip files bigger than this many MB (0.1 to 50). Saved with the notes folder.",
      },
      maxSearchResults: {
        label: "Most search results",
        description:
          "The search stops after this many results (10 to 1000). Saved with the notes folder.",
      },
      undoSteps: {
        label: "Undo steps",
        description:
          "How many renames and moves Undo remembers (1 to 100). Saved with the notes folder.",
      },
      doubleClickMs: {
        label: "Double click time",
        description:
          "Two clicks on a note in the tree within this many milliseconds open it as a permanent tab (150 to 1000). Saved with the notes folder.",
      },
      statusMessageSeconds: {
        label: "Message time",
        description:
          "How many seconds the messages in the status bar stay (1 to 30). Saved with the notes folder.",
      },
      minSearchLength: {
        label: "Shortest search",
        description:
          "The search starts after this many characters (1 to 10). Saved with the notes folder.",
      },
      caseSensitiveSearch: {
        label: "Case-sensitive search",
        description:
          "The search tells capital letters from small ones. Saved with the notes folder.",
      },
      sortReversed: {
        label: "Reverse the sort order",
        description:
          "Turns each group around: Z to A, or oldest first. Folders stay first. Saved with the notes folder.",
      },
      confirmDelete: {
        label: "Ask before deleting",
        description:
          "Ask before items are moved to the Trash. The Quick Note file is always asked about. Saved with the notes folder.",
      },
      minKeywordLength: {
        label: "Shortest keyword",
        description:
          "A keyword needs at least this many characters (1 to 20). Saved with the notes folder.",
      },
      maxLabelNameLength: {
        label: "Longest category or tag name",
        description:
          "The most characters in the name of a new category or tag (10 to 200). Saved with the notes folder.",
      },
      maxPatternTags: {
        label: "Tags from patterns per note",
        description:
          "The most tags that the tag patterns give to one note (1 to 100). It applies to the Quick Note box when the panel is opened again. Saved with the notes folder.",
      },
      maxAutoCategories: {
        label: "Most categories from files",
        description:
          "The most files that Category for every file offers as categories (10 to 2000). Saved with the notes folder.",
      },
      startAdvancedOn: {
        label: "Advanced options at the start",
        description:
          "Whether Advanced options are on on a computer where you never turned them on or off. Saved with the notes folder.",
      },
      startAutoCategoriesOn: {
        label: "Category for every file at the start",
        description:
          "Whether it is on on a computer where you never turned it on or off. Saved with the notes folder.",
      },
      startAutoTagPatternsOn: {
        label: "Tag from pattern at the start",
        description:
          "Whether it is on on a computer where you never turned it on or off. Saved with the notes folder.",
      },
      noTagPatterns: {
        label: "Files and folders without tagging",
        description:
          "Names and patterns (with * and ?) of files and folders that automatic tagging leaves alone: Run Tagging and Tag when saving skip them. Don't Auto-Tag in the tree adds an entry. Saved with the notes folder.",
      },
      syncAutoMessage: {
        label: "Push without asking for a message",
        description:
          "Push does not ask for the message of the new version: it uses the default one (NoteRoot sync, with the date and the time). On by default. Saved with the notes folder.",
      },
      syncIgnorePatterns: {
        label: "Files and folders not synced",
        description:
          "The sync leaves these alone, with every service: they are not sent, not brought and not listed in the changes, but they stay in the tree and the search. One pattern per line, like the list of hidden items (/folder, name, *.tmp). A file that is already online is not deleted from there. Saved with the notes folder.",
      },
      dropboxAppKey: {
        label: "Dropbox app key",
        description:
          "The App key of your own Dropbox app (Dropbox App Console ▸ Settings). The Dropbox sync needs it to sign in; it is not a secret. Saved with the notes folder.",
      },
      gitlabAddress: {
        label: "GitLab address",
        description:
          "The address of the GitLab that the GitLab sync uses: https://gitlab.com, or the address of your company's GitLab. Only https addresses are used. Saved with the notes folder; the token is asked when you connect and kept on this computer.",
      },
      savedGitlabToken: {
        label: "Saved GitLab token",
        description:
          "Whether the personal access token of GitLab is saved in the secret storage of VS Code on this computer (never shown). Reset forgets it: the next Connect asks for a token.",
      },
      savedGoogleSignIn: {
        label: "Saved Google sign-in",
        description:
          "Whether the sign-in to Google is saved in the secret storage of VS Code on this computer (never shown). Reset forgets it: the next Connect opens the browser.",
      },
      savedDropboxSignIn: {
        label: "Saved Dropbox sign-in",
        description:
          "Whether the sign-in to Dropbox is saved in the secret storage of VS Code on this computer (never shown). Reset forgets it: the next Connect opens the browser.",
      },
      savedMasterKeys: {
        label: "Saved keys of encrypted sync",
        description:
          "How many keys made from a master key are saved in the secret storage of VS Code on this computer (the master key itself is never saved). Reset forgets them all: the master key is asked again when it is needed.",
      },
      googleClientPlace: {
        label: "Google client: where to keep it",
        description:
          "Where the id and the secret of your Google client (Google Drive sync) are kept: in the config file of the notes folder (the default: .noteroot/config.json, so they travel with the notes; the Sync sends that file too, so do not use it for a public repository), or on this computer only (a file of the extension). Never in your VS Code settings.",
      },
      googleClientId: {
        label: "Google client id",
        description:
          "The Client ID of your own Google project (OAuth client of type Desktop app) for the Google Drive sync. Empty: the one that comes with NoteRoot, if there is one. Changing it signs you out of Google.",
      },
      googleClientSecret: {
        label: "Google client secret",
        description:
          "The Client secret of the same project. It is hidden here and never shown again; type a new one to replace it, or use Reset to remove it. Changing it signs you out of Google.",
      },
      syncRows: {
        label: "Sync rows in the Notes tree",
        description:
          "Which sync services get a row at the top of the Notes tree: every service (so one that is not connected can be connected from there), only the one that is connected, or none. Saved with the notes folder.",
      },
      syncMarkedAction: {
        label: "A marked file in a plain repository",
        description:
          "What Push does with a file on the list of the files to encrypt when the repository is not encrypted: ask every time, send it as plain text, leave it out of the push, or encrypt the marked files first. Saved with the notes folder.",
      },
      encryptPatterns: {
        label: "Files and folders to encrypt in the sync",
        description:
          "Names and patterns (with * and ?) of the files and folders that the sync encrypts when the repository is set to encrypt only the chosen files. Everything else goes online as plain text. Encrypt in Sync in the tree adds an entry. Saved with the notes folder.",
      },
      noteHeader: {
        label: "Note header",
        description:
          "The lines written at the start of every new note, for example an HTML comment with fields to fill in (<!--, **Summary:** , **Jira:** , -->). One line per entry. No entries means no header. Insert Header adds it to notes that already exist. Saved with the notes folder.",
      },
      advancedMode: {
        label: "Advanced options",
        description: "Shows the Category and Tag boxes in the Quick Note panel.",
      },
      autoCategories: {
        label: "Category for every file",
        description: "Offers every note file as a category that writes to that file.",
      },
      autoTagPatterns: {
        label: "Tag from pattern",
        description:
          "Text of a note that matches a tag pattern, such as ab-*, becomes a tag when the note is saved.",
      },
    },
    on: "On",
    off: "Off",
    notSet: "Not set",
    emptyValue: "(empty)",
    noHeading: "None (no heading)",
    headerLines: (count: number): string => (count === 1 ? "1 line" : `${count} lines`),
    listCount: (count: number): string => (count === 1 ? "1 entry" : `${count} entries`),
    megabytes: (count: number): string => `${count} MB`,
    milliseconds: (count: number): string => `${count} ms`,
    pixels: (count: number): string => `${count} px`,
    seconds: (count: number): string => `${count} s`,
    thresholdOff: "Off",
    defaultValue: (value: string): string => `Default: ${value}`,
    needsFolder: "Select a notes folder first: this setting is saved with the notes folder.",
    invalidRange: (min: number, max: number, integer: boolean): string =>
      `Enter ${integer ? "a whole number" : "a number"} from ${min} to ${max}.`,
    invalidHeaderLine: "Use one line of at most 200 characters.",
    invalidFileType: "Use letters, digits, - or _ (up to 10), for example md or txt.",
    sourceFolder:
      "Saved with this notes folder (.noteroot/config.json). It wins over your VS Code setting.",
    sourceUser: "From your VS Code settings. Changing it here saves it with the notes folder.",
    changed: "changed",
    sortChoices: { name: "Name", modified: "Date modified" },
    positionChoices: { end: "End of the file", start: "Start of the file" },
    googleClientPlaceChoices: {
      local: "On this computer only",
      config: "In the notes folder (config file)",
    },
    secretSet: "••••••••",
    syncRowsChoices: {
      all: "Every service",
      connected: "Only the connected service",
      none: "None",
    },
    syncMarkedChoices: {
      ask: "Ask every time",
      plain: "Push as plain text",
      skip: "Leave them out",
      encrypt: "Encrypt the marked files",
    },
    invalidExtension: "Start with a dot, then letters, digits, - or _ (for example .md or .txt).",
    invalidFormat: "Use one line of at most 60 characters.",
    invalidNumber: "Enter a number of 0 or more.",
    savedHere: "Saved on this computer",
    notSaved: "Not saved",
    noneSaved: "None saved",
    keysSaved: (count: number): string => (count === 1 ? "1 key saved" : `${count} keys saved`),
    invalidDropboxAppKey: "Paste the App key as Dropbox shows it: letters and digits, no spaces.",
    invalidHttpsAddress: "Write an https address, for example https://gitlab.com",
    emptyNotAllowed: "This cannot be empty.",
    invalidChoice: "This value is not allowed for this setting.",
    updated: (label: string): string => `${label} updated`,
    resetDone: (label: string): string => `${label} is back to its default`,
    listEntryEmpty: "Enter a name or a pattern.",
    listEntryDuplicate: (entry: string): string => `'${entry}' is in the list already.`,
  },

  header: {
    noTemplate: "There is no header yet. Add its lines in the Settings page, row Note header.",
    noEditor: "Open a note in the editor first.",
    notInNotesFolder: "This file is not inside your notes folder.",
    nothingToAdd:
      "Nothing to add: the date format is empty and the tag line has no text of its own (see the Quick Note settings).",
    added: (file: string): string => `Header added to ${file}`,
    present: (file: string): string => `${file} has the header already.`,
    skipped: (file: string): string => `${file} is not a text note, so it was left alone.`,
    summary: (added: number, present: number, skipped: number): string =>
      `Header added to ${added} note(s); ${present} had it already${skipped > 0 ? `; ${skipped} skipped` : ""}.`,
  },
  tagging: {
    excluded: (file: string): string => `${file} is excluded from tagging, so it was left alone.`,
    folderConfirm: (count: number): string => `Run Tagging on ${count} notes?`,
    folderConfirmDetail:
      "It writes tags into the notes that earn them. Notes that are excluded from tagging are left alone.",
    folderAction: "Run Tagging",
    folderEmpty: "There are no notes to tag in it.",
    folderLimited: (limit: number): string =>
      `Only the first ${limit} notes were tagged: there are more. Run it again on a smaller folder.`,
    noTagAdded: (name: string, count: number): string =>
      count === 1
        ? `${name} is now left out of automatic tagging.`
        : `${count} items are now left out of automatic tagging.`,
    noTagAlready: "Already left out of automatic tagging.",
    noTagRemoved: (name: string, count: number): string =>
      count === 1
        ? `${name} is tagged automatically again.`
        : `${count} items are tagged automatically again.`,
    noTagRemovePattern: (pattern: string): string =>
      `"${pattern}" leaves out this item and every other item it matches. Remove this pattern from the list?`,
    noTagInsideFolder: (name: string, folder: string): string =>
      `${name} is inside the folder ${folder}, which is left out of tagging. Include that folder instead.`,
    noTagNothing: "Nothing to include: it is left out by something else.",
    running: "Running tagging…",
    noEditor: "Open a note in the editor first.",
    notInNotesFolder: "This file is not inside your notes folder.",
    added: (file: string, tags: readonly string[]): string =>
      `Tags added to the start of ${file}: ${tags.map((tag) => `#${tag}`).join(" ")}`,
    updated: (file: string, tags: readonly string[]): string =>
      `Tags added to the tag line of ${file}: ${tags.map((tag) => `#${tag}`).join(" ")}`,
    entries: (file: string, changed: number, notes: number, tags: readonly string[]): string =>
      `${file}: ${changed} of ${notes} notes got tags (${tags.map((tag) => `#${tag}`).join(" ")}).`,
    onSave: (file: string, changed: number, tags: readonly string[]): string =>
      `Saved ${file} with tags${changed > 1 ? ` in ${changed} notes` : ""}: ${tags.map((tag) => `#${tag}`).join(" ")}`,
    unchanged: (file: string, notes: number): string =>
      notes > 1
        ? `Every note of ${file} has all its tags already.`
        : `${file} has all its tags already.`,
    none: (file: string): string => `No tags found for ${file}.`,
    skipped: (file: string): string =>
      `${file} is not a text note (or it is too big), so it was left alone.`,
    summary: (tagged: number, same: number, skipped: number): string =>
      `Tagging done: ${tagged} changed, ${same} without new tags${skipped > 0 ? `, ${skipped} skipped` : ""}.`,
  },

  labelsView: {
    categories: "Categories",
    tags: "Tags",
    usesQuickNoteFile: "Quick Note file",
    usesQuickNoteFileTooltip: (name: string): string =>
      `Notes of '${name}' go to the Quick Note file. Right-click to give it a file of its own.`,
    categoryFileTooltip: (name: string, file: string): string => `Notes of '${name}' go to ${file}`,
    notCreatedYetShort: "not created yet",
    keywordTooltip: (keyword: string): string =>
      `A note that contains "${keyword}" is handled by this entry.`,
    autoGroup: "Every file",
    patterns: "Tag Patterns",
    patternTagCount: (count: number): string => (count === 1 ? "1 tag" : `${count} tags`),
    noMatchesYet: "No matches yet",
    noMatchesYetTooltip: "No note has text that matches this pattern yet.",
    patternsOff: "off",
    patternsGroupTooltip: (enabled: boolean): string =>
      enabled
        ? "Text of a note that matches a pattern becomes a tag when the note is saved. The tag is written in the note only."
        : "Tag patterns are turned off. Turn them on with the button in the title bar.",
    patternTooltip: (pattern: string): string =>
      `Finds ${patternExample(pattern)} in a note and makes the tag #${patternExample(pattern)}`,
    autoGroupTooltip: (count: number, truncated: boolean): string =>
      `Every note file is a category that writes to that file (${count}${truncated ? " of more" : ""}). Turn it off with the button in the title bar.`,
    autoOn: "Every note file is now a category.",
    autoTagOn: "Text that matches a tag pattern now becomes a tag.",
    autoTagOnNoPatterns:
      "Text that matches a tag pattern now becomes a tag. There is no pattern yet: add one with Tag Patterns….",
    autoTagOnNeedsAdvanced:
      "Text that matches a tag pattern now becomes a tag. Show the Advanced options in the Quick Note panel to use it.",
    autoTagOff: "Tags from patterns are off.",
    autoOnNeedsAdvanced:
      "Every note file is now a category. Show the Advanced options in the Quick Note panel to choose one.",
    autoOff: "Categories for every file are off.",
    noteCount: (count: number): string => (count === 1 ? "1 note" : `${count} notes`),
    tagNoteTooltip: (path: string, line: number): string => `${path}, line ${line}`,
  },

  search: {
    title: "Search Notes",
    placeholder: "Search file names and note contents",
    noResults: (query: string): string => `No results for '${query}'.`,
    limited: (count: number): string =>
      `Showing the first ${count} results. Type more to narrow them down.`,
    lineDetail: (line: number, snippet: string): string => `Line ${line}: ${snippet}`,
  },

  quickNote: {
    textAreaLabel: "Quick note text",
    placeholder: "Write or paste a note…",
    okLabel: "Save",
    saveAndOpenAriaLabel: "Save quick note and open the file",
    saveAndOpenTooltip: "Save to {file} and open it",
    okAriaLabel: "Save quick note",
    optionsTitle: "Quick Note Options",
    optionsPlaceholder: "Choose an option to change",
    optionPositionLabel: "Where new notes go",
    optionHeadingLabel: "Heading above each note",
    optionTagLineLabel: "Line with the tags",
    tagLineTitle: "Line With the Tags",
    tagLineCustom: "$(edit) Custom…",
    tagLineCustomDetail: "Write your own line. It must contain {tags}.",
    tagLineCustomPrompt: "Use {tags} where the tags go, for example **Tags:** {tags}",
    tagLineInvalid:
      "The line needs {tags}, must be one line of at most 100 characters, with no space at the start or the end.",
    tagLineExample: (template: string): string => template.replace("{tags}", "#ab-12312 #ab-222"),
    positionTitle: "Where New Notes Go",
    positionEnd: "End of the file",
    positionEndDetail: "Each new note is added below the older ones.",
    positionStart: "Start of the file",
    positionStartDetail:
      "Each new note goes on top, above the older ones (after a front matter block, if the file has one).",
    headingTitle: "Heading Above Each Note",
    headingPlain: "Plain text",
    headingPlainDetail: "Only the date and time, without a Markdown heading.",
    headingLevelLabel: (level: string): string => `${level} Heading`,
    headingLevelDetail: (level: string): string => `${level} 2026-01-31 09:30`,
    optionCurrent: "current",
    advancedTitle: "Advanced",
    categoryLabel: "Category",
    categoryPlaceholder: "Category…",
    tagLabel: "Tag",
    createCategoryOption: "Create category…",
    createTagOption: "Create tag…",
    createCategoryTitle: "Create Category",
    createTagTitle: "Create Tag",
    createCategoryPrompt: "Name of the new category",
    createTagPrompt: "Name of the new tag",
    categoryFileTitle: (name: string): string => `File for category '${name}'`,
    categoryFileTitleMany: (count: number): string => `File for ${count} categories`,
    categoryFileNone: "$(circle-slash) No separate file (use the Quick Note file)",
    categoryFilePlaceholder: "Notes of this category are saved to this file",
    changeCategoryFileTitle: "Change Category File",
    changeCategoryFilePlaceholder: "Choose a category",
    categoryUsesQuickNoteFile: "Quick Note file",
    noCategoriesYet:
      "There are no categories yet. Switch the Advanced mode on and choose Create category… in the Category list.",
    categoryFileSet: (name: string, file: string): string => `Category '${name}': ${file}`,
    categoryFileCleared: (name: string): string =>
      `Category '${name}' now uses the Quick Note file`,
    manageTitle: "Manage Categories and Tags",
    managePlaceholder: "Pick one to change it, or create a new one",
    manageCategories: "Categories",
    manageTags: "Tags",
    manageNoCategories: "No categories yet",
    manageNoTags: "No tags yet",
    manageCreateCategory: "$(add) Create category…",
    manageCreateTag: "$(add) Create tag…",
    manageChangeFile: "Change file",
    manageRename: "Rename",
    manageDelete: "Delete",
    manageMenuChangeFile: "$(file-symlink-file) Change file…",
    manageMenuRename: "$(edit) Rename…",
    manageMenuDelete: "$(trash) Delete…",
    manageMenuTitle: (kind: string, name: string): string => `${kind} '${name}'`,
    kindName: (kind: "category" | "tag"): string => (kind === "category" ? "Category" : "Tag"),
    renameTitle: (kind: "category" | "tag", name: string): string => `Rename ${kind} '${name}'`,
    renamePrompt: "New name",
    deleteConfirm: (kind: "category" | "tag", name: string): string => `Delete ${kind} '${name}'?`,
    deleteCategoryFileDetail: (file: string): string => `Its file '${file}' is not deleted.`,
    deleteAction: "Delete",
    patternsTitle: "Tag Patterns",
    patternsPlaceholder:
      "Text that matches a pattern becomes a tag. Pick one to change it, or add a new one",
    patternsNone: "No patterns yet",
    patternsAdd: "$(add) Add pattern…",
    patternsEdit: "Change",
    patternsDelete: "Delete",
    patternsRowDetail: (pattern: string): string =>
      `Finds ${patternExample(pattern)} and makes the tag #${patternExample(pattern)}`,
    patternsAddTitle: "Add Tag Pattern",
    patternsPresetPlaceholder: "What do the tags look like?",
    patternsPresetNumber: {
      label: "Prefix and number",
      detail: "Like ab-1 or ab-4021: a start that you type, then digits",
    },
    patternsPresetLetters: {
      label: "Prefix and letters",
      detail: "Like ab-x or ab-xyz: a start that you type, then letters",
    },
    patternsPresetAnything: {
      label: "Prefix and anything",
      detail: "Like ab-12, ab-x1 or ab-x-1: a start that you type, then letters, digits, - and _",
    },
    patternsPresetCustom: {
      label: "Write the pattern myself…",
      detail: "For power users: * # @ [abc] [^abc]",
    },
    patternsPresetAdvanced: "Advanced",
    patternsPrefixTitle: "Start of the tags",
    patternsPrefixPrompt:
      "The start of the tag, for example ab- (letters, digits, - or _; at least 2 characters).",
    patternsPrefixInvalid: "Use letters, digits, - or _ only.",
    patternsEditTitle: (pattern: string): string => `Change Tag Pattern '${pattern}'`,
    patternsPrompt:
      "Use * for letters, digits, - and _, # for digits only, @ for letters only, [0-9.] for the characters you allow and [^?,;] for the characters you do not allow. The tag stops at the first character that does not fit. For example ab-# finds ab-723126 in xcc-723126?abc and makes the tag #ab-723126.",
    patternsEmpty: "Enter a pattern.",
    patternsTooLong: (max: number): string =>
      `The pattern is too long (${max} characters maximum).`,
    patternsInvalid:
      "The pattern cannot contain spaces, line breaks or two wildcards (* # @ [ ]) in a row.",
    patternsBadList:
      "A [ ] list needs its closing ], at least one character inside and ranges from low to high, like [a-z]. A [ or ] that is not a list is not allowed.",
    patternsNoWildcard:
      "The pattern needs a part that changes: * (letters, digits, - _), # (digits), @ (letters) or a list like [0-9.], for example ab-#.",
    patternsTooFewLiterals: (min: number): string =>
      `Besides the wildcards (* # @ [ ]), the pattern needs at least ${min} fixed characters.`,
    patternsAlreadyThere: (pattern: string): string => `'${pattern}' is already a pattern.`,
    patternsAdded: (pattern: string): string => `Tag pattern '${pattern}' added`,
    patternsChanged: (pattern: string): string => `Tag pattern changed to '${pattern}'`,
    patternsDeleted: (pattern: string): string => `Tag pattern '${pattern}' deleted`,
    patternsDeleteConfirm: (pattern: string): string => `Delete the tag pattern '${pattern}'?`,
    patternsDeleteDetail: "Tags that were made from it in notes are not removed.",
    manageKeyword: "Set keyword",
    manageMenuKeyword: "$(quote) Set keyword…",
    keywordTitle: (kind: "category" | "tag", name: string): string =>
      `Keyword of ${kind} '${name}'`,
    keywordPrompt: (kind: "category" | "tag"): string =>
      kind === "tag"
        ? "A note that contains this text anywhere gets the tag by itself (at least 3 characters). Leave it empty to remove it."
        : "A note that contains this text anywhere is saved to this category, unless you chose another one (at least 3 characters). Leave it empty to remove it.",
    keywordTooShort: (min: number): string => `The keyword needs at least ${min} characters.`,
    keywordTooLong: (max: number): string => `The keyword is too long (${max} characters maximum).`,
    keywordInvalid: "The keyword cannot contain line breaks or other control characters.",
    keywordAlreadyUsed: (keyword: string, other: string): string =>
      `'${other}' already has the keyword '${keyword}'.`,
    keywordSet: (kind: "category" | "tag", name: string, keyword: string): string =>
      `${kind === "category" ? "Category" : "Tag"} '${name}': notes containing '${keyword}'`,
    keywordCleared: (kind: "category" | "tag", name: string): string =>
      `${kind === "category" ? "Category" : "Tag"} '${name}' has no keyword any more`,
    withKeyword: (text: string, keyword: string): string => `${text} \u00b7 "${keyword}"`,
    autoTagTooltip: "Added by itself because the note contains the keyword of this tag",
    autoCategoryPlaceholder: "{name} (by keyword)",
    labelRenamed: (kind: "category" | "tag", from: string, to: string): string =>
      `${kind === "category" ? "Category" : "Tag"} '${from}' renamed to '${to}'`,
    deleteManyConfirm: (count: number): string => `Delete ${count} categories and tags?`,
    deleteManyDetail: (names: readonly string[]): string =>
      `${names.slice(0, 10).join(", ")}${names.length > 10 ? ", …" : ""}\nOnly the names are removed. The files of categories are never deleted.`,
    deletedMany: (count: number): string => `${count} categories and tags deleted`,
    fileClearedMany: (count: number): string => `${count} categories use the Quick Note file again`,
    fileSetMany: (count: number, file: string): string =>
      `${count} categories now write to ${file}`,
    keywordClearedMany: (count: number): string => `Keyword removed from ${count} entries`,
    labelDeleted: (kind: "category" | "tag", name: string): string =>
      `${kind === "category" ? "Category" : "Tag"} '${name}' deleted`,
    labelNameEmpty: "Enter a name.",
    labelNameTooLong: (max: number): string => `The name is too long (${max} characters maximum).`,
    labelNameInvalid: "The name cannot contain control characters.",
    labelAlreadyExists: (name: string): string => `'${name}' already exists.`,
    categoryCreated: (name: string, file?: string): string =>
      file ? `Category '${name}' created: ${file}` : `Category '${name}' created`,
    tagCreated: (name: string): string => `Tag '${name}' created`,
    tagPlaceholder: "Add tag…",
    chosenTagsLabel: "Chosen tags",
    createCategoryNamed: "Create category '{name}'…",
    createTagNamed: "Create tag '{name}'…",
    clearCategoryLabel: "Clear the category",
    showCategoriesLabel: "Show the categories",
    showTagsLabel: "Show the tags",
    removeTagLabel: "Remove tag {tag}",
    noTagsYet: "Chosen tags appear here",
    pasteAndSaveLabel: "Paste and Save",
    pasteAndSaveAriaLabel: "Paste the clipboard and save it as a quick note",
    pasteAndSaveTooltip:
      "Saves the text on your clipboard as a note. What you typed here stays as it is.",
    /** `{file}` is replaced by the file notes are saved to. */
    saveTooltip: "Save to {file}",
    saveFailed: "The note could not be saved. Your text is still here. See the logs for details.",
    addedToQuickNote: (file: string): string => `Added to Quick Note: ${file}`,
    nothingSelected: "Select some text first.",
    changeFileTitle: "Change Quick Note File",
    changeFileCurrent: (file: string): string => `Notes are saved to ${file}`,
    changeFileExisting: "$(file) Choose an existing note…",
    changeFileNew: "$(new-file) Create a new note…",
    changeFileDefault: (file: string): string => `$(discard) Use the default (${file})`,
    changeFileOpenLabel: "Use as Quick Note File",
    newFilePrompt: "Name or path inside the notes folder, for example ideas.md or inbox/ideas.md",
    newFileHint: "The file is created when you save the first note.",
    pathMustBeRelative: "Use a path inside the notes folder, without a drive or a leading slash.",
    fileChanged: (file: string): string => `Quick Note file: ${file}`,
  },

  nameValidation: {
    empty: "Enter a name.",
    separators: 'A name cannot contain "/" or "\\".',
    illegalCharacters: 'A name cannot contain any of these characters: < > : " | ? *',
    controlCharacters: "A name cannot contain control characters.",
    dotName: 'A name cannot be "." or "..".',
    trailingDotOrSpace: "A name cannot end with a dot or a space.",
    reserved: (name: string): string => `'${name}' is a reserved name on Windows.`,
    tooLong: "The name is too long (255 characters maximum).",
    alreadyExists: (name: string): string => `'${name}' already exists here.`,
  },

  moveSelection: {
    title: "Move the selected text to…",
    placeholder: "Choose the note to add the text to (type to filter)",
    newNote: "New note…",
    recent: "Recent",
    allNotes: "All notes",
    noSelection: "Select some text in a note first.",
    notInNotes: "This file is not in the notes folder, so NoteRoot does not move text from it.",
    sameFile: "Choose another note: the text is already in this one.",
    done: (file: string): string => `Moved the selection to ${file}`,
    changedMeanwhile: (file: string): string =>
      `The text was added to ${file}, but it was not removed here because this note changed in the meantime. Remove it by hand.`,
  },
  fileOps: {
    newFileTitle: "New File",
    newFolderTitle: "New Folder",
    newFilePlaceholder: "note.md",
    newFolderPlaceholder: "Folder name",
    renameTitle: "Rename",
    duplicating: "Duplicating…",
    nothingToUndo: "There is no rename or move to undo.",
    undone: (count: number): string =>
      count === 1
        ? "Undone: 1 item is back where it was."
        : `Undone: ${count} items are back where they were.`,
    undoFailed: (names: string): string =>
      `Could not undo for: ${names}. The old name may be taken, or the item or its old folder is gone.`,
    moveToTrashAction: "Move to Trash",
    deleteOne: (name: string): string => `Move '${name}' to the Trash?`,
    deleteFolder: (name: string): string => `Move '${name}' and everything inside it to the Trash?`,
    deleteMany: (count: number): string => `Move ${count} items to the Trash?`,
    trashUnavailable: (count: number): string =>
      count === 1
        ? "The Trash is not available. Delete permanently? This cannot be undone."
        : `The Trash is not available. Delete ${count} items permanently? This cannot be undone.`,
    deletePermanentlyAction: "Delete Permanently",
    moveConflict: (name: string): string => `'${name}' already exists in the destination.`,
    moveConflictDetail: "Replace moves the existing item to the Trash first.",
    replaceAction: "Replace",
    skipAction: "Skip",
    pathCopied: "Path copied to the clipboard.",
    excluded: (name: string, count: number): string =>
      count === 1
        ? `${name} is now hidden from NoteRoot.`
        : `${count} items are now hidden from NoteRoot.`,
    excludedAlready: "Already hidden from NoteRoot.",
    excludeUndo: "Undo",
    included: (name: string, count: number): string =>
      count === 1 ? `${name} is shown again.` : `${count} items are shown again.`,
    includePattern: (pattern: string): string =>
      `"${pattern}" hides this item and every other item it matches. Remove this pattern from the hidden list?`,
    includePatternAction: "Remove Pattern",
    includeInsideHidden: (name: string, folder: string): string =>
      `${name} is inside the hidden folder ${folder}. Include that folder instead.`,
    includeFolderAction: "Include the Folder",
    includeNothing: "Nothing to include: it is hidden by something else.",
    someFailed: (failed: number, verb: string): string =>
      `${failed === 1 ? "1 item" : `${failed} items`} could not be ${verb}. See the logs for details.`,
    quickNoteFileRename: (file: string): string =>
      `This is your Quick Note file. If you rename it, new Quick Notes will create a new "${file}" file. Continue?`,
    quickNoteFolderRename: (file: string): string =>
      `This folder contains your Quick Note file. If you rename it, new Quick Notes will create a new "${file}" file. Continue?`,
    quickNoteFileMove: (file: string): string =>
      `This is your Quick Note file. If you move it, new Quick Notes will create a new "${file}" file. Continue?`,
    quickNoteFolderMove: (file: string): string =>
      `This folder contains your Quick Note file. If you move it, new Quick Notes will create a new "${file}" file. Continue?`,
    quickNoteDeleteDetail: (file: string): string =>
      `This includes your Quick Note file. New Quick Notes will create a new "${file}" file.`,
    quickNoteSettingHint: "You can change the file in the noteRoot.quickNoteFile setting.",
    renameAnywayAction: "Rename Anyway",
    moveAnywayAction: "Move Anyway",
  },

  encryption: {
    encryptTitle: (count: number): string =>
      count === 1 ? "Encrypt this note" : `Encrypt ${count} notes`,
    decryptTitle: (count: number): string =>
      count === 1 ? "Decrypt this note" : `Decrypt ${count} notes`,
    keyPrompt:
      "Enter the master key. It cannot be recovered: if you forget it, the encrypted notes are lost.",
    keyConfirmPrompt: "Enter the master key again.",
    keyPlaceholder: "Master key",
    decryptKeyPrompt: "Enter the master key.",
    keyMismatch: "The two keys are not the same.",
    keyTooShort: (min: number): string => `Use at least ${min} characters.`,
    wrongKey: "Wrong master key, or the file is damaged.",
    notEncrypted: (name: string): string => `${name} is not an encrypted note.`,
    alreadyEncrypted: (name: string): string => `${name} is already encrypted.`,
    targetExists: (name: string): string =>
      `A file named ${name} already exists, so ${name} was left as it is.`,
    unsaved: (name: string): string => `${name} has unsaved changes. Save or close it first.`,
    quickNoteFile:
      "The Quick Note file cannot be encrypted: new notes are added to it all the time.",
    notText: (name: string): string => `${name} is not a text note, so it cannot be encrypted.`,
    tooBig: (name: string): string => `${name} is too big to encrypt here.`,
    encrypted: (name: string, count: number): string =>
      count === 1 ? `${name} is encrypted.` : `${count} notes are encrypted.`,
    decrypted: (name: string, count: number): string =>
      count === 1 ? `${name} is decrypted.` : `${count} notes are decrypted.`,
    working: "Working…",
    copyTitle: "Copy this note as encrypted text",
    copied: (name: string): string =>
      `The encrypted text of ${name} is on the clipboard. The note itself was not changed.`,
    clipboardTitle: "Decrypt the text on the clipboard",
    clipboardNotEncrypted: "The clipboard does not hold encrypted NoteRoot text.",
    clipboardName: "Decrypted text.md",
    isLink: (name: string): string =>
      `${name} is a link, so it was left as it is (writing would change the file it points to).`,
    cannotWriteInto: "An encrypted note cannot be written to. Decrypt it first.",
    lockedTooltip: "Encrypted note. Right-click it to decrypt.",
  },
  syncPage: {
    title: "NoteRoot Sync",
    intro:
      "Keep this notes folder on another computer through an online service. Nothing is sent until you press Push or Pull.",
    searchLabel: "Search the files that changed",
    searchPlaceholder: "Search the files that changed",
    noMatches: "No changed file matches.",
    overview: "Overview",
    changes: "Changes",
    options: "Options",
    encryption: "Encryption",
    providersTitle: "Services",
    providersIntro: "Choose a service to see its status and what it can do.",
    providerOpen: "Open",
    providerNotConnected: "Not connected",
    backToProviders: "‹ Services",
    openOnline: "Open online",
    githubUses: "Uses your GitHub account in VS Code",
    githubHowTitle: "How to connect to GitHub",
    githubStep1:
      "Press Connect. NoteRoot uses the GitHub account of VS Code, so there is nothing to make or paste.",
    githubStep2: "If VS Code asks, sign in to GitHub in the browser that opens and allow it once.",
    githubStep3:
      "Pick a repository, or make a new private one, and say whether to encrypt the notes.",
    gitlabTokenSaved: "GitLab token saved ({address})",
    gitlabTokenMissing: "No GitLab token yet: Connect asks for it",
    gitlabHowTitle: "How to connect to GitLab (free, once)",
    gitlabStep1:
      "In GitLab: your picture ▸ Preferences ▸ Access tokens ▸ Add new token ▸ Legacy token.",
    gitlabStep2:
      "Name it NoteRoot, choose an expiration date, tick ONLY the scope api, and create it. Copy the token: GitLab shows it once.",
    gitlabStep3:
      "If your GitLab is not gitlab.com, write its address in the Settings page, Sync & Encryption (GitLab address).",
    gitlabStep4: "Press Connect here and paste the token. It is kept on this computer only.",
    dropboxKeySet: "Dropbox app key set",
    dropboxKeyMissing: "Dropbox app key not set up",
    dropboxHowTitle: "How to set up the Dropbox app (free, once)",
    dropboxStep1:
      "Open dropbox.com/developers/apps ▸ Create app ▸ Scoped access ▸ App folder ▸ a name (for example NoteRoot).",
    dropboxStep2:
      "Permissions: tick files.metadata.read, files.metadata.write, files.content.read and files.content.write, then Submit.",
    dropboxStep3:
      "Settings ▸ OAuth 2 ▸ Redirect URIs: write http://localhost:53682/ and press Add. Keep Allow public clients on.",
    dropboxStep4:
      "Settings: copy the App key into the Settings page, Sync & Encryption (Dropbox app key), then press Connect here and Allow.",
    googleClientFromLocal: "Google client set (on this computer)",
    googleClientFromConfig: "Google client set (in the notes folder)",
    googleClientFromBuiltIn: "Google client set (comes with NoteRoot)",
    googleClientMissingBoth: "Google client not set up: client id and secret are missing",
    googleClientMissingId: "Google client not set up: client id is missing",
    googleClientMissingSecret: "Google client not set up: client secret is missing",
    googleClientHowTitle: "How to set up the Google client (free, once)",
    googleClientHowIntro:
      "Google needs an application id for the sign-in. You make one in your own Google account; nothing is sent to anyone else.",
    googleClientStep1:
      "Open console.cloud.google.com and make a new project (any name, for example NoteRoot).",
    googleClientStep2:
      "Menu ☰ ▸ APIs & Services ▸ Library ▸ Google Drive API ▸ Enable. Without this, the sign-in works but every push fails.",
    googleClientStep3:
      "Google Auth Platform ▸ Get started: App name NoteRoot, your email as support email, Audience External, your email as contact, agree to the policy, Create.",
    googleClientStep4:
      "Data Access ▸ Add or remove scopes. If the list is empty, paste https://www.googleapis.com/auth/drive.file in Manually add scopes ▸ Add to table ▸ Update ▸ Save.",
    googleClientStep5:
      "Audience ▸ Test users ▸ Add users: your own Google email. The app stays in Testing, so the sign-in ends after 7 days and you connect again. (Step 6 is optional.)",
    googleClientStep6:
      "Optional, so the sign-in does not end after 7 days: Branding ▸ add an Application home page link and an Application privacy policy link (public pages, for example the ones of your project) ▸ Save, then Audience ▸ Publish app. You do not need this for your own use.",
    googleClientStep7:
      "Clients ▸ Create client ▸ Application type Desktop app ▸ Create. Open it and copy the Client ID and the Client secret.",
    googleClientStep8:
      "Paste them into the Settings page, Sync & Encryption (Google client id, Google client secret), then press Connect here. On the page that says Google has not verified this app, press Continue, then Allow.",
    openSyncSettings: "Open the Settings",
    diff: "Diff",
    diffTip: "Show the difference between your file and the online one",
    notConnectedTitle: "This notes folder is not connected",
    notConnectedHelp:
      "Connect it to a service to push your notes online and pull them on another computer. The notes can be encrypted before they leave this computer.",
    connect: "Connect…",
    service: "Service",
    privateText: "Private",
    publicText: "Public: anyone can read it",
    status: "Status",
    allTitle: "For all the connected services",
    allHelp: "One after the other. A service that cannot do it does not stop the others.",
    checkAll: "Check all",
    pullAll: "Pull all",
    pushAll: "Push all",
    checkAllTip: "Compare every connected service with its online copy",
    pullAllTip: "Bring what changed online from every connected service",
    pushAllTip: "Send what changed here to every connected service (one message for all)",
    sharedTitle: "For all services",
    sharedHelp: "These are the same for every service: you change them here, not in each service.",
    advancedTitle: "Advanced",
    versionWord: "version",
    filesNotSynced: "Files not synced",
    filesNotSyncedHelp:
      "The files and folders that no service syncs: they are not sent, not brought and not listed in the changes ({n} in the list). You can also right-click an item in the Notes tree and choose Don't Sync.",
    notSyncedBoxTitle: "Not synced",
    notSyncedBoxHelp: "The files and folders you left out of the sync, as written.",
    filesToEncrypt: "Files to encrypt",
    filesToEncryptHelp:
      "The files and folders that are encrypted when a service encrypts only the ones you choose ({n} in the list).",
    actionsTitle: "What you can do",
    pullHelp: "Bring what changed online into this folder.",
    pushHelp: "Send what changed here online.",
    disconnectHelp:
      "Stop syncing this folder with this service. Nothing is deleted here or online.",
    fixConflictsHelp:
      "Files that changed here and online need your choice of which version to keep.",
    countToPull: "{n} to pull",
    countToPush: "{n} to push",
    countConflicts: "{n} in conflict",
    nothingToPull: "Nothing to pull",
    nothingToPush: "Nothing to push",
    checkNow: "Check now",
    pull: "Pull",
    push: "Push",
    change: "Change…",
    disconnect: "Disconnect",
    localChanges: "Local changes",
    remoteChanges: "Remote changes",
    localHint: "Files here that are not online yet. Push sends them.",
    remoteHint: "Files online that are not here yet. Pull brings them.",
    nothingNew: "No changes.",
    conflictsTitle: "Conflicts",
    conflictsHint:
      "Files that changed here and online. Choose which version to keep for each (the file here, or the one online, or both); then press Apply choices.",
    choiceLabel: "What to keep:",
    choiceMine: "Keep mine",
    choiceMineTip: "Keep the file here (the next Push sends it online)",
    choiceOnline: "Keep online",
    choiceOnlineTip: "Keep the file online (the one here goes to the Trash)",
    choiceBoth: "Keep both",
    choiceBothTip: "Keep both: the online one is saved next to yours as name (online)",
    fixConflicts: "Fix conflicts",
    fixConflictsTip: "Go to the conflicts and choose which version to keep for each file",
    chooseAllLabel: "The same for all the files:",
    chooseAllMine: "Keep all mine",
    chooseAllOnline: "Keep all online",
    chosenCount: "{n} of {total} chosen",
    applyChoices: "Apply choices",
    applyChoicesTip:
      "Pull: puts your choices in effect (the files you did not keep are moved to the Trash first)",
    chooseEveryFile: "Choose for every file, then apply.",
    noConflicts: "No conflicts.",
    notChecked: "Not checked yet. Press Check now.",
    conflict: "conflict",
    history: "History",
    historyHelp:
      "How many versions the service keeps. Keeping fewer makes it small, but the older versions are gone.",
    historyAll: "Every version",
    historyLast: "The last {n} versions",
    historyOne: "One version",
    hiddenFiles: "Hidden files",
    hiddenFilesHelp: "Also sync the files and folders that NoteRoot hides.",
    included: "Included",
    leftOut: "Left out",
    autoCheck: "Check for new changes",
    autoCheckHelp:
      "Look for a new version every few minutes and when this window gets the focus. Nothing is changed by it.",
    on: "On",
    off: "Off",
    turnOn: "Turn on",
    turnOff: "Turn off",
    notEncrypted:
      "The notes go online as they are: anyone who can read the {target} can read them.",
    encrypted: "The notes are sealed on this computer with your master key before they go online.",
    namesPlain: "File names are kept (note.md.enc).",
    namesHidden: "File names are hidden.",
    scopeAll: "Every note is encrypted.",
    scopeCustom:
      "Only the files and folders you chose are encrypted ({n} in the list). The others go online as plain text.",
    sealEncrypted: "encrypted",
    sealListedPlain: "on the list, not encrypted",
    filesTitle: "Notes that are encrypted",
    filesListedTitle: "Notes on the list (not encrypted yet)",
    filesHelp: "The notes of the folder that the list chooses.",
    filesNone: "No note of the folder is on the list.",
    filesMore: "…and more",
    listEmpty:
      "The list is empty: nothing is encrypted yet. Right-click a note or a folder and choose Encrypt in Sync.",
    encryptHow:
      "Encrypting seals each note on this computer with a master key (AES-256) before it goes online. Online there is only unreadable data. Only someone with the master key can read the notes, also on another computer.",
    encryptAsksTitle: "Encrypt the notes… asks you for:",
    encryptAsk1:
      "Which notes: every note, or only the files and folders you choose (the others stay readable online).",
    encryptAsk2: "The file names: kept (note.md.enc) or hidden.",
    encryptAsk3: "The older versions: keep them (they stay readable) or drop them.",
    encryptAsk4: "The master key, typed twice.",
    keyWarning:
      "The master key is never stored in the notes folder or online. If you lose it, the encrypted notes cannot be read by anyone.",
    encryptNow: "Encrypt the notes…",
    turnOffEncryption: "Turn off the encryption",
    turnOffEncryptionHelp:
      "Sends every note online as plain text and removes the encrypted files. The master key is asked once to open them.",
    turnOffEncryptionButton: "Turn off…",
    whichNotes: "Which notes",
    scopeAllState: "Every note",
    scopeCustomState: "Only the chosen",
    fileNames: "File names",
    namesKeptState: "Kept",
    namesHiddenState: "Hidden",
    masterKey: "Master key",
    masterKeyHelp:
      "A key made from the master key is kept in the secure storage of VS Code on this computer, so it is not asked every time. The master key itself is never stored in the notes folder or online: if you lose it, the encrypted notes cannot be read by anyone.",
    keyState: "Never stored online",
    listBoxTitle: "The list",
    listBoxHelp: "The files and folders you chose, as written.",
    autoMessage: "Message of a push",
    autoMessageHelp:
      "Push asks for the message of the new {version}. Turn this on to use the default one (NoteRoot sync and the date and the time) without asking.",
    autoMessageOn: "Default, without asking",
    autoMessageOff: "Ask every time",
    markedAction: "A file to encrypt, in a service that is not encrypted",
    markedActionHelp:
      "What Push does with a file of the list of files to encrypt when the service it sends to is not encrypted: ask, send it as plain text, leave it out, or encrypt it.",
    markedAsk: "Ask every time",
    markedPlain: "Push as plain text",
    markedSkip: "Leave them out",
    markedEncrypt: "Encrypt the marked files",
    changeKey: "Change the master key…",
    forgetKey: "Forget the saved key",
    editList: "Edit the list…",
  },
  sync: {
    // The texts here do not name a service: they work for every provider (`SyncProvider`). The texts of one service are in its own part (`github`).
    group: (provider: string): string => `${provider} Sync`,
    localChanges: "Local changes",
    remoteChanges: "Remote changes",
    notChecked: "Not checked yet",
    remoteNotChecked: "Remote not checked yet",
    changedHere: (count: number): string =>
      count === 1 ? "1 file changed here" : `${count} files changed here`,
    inSync: "Everything is in sync",
    nothingNew: "No changes",
    newVersion: (noun: string): string => `New ${noun} online`,
    checking: "Checking…",
    conflict: "conflict",
    kind: { added: "new", modified: "changed", deleted: "deleted" },
    checkedAt: (time: string): string => `Checked at ${time}`,
    encryptedMark: "encrypted",
    markedNotEncrypted: (count: number, noun: string): string =>
      count === 1
        ? `1 file is on the list of the files to encrypt, but this ${noun} is not encrypted.`
        : `${count} files are on the list of the files to encrypt, but this ${noun} is not encrypted.`,
    markedNotEncryptedDetail: (paths: readonly string[]): string => {
      const shown = paths.slice(0, 5).map((path) => `  ${path}`);
      const more = paths.length > 5 ? [`  … and ${paths.length - 5} more`] : [];
      return [
        "They would go online as plain text, readable by anyone who can read it:",
        ...shown,
        ...more,
        "",
        "Encrypt the marked files seals only these; every other note stays readable online. It asks for a master key.",
        "Leave them out sends everything else and keeps them as changes here.",
      ].join("\n");
    },
    pushPlainAction: "Push as Plain Text",
    markedPickTitle: "A marked file in a plain repository",
    markedPickPlaceholder: "What should Push do with a file on the list of the files to encrypt?",
    markedPickAsk: "Ask every time",
    markedPickAskDetail: "Show the question at each Push that has such a file.",
    markedPickPlain: "Push as plain text",
    markedPickPlainDetail: "The file goes online readable. Nothing is asked.",
    markedPickSkip: "Leave them out of the push",
    markedPickSkipDetail: "The rest is sent and the marked files stay as changes here.",
    markedPickEncrypt: "Encrypt the marked files",
    markedPickEncryptDetail:
      "Only the marked files are sealed (the master key is asked), then the push goes on.",
    encryptMarkedAction: "Encrypt the Marked Files, Then Push",
    skipMarkedAction: "Leave Them Out of This Push",

    noKeepBothConfig: "The settings file cannot be kept twice: choose mine or online.",
    noWebPage: (service: string): string => `${service} has no web page for this folder to open.`,
    allFailed: (service: string, reason: string): string => `${service}: ${reason}`,
    allFailedUnknown: "The action did not work. See the logs for details.",
    chooseServiceTitle: "Which sync service?",
    chooseServicePlaceholder: "This notes folder is connected to more than one",
    chooseProviderTitle: "Where should the notes be synced?",
    chooseProviderPlaceholder: "Pick a service",
    signInFailed: (provider: string): string =>
      `NoteRoot was not signed in to ${provider}, so nothing was done.`,
    noRoot: "Select a notes folder first.",
    notConnected: "This notes folder is not connected to anything to sync with.",
    unknownProvider: "That sync service is not available in this version of NoteRoot.",
    busy: "Another sync action is still running. Wait until it finishes.",
    privateDetail: "private",
    publicDetail: "public: anyone can read it",
    publicWarning: (label: string): string =>
      `${label} is public. Anyone on the internet can read the notes you push to it. Use it anyway?`,
    useAnyway: "Use It Anyway",
    connected: (label: string): string =>
      `This notes folder is connected to ${label}. Press Refresh to compare.`,
    switchWarning: (label: string): string =>
      `Connect this notes folder to ${label}? The files of both are compared again, nothing is deleted.`,
    connectAction: "Connect",
    disconnectConfirm: (label: string): string =>
      `Disconnect this notes folder from ${label}? Your notes and the files online stay as they are.`,
    disconnectAction: "Disconnect",
    disconnected: "Disconnected.",
    autoCheckOn: (noun: string): string =>
      `NoteRoot now checks every few minutes whether there is a new ${noun} online. It only asks for the latest one, nothing is downloaded.`,
    autoCheckOff: "NoteRoot no longer checks by itself.",

    refreshed: (local: number, remote: number, conflicts = 0): string =>
      local === 0 && remote === 0 && conflicts === 0
        ? "Everything is in sync."
        : `${local} to push, ${remote} to pull${conflicts > 0 ? `, ${conflicts} in conflict` : ""}.`,
    newOnline: (label: string, noun: string): string =>
      `${label} has a new ${noun}. Open the Sync page and press Pull.`,
    showActions: "Open Sync Page",

    pullAction: "Pull",
    pullThenPush: "Pull, then Push",
    stillBehind: "The files online changed again while pulling. Press Push to try again.",
    unsavedWarning: (count: number): string =>
      count === 1
        ? "1 open note has changes that are not saved. A push sends what is saved on disk."
        : `${count} open notes have changes that are not saved. A push sends what is saved on disk.`,
    pushSaved: "Push the Saved Files",
    commitMessageEmpty: "Write a short message.",
    someFailed: (count: number): string =>
      count === 1
        ? "1 file could not be applied (see the logs). It stays as it was and is tried again next time."
        : `${count} files could not be applied (see the logs). They stay as they were and are tried again next time.`,
    nothingToPush: "There is nothing to push.",
    pullFirst: "There are changes online that are not here yet. Pull first, then push.",
    commitMessagePrompt: "Message for this push (press Enter to push)",
    defaultCommitMessage: (date: string): string => `NoteRoot sync ${date}`,
    historyTitle: "History of the online copy",
    historyPlaceholder: "Choose how the commits are kept",
    historyKeep: "Keep every commit",
    historyKeepDetail: "Each push adds a commit and the earlier ones stay. This is the usual way.",
    historyLast: "Keep only the last commits…",
    historyLastDetail:
      "Each push keeps only the last few commits (you choose how many). The older ones are dropped.",
    historySingle: "Keep only one commit",
    historySingleDetail:
      "Each push replaces the whole history with one commit that holds all the files. The earlier commits are dropped.",
    historyCurrent: "current",
    historyCountPrompt: "How many of the last commits should be kept?",
    historyCountInvalid: (max: number): string => `Use a whole number from 1 to ${max}.`,
    historyConfirm: (label: string, count: number): string =>
      count === 1
        ? `From now on every push replaces the whole history of ${label} with one single commit. The earlier commits are dropped and this cannot be undone. Other computers are not affected: they compare files, not commits.`
        : `From now on every push keeps only the last ${count} commits of ${label}. The older commits are dropped and this cannot be undone. Other computers are not affected: they compare files, not commits.`,
    historyConfirmAction: "Drop Older Commits",
    historyOn: (count: number): string =>
      count === 1
        ? "Only one commit is kept online. Each push replaces it."
        : `Only the last ${count} commits are kept online.`,
    historyOff: "Every commit is kept again from the next push.",
    historyUnsupported: (provider: string): string =>
      `${provider} cannot limit the history to its last commits.`,
    pushing: "Pushing…",
    pushed: (count: number, label: string): string =>
      count === 1 ? `Pushed 1 file to ${label}.` : `Pushed ${count} files to ${label}.`,
    pushedStatus: (count: number): string =>
      count === 1 ? "Pushed 1 file." : `Pushed ${count} files.`,
    tooManyFiles: (limit: number): string =>
      `This notes folder has more than ${limit} files, which is too many to sync.`,
    pushNeedsConfirm: (count: number, label: string): string =>
      `Push ${count === 1 ? "1 file" : `${count} files`} to the PUBLIC ${label}? Anyone can read them.`,
    pushAction: "Push",

    pulling: "Pulling…",
    nothingToPull: "There is nothing new to pull.",
    pulled: (written: number, trashed: number): string => {
      const parts: string[] = [];
      if (written > 0) {
        parts.push(written === 1 ? "1 file saved" : `${written} files saved`);
      }
      if (trashed > 0) {
        parts.push(
          trashed === 1 ? "1 file moved to the Trash" : `${trashed} files moved to the Trash`
        );
      }
      return parts.length > 0 ? `Pulled: ${parts.join(", ")}.` : "Pulled: nothing changed here.";
    },
    keptBoth: (names: string): string =>
      `The online versions were saved next to yours as: ${names}.`,
    fixConflictsFirst: (count: number): string =>
      `${count === 1 ? "1 file was" : `${count} files were`} changed here and online. Go to the Sync page, Changes, Conflicts, choose what to keep for each, and apply the choices.`,
    openConflicts: "Open the Conflicts",
    unsavedBlocks: (count: number): string =>
      `${count === 1 ? "1 note has" : `${count} notes have`} unsaved changes here and changed online too. Save ${count === 1 ? "it" : "them"}, then pull again.`,
    configInvalid: "The online config file is not valid, so it was left as it is.",
    truncatedTree: "The remote is too big to read in one go, so it cannot be synced here.",

    /** The texts of the diff of the Actions panel (`syncCommands.ts`). */
    diff: {
      localTitle: (name: string): string => `${name} (Online ↔ Local)`,
      remoteTitle: (name: string): string => `${name} (Local ↔ Online)`,
      binary: (path: string): string =>
        `${path} is not a text file, so there is nothing to compare.`,
      tooBig: (path: string): string => `${path} is too big to show here.`,
      gone: (path: string): string => `${path} is not online any more. Press Refresh.`,
      notOnline: (path: string): string =>
        `${path} is not online yet, so there is nothing to compare it with. Here is your file.`,
      notHere: (path: string): string =>
        `${path} is not here yet, so there is nothing to compare it with. Here is the online file.`,
      neither: (path: string): string => `${path} is neither here nor online: nothing to compare.`,
    },

    /** The texts of the choice about hidden files (`syncCommands.ts`). */
    hidden: {
      title: "Hidden files",
      placeholder: "Choose whether the files NoteRoot hides are synced",
      skip: "Leave the hidden files out",
      skipDetail:
        "Files hidden from NoteRoot (such as .vscode, .claude and the items you hid) are not pushed or pulled. This is the usual way.",
      include: "Sync the hidden files too",
      includeDetail:
        "They are pushed and pulled like the other files. Never synced: .git, .noteroot (except its settings file), .DS_Store, Thumbs.db and desktop.ini.",
      current: "current",
      confirm: (label: string): string =>
        `The files that NoteRoot hides (for example .vscode, .claude and the items you hid) will be pushed to ${label} on the next Push, and the ones online will be pulled. Anyone who can read ${label} can read them. Include them?`,
      confirmAction: "Include Hidden Files",
      on: "Hidden files are synced too. Press Refresh to compare.",
      off: "Hidden files are left out again. Nothing online was deleted.",
      tag: "hidden files included",
    },

    /** The texts of the encrypted sync (`EncryptedSyncProvider`, `syncCommands.ts`). */
    ignore: {
      added: (name: string, count: number): string =>
        count === 1
          ? `${name} is not synced any more: it is not sent, not brought and not listed in the changes. If it is online already, it stays there.`
          : `${count} items are not synced any more: they are not sent, not brought and not listed in the changes. Whatever is online already stays there.`,
      already: "Already not synced.",
      removed: (name: string, count: number): string =>
        count === 1
          ? `${name} is synced again: it shows in the changes at the next check.`
          : `${count} items are synced again: they show in the changes at the next check.`,
      removePattern: (pattern: string): string =>
        `"${pattern}" leaves this item and every other item it matches out of the sync. Remove this pattern from the list?`,
      insideFolder: (name: string, folder: string): string =>
        `${name} is inside the folder ${folder}, which is not synced. Sync that folder again instead.`,
      nothing: "Nothing to change: it is left out by something else.",
    },
    encryption: {
      headerUnreadable: "The encryption file of the repository cannot be read.",
      notEncryptedRepo:
        "This repository has notes that NoteRoot did not encrypt, so it cannot be used as an encrypted one. Use an empty repository.",
      otherSetup:
        "The encryption of this repository is not the one this folder was connected to. Connect to it again.",
      keyRequired: "The master key is needed to open the encrypted notes.",
      keyMissing:
        "The key of this repository is not kept on this computer. Connect to the repository again to enter it.",
      damaged: (path: string): string =>
        `The online copy of ${path} is damaged or was changed, so it was not used.`,
      title: "Encrypt the notes before they are pushed?",
      placeholder: "Choose how the notes are stored online",
      no: "No, push the notes as they are",
      noDetail:
        "The text and the names of the notes can be read by anyone who can read the repository.",
      yes: "Yes, encrypt the notes",
      yesDetail:
        "Every note is sealed on this computer with a master key. Online there is only unreadable data.",
      listAdded: (name: string, count: number): string =>
        count === 1
          ? `${name} is on the list of the files to encrypt in the sync. It is sent sealed at the next Push if the repository encrypts only the chosen files.`
          : `${count} items are on the list of the files to encrypt in the sync. They are sent sealed at the next Push if the repository encrypts only the chosen files.`,
      listAlready: "Already encrypted in the sync.",
      listRemoved: (name: string, count: number): string =>
        count === 1
          ? `${name} is off the list of the files to encrypt in the sync. It goes online as plain text at the next Push if the repository encrypts only the chosen files.`
          : `${count} items are off the list of the files to encrypt in the sync. They go online as plain text at the next Push if the repository encrypts only the chosen files.`,
      listRemovePattern: (pattern: string): string =>
        `"${pattern}" encrypts this item and every other item it matches. Remove this pattern from the list?`,
      listInsideFolder: (name: string, folder: string): string =>
        `${name} is inside the folder ${folder}, which is encrypted in the sync. Stop encrypting that folder instead.`,
      listNothing: "Nothing to change: it is encrypted by something else.",
      scopeTitle: "What is encrypted",
      scopePlaceholder: "Choose which notes are sealed",
      scopeAll: "Every note",
      scopeAllDetail: "All the notes are sealed. Nothing readable goes online.",
      scopeCustom: "Only the files and folders I choose",
      scopeCustomDetail:
        "Use Encrypt in Sync in the Notes tree to choose them. Every other note goes online as plain text, and a new note stays plain until you choose it.",
      namesTitle: "File names online",
      namesPlaceholder: "Choose what can be seen of the names",
      namesPlain: "Keep the file names",
      namesPlainDetail:
        "Notes appear as note.md.enc. The names and the folders can be read online.",
      namesHidden: "Hide the file names too",
      namesHiddenDetail:
        "Notes appear as codes. Nobody online can see the names or the folders, only how many files there are.",
      newKeyTitle: "Master key of the encrypted notes",
      newKeyPrompt:
        "Choose the master key. It cannot be recovered: if you forget it, the encrypted notes online are lost.",
      newKeyAgain: "Enter the master key again.",
      askKeyPrompt: (label: string): string => `Enter the master key of ${label}.`,
      askKeyRetry: "That master key does not open this repository. Try again.",
      connectedEncrypted: (label: string): string =>
        `${label} is encrypted. The master key is kept on this computer in the secure storage of VS Code.`,
      forgetDone:
        "The saved key was removed from this computer. The master key is asked the next time it is needed.",
      notEncrypted: "This repository is not encrypted.",
      alreadyEncrypted: "This repository is already encrypted.",
      nothingToEncrypt:
        "The repository has no notes to encrypt. Connect to an empty repository to start it encrypted.",
      working: "Sealing the notes…",
      convertMessage: "Encrypt the notes with NoteRoot",
      revealMessage: "Turn the encryption off",
      rekeyMessage: "Change the master key",
      renameMessage: "Change how the encrypted files are named",
      changeKeyConfirm: (label: string): string =>
        `Change the master key of ${label}? Every note is sealed again with the new key. On your other computers you connect to it again and type the new key. The older commits stay sealed with the OLD key, so anyone who has it can still open them, unless you drop the history in the next step.`,
      changeNamesConfirm: (label: string): string =>
        `Change how the encrypted files of ${label} are named online? Every encrypted note is sealed again and sent as one new version. The master key is asked again: type the same one to keep it, or a new one (other computers must connect again if you change it).`,
      changeNamesAction: "Change the Names",
      changeNamesSame: "The file names already are like that.",
      changeNamesDone: (label: string): string =>
        `The encrypted files of ${label} are named in the new way.`,
      changeKeyAction: "Change the Key",
      changeKeyDone: (label: string): string =>
        `The master key of ${label} was changed. On your other computers, connect to it again and type the new key.`,
      convertConfirm: (label: string): string =>
        `Encrypt the notes of ${label}? Each note online is replaced by an encrypted copy. Files that NoteRoot does not sync (hidden ones, files over 25 MB...) stay as they are. The older commits still hold the plain notes unless you drop the history in the next step.`,
      convertAction: "Encrypt the Notes",
      decryptConfirm: (label: string): string =>
        `Turn off the encryption of ${label}? Every note is sent online as plain text and the encrypted files are removed.`,
      decryptDetail:
        "The master key is asked once to open the notes. Anyone who can see the online copy will be able to read the notes. The older versions keep the encrypted files (and any plain notes from before) unless you drop the history. Other computers that use this connection must connect again.",
      decryptAction: "Turn Off Encryption",
      decryptDone: (label: string): string =>
        `The encryption of ${label} is off: the notes are online as plain text.`,
      convertDone: (label: string, dropped: boolean): string =>
        dropped
          ? `${label} is encrypted and its history is one commit.`
          : `${label} is encrypted. The older commits still hold the plain notes.`,
      dropTitle: "What happens to the older commits?",
      dropPlaceholder: "Choose what to do with the history",
      dropKeep: "Keep the history",
      dropKeepDetail:
        "The older commits stay online, with the plain notes (or sealed with the old key).",
      dropDrop: "Drop the history",
      dropDropDetail:
        "The branch becomes one commit, so the older versions are gone from it. GitHub may keep copies that nobody can reach for a while.",
      tag: "encrypted",
      tooltip: (names: string): string => `Encrypted notes, ${names}.`,
    },

    /** The texts of the GitHub provider (`GitHubSyncProvider`). */
    github: {
      description: "A GitHub repository, no git needed",
      pickTitle: "Choose the GitHub repository for your notes",
      pickPlaceholder: "Pick a repository, or create a new private one",
      loading: "Loading your repositories…",
      createItem: "Create a new private repository…",
      createDetail: "Starts empty. Only you can see it.",
      createPrompt: "Name of the new private repository",
      createValue: "my-notes",
      createInvalid: "Use letters, numbers, dots, dashes and underscores (at most 100 characters).",
      typeItem: "Type the name of another repository…",
      typeDetail: "For a repository that is not in the list (owner/name).",
      typePrompt: "Repository as owner/name, for example your-name/my-notes",
      typeInvalid: "Use the form owner/name, for example your-name/my-notes.",
      notSignedIn: "Sign in to GitHub first (Accounts menu, or press Connect again).",
      expired: "The GitHub sign-in is not valid any more. Sign in again.",
      rateLimited: "GitHub is limiting the requests for now. Try again in a few minutes.",
      forbidden:
        "GitHub refused this action. The repository may belong to an organisation that needs your approval, or your account cannot write to it.",
      notFound:
        "GitHub did not find that. The repository or the branch may be gone, or you may not have access.",
      conflict:
        "The repository changed while NoteRoot was working. Press Refresh, pull, and try again.",
      unprocessable: "GitHub refused the data. See the logs for details.",
      network: "NoteRoot could not reach GitHub. Check the internet connection and try again.",
      unexpected: "GitHub gave an answer that NoteRoot cannot read.",
      createExists: "A repository with that name exists already. Pick it from the list instead.",
    },
    gitlab: {
      description: "A GitLab project (gitlab.com or your own GitLab), with a personal access token",
      pickTitle: "Choose the GitLab project for your notes",
      pickPlaceholder: "Pick a project, or make a new private one",
      loading: "Loading your projects…",
      createItem: "Make a new private project…",
      createDetail: "Starts empty. Only you can see it.",
      createPrompt: "Name of the new private project",
      createValue: "my-notes",
      createInvalid:
        "Use letters, numbers, dots, dashes, underscores and spaces (at most 100 characters).",
      typeItem: "Type the path of another project…",
      typeDetail: "For a project that is not in the list (group/name).",
      typePrompt: "Project as group/name, for example your-name/my-notes",
      typeInvalid: "Use the form group/name, for example your-name/my-notes.",
      signInTitle: "Sign in to GitLab",
      tokenPrompt: (address: string): string =>
        `A personal access token of ${address}. In GitLab: your picture ▸ Preferences ▸ Access tokens ▸ Add new token ▸ Legacy token, and tick ONLY the scope api. It is kept in the secret storage of VS Code. To use another GitLab, change the GitLab address in the Settings page first.`,
      tokenInvalid: "Paste the token as GitLab shows it: no spaces, and not empty.",
      tokenRefused: "GitLab did not accept that token (or that address). Check both and try again.",
      notSignedIn: "Sign in to GitLab first (press Connect again).",
      expired:
        "GitLab did not accept the token any more (it may have ended). Connect again to give a new one.",
      forbidden:
        "GitLab refused this action. Your token may lack the scope api, or you cannot write to this project.",
      notFound:
        "GitLab did not find that. The project or the branch may be gone, or you may not have access.",
      rateLimited: "GitLab is limiting the requests for now. Try again in a few minutes.",
      conflict:
        "GitLab refused the change, or the project changed while NoteRoot was working. Press Check now, pull, and try again.",
      tooMany: "The project has too many files to list.",
      network:
        "NoteRoot could not reach GitLab. Check the internet connection and the address, and try again.",
      unexpected: "GitLab gave an answer that NoteRoot cannot read.",
    },
    dropbox: {
      description: "A folder of your Dropbox, with your Dropbox account",
      pickTitle: "Choose the Dropbox folder for your notes",
      pickPlaceholder: "Pick a folder that NoteRoot can use, or make a new one",
      loading: "Looking for the folders of NoteRoot in your Dropbox…",
      createItem: "Make a new folder in your Dropbox…",
      createDetail: "NoteRoot makes it inside its own app folder. Only you can see it.",
      createPrompt: "Name of the new folder in your Dropbox",
      createValue: "NoteRoot notes",
      createInvalid:
        'Use a name of at most 100 characters, without slashes or the characters < > : " | ? *.',
      notConfigured:
        "The Dropbox sign-in is not set up: write the App key of your Dropbox app in the Settings page (Sync & Encryption, Dropbox app key).",
      portBusy: (port: number): string =>
        `NoteRoot could not listen on port ${port} for the Dropbox sign-in (something else uses it). Close it and try again.`,
      browserNotOpened: "The browser could not be opened for the Dropbox sign-in.",
      noRefreshToken:
        "Dropbox did not give NoteRoot a lasting sign-in. Check that the app was made with the access type App folder and try again.",
      notSignedIn: "Sign in to Dropbox first (press Connect again).",
      expired: "The Dropbox sign-in is not valid any more. Connect again to sign in.",
      signInRefused:
        "Dropbox refused the sign-in. Check the App key and the Redirect URI of the app, and try again.",
      rateLimited: "Dropbox is limiting the requests for now. Try again in a few minutes.",
      quota: "Your Dropbox is full. Free some space and try again.",
      forbidden:
        "Dropbox refused this action. The Dropbox app may be missing a permission (files.metadata.read and write, files.content.read and write).",
      notFound: "Dropbox did not find that. The folder or the file may be gone.",
      conflict:
        "The Dropbox folder changed while NoteRoot was working. Press Check now, pull, and try again.",
      tooMany: "The Dropbox folder holds too many files to list.",
      network: "NoteRoot could not reach Dropbox. Check the internet connection and try again.",
      unexpected: "Dropbox gave an answer that NoteRoot cannot read.",
      pageDone: "NoteRoot is signed in to Dropbox. You can close this tab and go back to VS Code.",
      pageFailed: "The sign-in did not work. Close this tab and try again from VS Code.",
    },
    googleDrive: {
      description: "A folder of your Google Drive, with your Google account",
      pickTitle: "Choose the Google Drive folder for your notes",
      pickPlaceholder: "Pick a folder that NoteRoot made, or make a new one",
      loading: "Looking for the folders of NoteRoot in your Drive…",
      createItem: "Make a new folder in your Drive…",
      createDetail: "NoteRoot makes it in the top of your Drive. Only you can see it.",
      createPrompt: "Name of the new folder in your Google Drive",
      createValue: "NoteRoot notes",
      createInvalid: "Use a name of at most 100 characters, without slashes.",
      notConfigured:
        "The Google sign-in is not set up. Make a Google client of your own (type Desktop app, see the README) and write its id and secret in the Settings page, Sync & Encryption, rows Google client id and Google client secret.",
      clientFieldInvalid: "Paste it as Google shows it: no spaces, and not empty.",
      browserNotOpened: "The browser could not be opened for the Google sign-in.",
      noRefreshToken:
        "Google did not give NoteRoot a lasting sign-in. Take the access of NoteRoot away in your Google account (Security, Third-party access) and sign in again.",
      notSignedIn: "Sign in to Google first (press Connect again).",
      expired: "The Google sign-in is not valid any more. Connect again to sign in.",
      signInRefused: "Google refused the sign-in. Try again.",
      rateLimited: "Google is limiting the requests for now. Try again in a few minutes.",
      quota: "Your Google Drive is full. Free some space and try again.",
      forbidden:
        "Google refused this action. NoteRoot can only use the files and folders that it made itself.",
      notFound: "Google did not find that. The file may be gone.",
      folderGone:
        "The Drive folder of this connection is gone (deleted or in the Trash). Change the folder or disconnect.",
      conflict:
        "The Drive folder changed while NoteRoot was working. Press Check now, pull, and try again.",
      tooMany: "The Drive of NoteRoot holds too many files to list.",
      network: "NoteRoot could not reach Google. Check the internet connection and try again.",
      unexpected: "Google gave an answer that NoteRoot cannot read.",
      pageDone: "NoteRoot is signed in to Google. You can close this tab and go back to VS Code.",
      pageFailed: "The sign-in did not work. Close this tab and try again from VS Code.",
    },
  },
  errors: {
    clipboardEmpty: "The clipboard has no text to save.",
    invalidMove: (name: string): string =>
      `'${name}' cannot be moved into itself or one of its own folders.`,
    outsideRoot: "That location is outside the notes folder.",
    rootMissing: "The notes folder is not available.",
    trashUnavailable: "The Trash is not available.",
    configCorrupt: "The NoteRoot config file is invalid.",
    categoryFileOutside: (name: string): string =>
      `The file of category '${name}' is not inside the notes folder.`,
    configLocked:
      "NoteRoot cannot save to its config file because the file is invalid or was created by a newer version. Open it to check it.",
  },
} as const;
