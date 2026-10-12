import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { showWalkthroughOnFirstRun } from "./commands/walkthrough";
import { createKeyAsker } from "./commands/syncKeyPrompt";
import { ViewIds } from "./constants/context";
import { ActiveNoteService } from "./services/ActiveNoteService";
import { AdvancedModeService } from "./services/AdvancedModeService";
import { AutoCategoryService } from "./services/AutoCategoryService";
import { AutoTagPatternService } from "./services/AutoTagPatternService";
import { SettingKeys } from "./constants/settings";
import { ConfigService } from "./services/ConfigService";
import { ExcludeMatcher } from "./services/ExcludeMatcher";
import { FileOperationsService } from "./services/FileOperationsService";
import { FolderSettingsService } from "./services/FolderSettingsService";
import { EncryptionSupport } from "./services/EncryptedSyncProvider";
import { GitHubAuth } from "./services/GitHubAuth";
import { GitHubClient } from "./services/GitHubClient";
import { GitHubSyncProvider } from "./services/GitHubSyncProvider";
import { SecretKeyStore } from "./services/SecretKeyStore";
import { SyncService } from "./services/SyncService";
import { LabelService } from "./services/LabelService";
import { InternalSaves } from "./services/InternalSaves";
import { NoteTaggingService } from "./services/NoteTaggingService";
import { DecryptedViewService, DECRYPTED_SCHEME } from "./services/DecryptedViewService";
import { NoteEncryptionService } from "./services/NoteEncryptionService";
import { NoteHeaderService } from "./services/NoteHeaderService";
import { Logger } from "./services/Logger";
import { NameValidator } from "./services/NameValidator";
import { PathGuard } from "./services/PathGuard";
import { QuickNoteService } from "./services/QuickNoteService";
import { OnlineViewService, ONLINE_SCHEME } from "./services/OnlineViewService";
import { PinnedNotesService } from "./services/PinnedNotesService";
import { TagIndexService } from "./services/TagIndexService";
import { RecentNotesService } from "./services/RecentNotesService";
import { RootFolderService } from "./services/RootFolderService";
import { SearchService } from "./services/SearchService";
import { SettingsService } from "./services/SettingsService";
import { ShowHiddenService } from "./services/ShowHiddenService";
import { StateService } from "./services/StateService";
import { NotesDragAndDrop } from "./tree/NotesDragAndDrop";
import { NotesTreeProvider } from "./tree/NotesTreeProvider";
import { LabelsTreeProvider } from "./tree/LabelsTreeProvider";
import { SettingsTreeProvider } from "./tree/SettingsTreeProvider";
import { PinnedRecentProvider } from "./tree/PinnedRecentProvider";
import { SyncTreeProvider } from "./tree/SyncTreeProvider";
import { TreeNavigator } from "./tree/TreeNavigator";
import { TreeStateController } from "./tree/TreeStateController";
import { configureStatusMessages } from "./util/status";
import { QuickNoteViewProvider } from "./webview/QuickNoteViewProvider";

