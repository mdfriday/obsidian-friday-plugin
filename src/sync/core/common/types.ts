import type { I18N_LANGS } from "./rosetta.ts";

import type { TaggedType } from "octagonal-wheels/common/types";
export type { TaggedType };

export {
    LOG_LEVEL_DEBUG,
    LOG_LEVEL_INFO,
    LOG_LEVEL_NOTICE,
    LOG_LEVEL_URGENT,
    LOG_LEVEL_VERBOSE,
} from "octagonal-wheels/common/logger";
export type { LOG_LEVEL } from "octagonal-wheels/common/logger";
import { RESULT_NOT_FOUND, RESULT_TIMED_OUT } from "octagonal-wheels/common/const";
export { RESULT_NOT_FOUND, RESULT_TIMED_OUT };
type ExtractPropertiesByType<T, U> = {
    [K in keyof T as T[K] extends U ? K : never]: T[K] extends U ? K : never;
};

export type FilterStringKeys<T> = keyof ExtractPropertiesByType<T, string | (string | undefined)>;

export type FilterBooleanKeys<T> = keyof ExtractPropertiesByType<T, boolean | (boolean | undefined)>;

export type FilterNumberKeys<T> = keyof ExtractPropertiesByType<T, number | (number | undefined)>;

export type FilePath = TaggedType<string, "FilePath">;
export type FilePathWithPrefixLC = TaggedType<string, "FilePathWithPrefixLC">;
export type FilePathWithPrefix = TaggedType<string, "FilePathWithPrefix"> | FilePath | FilePathWithPrefixLC;
export type DocumentID = TaggedType<string, "documentId">;

// docs should be encoded as base64, so 1 char -> 1 bytes
// and cloudant limitation is 1MB , we use 900kb;

export const MAX_DOC_SIZE = 1000; // for .md file, but if delimiters exists. use that before.
export const MAX_DOC_SIZE_BIN = 102400; // 100kb
export const VER = 12; // 12 Since 0.25.0, HKDF is used for encryption, so the version is changed to 12.

export const RECENT_MODIFIED_DOCS_QTY = 30;
export const LEAF_WAIT_TIMEOUT = 30000; // in synchronization, waiting missing leaf time out.
export const LEAF_WAIT_ONLY_REMOTE = 5000;
export const LEAF_WAIT_TIMEOUT_SEQUENTIAL_REPLICATOR = 5000;
export const REPLICATION_BUSY_TIMEOUT = 3000000;

// Magic Special value for arguments or results.

export const CANCELLED = Symbol("cancelled");
export const AUTO_MERGED = Symbol("auto_merged");
export const NOT_CONFLICTED = Symbol("not_conflicted");
export const MISSING_OR_ERROR = Symbol("missing_or_error");
export const LEAVE_TO_SUBSEQUENT = Symbol("leave_to_subsequent_proc");
export const TIME_ARGUMENT_INFINITY = Symbol("infinity");

export const VERSIONING_DOCID = "obsydian_livesync_version" as DocumentID;
export const MILESTONE_DOCID = "_local/obsydian_livesync_milestone" as DocumentID;
export const NODEINFO_DOCID = "_local/obsydian_livesync_nodeinfo" as DocumentID;

/**
 * Represents the connection details required to connect to a CouchDB instance.
 */
export interface CouchDBConnection {
    /**
     * The URI of the CouchDB instance.
     */
    couchDB_URI: string;
    /**
     * The username to use when connecting to the CouchDB instance.
     */
    couchDB_USER: string;
    /**
     * The password to use when connecting to the CouchDB instance.
     */
    couchDB_PASSWORD: string;
    /**
     * The name of the database to use.
     */
    couchDB_DBNAME: string;

    /**
     * e.g. `x-some-header: some-value\n x-some-header2: some-value2`
     */
    couchDB_CustomHeaders: string;

    useJWT: boolean;

    jwtAlgorithm: "HS256" | "HS512" | "ES256" | "ES512" | "";

    // JWT key (psk on HS, public key on ES)
    jwtKey: string;
    jwtKid: string;
    jwtSub: string;
    // JWT Expiration duration (in minutes)
    jwtExpDuration: number;

    /**
     * Use Request API to avoid `inevitable` CORS problem.
     * Seems stable, so promoted to the normal setting.
     */
    useRequestAPI: boolean;
}

/**
 * Interface representing the settings for periodic replication.
 */
interface PeriodicReplicationSettings {
    /**
     * Indicates whether periodic replication is enabled.
     */
    periodicReplication: boolean;

    /**
     * The interval, in milliseconds, at which periodic replication occurs.
     */
    periodicReplicationInterval: number;
}

export type ConfigPassphraseStore = "" /* default */ | "LOCALSTORAGE" | "ASK_AT_LAUNCH";

/**
 * Represents the user settings that are encrypted.
 */
interface EncryptedUserSettings {
    /**
     * The store for the configuration passphrase.
     */
    configPassphraseStore: ConfigPassphraseStore;

    /**
     * The encrypted passphrase used for E2EE.
     */
    encryptedPassphrase: string;

    /**
     * The encrypted connection details for CouchDB.
     */
    encryptedCouchDBConnection: string;
}

/**
 * Interface representing the settings for different sync invocation methods.
 */
interface SyncMethodSettings {
    /**
     * Synchronise in Live. This is an exclusive setting against other sync methods.
     */
    liveSync: boolean;
    /**
     * automatically run sync on save.
     * File modification will trigger the sync, even if the file is not changed on the editor.
     */
    syncOnSave: boolean;
    /**
     * automatically run sync on starting the plug-in.
     */
    syncOnStart: boolean;
    /**
     * automatically run sync on opening a file.
     */
    syncOnFileOpen: boolean;
    /**
     * automatically run sync on editor save.
     * Different from syncOnSave, this is only reacts to the editor save event.
     */
    syncOnEditorSave: boolean;

    /**
     * The minimum delay between synchronisation operations (in milliseconds).
     * If the operation is triggered before this delay, the operation will be delayed until the delay is over, and executed as a single operation.
     */
    syncMinimumInterval: number;
}

/**
 * Interface representing the settings for file handling.
 */
interface FileHandlingSettings {
    /**
     * Use trash instead of actually delete.
     */
    trashInsteadDelete: boolean;
    /**
     * Do not delete the folder even if it has got empty.
     */
    doNotDeleteFolder: boolean;
    /**
     * Thinning out the changes and make a single change for the same file.
     */
    batchSave: boolean;
    batchSaveMinimumDelay: number;
    batchSaveMaximumDelay: number;

    /**
     * Maximum size of the file to be synchronized (in MB).
     */
    syncMaxSizeInMB: number;
    /**
     * Use ignore files.
     */
    useIgnoreFiles: boolean;
    /**
     * Ignore files pattern, i,e, `.gitignore, .obsidianignore` (This should be separated by comma)
     */
    ignoreFiles: string;
    /**
     * Do not prevent write if the size is mismatched.
     */
    processSizeMismatchedFiles: boolean;
}

/**
 * Interface representing the settings for Hidden File Sync.
 */
interface InternalFileSettings {
    /**
     * Synchronise internal files.
     */
    syncInternalFiles: boolean;

    /**
     * Scan internal files before replication.
     */
    syncInternalFilesBeforeReplication: boolean;
    /**
     * Interval for scanning internal files (in seconds).
     */
    syncInternalFilesInterval: number;
    /**
     * Ignore patterns for internal files.
     * (Comma separated list of regular expressions)
     */
    syncInternalFilesIgnorePatterns: CustomRegExpSourceList<",">;
    /**
     * Limit patterns for internal files.
     */
    syncInternalFilesTargetPatterns: CustomRegExpSourceList<",">;
    /**
     * Enable watch internal file changes (This option uses the unexposed API)
     */
    watchInternalFileChanges: boolean;

    /**
     * Suppress notification of hidden files change.
     */
    suppressNotifyHiddenFilesChange: boolean;

    /**
     * Overwrite instead of merging patterns for internal files.
     */
    syncInternalFileOverwritePatterns: CustomRegExpSourceList<",">;
}

// Plugin Sync Settings

export const MODE_SELECTIVE = 0;
export const MODE_AUTOMATIC = 1;
export const MODE_PAUSED = 2;
export const MODE_SHINY = 3;
export type SYNC_MODE = typeof MODE_SELECTIVE | typeof MODE_AUTOMATIC | typeof MODE_PAUSED | typeof MODE_SHINY;

export interface PluginSyncSettingEntry {
    key: string;
    mode: SYNC_MODE;
    files: string[];
}

/**
 * Interface representing the settings for plugin synchronisation.
 */
interface PluginSyncSettings {
    /**
     * Indicates whether plugin synchronisation is enabled.
     */
    usePluginSync: boolean;

    /**
     * Indicates whether plugin settings synchronisation is enabled.
     */
    usePluginSettings: boolean;

