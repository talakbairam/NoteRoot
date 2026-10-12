import { registerConfigNotifications } from "./configNotifications";
import {
  registerEncryptionCommands,
  type EncryptionCommandDependencies,
} from "./encryptionCommands";
import { registerFileCommands, type FileCommandDependencies } from "./fileCommands";
import { registerGeneralCommands } from "./generalCommands";
import { registerHeaderCommands, type HeaderCommandDependencies } from "./headerCommands";
import { registerLabelCommands, type LabelCommandDependencies } from "./labelCommands";
import { registerLabelViewCommands, type LabelViewCommandDependencies } from "./labelViewCommands";
import {
  registerTagPatternCommands,
  type TagPatternCommandDependencies,
} from "./tagPatternCommands";
import { registerTaggingCommands, type TaggingCommandDependencies } from "./taggingCommands";
import { registerPinnedCommands, type PinnedCommandDependencies } from "./pinnedCommands";
import { registerQuickNoteCommands, type QuickNoteCommandDependencies } from "./quickNoteCommands";
import { registerRecentCommands, type RecentCommandDependencies } from "./recentCommands";
import { registerRootCommands, type RootCommandDependencies } from "./rootCommands";
import { registerSettingsCommands, type SettingsCommandDependencies } from "./settingsCommands";
import { registerSyncCommands, type SyncCommandDependencies } from "./syncCommands";
import { registerSearchCommands, type SearchCommandDependencies } from "./searchCommands";
import { registerTreeCommands, type TreeCommandDependencies } from "./treeCommands";

export type CommandDependencies = RootCommandDependencies &
  TreeCommandDependencies &
  FileCommandDependencies &
  QuickNoteCommandDependencies &
  SearchCommandDependencies &
  RecentCommandDependencies &
  PinnedCommandDependencies &
  LabelCommandDependencies &
  LabelViewCommandDependencies &
  TagPatternCommandDependencies &
  TaggingCommandDependencies &
  HeaderCommandDependencies &
  EncryptionCommandDependencies &
  SettingsCommandDependencies &
  SyncCommandDependencies;

/** Registers every command and notification handler. */
export function registerCommands(deps: CommandDependencies): void {
  const { context, logger, configService } = deps;
  registerGeneralCommands(context, logger);
  registerRootCommands(deps);
  registerTreeCommands(deps);
  registerFileCommands(deps);
  registerQuickNoteCommands(deps);
  registerSearchCommands(deps);
  registerRecentCommands(deps);
  registerPinnedCommands(deps);
  registerLabelCommands(deps);
  registerLabelViewCommands(deps);
  registerTagPatternCommands(deps);
  registerTaggingCommands(deps);
  registerHeaderCommands(deps);
  registerEncryptionCommands(deps);
  registerSettingsCommands(deps);
  registerSyncCommands(deps);
  registerConfigNotifications(context, configService, logger);
}