/** Wiring only: creates services and providers and registers them. No business logic here. */
export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger();
  const extensionVersion = readVersion(context);
  logger.info(`Activating NoteRoot ${extensionVersion}`);

  const settings = new SettingsService(logger);
  configureStatusMessages(() => settings.statusMessageMs);
  const excludeMatcher = new ExcludeMatcher(settings);
  // The files and folders that automatic tagging leaves alone: the same patterns as the hidden list, another list, nothing always matched.
  const noTagMatcher = new ExcludeMatcher(settings, {
    key: SettingKeys.noTagPatterns,
    read: () => settings.noTagPatterns,
    always: [],
  });
  const configService = new ConfigService(logger, extensionVersion);
  const rootService = new RootFolderService(settings, configService, excludeMatcher, logger);
  const folderSettings = new FolderSettingsService(rootService, configService, settings, logger);
  const pathGuard = new PathGuard(rootService);
  const stateService = new StateService(context.globalState, logger);

  const nameValidator = new NameValidator();
  const fileOps = new FileOperationsService(pathGuard, nameValidator, settings, logger);

  const showHidden = new ShowHiddenService(context.globalState);
  const treeProvider = new NotesTreeProvider(
    rootService,
    pathGuard,
    excludeMatcher,
    settings,
    logger,
    showHidden,
    noTagMatcher
  );
  const navigator = new TreeNavigator(treeProvider, rootService, pathGuard, logger);
  const treeView = vscode.window.createTreeView(ViewIds.tree, {
    treeDataProvider: treeProvider,
    canSelectMany: true,
    showCollapseAll: false, // The title bar has its own Collapse All button.
    dragAndDropController: new NotesDragAndDrop(fileOps, pathGuard, rootService, navigator, logger),
  });
  navigator.attach(treeView);
  const treeState = new TreeStateController(
    treeView,
    treeProvider,
    rootService,
    stateService,
    logger
  );

  const activeNote = new ActiveNoteService(rootService, pathGuard, excludeMatcher);
  const searchService = new SearchService(rootService, pathGuard, excludeMatcher, logger, settings);
  const recentService = new RecentNotesService(
    rootService,
    pathGuard,
    excludeMatcher,
    stateService,
    settings
  );
  const pinnedService = new PinnedNotesService(rootService, configService, pathGuard, logger);
  const pinnedRecentProvider = new PinnedRecentProvider(recentService, pinnedService, treeProvider);
  const advancedMode = new AdvancedModeService(context.globalState, settings);
  const autoCategories = new AutoCategoryService(
    context.globalState,
    rootService,
    searchService,
    logger,
    settings
  );
  const autoTagPatterns = new AutoTagPatternService(context.globalState, settings);
  const labelService = new LabelService(
    rootService,
    configService,
    advancedMode,
    autoCategories,
    autoTagPatterns,
    settings
  );
  const tagIndex = new TagIndexService(searchService);
  const internalSaves = new InternalSaves();
  const taggingService = new NoteTaggingService(
    labelService,
    searchService,
    pathGuard,
    settings,
    excludeMatcher,
    internalSaves,
    logger,
    noTagMatcher
  );
  taggingService.start();
  const headerService = new NoteHeaderService(
    pathGuard,
    searchService,
    settings,
    internalSaves,
    logger
  );
  const encryptionService = new NoteEncryptionService(pathGuard, fileOps, logger);
  const onlineView = new OnlineViewService();
  context.subscriptions.push(
    onlineView,
    vscode.workspace.registerTextDocumentContentProvider(ONLINE_SCHEME, onlineView)
  );
  const decryptedView = new DecryptedViewService();
  context.subscriptions.push(
    decryptedView,
    vscode.workspace.registerTextDocumentContentProvider(DECRYPTED_SCHEME, decryptedView)
  );
  // The services a notes folder can be synced with. A new one is one more class that implements SyncProvider, added here.
  const githubAuth = new GitHubAuth();
  const syncProviders = [
    new GitHubSyncProvider(new GitHubClient(() => githubAuth.token(), logger), githubAuth),
  ];
  const syncService = new SyncService(
    context.globalState,
    rootService,
    pathGuard,
    searchService,
    excludeMatcher,
    syncProviders,
    new EncryptionSupport(new SecretKeyStore(context.secrets), createKeyAsker(), logger),
    logger
  );
  const syncProvider = new SyncTreeProvider(syncService);
  const syncView = vscode.window.createTreeView(ViewIds.sync, { treeDataProvider: syncProvider });
  syncProvider.attach(syncView);
  const settingsContext = { settings, advancedMode, autoCategories, autoTagPatterns };
  const settingsProvider = new SettingsTreeProvider(settingsContext);
  const labelsProvider = new LabelsTreeProvider(
    labelService,
    tagIndex,
    treeProvider,
    rootService,
    settings,
    autoCategories,
    autoTagPatterns,
    logger
  );
  const quickNoteService = new QuickNoteService(
    rootService,
    pathGuard,
    settings,
    nameValidator,
    labelService,
    logger,
    internalSaves
  );
  const quickNoteView = new QuickNoteViewProvider(
    context.extensionUri,
    quickNoteService,
    stateService,
    rootService,
    advancedMode,
    labelService,
    logger,
    settings
  );

  context.subscriptions.push(
    logger,
    settings,
    excludeMatcher,
    noTagMatcher,
    configService,
    rootService,
    folderSettings,
    stateService,
    treeProvider,
    treeView,
    treeState,
    activeNote,
    showHidden,
    recentService,
    pinnedRecentProvider,
    pinnedService,
    labelsProvider,
    // canSelectMany: Ctrl and Shift click select several tags and categories (delete, remove file or keyword work on all of them).
    vscode.window.createTreeView(ViewIds.labels, {
      treeDataProvider: labelsProvider,
      canSelectMany: true,
    }),
    syncService,
    syncProvider,
    syncView,
    settingsProvider,
    vscode.window.registerTreeDataProvider(ViewIds.settings, settingsProvider),
    vscode.window.registerTreeDataProvider(ViewIds.recent, pinnedRecentProvider),
    quickNoteService,
    advancedMode,
    autoCategories,
    autoTagPatterns,
    taggingService,
    labelService,
    quickNoteView,
    // Default retainContextWhenHidden (false): the page is rebuilt from the stored draft when shown again.
    vscode.window.registerWebviewViewProvider(ViewIds.quickNote, quickNoteView)
  );

  registerCommands({
    context,
    logger,
    rootService,
    configService,
    pathGuard,
    settings,
    fileOps,
    navigator,
    treeState,
    quickNoteService,
    quickNoteView,
    advancedMode,
    labelService,
    searchService,
    recentService,
    pinnedService,
    labelsProvider,
    autoCategories,
    autoTagPatterns,
    taggingService,
    headerService,
    encryptionService,
    decryptedView,
    showHidden,
    excludeMatcher,
    noTagMatcher,
    settingsContext,
    syncService,
    onlineView,
  });

  showHidden
    .initialize()
    .catch((error: unknown) => logger.error("Could not publish the show hidden files key.", error));
  activeNote
    .initialize()
    .catch((error: unknown) => logger.error("Could not publish the active note key.", error));
  syncService
    .initialize()
    .catch((error: unknown) => logger.error("Could not publish the GitHub sync state.", error));
  autoTagPatterns
    .initialize()
    .catch((error: unknown) => logger.error("Could not publish the tag patterns mode.", error));
  autoCategories
    .initialize()
    .catch((error: unknown) =>
      logger.error("Could not publish the categories from files mode.", error)
    );
  advancedMode
    .initialize()
    .catch((error: unknown) => logger.error("Could not publish the Advanced mode.", error));

  // Not awaited: a slow or disconnected drive must not delay activation.
  rootService
    .initialize()
    .then(() => showWalkthroughOnFirstRun(context, rootService))
    .catch((error: unknown) => logger.error("Could not finish starting up.", error));
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}

function readVersion(context: vscode.ExtensionContext): string {
  const version: unknown = context.extension.packageJSON?.version;
  return typeof version === "string" ? version : "0.0.0";
}