    /**
     * Indicates whether to show the device's own plugins.
     */
    showOwnPlugins: boolean;

    /**
     * Indicates whether to automatically scan plugins.
     */
    autoSweepPlugins: boolean;

    /**
     * Indicates whether to periodically scan plugins automatically.
     */
    autoSweepPluginsPeriodic: boolean;

    /**
     * Indicates whether to notify when a plugin or setting is updated.
     */
    notifyPluginOrSettingUpdated: boolean;

    /**
     * The name of the device and vault.
     * This is used to identify the device and vault among synchronised devices and vaults.
     * Hence, this should be unique among devices and vaults.
     */
    deviceAndVaultName: string;

    /**
     * Indicates whether the v2 of plugin synchronisation is enabled.
     */
    usePluginSyncV2: boolean;

    /**
     * Indicates whether additional plugin synchronisation settings are enabled.
     * This setting is hidden from the UI.
     */
    usePluginEtc: boolean;

    /**
     * Extended settings for plugin synchronisation.
     */
    pluginSyncExtendedSetting: Record<PluginSyncSettingEntry["key"], PluginSyncSettingEntry>;
}

/**
 * Interface representing the user interface settings.
 */
interface UISettings {
    /**
     * Indicates whether verbose logging has been enabled.
     */
    showVerboseLog: boolean;

    /**
     * Indicates whether less information should be shown in the log.
     */
    lessInformationInLog: boolean;

    /**
     * Indicates whether longer status line should be shown inside the editor.
     */
    showLongerLogInsideEditor: boolean;

    /**
     * Indicates whether the status line should be shown on the editor.
     */
    showStatusOnEditor: boolean;

    /**
     * Indicates whether the status line should be shown on the status bar.
     */
    showStatusOnStatusbar: boolean;

    /**
     * Indicates whether only icons instead of status line should be shown on the editor.
     */
    showOnlyIconsOnEditor: boolean;

    /**
     * Hide File warning notice bar.
     */
    hideFileWarningNotice: boolean;

    /**
     * The language to be used for display.
     */
    displayLanguage: I18N_LANGS;
}

/**
 * Interface representing the settings for mode of exposing advanced things.
 */
interface ModeSettings {
    /**
     * Indicates whether the advanced mode is enabled.
     */
    useAdvancedMode: boolean;

    /**
     * Indicates whether the power user mode is enabled.
     */
    usePowerUserMode: boolean;

    /**
     * Indicates whether the edge case mode is enabled.
     */
    useEdgeCaseMode: boolean;
}

/**
 * Interface representing the settings for debug mode.
 */
interface DebugModeSettings {
    /**
     * Indicates whether the debug tools of Self-hosted LiveSync are enabled.
     */
    enableDebugTools: boolean;
    /**
     * Indicates whether to write log to the file.
     */
    writeLogToTheFile: boolean;
}

/**
 * Interface representing additional tweak settings.
 */
interface ExtraTweakSettings {
    /**
     * The threshold value for notifying about the size of remote storage.
     * When the size of the remote storage exceeds this threshold, a notification will be triggered.
     */
    notifyThresholdOfRemoteStorageSize: number;
}

/**
 * Interface representing the settings for beta tweaks.
 */
interface BetaTweakSettings {
    /**
     * Indicates whether to disable the WebWorker for generating chunks.
     */
    disableWorkerForGeneratingChunks: boolean;

    /**
     * Indicates whether to process small files in the UI thread.
     */
    processSmallFilesInUIThread: boolean;
}

/**
 * Interface representing the settings for synchronising settings via file.
 */
interface SettingSyncSettings {
    /**
     * The file path where the settings is stored.
     */
    settingSyncFile: string;

    /**
     * Indicates whether to write credentials for settings synchronising.
     */
    writeCredentialsForSettingSync: boolean;

    /**
     * Indicates whether to notify all settings synchronising files events.
     */
    notifyAllSettingSyncFile: boolean;
}

/**
 * Represents settings that are considered obsolete and are not configurable from the UI.
 */
interface ObsoleteSettings {
    /**
     * Saving delay (in milliseconds).
     */
    savingDelay: number; // Not Configurable from the UI Now.
    /**
     * Garbage collection delay (in milliseconds). Now, no longer GC is implemented.
     */
    gcDelay: number;
    /**
     * Skip older files on sync. No effect now.
     */
    skipOlderFilesOnSync: boolean;
    /**
     * Use the IndexedDB adapter. Now always true. Should be.
     */
    useIndexedDBAdapter: boolean;
}

export const SETTING_VERSION_INITIAL = 0;
export const SETTING_VERSION_SUPPORT_CASE_INSENSITIVE = 10;
export const CURRENT_SETTING_VERSION = SETTING_VERSION_SUPPORT_CASE_INSENSITIVE;

/**
 * Interface representing some data stored in the settings for the plugin.
 */
interface DataOnSettings {
    /**
     * VersionUp flash message which is shown when some incompatible changes are made during the update.
     */
    versionUpFlash: string;
    /**
     * Setting file version, to migrate the settings.
     */
    settingVersion: number;
    /**
     * Indicates whether the setting of the plug-in is configured once.
     */
    isConfigured?: boolean;
    /**
     * The user-last-read version number.
     */
    lastReadUpdates: number;

    /**
     * The last checked version by the doctor.
     */
    doctorProcessedVersion: string;
}

/**
 * Interface representing the settings for a safety valve mechanism.
 */
interface SafetyValveSettings {
    /**
     * Indicates whether file watching should be suspended.
     */
    suspendFileWatching: boolean;

    /**
     * Indicates whether parsing and reflecting of replication results should be suspended.
     */
    suspendParseReplicationResult: boolean;

    /**
     * Indicates whether suspension should be avoided during fetching operations.
     */
    doNotSuspendOnFetching: boolean;
}

/**
 * Represents the settings required to synchronise with a bucket.
 */
export interface BucketSyncSetting {
    /**
     * The access key to use when connecting to the bucket.
     */
    accessKey: string;
    /**
     * The secret to use when connecting to the bucket.
     */
    secretKey: string;
    /**
     * The name of bucket to use.
     */
    bucket: string;
    /**
     * The region of the bucket.
     */
    region: string;
    /**
     * The endpoint of the bucket.
     */
    endpoint: string;
    /**
     * Indicates whether to use a custom request handler.
     * (This is for CORS issue).
     */
    useCustomRequestHandler: boolean;

    // Custom request headers
    // e.g. `x-some-header: some-value\n x-some-header2: some-value2`
    bucketCustomHeaders: string;

    /**
     * The prefix to use for the bucket (e.g., "my-bucket/", means mostly like a folder).
     */
    bucketPrefix: string;
    /**
     * Indicates whether to force path style access.
     */
    forcePathStyle: boolean;
}

export interface LocalDBSettings {
    /**
     * Indicates whether to use the IndexedDB adapter for the local database.
     * @deprecated
     */
    useIndexedDBAdapter: boolean;
}

// Remote Type
export const RemoteTypes = {
    REMOTE_COUCHDB: "",
    REMOTE_MINIO: "MINIO",
    REMOTE_P2P: "ONLY_P2P",
} as const;
export const REMOTE_COUCHDB = RemoteTypes.REMOTE_COUCHDB;
export const REMOTE_MINIO = RemoteTypes.REMOTE_MINIO;

//
export const REMOTE_P2P = RemoteTypes.REMOTE_P2P;

export type RemoteType = (typeof RemoteTypes)[keyof typeof RemoteTypes];

export enum AutoAccepting {
    NONE = 0,
    ALL = 1,
}
export interface P2PConnectionInfo {
    /**
     * Indicates whether P2P connection is enabled.
     */
    P2P_Enabled: boolean;
    /**
     * Nostr relay server URL. (Comma separated list)
     * This is only for the channelling server to establish for the P2P connection.
     * No data is transferred through this server.
     */
    P2P_relays: string;
    /**
     * The room ID for `your devices`. This should be unique among the users.
     * (Or, lines will be got mixed up).
     */
    P2P_roomID: string;
    /**
     * The passphrase for your devices.
     * It can be empty, but it will help you if you have a duplicate Room ID.
     */
    P2P_passphrase: string;

    /**
     * The Application ID for the P2P connection.
     * This is used to identify the application using the P2P network.
     * In Self-hosted LiveSync, fixed to "self-hosted-livesync".
     */
    P2P_AppID: string;

    /**
     * Indicates whether to auto-start the P2P connection on launch.
     */
    P2P_AutoStart: boolean;

    /**
     * Indicates whether to automatically broadcast changes to connected peers.
     */
    P2P_AutoBroadcast: boolean;

    /**
     * The name of the device peer (This only for editing-setting purpose, not saved in the actual setting file, due to avoid setting-sync issues).
     */
    P2P_DevicePeerName?: string;

    /**
     * The TURN server URLs for the P2P connection. (Comma separated list)
     */
    P2P_turnServers: string;
    /**
     * The TURN username for the P2P connection.
     */
    P2P_turnUsername: string;

    /**
     * The TURN credential (password, secret, etc...) for the P2P connection.
     */
    P2P_turnCredential: string;
}
export interface P2PSyncSetting extends P2PConnectionInfo {
    P2P_AutoAccepting: AutoAccepting;
    P2P_AutoSyncPeers: string;
    P2P_AutoWatchPeers: string;
    P2P_SyncOnReplication: string;
    P2P_RebuildFrom: string;
    P2P_AutoAcceptingPeers: string;
    P2P_AutoDenyingPeers: string;

    P2P_IsHeadless?: boolean;
}

export const P2P_DEFAULT_SETTINGS: P2PSyncSetting = {
    P2P_Enabled: false,
    P2P_AutoAccepting: AutoAccepting.NONE,
    P2P_AppID: "self-hosted-livesync",
    P2P_roomID: "",
    P2P_passphrase: "",
    P2P_relays: "wss://exp-relay.vrtmrz.net/",
    P2P_AutoBroadcast: false,
    P2P_AutoStart: false,
    P2P_AutoSyncPeers: "",
    P2P_AutoWatchPeers: "",
    P2P_SyncOnReplication: "",
    P2P_RebuildFrom: "",
    P2P_AutoAcceptingPeers: "",
    P2P_AutoDenyingPeers: "",
    P2P_IsHeadless: false,
    P2P_DevicePeerName: "",
    P2P_turnServers: "",
    P2P_turnUsername: "",
    P2P_turnCredential: "",
} as const;

/**
 * Interface representing the settings for a remote type.
 */
export interface RemoteTypeSettings {
    /**
     * The type of the remote.
     */
    remoteType: RemoteType;
}

export const E2EEAlgorithmNames = {
    "": "V1: Legacy",
    v2: "V2: AES-256-GCM With HKDF",
    forceV1: "Force-V1: Force Legacy (Not recommended)",
} as const;
export const E2EEAlgorithms = {
    V1: "",
    V2: "v2",
    ForceV1: "forceV1",
} as const;
export type E2EEAlgorithm = (typeof E2EEAlgorithms)[keyof typeof E2EEAlgorithms] | "";
/**
 * Represents the settings used for End-to-End encryption.
 */
export interface EncryptionSettings {
    /**
     * Indicates whether E2EE is enabled.
     */
    encrypt: boolean;

    /**
     * The passphrase used for E2EE.
     */
    passphrase: string;

    /**
     * Indicates whether path obfuscation is used.
     * If not, the path will be stored as it is, as the document ID.
     */
    usePathObfuscation: boolean;

    /**
     * The algorithm used for hashing the passphrase.
     * This is used for E2EE.
     */
    E2EEAlgorithm: E2EEAlgorithm;
}
export const HashAlgorithms = {
    XXHASH32: "xxhash32",
    XXHASH64: "xxhash64",
    MIXED_PUREJS: "mixed-purejs",
    SHA1: "sha1",
    LEGACY: "",
} as const;
export type HashAlgorithm = (typeof HashAlgorithms)[keyof typeof HashAlgorithms];
// Note: xxhash32 is obsolete and not preferred since v0.24.7.
// export type HashAlgorithm = "" | "xxhash32" | "xxhash64" | "mixed-purejs" | "sha1";
export const ChunkAlgorithmNames = {
    v1: "V1: Legacy",
    v2: "V2: Simple (Default)",
    "v2-segmenter": "V2.5: Lexical chunks",
    "v3-rabin-karp": "V3: Fine deduplication",
} as const;
export const ChunkAlgorithms = {
    V1: "v1",
    V2: "v2",
    V2Segmenter: "v2-segmenter",
    RabinKarp: "v3-rabin-karp",
} as const;
export type ChunkSplitterVersion = (typeof ChunkAlgorithms)[keyof typeof ChunkAlgorithms] | "";

/**
 * Interface representing the settings for chunk processing.
 */
interface ChunkSettings {
    /**
     * The algorithm used for hashing chunks.
     */
    hashAlg: HashAlgorithm;

    /**
     * The minimum size of a chunk in chars.
     */
    minimumChunkSize: number;

    /**
     * The custom size of a chunk.
     * Note: This value used as a coefficient for the normal chunk size.
     */
    customChunkSize: number;

    /**
     * The threshold for considering a line as long.
     * (Not respected in v0.24.x).
     */
    longLineThreshold: number;

    /**
     * Flag indicating whether to use a segmenter for chunking.
     * @deprecated use chunkSplitterVersion instead.
     */
    useSegmenter: boolean;

    /**
     * Flag indicating whether to enable version 2 of the chunk splitter.
     * @deprecated use chunkSplitterVersion instead.
     */
    enableChunkSplitterV2: boolean;

    /**
     * Flag indicating whether to avoid using a fixed revision for chunks.
     */
    doNotUseFixedRevisionForChunks: boolean;

    /**
     * The version of the chunk splitter to use.
     */
    chunkSplitterVersion: ChunkSplitterVersion;
}

/**
 * Settings for on-demand chunk fetching.
 */
interface OnDemandChunkSettings {
    /**
     * Indicates whether chunks should be fetch online. (means replication transfers only metadata).
     */
    readChunksOnline: boolean;
    /**
     * Indicates whether to use only local chunks without fetching online.
     */
    useOnlyLocalChunk: boolean;

    /**
     * The number of concurrent chunk reads allowed when fetching online.
     */
    concurrencyOfReadChunksOnline: number;

    /**
     * The minimum interval (in milliseconds) between consecutive online chunk fetching.
     */
    minimumIntervalOfReadChunksOnline: number;

    // Note: If concurrency is 3, the fetching will be like:
    // 1: |---> |---->   |----> ---->
    // 2:     |----> |---->    |----> |--- ->
    // 3:         |------> |--->    |----> |---->
    // ============================================
    //    |   | | |  |   | |   |    | |    |  <- Request starts
    // All intervals between requests should be more than minimumIntervalOfReadChunksOnline.
    // This is mainly for avoiding the 429 error on Cloudant or some other rate limiting gateways. CouchDB could accept more connections.
}

/**
 * Configuration settings for Eden.
 */
interface EdenSettings {
    /**
     * Indicates whether Eden is enabled.
     */
    useEden: boolean;

    /**
     * The maximum number of chunks allowed in Eden.
     */
    maxChunksInEden: number;

    /**
     * The maximum total length allowed in Eden.
     */
    maxTotalLengthInEden: number;

    /**
     * The maximum age allowed in Eden.
     */
    maxAgeInEden: number;
}

/**
 * Interface representing obsolete settings for an remote database.
 */
interface ObsoleteRemoteDBSettings {
    /**
     * Indicates whether to check the integrity of the data on save.
     */
    checkIntegrityOnSave: boolean;

    /**
     * Indicates whether to use history tracking.
     * (Now always true)
     */
    useHistory: boolean;

    /**
     * Indicates whether to disable using API of Obsidian.
     * (Now always true: Note: Obsidian cannot handle multiple requests at the same time).
     */
    disableRequestURI: boolean;

    /**
     * Indicates whether to send data in bulk chunks.
     */
    sendChunksBulk: boolean;

    /**
     * The maximum size of the bulk chunks to be sent.
     */
    sendChunksBulkMaxSize: number;

    /**
     * Indicates whether to use a dynamic iteration count.
     */
    useDynamicIterationCount: boolean;

    /**
     * Indicates weather to pace the replication processing interval.
     * Now (v0.24.x) not be respected.
     */
    doNotPaceReplication: boolean;
}

/**
 * Interface representing the settings for beta tweaks for the remote database.
 */
interface BetaRemoteDBSettings {
    /**
     * Indicates whether compression is enabled for the remote database.
     */
    enableCompression: boolean;
}
/**
 * Interface representing the some data stored on the settings.
 */
interface DataOnRemoteDBSettings {
    /**
     * VersionUp flash message which is shown when some incompatible changes are made during the update.
     */
    versionUpFlash: string;
}

/**
 * Interface representing the settings for replication.
 */
interface ReplicationSetting {
    /**
     * The maximum number of documents to be processed in a batch.
     */
    batch_size: number;
    /**
     * The maximum number of batches to be processed.
     */
    batches_limit: number;
}

/**
 * Interface representing the settings for targetting files.
 */
interface FileHandlingSettings {
    /**
     * The regular expression for files to be synchronised.
     */
    syncOnlyRegEx: CustomRegExpSourceList<"|[]|">; // I really regret this delimiter.
    /**
     * The regular expression for files to be ignored during synchronisation.
     */
    syncIgnoreRegEx: CustomRegExpSourceList<"|[]|">;
}

/**
 * Interface representing the settings for processing behaviour.
 */
interface ProcessingBehaviourSettings {
    /**
     * Hash cache maximum count.
     */
    hashCacheMaxCount: number;
    /**
     * Hash cache maximum amount.
     */
    hashCacheMaxAmount: number;
}

/**
 * Interface representing the settings for remote database tweaks.
 */
interface RemoteDBTweakSettings {
    /**
     * Indicates whether to ignore the version check.
     */
    ignoreVersionCheck: boolean;
    /**
     * Indicates whether to ignore and continue syncing even if the configuration-mismatch is detected.
     * (Note: Mismatched settings can lead to inappropriate de-duplication, leading to storage wastage and increased traffic).
     */
    disableCheckingConfigMismatch: boolean;
}

/**
 * Interface representing the settings for optional and not exposed remote database settings.
 */
interface OptionalAndNotExposedRemoteDBSettings {
    /**
     * Indicates whether to accept empty passphrase.
     * This not meant to `Not be encrypted`, but `Be encrypted with empty passphrase`.
     */
    permitEmptyPassphrase: boolean;
}

/**
 * Interface representing the settings for cross-platform interoperability.
 */
interface CrossPlatformInteroperabilitySettings {
    /**
     * Indicates whether to handle filename case sensitively.
     */
    handleFilenameCaseSensitive: boolean;
}

/**
 * Interface representing the settings for conflict handling.
 */
interface ConflictHandlingSettings {
    /**
     * Indicates whether to check conflicts only on file open.
     */
    checkConflictOnlyOnOpen: boolean;

    /**
     * Indicates whether to show the merge dialog only on active file.
     */
    showMergeDialogOnlyOnActive: boolean;
}

/**
 * Settings that define the behavior of the merge process.
 */
interface MergeBehaviourSettings {
    /**
     * Indicates whether to synchronise after merging.
     */
    syncAfterMerge: boolean;

    /**
     * Determines if conflicts should be resolved by choosing the newer file.
     */
    resolveConflictsByNewerFile: boolean;

    /**
     * Specifies whether to write documents even if there are conflicts.
     */
    writeDocumentsIfConflicted: boolean;

    /**
     * Disables automatic merging of markdown files.
     */
    disableMarkdownAutoMerge: boolean;
}

/**
 * Configuration settings for handling edge cases in the application.
 */
interface EdgeCaseHandlingSettings {
    /**
     * An optional suffix to append to the database name after the vault name.
     */
    additionalSuffixOfDatabaseName: string | undefined;

    /**
     * Flag to disable the worker thread for generating chunks.
     */
    disableWorkerForGeneratingChunks: boolean;

    /**
     * Flag to process small files in the UI thread instead of a worker thread.
     */
    processSmallFilesInUIThread: boolean;

    /**
     * Indicates whether to use timeout for PouchDB replication.
     */
    useTimeouts: boolean;
}

/**
 * Configuration settings for handling deleted files.
 */
interface DeletedFileMetadataSettings {
    /**
     * Indicates whether to delete metadata of deleted files.
     */
    deleteMetadataOfDeletedFiles: boolean;
    /**
     * The number of days to wait before automatically deleting metadata of deleted files.
     */
    automaticallyDeleteMetadataOfDeletedFiles: number;
}

interface ObsidianLiveSyncSettings_PluginSetting
    extends SyncMethodSettings,
        UISettings,
        FileHandlingSettings,
        MergeBehaviourSettings,
        EncryptedUserSettings,
        PeriodicReplicationSettings,
        InternalFileSettings,
        PluginSyncSettings,
        ModeSettings,
        ExtraTweakSettings,
        BetaTweakSettings,
        ObsoleteSettings,
        DebugModeSettings,
        SettingSyncSettings,
        SafetyValveSettings,
        DataOnSettings {}

export type RemoteDBSettings = CouchDBConnection &
    BucketSyncSetting &
    RemoteTypeSettings &
    EncryptionSettings &
    ChunkSettings &
    EdenSettings &
    DataOnRemoteDBSettings &
    ObsoleteRemoteDBSettings &
    OnDemandChunkSettings &
    BetaRemoteDBSettings &
    ReplicationSetting &
    RemoteDBTweakSettings &
    FileHandlingSettings &
    ProcessingBehaviourSettings &
    OptionalAndNotExposedRemoteDBSettings &
    CrossPlatformInteroperabilitySettings &
    ConflictHandlingSettings &
    EdgeCaseHandlingSettings &
    DeletedFileMetadataSettings &
    P2PSyncSetting;

export type ObsidianLiveSyncSettings = ObsidianLiveSyncSettings_PluginSetting & RemoteDBSettings & LocalDBSettings;

export const DEFAULT_SETTINGS: ObsidianLiveSyncSettings = {
    remoteType: REMOTE_COUCHDB,
    useCustomRequestHandler: false,
    couchDB_URI: "",
    couchDB_USER: "",
    couchDB_PASSWORD: "",
    couchDB_DBNAME: "",
    liveSync: false,
    syncOnSave: false,
    syncOnStart: false,
    savingDelay: 200,
    lessInformationInLog: false,
    gcDelay: 300,
    versionUpFlash: "",
    minimumChunkSize: 20,
    longLineThreshold: 250,
    showVerboseLog: false,
    suspendFileWatching: false,
    trashInsteadDelete: true,
    periodicReplication: false,
    periodicReplicationInterval: 60,
    syncOnFileOpen: false,
    encrypt: false,
    passphrase: "",
    usePathObfuscation: false,
    doNotDeleteFolder: false,
    resolveConflictsByNewerFile: false,
    batchSave: false,
    batchSaveMinimumDelay: 5,
    batchSaveMaximumDelay: 60,
    deviceAndVaultName: "",
    usePluginSettings: false,
    showOwnPlugins: false,
    showStatusOnEditor: true,
    showStatusOnStatusbar: true,
    showOnlyIconsOnEditor: false,
    hideFileWarningNotice: false,
    usePluginSync: false,
    autoSweepPlugins: false,
    autoSweepPluginsPeriodic: false,
    notifyPluginOrSettingUpdated: false,
    checkIntegrityOnSave: false,
    batch_size: 25,
    batches_limit: 25,
    useHistory: false,
    disableRequestURI: false,
    skipOlderFilesOnSync: true,
    checkConflictOnlyOnOpen: false,
    showMergeDialogOnlyOnActive: false,
    syncInternalFiles: false,
    syncInternalFilesBeforeReplication: false,
    syncInternalFilesIgnorePatterns:
        "\\/node_modules\\/, \\/\\.git\\/, \\/obsidian-livesync\\/" as CustomRegExpSourceList<",">,
    syncInternalFilesTargetPatterns: "" as CustomRegExpSourceList<",">,
    syncInternalFilesInterval: 60,
    additionalSuffixOfDatabaseName: "",
    ignoreVersionCheck: false,
    lastReadUpdates: 0,
    deleteMetadataOfDeletedFiles: false,
    syncIgnoreRegEx: "" as CustomRegExpSourceList<"|[]|">,
    syncOnlyRegEx: "" as CustomRegExpSourceList<"|[]|">,
    customChunkSize: 0,
    readChunksOnline: true,
    watchInternalFileChanges: true,
    automaticallyDeleteMetadataOfDeletedFiles: 0,
    disableMarkdownAutoMerge: false,
    writeDocumentsIfConflicted: false,
    useDynamicIterationCount: false,
    syncAfterMerge: false,
    configPassphraseStore: "",
    encryptedPassphrase: "",
    encryptedCouchDBConnection: "",
    permitEmptyPassphrase: false,
    useIndexedDBAdapter: false,
    useTimeouts: false,
    writeLogToTheFile: false,
    doNotPaceReplication: false,
    hashCacheMaxCount: 300,
    hashCacheMaxAmount: 50,
    concurrencyOfReadChunksOnline: 40,
    minimumIntervalOfReadChunksOnline: 50,
    hashAlg: "xxhash64",
    suspendParseReplicationResult: false,
    doNotSuspendOnFetching: false,
    useIgnoreFiles: false,
    ignoreFiles: ".gitignore",
    syncOnEditorSave: false,
    pluginSyncExtendedSetting: {},
    syncMaxSizeInMB: 50,
    settingSyncFile: "",
    writeCredentialsForSettingSync: false,
    notifyAllSettingSyncFile: false,
    isConfigured: undefined,
    settingVersion: CURRENT_SETTING_VERSION,
    enableCompression: false,
    accessKey: "",
    bucket: "",
    endpoint: "",
    region: "auto",
    secretKey: "",
    useEden: false,
    maxChunksInEden: 10,
    maxTotalLengthInEden: 1024,
    maxAgeInEden: 10,
    disableCheckingConfigMismatch: false,
    displayLanguage: "",
    /**
     * @deprecated
     */
    enableChunkSplitterV2: false,
    disableWorkerForGeneratingChunks: false,
    processSmallFilesInUIThread: false,
    notifyThresholdOfRemoteStorageSize: -1,

    usePluginSyncV2: false,
    usePluginEtc: false,
    handleFilenameCaseSensitive: undefined!,
    doNotUseFixedRevisionForChunks: true,
    showLongerLogInsideEditor: false,
    sendChunksBulk: false,
    sendChunksBulkMaxSize: 1,
    /**
     * @deprecated
     * This setting is no longer used and will be removed in the future.
     */
    useSegmenter: false,
    useAdvancedMode: false,
    usePowerUserMode: false,
    useEdgeCaseMode: false,
    enableDebugTools: false,
    suppressNotifyHiddenFilesChange: false,
    syncMinimumInterval: 2000,
    ...P2P_DEFAULT_SETTINGS,
    doctorProcessedVersion: "",

    bucketCustomHeaders: "",
    couchDB_CustomHeaders: "",
    useJWT: false,
    jwtAlgorithm: "",
    jwtKey: "",
    jwtKid: "",
    jwtSub: "",
    jwtExpDuration: 5,
    useRequestAPI: false,
    bucketPrefix: "",
    chunkSplitterVersion: "",
    E2EEAlgorithm: E2EEAlgorithms.V2,
    processSizeMismatchedFiles: false,
    forcePathStyle: true,
    syncInternalFileOverwritePatterns: "" as CustomRegExpSourceList<",">,
    useOnlyLocalChunk: false,
};

export const KeyIndexOfSettings: Record<keyof ObsidianLiveSyncSettings, number> = {
    remoteType: 0,
    useCustomRequestHandler: 1,
    couchDB_URI: 2,
    couchDB_USER: 3,
    couchDB_PASSWORD: 4,
    couchDB_DBNAME: 5,
    minimumChunkSize: 6,
    longLineThreshold: 7,
    encrypt: 8,
    passphrase: 9,
    usePathObfuscation: 10,
    checkIntegrityOnSave: 11,
    batch_size: 12,
    batches_limit: 13,
    useHistory: 14,
    disableRequestURI: 15,
    checkConflictOnlyOnOpen: 16,
    showMergeDialogOnlyOnActive: 17,
    additionalSuffixOfDatabaseName: 18,
    ignoreVersionCheck: 19,
    deleteMetadataOfDeletedFiles: 20,
    customChunkSize: 21,
    readChunksOnline: 22,
    automaticallyDeleteMetadataOfDeletedFiles: 23,
    useDynamicIterationCount: 24,
    permitEmptyPassphrase: 25,
    useTimeouts: 26,
    doNotPaceReplication: 27,
    hashCacheMaxCount: 28,
    hashCacheMaxAmount: 29,
    concurrencyOfReadChunksOnline: 30,
    minimumIntervalOfReadChunksOnline: 31,
    hashAlg: 32,
    enableCompression: 33,
    accessKey: 34,
    bucket: 35,
    endpoint: 36,
    region: 37,
    secretKey: 38,
    useEden: 39,
    maxChunksInEden: 40,
    maxTotalLengthInEden: 41,
    maxAgeInEden: 42,
    disableCheckingConfigMismatch: 43,
    handleFilenameCaseSensitive: 44,
    doNotUseFixedRevisionForChunks: 45,
    sendChunksBulk: 46,
    sendChunksBulkMaxSize: 47,
    useSegmenter: 48,
    liveSync: 49,
    syncOnSave: 50,
    syncOnStart: 51,
    syncOnFileOpen: 52,
    syncOnEditorSave: 53,
    syncMinimumInterval: 54,
    showVerboseLog: 55,
    lessInformationInLog: 56,
    showLongerLogInsideEditor: 57,
    showStatusOnEditor: 58,
    showStatusOnStatusbar: 59,
    showOnlyIconsOnEditor: 60,
    displayLanguage: 61,
    trashInsteadDelete: 62,
    doNotDeleteFolder: 63,
    batchSave: 64,
    batchSaveMinimumDelay: 64,
    batchSaveMaximumDelay: 65,
    syncMaxSizeInMB: 66,
    useIgnoreFiles: 67,
    ignoreFiles: 68,
    syncOnlyRegEx: 69,
    syncIgnoreRegEx: 70,
    syncAfterMerge: 71,
    resolveConflictsByNewerFile: 72,
    writeDocumentsIfConflicted: 73,
    disableMarkdownAutoMerge: 74,
    configPassphraseStore: 75,
    encryptedPassphrase: 76,
    encryptedCouchDBConnection: 77,
    periodicReplication: 78,
    periodicReplicationInterval: 79,
    syncInternalFiles: 80,
    syncInternalFilesBeforeReplication: 81,
    syncInternalFilesInterval: 82,
    syncInternalFilesIgnorePatterns: 83,
    watchInternalFileChanges: 84,
    suppressNotifyHiddenFilesChange: 85,
    usePluginSync: 86,
    usePluginSettings: 87,
    showOwnPlugins: 88,
    autoSweepPlugins: 89,
    autoSweepPluginsPeriodic: 90,
    notifyPluginOrSettingUpdated: 91,
    deviceAndVaultName: 92,
    usePluginSyncV2: 93,
    usePluginEtc: 94,
    pluginSyncExtendedSetting: 95,
    useAdvancedMode: 96,
    usePowerUserMode: 97,
    useEdgeCaseMode: 98,
    notifyThresholdOfRemoteStorageSize: 99,
    disableWorkerForGeneratingChunks: 100,
    processSmallFilesInUIThread: 101,
    enableChunkSplitterV2: 102,
    savingDelay: 103,
    gcDelay: 104,
    skipOlderFilesOnSync: 105,
    useIndexedDBAdapter: 106,
    enableDebugTools: 107,
    writeLogToTheFile: 108,
    settingSyncFile: 109,
    writeCredentialsForSettingSync: 110,
    notifyAllSettingSyncFile: 111,
    suspendFileWatching: 112,
    suspendParseReplicationResult: 113,
    doNotSuspendOnFetching: 114,
    versionUpFlash: 115,
    settingVersion: 116,
    isConfigured: 117,
    lastReadUpdates: 118,
    doctorProcessedVersion: 119,
    P2P_Enabled: 120,
    P2P_relays: 121,
    P2P_roomID: 122,
    P2P_passphrase: 123,
    P2P_AutoAccepting: 124,
    P2P_AutoStart: 125,
    P2P_AutoBroadcast: 126,
    P2P_AutoSyncPeers: 127,
    P2P_AutoWatchPeers: 128,
    P2P_SyncOnReplication: 129,
    P2P_AppID: 130,
    P2P_RebuildFrom: 131,
    bucketCustomHeaders: 132,
    couchDB_CustomHeaders: 133,
    useJWT: 134,
    jwtAlgorithm: 135,
    jwtKey: 136,
    jwtKid: 137,
    jwtSub: 138,
    jwtExpDuration: 139,
    P2P_AutoAcceptingPeers: 140,
    P2P_AutoDenyingPeers: 141,
    P2P_IsHeadless: -1,
    syncInternalFilesTargetPatterns: 142,
    useRequestAPI: 143,
    hideFileWarningNotice: 144,
    bucketPrefix: 145,
    chunkSplitterVersion: 146,
    E2EEAlgorithm: 147,
    processSizeMismatchedFiles: 148,
    forcePathStyle: 149,
    P2P_DevicePeerName: -1,
    P2P_turnServers: 150,
    P2P_turnUsername: 151,
    P2P_turnCredential: 152,
    syncInternalFileOverwritePatterns: 153,
    useOnlyLocalChunk: 154,
} as const;

export interface HasSettings<T extends Partial<ObsidianLiveSyncSettings>> {
    settings: T;
}

export const PREFERRED_BASE: Partial<ObsidianLiveSyncSettings> = {
    syncMaxSizeInMB: 50,
    chunkSplitterVersion: "v3-rabin-karp",
    doNotUseFixedRevisionForChunks: false,
    usePluginSyncV2: true,
    handleFilenameCaseSensitive: false,
    E2EEAlgorithm: E2EEAlgorithms.V2,
};

export const PREFERRED_SETTING_CLOUDANT: Partial<ObsidianLiveSyncSettings> = {
    ...PREFERRED_BASE,
    customChunkSize: 0,
    sendChunksBulkMaxSize: 1,
    concurrencyOfReadChunksOnline: 100,
    minimumIntervalOfReadChunksOnline: 333,
};
export const PREFERRED_SETTING_SELF_HOSTED: Partial<ObsidianLiveSyncSettings> = {
    ...PREFERRED_BASE,
    customChunkSize: 50,
    sendChunksBulkMaxSize: 1,
    concurrencyOfReadChunksOnline: 30,
    minimumIntervalOfReadChunksOnline: 25,
};
export const PREFERRED_JOURNAL_SYNC: Partial<ObsidianLiveSyncSettings> = {
    ...PREFERRED_BASE,
    customChunkSize: 10,
    concurrencyOfReadChunksOnline: 30,
    minimumIntervalOfReadChunksOnline: 25,
};

export const EntryTypes = {
    NOTE_LEGACY: "notes",
    NOTE_BINARY: "newnote",
    NOTE_PLAIN: "plain",
    INTERNAL_FILE: "internalfile",
    CHUNK: "leaf",
    CHUNK_PACK: "chunkpack",
    VERSION_INFO: "versioninfo",
    SYNC_INFO: "syncinfo",
    SYNC_PARAMETERS: "sync-parameters",
    MILESTONE_INFO: "milestoneinfo",
    NODE_INFO: "nodeinfo",
} as const;
export const NoteTypes = [EntryTypes.NOTE_LEGACY, EntryTypes.NOTE_BINARY, EntryTypes.NOTE_PLAIN];
export const ChunkTypes = [EntryTypes.CHUNK, EntryTypes.CHUNK_PACK];
export type EntryType = (typeof EntryTypes)[keyof typeof EntryTypes];
export type EntryTypes = typeof EntryTypes;
export type EntryTypeNotes = EntryTypes["NOTE_BINARY"] | EntryTypes["NOTE_PLAIN"];
export type EntryTypeNotesWithLegacy = EntryTypeNotes | EntryTypes["NOTE_LEGACY"];

/**
 * Represents an entry in the database.
 */
export interface DatabaseEntry {
    /**
     * The ID of the document.
     */
    _id: DocumentID;

    /**
     * The revision of the document.
     */
    _rev?: string;

    /**
     * Deleted flag.
     */
    _deleted?: boolean;

    /**
     * Conflicts (if exists).
     */
    _conflicts?: string[];
}

/**
 * Represents the base structure for an entry that represents a file.
 */
export type EntryBase = {
    /**
     * The creation time of the file.
     */
    ctime: number;
    /**
     * The modification time of the file.
     */
    mtime: number;
    /**
     * The size of the file.
     */
    size: number;
    /**
     * Deleted flag.
     */
    deleted?: boolean;
};

export type EdenChunk = {
    data: string;
    epoch: number;
};

export type EntryWithEden = {
    eden: Record<DocumentID, EdenChunk>;
};

export type NoteEntry = DatabaseEntry &
    EntryBase &
    EntryWithEden & {
        /**
         * The path of the file.
         */
        path: FilePathWithPrefix;
        /**
         * Contents of the file.
         */
        data: string | string[];
        /**
         * The type of the entry.
         */
        type: EntryTypes["NOTE_LEGACY"];
    };

export type NewEntry = DatabaseEntry &
    EntryBase &
    EntryWithEden & {
        /**
         * The path of the file.
         */
        path: FilePathWithPrefix;
        /**
         * Chunk IDs indicating the contents of the file.
         */
        children: string[];
        /**
         * The type of the entry.
         */
        type: EntryTypes["NOTE_BINARY"];
    };
export type PlainEntry = DatabaseEntry &
    EntryBase &
    EntryWithEden & {
        /**
         * The path of the file.
         */
        path: FilePathWithPrefix;
        /**
         * Chunk IDs indicating the contents of the file.
         */
        children: string[];
        /**
         * The type of the entry.
         */
        type: EntryTypes["NOTE_PLAIN"];
    };

export type InternalFileEntry = DatabaseEntry &
    NewEntry &
    EntryBase & {
        deleted?: boolean;
        // type: "newnote";
    };

export type AnyEntry = NoteEntry | NewEntry | PlainEntry | InternalFileEntry;

export type LoadedEntry = AnyEntry & {
    data: string | string[];
    datatype: EntryTypeNotes;
};
export type SavingEntry = AnyEntry & {
    data: Blob;
    datatype: EntryTypeNotes;
};

export type MetaEntry = AnyEntry & {
    children: string[];
    // datatype: "plain" | "newnote";
};
export function isMetaEntry(entry: AnyEntry): entry is MetaEntry {
    return "children" in entry;
}

export type EntryLeaf = DatabaseEntry & {
    type: EntryTypes["CHUNK"];
    data: string;
    isCorrupted?: boolean;
    // received?: boolean;
};

export type EntryChunkPack = DatabaseEntry & {
    type: EntryTypes["CHUNK_PACK"];
    data: string; //Record<string, string>;
};

export interface EntryVersionInfo extends DatabaseEntry {
    type: EntryTypes["VERSION_INFO"];
    version: number;
}
export interface EntryHasPath {
    path: FilePathWithPrefix | FilePath;
}
export interface ChunkVersionRange {
    min: number; //lower compatible chunk format version
    max: number; //maximum compatible chunk format version.
    current: number; //current chunk version.
}

export const TweakValuesShouldMatchedTemplate: Partial<ObsidianLiveSyncSettings> = {
    minimumChunkSize: 20,
    longLineThreshold: 250,
    encrypt: false,
    usePathObfuscation: false,
    enableCompression: false,
    useEden: false,
    customChunkSize: 0,
    useDynamicIterationCount: false,
    hashAlg: "xxhash64",
    enableChunkSplitterV2: false,
    maxChunksInEden: 10,
    maxTotalLengthInEden: 1024,
    maxAgeInEden: 10,
    usePluginSyncV2: false,
    handleFilenameCaseSensitive: false,
    doNotUseFixedRevisionForChunks: true,
    useSegmenter: false,
    E2EEAlgorithm: E2EEAlgorithms.V2,
    chunkSplitterVersion: ChunkAlgorithms.RabinKarp,
};

type TweakKeys = keyof TweakValues;

export const IncompatibleChanges: TweakKeys[] = [
    "encrypt",
    "usePathObfuscation",
    "useDynamicIterationCount",
    "handleFilenameCaseSensitive",
] as const;

export const CompatibleButLossyChanges: TweakKeys[] = ["hashAlg"];

type IncompatibleRecommendationPatterns<T extends TweakKeys> = {
    key: T;
    isRecommendation?: boolean;
} & (
    | {
          from: TweakValues[T];
          to: TweakValues[T];
      }
    | {
          from: TweakValues[T];
      }
    | {
          to: TweakValues[T];
      }
);

export const IncompatibleChangesInSpecificPattern: IncompatibleRecommendationPatterns<TweakKeys>[] = [
    { key: "doNotUseFixedRevisionForChunks", from: true, to: false, isRecommendation: true },
    { key: "doNotUseFixedRevisionForChunks", to: true, isRecommendation: false },
] as const;

export const TweakValuesRecommendedTemplate: Partial<ObsidianLiveSyncSettings> = {
    useIgnoreFiles: false,
    useCustomRequestHandler: false,

    batch_size: 25,
    batches_limit: 25,
    // useIndexedDBAdapter: false,
    useTimeouts: false,
    readChunksOnline: true,
    hashCacheMaxCount: 300,
    hashCacheMaxAmount: 50,
    concurrencyOfReadChunksOnline: 40,
    minimumIntervalOfReadChunksOnline: 50,
    ignoreFiles: ".gitignore",
    syncMaxSizeInMB: 50,
    enableChunkSplitterV2: false,
    usePluginSyncV2: true,
    handleFilenameCaseSensitive: false,
    doNotUseFixedRevisionForChunks: false,
    E2EEAlgorithm: E2EEAlgorithms.V2,
    chunkSplitterVersion: ChunkAlgorithms.RabinKarp,
};
export const TweakValuesDefault: Partial<ObsidianLiveSyncSettings> = {
    usePluginSyncV2: false,
    E2EEAlgorithm: DEFAULT_SETTINGS.E2EEAlgorithm,
    chunkSplitterVersion: DEFAULT_SETTINGS.chunkSplitterVersion,
};

export const configurationNames: Partial<Record<keyof ObsidianLiveSyncSettings, ConfigurationItem>> = {
    minimumChunkSize: {
        name: "Minimum Chunk Size (Not Configurable from the UI Now).",
    },
    longLineThreshold: {
        name: "Longest chunk line threshold value (Not Configurable from the UI Now).",
    },
    encrypt: {
        name: "End-to-End Encryption",
        desc: "Encrypt contents on the remote database. If you use the plugin's synchronization feature, enabling this is recommended.",
    },
    usePathObfuscation: {
        name: "Property Encryption",
        desc: "If enabled, the file properties will be encrypted in the remote database. This is useful for protecting sensitive information in file paths, sizes, and IDs of its chunks. If you are using V1 E2EE, this only obfuscates the file path.",
    },
    enableCompression: {
        name: "Data Compression",
        status: "EXPERIMENTAL",
    },
    useEden: {
        name: "Incubate Chunks in Document",
        desc: "If enabled, newly created chunks are temporarily kept within the document, and graduated to become independent chunks once stabilised.",
        status: "BETA",
    },
    customChunkSize: {
        name: "Enhance chunk size",
    },
    useDynamicIterationCount: {
        name: "Use dynamic iteration count",
        status: "EXPERIMENTAL",
    },
    hashAlg: {
        name: "The Hash algorithm for chunk IDs",
        status: "EXPERIMENTAL",
    },
    enableChunkSplitterV2: {
        name: "Use splitting-limit-capped chunk splitter",
        desc: "If enabled, chunks will be split into no more than 100 items. However, dedupe is slightly weaker.",
    },
    maxChunksInEden: {
        name: "Maximum Incubating Chunks",
        desc: "The maximum number of chunks that can be incubated within the document. Chunks exceeding this number will immediately graduate to independent chunks.",
    },
    maxTotalLengthInEden: {
        name: "Maximum Incubating Chunk Size",
        desc: "The maximum total size of chunks that can be incubated within the document. Chunks exceeding this size will immediately graduate to independent chunks.",
    },
    maxAgeInEden: {
        name: "Maximum Incubation Period",
        desc: "The maximum duration for which chunks can be incubated within the document. Chunks exceeding this period will graduate to independent chunks.",
    },
    usePluginSyncV2: {
        name: "Per-file-saved customization sync",
        desc: "If enabled per-filed efficient customization sync will be used. We need a small migration when enabling this. And all devices should be updated to v0.23.18. Once we enabled this, we lost a compatibility with old versions.",
    },
    handleFilenameCaseSensitive: {
        name: "Handle files as Case-Sensitive",
        desc: "If this enabled, All files are handled as case-Sensitive (Previous behaviour).",
    },
    doNotUseFixedRevisionForChunks: {
        name: "Compute revisions for chunks (Previous behaviour)",
        desc: "If this enabled, all chunks will be stored with the revision made from its content. (Previous behaviour)",
    },
    useSegmenter: {
        name: "Use Segmented-splitter",
        desc: "If this enabled, chunks will be split into semantically meaningful segments. Not all platforms support this feature.",
    },
    useJWT: {
        name: "Use JWT instead of Basic Authentication",
        desc: "If this enabled, JWT will be used for authentication.",
        isAdvanced: true,
    },
    jwtAlgorithm: {
        name: "JWT Algorithm",
        desc: "The algorithm used for JWT authentication.",
        isAdvanced: true,
    },
    jwtKey: {
        name: "Keypair or pre-shared key",
        desc: "The key (PSK in HSxxx in base64, or private key in ESxxx in PEM) used for JWT authentication.",
        isAdvanced: true,
        isHidden: true,
        // placeHolder:""
    },
    jwtKid: {
        name: "Key ID",
        desc: "The key ID. this should be matched with CouchDB->jwt_keys->ALG:_`kid`.",
        isAdvanced: true,
    },
    jwtExpDuration: {
        name: "Rotation Duration",
        desc: "The Rotation duration of token in minutes. Each generated tokens will be valid only within this duration.",
        isAdvanced: true,
    },
    jwtSub: {
        name: "Subject (whoami)",
        desc: "The subject for JWT authentication. Mostly username.",
        isAdvanced: true,
    },
    bucketCustomHeaders: {
        name: "Custom Headers",
        desc: "Custom headers for requesting the bucket. e.g. `x-custom-header1: value1\n x-custom-header2: value2`",
        placeHolder: "x-custom-header1: value1\n x-custom-header2: value2",
    },
    couchDB_CustomHeaders: {
        name: "Custom Headers",
        desc: "Custom headers for requesting the CouchDB. e.g. `x-custom-header1: value1\n x-custom-header2: value2`",
        placeHolder: "x-custom-header1: value1\n x-custom-header2: value2",
    },
    chunkSplitterVersion: {
        name: "Chunk Splitter",
        desc: "Now we can choose how to split the chunks; V3 is the most efficient. If you have troubled, please make this Default or Legacy.",
    },
    E2EEAlgorithm: {
        name: "End-to-End Encryption Algorithm",
        desc: "Please use V2, V1 is deprecated and will be removed in the future, It was not a very appropriate algorithm. Only for compatibility V1 is kept.",
        isAdvanced: true,
    },
    P2P_AppID: {
        name: "Application ID",
        desc: "The Application ID for P2P connection. This should be same among your devices. Default is 'self-hosted-livesync' and could not be modified from the UI.",
        isAdvanced: true,
    },
    P2P_relays: {
        name: "Signalling Relays",
        desc: "The Nostr relay servers to establish connections for P2P connections. Multiple servers can be separated by commas.",
        placeHolder: "wss://relay1.example.com,wss://relay2.example.com",
    },
    P2P_roomID: {
        name: "Room ID",
        desc: "The Room ID for P2P connection. This should be same among your devices.",
    },
    P2P_passphrase: {
        name: "Passphrase",
        desc: "The Passphrase for P2P connection. This should be same among your devices.",
        isHidden: true,
    },
    P2P_turnServers: {
        name: "TURN Servers",
        desc: "The TURN servers to use for P2P connections. Multiple servers can be separated by commas.",
        placeHolder: "turn:turn1.example.com,turn:turn2.example.com",
    },
    P2P_turnUsername: {
        name: "TURN Username",
        desc: "The username for the TURN servers.",
    },
    P2P_turnCredential: {
        name: "TURN Credential",
        desc: "The credential/password for the TURN servers.",
        isHidden: true,
    },
    useOnlyLocalChunk: {
        name: "Use Only Local Chunks",
        desc: "If enabled, the plugin will not attempt to connect to the remote database even if the chunk was not found locally.",
        isAdvanced: true,
    },
};

export const LEVEL_ADVANCED = "ADVANCED";
export const LEVEL_POWER_USER = "POWER_USER";
export const LEVEL_EDGE_CASE = "EDGE_CASE";
export type ConfigLevel = "" | "ADVANCED" | "POWER_USER" | "EDGE_CASE";
export type ConfigurationItem = {
    name: string;
    desc?: string;
    placeHolder?: string;
    status?: "BETA" | "ALPHA" | "EXPERIMENTAL";
    obsolete?: boolean;
    level?: ConfigLevel;
    isHidden?: boolean;
    isAdvanced?: boolean;
};

/**
 * Get human readable Configuration stability
 * @param status
 * @returns
 */
export function statusDisplay(status?: string): string {
    if (!status) return "";
    if (status == "EXPERIMENTAL") return ` (Experimental)`;
    if (status == "ALPHA") return ` (Alpha)`;
    if (status == "BETA") return ` (Beta)`;
    return ` (${status})`;
}

/**
 * Get human readable configuration name.
 * @param key configuration key
 * @param alt
 * @returns
 */
export function confName(key: keyof ObsidianLiveSyncSettings, alt: string = "") {
    if (key in configurationNames) {
        return `${configurationNames[key]?.name}${statusDisplay(configurationNames[key]?.status)}`;
    } else {
        return `${alt || ""}`;
    }
}

/**
 * Get human readable configuration description.
 * @param key configuration key
 * @param alt
 * @returns
 */
export function confDesc(key: keyof ObsidianLiveSyncSettings, alt?: string) {
    if (key in configurationNames) {
        if (configurationNames[key]?.desc) {
            return `${configurationNames[key]?.name}${statusDisplay(configurationNames[key]?.status)}`;
        }
        return alt;
    } else {
        return alt;
    }
}
export const TweakValuesTemplate = { ...TweakValuesRecommendedTemplate, ...TweakValuesShouldMatchedTemplate };
export type TweakValues = typeof TweakValuesTemplate;

export const DEVICE_ID_PREFERRED = "PREFERRED";

export type NodeKey = string;
export interface DeviceInfo {
    /**
     * Name of the device (Initially from deviceAndVaultName setting, configurable).
     */
    device_name: string;
    /**
     * Vault name (From vaultName setting).
     */
    vault_name: string;
    /**
     * Obsidian App version of the device.
     */
    app_version: string;
    /**
     * Plugin version of the device.
     */
    plugin_version: string;
    progress: string;
}
export interface NodeData extends DeviceInfo {
    /**
     * Epoch time in milliseconds when the device last connected.
     */
    last_connected: number;
}
export interface EntryMilestoneInfo extends DatabaseEntry {
    _id: typeof MILESTONE_DOCID;
    type: EntryTypes["MILESTONE_INFO"];
    created: number;
    accepted_nodes: string[];
    node_info: { [key: NodeKey]: NodeData };
    locked: boolean;
    cleaned?: boolean;
    node_chunk_info: { [key: NodeKey]: ChunkVersionRange };
    tweak_values: { [key: NodeKey]: TweakValues };
}

export interface EntryNodeInfo extends DatabaseEntry {
    _id: typeof NODEINFO_DOCID;
    type: EntryTypes["NODE_INFO"];
    nodeid: string;
    v20220607?: boolean;
}

export type EntryBody = NoteEntry | NewEntry | PlainEntry | InternalFileEntry;

export type EntryDoc =
    | EntryBody
    | LoadedEntry
    | EntryLeaf
    | EntryVersionInfo
    | EntryMilestoneInfo
    | EntryNodeInfo
    | EntryChunkPack;

export type diff_result_leaf = {
    rev: string;
    data: string;
    ctime: number;
    mtime: number;
    deleted?: boolean;
};
export type dmp_result = Array<[number, string]>;

export type diff_result = {
    left: diff_result_leaf;
    right: diff_result_leaf;
    diff: dmp_result;
};

export type DIFF_CHECK_RESULT_AUTO =
    | typeof CANCELLED
    | typeof AUTO_MERGED
    | typeof NOT_CONFLICTED
    | typeof MISSING_OR_ERROR;

export type diff_check_result = DIFF_CHECK_RESULT_AUTO | diff_result;

export type Credential = {
    username: string;
    password: string;
};

export type EntryDocResponse = EntryDoc & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta;

export const DatabaseConnectingStatuses = {
    STARTED: "STARTED",
    NOT_CONNECTED: "NOT_CONNECTED",
    PAUSED: "PAUSED",
    CONNECTED: "CONNECTED",
    COMPLETED: "COMPLETED",
    CLOSED: "CLOSED",
    ERRORED: "ERRORED",
    JOURNAL_SEND: "JOURNAL_SEND",
    JOURNAL_RECEIVE: "JOURNAL_RECEIVE",
} as const;
export type DatabaseConnectingStatus = (typeof DatabaseConnectingStatuses)[keyof typeof DatabaseConnectingStatuses];

// export type DatabaseConnectingStatus =
//     | "STARTED"
//     | "NOT_CONNECTED"
//     | "PAUSED"
//     | "CONNECTED"
//     | "COMPLETED"
//     | "CLOSED"
//     | "ERRORED"
//     | "JOURNAL_SEND"
//     | "JOURNAL_RECEIVE";

export const PREFIXMD_LOGFILE = "livesync_log_";
export const PREFIXMD_LOGFILE_UC = "LIVESYNC_LOG_";

export const FlagFilesOriginal = {
    SUSPEND_ALL: "redflag.md" as FilePath,
    REBUILD_ALL: "redflag2.md" as FilePath,
    FETCH_ALL: "redflag3.md" as FilePath,
} as const;

export const FlagFilesHumanReadable = {
    REBUILD_ALL: "flag_rebuild.md" as FilePath,
    FETCH_ALL: "flag_fetch.md" as FilePath,
} as const;

/**
 * @deprecated Use `FlagFilesOriginal.SUSPEND_ALL` instead.
 */
export const FLAGMD_REDFLAG = FlagFilesOriginal.SUSPEND_ALL;
/**
 * @deprecated Use `FlagFilesHumanReadable.REBUILD_ALL` instead.
 */
export const FLAGMD_REDFLAG2 = FlagFilesOriginal.REBUILD_ALL;
/**
 * @deprecated Use `FlagFilesHumanReadable.FETCH_ALL` instead.
 */
export const FLAGMD_REDFLAG2_HR = FlagFilesHumanReadable.REBUILD_ALL;
/**
 * @deprecated Use `FlagFilesOriginal.FETCH_ALL` instead.
 */
export const FLAGMD_REDFLAG3 = FlagFilesOriginal.FETCH_ALL;
/**
 * @deprecated Use `FlagFilesHumanReadable.FETCH_ALL` instead.
 */
export const FLAGMD_REDFLAG3_HR = FlagFilesHumanReadable.FETCH_ALL;

export const SYNCINFO_ID = "syncinfo" as DocumentID;

export interface SyncInfo extends DatabaseEntry {
    _id: typeof SYNCINFO_ID;
    type: EntryTypes["SYNC_INFO"];
    data: string;
}

export const SALT_OF_PASSPHRASE = "rHGMPtr6oWw7VSa3W3wpa8fT8U";
export const SALT_OF_ID = "a83hrf7f\u0003y7sa8g31";
export const SEED_MURMURHASH = 0x12345678;

export const IDPrefixes = {
    Obfuscated: "f:",
    Chunk: "h:",
    EncryptedChunk: "h:+",
};
/**
 * @deprecated Use `IDPrefixes.Obfuscated` instead.
 */
export const PREFIX_OBFUSCATED = "f:";
/**
 * @deprecated Use `IDPrefixes.Chunk` instead.
 */
export const PREFIX_CHUNK = "h:";
/**
 * @deprecated Use `IDPrefixes.EncryptedChunk` instead.
 */
export const PREFIX_ENCRYPTED_CHUNK = "h:+";

export type UXStat = {
    size: number;
    mtime: number;
    ctime: number;
    type: "file" | "folder";
};

export type UXFileInfo = UXFileInfoStub & {
    body: Blob;
};
// export type UXFileInfoStub = UXFileFileInfoStub;
export type UXAbstractInfoStub = UXFileInfoStub | UXFolderInfo;

export type UXFileInfoStub = {
    name: string;
    path: FilePath | FilePathWithPrefix;
    stat: UXStat;
    deleted?: boolean;
    isFolder?: false;
    isInternal?: boolean;
};
export type UXInternalFileInfoStub = {
    name: string;
    path: FilePath | FilePathWithPrefix;
    deleted?: boolean;
    isFolder?: false;
    isInternal: true;
    stat: undefined;
};

export type UXFolderInfo = {
    name: string;
    path: FilePath | FilePathWithPrefix;
    deleted?: boolean;
    isFolder: true;
    children: UXFileInfoStub[];
    parent: FilePath | FilePathWithPrefix | undefined;
};

export type UXDataWriteOptions = {
    /**
     * Time of creation, represented as a unix timestamp, in milliseconds.
     * Omit this if you want to keep the default behaviour.
     * @public
     * */
    ctime?: number;
    /**
     * Time of last modification, represented as a unix timestamp, in milliseconds.
     * Omit this if you want to keep the default behaviour.
     * @public
     */
    mtime?: number;
};

export type CacheData = string | ArrayBuffer;
export type FileEventType = "CREATE" | "DELETE" | "CHANGED" | "INTERNAL";
export type FileEventArgs = {
    file: UXFileInfoStub | UXInternalFileInfoStub;
    cache?: CacheData;
    oldPath?: string;
    ctx?: any;
};
export type FileEventItem = {
    type: FileEventType;
    args: FileEventArgs;
    key: string;
    skipBatchWait?: boolean;
    cancelled?: boolean;
    batched?: boolean;
};

export type Prettify<T> = {
    [K in keyof T]: T[K];
    // deno-lint-ignore ban-types
} & {};

export type CouchDBCredentials = BasicCredentials | JWTCredentials;

export type BasicCredentials = {
    username: string;
    password: string;
    type: "basic";
};

export type JWTCredentials = {
    jwtAlgorithm: CouchDBConnection["jwtAlgorithm"];
    jwtKey: string;
    jwtKid: string;
    jwtSub: string;
    jwtExpDuration: number;
    type: "jwt";
};

export interface JWTHeader {
    alg: string;
    typ: string;
    kid?: string;
}
export interface JWTPayload {
    sub: string;
    exp: number;
    iss?: string;
    iat: number;
    [key: string]: any;
}
export interface JWTParams {
    header: JWTHeader;
    payload: JWTPayload;
    credentials: JWTCredentials;
}
export interface PreparedJWT {
    header: JWTHeader;
    payload: JWTPayload;
    token: string;
}

export type CustomRegExpSource = TaggedType<string, "CustomRegExp">;
export type CustomRegExpSourceList<D extends string = ","> = TaggedType<string, `CustomRegExpList${D}`>;

export type ParsedCustomRegExp = [isInverted: boolean, pattern: string];

export const ProtocolVersions = {
    UNSET: undefined,
    LEGACY: 1,
    ADVANCED_E2EE: 2,
} as const;

export type ProtocolVersion = (typeof ProtocolVersions)[keyof typeof ProtocolVersions];
export const DOCID_SYNC_PARAMETERS = "_local/obsidian_livesync_sync_parameters" as DocumentID;
export const DOCID_JOURNAL_SYNC_PARAMETERS = "_obsidian_livesync_journal_sync_parameters.json" as DocumentID;

export interface SyncParameters extends DatabaseEntry {
    _id: typeof DOCID_SYNC_PARAMETERS;
    _rev?: string;
    type: EntryTypes["SYNC_PARAMETERS"];
    protocolVersion: ProtocolVersion;
    pbkdf2salt: string;
}
export const DEFAULT_SYNC_PARAMETERS: SyncParameters = {
    _id: DOCID_SYNC_PARAMETERS,
    type: EntryTypes["SYNC_PARAMETERS"],
    protocolVersion: ProtocolVersions.ADVANCED_E2EE,
    pbkdf2salt: "",
};

export const SETTING_KEY_P2P_DEVICE_NAME = "p2p_device_name";

export const configURIBase = "obsidian://setuplivesync?settings=";
export const configURIBaseQR = "obsidian://setuplivesync?settingsQR=";

export const SuffixDatabaseName = "-livesync-v2";
export const ExtraSuffixIndexedDB = "-indexeddb";
