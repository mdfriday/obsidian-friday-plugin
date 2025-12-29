import { LOG_LEVEL_DEBUG, Logger } from "octagonal-wheels/common/logger";
import { ServiceHub, type ServiceInstances } from "./ServiceHub.ts";
import {
    APIService,
    AppLifecycleService,
    ConflictService,
    DatabaseEventService,
    DatabaseService,
    FileProcessingService,
    PathService,
    RemoteService,
    ReplicationService,
    ReplicatorService,
    SettingService,
    TestService,
    ThroughHole,
    TweakValueService,
    VaultService,
    type ConfigService,
    type UIService,
} from "./Services.ts";
import { ServiceBackend } from "./ServiceBackend.ts";

function _getFunction<T extends keyof ServiceHub, M extends Extract<keyof ServiceHub[T], string | number>>(
    throughHole: ThroughHole,
    key: `${T}.${M}`
): ServiceHub[T][M] {
    return throughHole.getFunction(key) as ServiceHub[T][M];
}
function _getBindFunction<T extends keyof ServiceHub, M extends Extract<keyof ServiceHub[T], string | number>>(
    throughHole: ThroughHole,
    key: `${T}.${M}`
) {
    return (func: ServiceHub[T][M] extends (...args: infer P) => infer R ? (...args: P) => R : never) => {
        Logger(`Binding function ${key}`, LOG_LEVEL_DEBUG);
        throughHole.bindFunction(key, func);
    };
}

function bindMethod<T extends keyof ServiceHub, M extends Extract<keyof ServiceHub[T], string | number>>(
    throughHole: ThroughHole,
    key: `${T}.${M}`
) {
    return [_getFunction(throughHole, key), _getBindFunction(throughHole, key)] as const;
}

type HandlerFunc<F extends (...args: any[]) => any> = (handler: (...args: Parameters<F>) => ReturnType<F>) => void;

export class InjectableAPIService extends APIService {
    _throughHole: ThroughHole;
    addLog: typeof APIService.prototype.addLog;
    getCustomFetchHandler: typeof APIService.prototype.getCustomFetchHandler;
    isMobile: typeof APIService.prototype.isMobile;
    showWindow: typeof APIService.prototype.showWindow;
    getAppID: typeof APIService.prototype.getAppID;
    getAppVersion: typeof APIService.prototype.getAppVersion;
    getPluginVersion: typeof APIService.prototype.getPluginVersion;
    isLastPostFailedDueToPayloadSize: typeof APIService.prototype.isLastPostFailedDueToPayloadSize;

    handleAddLog: HandlerFunc<typeof APIService.prototype.addLog>;
    handleGetCustomFetchHandler: HandlerFunc<typeof APIService.prototype.getCustomFetchHandler>;
    handleIsMobile: HandlerFunc<typeof APIService.prototype.isMobile>;
    handleShowWindow: HandlerFunc<typeof APIService.prototype.showWindow>;
    handleGetAppID: HandlerFunc<typeof APIService.prototype.getAppID>;
    handleIsLastPostFailedDueToPayloadSize: HandlerFunc<typeof APIService.prototype.isLastPostFailedDueToPayloadSize>;

    handleGetAppVersion: HandlerFunc<typeof APIService.prototype.getAppVersion>;
    handleGetPluginVersion: HandlerFunc<typeof APIService.prototype.getPluginVersion>;

    override getPlatform(): string {
        return "unknown";
    }

    constructor(backend: ServiceBackend, throughHole: ThroughHole) {
        super(backend);
        this._throughHole = throughHole;
        [this.addLog, this.handleAddLog] = bindMethod(this._throughHole, "API.addLog");
        [this.getCustomFetchHandler, this.handleGetCustomFetchHandler] = bindMethod(
            this._throughHole,
            "API.getCustomFetchHandler"
        );
        [this.isMobile, this.handleIsMobile] = bindMethod(this._throughHole, "API.isMobile");
        [this.showWindow, this.handleShowWindow] = bindMethod(this._throughHole, "API.showWindow");
        [this.getAppID, this.handleGetAppID] = bindMethod(this._throughHole, "API.getAppID");
        [this.isLastPostFailedDueToPayloadSize, this.handleIsLastPostFailedDueToPayloadSize] = bindMethod(
            this._throughHole,
            "API.isLastPostFailedDueToPayloadSize"
        );
        [this.getAppVersion, this.handleGetAppVersion] = bindMethod(this._throughHole, "API.getAppVersion");
        [this.getPluginVersion, this.handleGetPluginVersion] = bindMethod(this._throughHole, "API.getPluginVersion");
    }
}

export class InjectablePathService extends PathService {
    _throughHole: ThroughHole;
    id2path: typeof PathService.prototype.id2path;
    path2id: typeof PathService.prototype.path2id;
    handleId2Path: HandlerFunc<typeof PathService.prototype.id2path>;
    handlePath2Id: HandlerFunc<typeof PathService.prototype.path2id>;
    constructor(backend: ServiceBackend, throughHole: ThroughHole) {
        super(backend);
        this._throughHole = throughHole;
        [this.id2path, this.handleId2Path] = bindMethod(this._throughHole, "path.id2path");
        [this.path2id, this.handlePath2Id] = bindMethod(this._throughHole, "path.path2id");
    }
}

export class InjectableDatabaseService extends DatabaseService {
    _throughHole: ThroughHole;
    createPouchDBInstance: typeof DatabaseService.prototype.createPouchDBInstance;
    openSimpleStore: typeof DatabaseService.prototype.openSimpleStore;
    openDatabase: typeof DatabaseService.prototype.openDatabase;
    resetDatabase: typeof DatabaseService.prototype.resetDatabase;
    isDatabaseReady: typeof DatabaseService.prototype.isDatabaseReady;

    handleCreatePouchDBInstance: HandlerFunc<typeof DatabaseService.prototype.createPouchDBInstance>;
    handleOpenSimpleStore: HandlerFunc<typeof DatabaseService.prototype.openSimpleStore>;
    handleOpenDatabase: HandlerFunc<typeof DatabaseService.prototype.openDatabase>;
    handleResetDatabase: HandlerFunc<typeof DatabaseService.prototype.resetDatabase>;
    handleIsDatabaseReady: HandlerFunc<typeof DatabaseService.prototype.isDatabaseReady>;

    constructor(backend: ServiceBackend, throughHole: ThroughHole) {
        super(backend);
        this._throughHole = throughHole;
        [this.createPouchDBInstance, this.handleCreatePouchDBInstance] = bindMethod(
            this._throughHole,
            "database.createPouchDBInstance"
        );
        [this.openSimpleStore, this.handleOpenSimpleStore] = bindMethod(this._throughHole, "database.openSimpleStore");
        [this.openDatabase, this.handleOpenDatabase] = bindMethod(this._throughHole, "database.openDatabase");
        [this.resetDatabase, this.handleResetDatabase] = bindMethod(this._throughHole, "database.resetDatabase");
        [this.isDatabaseReady, this.handleIsDatabaseReady] = bindMethod(this._throughHole, "database.isDatabaseReady");
    }
}
export class InjectableDatabaseEventService extends DatabaseEventService {
    _throughHole: ThroughHole;
    initialiseDatabase: typeof DatabaseEventService.prototype.initialiseDatabase;
    handleInitialiseDatabase: HandlerFunc<typeof DatabaseEventService.prototype.initialiseDatabase>;
    constructor(backend: ServiceBackend, throughHole: ThroughHole) {
        super(backend);
        this._throughHole = throughHole;
        [this.initialiseDatabase, this.handleInitialiseDatabase] = bindMethod(
            this._throughHole,
            "databaseEvents.initialiseDatabase"
        );
    }
}

export class InjectableReplicatorService extends ReplicatorService {
    _throughHole: ThroughHole;
    getActiveReplicator: typeof ReplicatorService.prototype.getActiveReplicator;
    handleGetActiveReplicator: HandlerFunc<typeof ReplicatorService.prototype.getActiveReplicator>;
    constructor(backend: ServiceBackend, throughHole: ThroughHole) {
        super(backend);
        this._throughHole = throughHole;
        [this.getActiveReplicator, this.handleGetActiveReplicator] = bindMethod(
            this._throughHole,
            "replicator.getActiveReplicator"
        );
    }
}
export class InjectableFileProcessingService extends FileProcessingService {
    _throughHole: ThroughHole;
    // No proxied functions
    constructor(backend: ServiceBackend, throughHole: ThroughHole) {
        super(backend);
        this._throughHole = throughHole;
    }
}

export class InjectableReplicationService extends ReplicationService {
    _throughHole: ThroughHole;
    parseSynchroniseResult: typeof ReplicationService.prototype.parseSynchroniseResult;
    isReplicationReady: typeof ReplicationService.prototype.isReplicationReady;
    replicate: typeof ReplicationService.prototype.replicate;
    replicateByEvent: typeof ReplicationService.prototype.replicateByEvent;
    handleParseSynchroniseResult: HandlerFunc<typeof ReplicationService.prototype.parseSynchroniseResult>;
    handleIsReplicationReady: HandlerFunc<typeof ReplicationService.prototype.isReplicationReady>;
    handleReplicate: HandlerFunc<typeof ReplicationService.prototype.replicate>;
    handleReplicateByEvent: HandlerFunc<typeof ReplicationService.prototype.replicateByEvent>;

    constructor(backend: ServiceBackend, throughHole: ThroughHole) {
        super(backend);
        this._throughHole = throughHole;
        [this.parseSynchroniseResult, this.handleParseSynchroniseResult] = bindMethod(
            this._throughHole,
            "replication.parseSynchroniseResult"
        );
        [this.isReplicationReady, this.handleIsReplicationReady] = bindMethod(
            this._throughHole,
            "replication.isReplicationReady"
        );
        [this.replicate, this.handleReplicate] = bindMethod(this._throughHole, "replication.replicate");
        [this.replicateByEvent, this.handleReplicateByEvent] = bindMethod(
            this._throughHole,
            "replication.replicateByEvent"
        );
    }
}
export class InjectableRemoteService extends RemoteService {
    _throughHole: ThroughHole;
    replicateAllToRemote: typeof RemoteService.prototype.replicateAllToRemote;
    replicateAllFromRemote: typeof RemoteService.prototype.replicateAllFromRemote;
    markLocked: typeof RemoteService.prototype.markLocked;
    markUnlocked: typeof RemoteService.prototype.markUnlocked;
    markResolved: typeof RemoteService.prototype.markResolved;
    tryResetDatabase: typeof RemoteService.prototype.tryResetDatabase;
    tryCreateDatabase: typeof RemoteService.prototype.tryCreateDatabase;
    connect: typeof RemoteService.prototype.connect;
    handleReplicateAllToRemote: HandlerFunc<typeof RemoteService.prototype.replicateAllToRemote>;
    handleReplicateAllFromRemote: HandlerFunc<typeof RemoteService.prototype.replicateAllFromRemote>;
    handleMarkLocked: HandlerFunc<typeof RemoteService.prototype.markLocked>;
    handleMarkUnlocked: HandlerFunc<typeof RemoteService.prototype.markUnlocked>;
    handleMarkResolved: HandlerFunc<typeof RemoteService.prototype.markResolved>;
    handleTryResetDatabase: HandlerFunc<typeof RemoteService.prototype.tryResetDatabase>;
    handleTryCreateDatabase: HandlerFunc<typeof RemoteService.prototype.tryCreateDatabase>;
    handleConnect: HandlerFunc<typeof RemoteService.prototype.connect>;
    constructor(backend: ServiceBackend, throughHole: ThroughHole) {
        super(backend);
        this._throughHole = throughHole;
        [this.replicateAllToRemote, this.handleReplicateAllToRemote] = bindMethod(
            this._throughHole,
            "remote.replicateAllToRemote"
        );
        [this.replicateAllFromRemote, this.handleReplicateAllFromRemote] = bindMethod(
            this._throughHole,
            "remote.replicateAllFromRemote"
        );
        [this.markLocked, this.handleMarkLocked] = bindMethod(this._throughHole, "remote.markLocked");
        [this.markUnlocked, this.handleMarkUnlocked] = bindMethod(this._throughHole, "remote.markUnlocked");
        [this.markResolved, this.handleMarkResolved] = bindMethod(this._throughHole, "remote.markResolved");
        [this.tryResetDatabase, this.handleTryResetDatabase] = bindMethod(this._throughHole, "remote.tryResetDatabase");
        [this.tryCreateDatabase, this.handleTryCreateDatabase] = bindMethod(
            this._throughHole,
            "remote.tryCreateDatabase"
        );
        [this.connect, this.handleConnect] = bindMethod(this._throughHole, "remote.connect");
    }
}
export class InjectableConflictService extends ConflictService {
    _throughHole: ThroughHole;
    queueCheckForIfOpen: typeof ConflictService.prototype.queueCheckForIfOpen;
    queueCheckFor: typeof ConflictService.prototype.queueCheckFor;
    ensureAllProcessed: typeof ConflictService.prototype.ensureAllProcessed;
    resolveByDeletingRevision: typeof ConflictService.prototype.resolveByDeletingRevision;
    resolve: typeof ConflictService.prototype.resolve;
    resolveByNewest: typeof ConflictService.prototype.resolveByNewest;
    handleQueueCheckForIfOpen: HandlerFunc<typeof ConflictService.prototype.queueCheckForIfOpen>;
    handleQueueCheckFor: HandlerFunc<typeof ConflictService.prototype.queueCheckFor>;
    handleEnsureAllProcessed: HandlerFunc<typeof ConflictService.prototype.ensureAllProcessed>;
    handleResolveByDeletingRevision: HandlerFunc<typeof ConflictService.prototype.resolveByDeletingRevision>;
    handleResolve: HandlerFunc<typeof ConflictService.prototype.resolve>;
    handleResolveByNewest: HandlerFunc<typeof ConflictService.prototype.resolveByNewest>;

    constructor(backend: ServiceBackend, throughHole: ThroughHole) {
        super(backend);
        this._throughHole = throughHole;
        [this.queueCheckForIfOpen, this.handleQueueCheckForIfOpen] = bindMethod(
            this._throughHole,
            "conflict.queueCheckForIfOpen"
        );
        [this.queueCheckFor, this.handleQueueCheckFor] = bindMethod(this._throughHole, "conflict.queueCheckFor");
        [this.ensureAllProcessed, this.handleEnsureAllProcessed] = bindMethod(
            this._throughHole,
            "conflict.ensureAllProcessed"
        );
        [this.resolveByDeletingRevision, this.handleResolveByDeletingRevision] = bindMethod(
            this._throughHole,
            "conflict.resolveByDeletingRevision"
        );
        [this.resolve, this.handleResolve] = bindMethod(this._throughHole, "conflict.resolve");
        [this.resolveByNewest, this.handleResolveByNewest] = bindMethod(this._throughHole, "conflict.resolveByNewest");
    }
}

export class InjectableAppLifecycleService extends AppLifecycleService {
    _throughHole: ThroughHole;
    performRestart: typeof AppLifecycleService.prototype.performRestart;
    askRestart: typeof AppLifecycleService.prototype.askRestart;
    scheduleRestart: typeof AppLifecycleService.prototype.scheduleRestart;
    isSuspended: typeof AppLifecycleService.prototype.isSuspended;
    setSuspended: typeof AppLifecycleService.prototype.setSuspended;
    isReady: typeof AppLifecycleService.prototype.isReady;
    markIsReady: typeof AppLifecycleService.prototype.markIsReady;
    resetIsReady: typeof AppLifecycleService.prototype.resetIsReady;
    hasUnloaded: typeof AppLifecycleService.prototype.hasUnloaded;
    isReloadingScheduled: typeof AppLifecycleService.prototype.isReloadingScheduled;
    handlePerformRestart: HandlerFunc<typeof AppLifecycleService.prototype.performRestart>;
    handleAskRestart: HandlerFunc<typeof AppLifecycleService.prototype.askRestart>;
    handleScheduleRestart: HandlerFunc<typeof AppLifecycleService.prototype.scheduleRestart>;
    handleIsSuspended: HandlerFunc<typeof AppLifecycleService.prototype.isSuspended>;
    handleSetSuspended: HandlerFunc<typeof AppLifecycleService.prototype.setSuspended>;
    handleIsReady: HandlerFunc<typeof AppLifecycleService.prototype.isReady>;
    handleMarkIsReady: HandlerFunc<typeof AppLifecycleService.prototype.markIsReady>;
    handleResetIsReady: HandlerFunc<typeof AppLifecycleService.prototype.resetIsReady>;
    handleHasUnloaded: HandlerFunc<typeof AppLifecycleService.prototype.hasUnloaded>;
    handleIsReloadingScheduled: HandlerFunc<typeof AppLifecycleService.prototype.isReloadingScheduled>;

    constructor(backend: ServiceBackend, throughHole: ThroughHole) {
        super(backend);
        this._throughHole = throughHole;
        [this.performRestart, this.handlePerformRestart] = bindMethod(this._throughHole, "appLifecycle.performRestart");
        [this.askRestart, this.handleAskRestart] = bindMethod(this._throughHole, "appLifecycle.askRestart");
        [this.scheduleRestart, this.handleScheduleRestart] = bindMethod(
            this._throughHole,
            "appLifecycle.scheduleRestart"
        );
        [this.isSuspended, this.handleIsSuspended] = bindMethod(this._throughHole, "appLifecycle.isSuspended");
        [this.setSuspended, this.handleSetSuspended] = bindMethod(this._throughHole, "appLifecycle.setSuspended");
        [this.isReady, this.handleIsReady] = bindMethod(this._throughHole, "appLifecycle.isReady");
        [this.markIsReady, this.handleMarkIsReady] = bindMethod(this._throughHole, "appLifecycle.markIsReady");
        [this.resetIsReady, this.handleResetIsReady] = bindMethod(this._throughHole, "appLifecycle.resetIsReady");
        [this.hasUnloaded, this.handleHasUnloaded] = bindMethod(this._throughHole, "appLifecycle.hasUnloaded");
        [this.isReloadingScheduled, this.handleIsReloadingScheduled] = bindMethod(
            this._throughHole,
            "appLifecycle.isReloadingScheduled"
        );
    }
}
export class InjectableSettingService extends SettingService {
    _throughHole: ThroughHole;
    clearUsedPassphrase: typeof SettingService.prototype.clearUsedPassphrase;
    realiseSetting: typeof SettingService.prototype.realiseSetting;
    decryptSettings: typeof SettingService.prototype.decryptSettings;
    adjustSettings: typeof SettingService.prototype.adjustSettings;
    getDeviceAndVaultName: typeof SettingService.prototype.getDeviceAndVaultName;
    setDeviceAndVaultName: typeof SettingService.prototype.setDeviceAndVaultName;
    saveDeviceAndVaultName: typeof SettingService.prototype.saveDeviceAndVaultName;
    saveSettingData: typeof SettingService.prototype.saveSettingData;
    loadSettings: typeof SettingService.prototype.loadSettings;
    currentSettings: typeof SettingService.prototype.currentSettings;
    shouldCheckCaseInsensitively: typeof SettingService.prototype.shouldCheckCaseInsensitively;
    importSettings: typeof SettingService.prototype.importSettings;

    handleClearUsedPassphrase: HandlerFunc<typeof SettingService.prototype.clearUsedPassphrase>;
    handleRealiseSetting: HandlerFunc<typeof SettingService.prototype.realiseSetting>;
    handleDecryptSettings: HandlerFunc<typeof SettingService.prototype.decryptSettings>;
    handleAdjustSettings: HandlerFunc<typeof SettingService.prototype.adjustSettings>;
    handleGetDeviceAndVaultName: HandlerFunc<typeof SettingService.prototype.getDeviceAndVaultName>;
    handleSetDeviceAndVaultName: HandlerFunc<typeof SettingService.prototype.setDeviceAndVaultName>;
    handleSaveDeviceAndVaultName: HandlerFunc<typeof SettingService.prototype.saveDeviceAndVaultName>;
    handleSaveSettingData: HandlerFunc<typeof SettingService.prototype.saveSettingData>;
    handleLoadSettings: HandlerFunc<typeof SettingService.prototype.loadSettings>;
    handleCurrentSettings: HandlerFunc<typeof SettingService.prototype.currentSettings>;
    handleShouldCheckCaseInsensitively: HandlerFunc<typeof SettingService.prototype.shouldCheckCaseInsensitively>;

    handleImportSettings: HandlerFunc<typeof SettingService.prototype.importSettings>;

    constructor(backend: ServiceBackend, throughHole: ThroughHole) {
        super(backend);
        this._throughHole = throughHole;
        [this.clearUsedPassphrase, this.handleClearUsedPassphrase] = bindMethod(
            this._throughHole,
            "setting.clearUsedPassphrase"
        );
        [this.realiseSetting, this.handleRealiseSetting] = bindMethod(this._throughHole, "setting.realiseSetting");
        [this.decryptSettings, this.handleDecryptSettings] = bindMethod(this._throughHole, "setting.decryptSettings");
        [this.adjustSettings, this.handleAdjustSettings] = bindMethod(this._throughHole, "setting.adjustSettings");
        [this.getDeviceAndVaultName, this.handleGetDeviceAndVaultName] = bindMethod(
            this._throughHole,
            "setting.getDeviceAndVaultName"
        );
        [this.setDeviceAndVaultName, this.handleSetDeviceAndVaultName] = bindMethod(
            this._throughHole,
            "setting.setDeviceAndVaultName"
        );
        [this.saveDeviceAndVaultName, this.handleSaveDeviceAndVaultName] = bindMethod(
            this._throughHole,
            "setting.saveDeviceAndVaultName"
        );
        [this.saveSettingData, this.handleSaveSettingData] = bindMethod(this._throughHole, "setting.saveSettingData");
        [this.loadSettings, this.handleLoadSettings] = bindMethod(this._throughHole, "setting.loadSettings");
        [this.currentSettings, this.handleCurrentSettings] = bindMethod(this._throughHole, "setting.currentSettings");
        [this.shouldCheckCaseInsensitively, this.handleShouldCheckCaseInsensitively] = bindMethod(
            this._throughHole,
            "setting.shouldCheckCaseInsensitively"
        );
        [this.importSettings, this.handleImportSettings] = bindMethod(this._throughHole, "setting.importSettings");
    }
}
export class InjectableTweakValueService extends TweakValueService {
    _throughHole: ThroughHole;
    fetchRemotePreferred: typeof TweakValueService.prototype.fetchRemotePreferred;
    checkAndAskResolvingMismatched: typeof TweakValueService.prototype.checkAndAskResolvingMismatched;

    askResolvingMismatched: typeof TweakValueService.prototype.askResolvingMismatched;
    checkAndAskUseRemoteConfiguration: typeof TweakValueService.prototype.checkAndAskUseRemoteConfiguration;
    askUseRemoteConfiguration: typeof TweakValueService.prototype.askUseRemoteConfiguration;
    handleFetchRemotePreferred: HandlerFunc<typeof TweakValueService.prototype.fetchRemotePreferred>;
    handleCheckAndAskResolvingMismatched: HandlerFunc<
        typeof TweakValueService.prototype.checkAndAskResolvingMismatched
    >;
    handleAskResolvingMismatched: HandlerFunc<typeof TweakValueService.prototype.askResolvingMismatched>;
    handleCheckAndAskUseRemoteConfiguration: HandlerFunc<
        typeof TweakValueService.prototype.checkAndAskUseRemoteConfiguration
    >;
    handleAskUseRemoteConfiguration: HandlerFunc<typeof TweakValueService.prototype.askUseRemoteConfiguration>;

    constructor(backend: ServiceBackend, throughHole: ThroughHole) {
        super(backend);
        this._throughHole = throughHole;
        [this.fetchRemotePreferred, this.handleFetchRemotePreferred] = bindMethod(
            this._throughHole,
            "tweakValue.fetchRemotePreferred"
        );
        [this.checkAndAskResolvingMismatched, this.handleCheckAndAskResolvingMismatched] = bindMethod(
            this._throughHole,
            "tweakValue.checkAndAskResolvingMismatched"
        );
        [this.askResolvingMismatched, this.handleAskResolvingMismatched] = bindMethod(
            this._throughHole,
            "tweakValue.askResolvingMismatched"
        );
        [this.checkAndAskUseRemoteConfiguration, this.handleCheckAndAskUseRemoteConfiguration] = bindMethod(
            this._throughHole,
            "tweakValue.checkAndAskUseRemoteConfiguration"
        );
        [this.askUseRemoteConfiguration, this.handleAskUseRemoteConfiguration] = bindMethod(
            this._throughHole,
            "tweakValue.askUseRemoteConfiguration"
        );
    }
}
export class InjectableVaultService extends VaultService {
    _throughHole: ThroughHole;
    getVaultName: typeof VaultService.prototype.getVaultName;
    scanVault: typeof VaultService.prototype.scanVault;
    isIgnoredByIgnoreFile: typeof VaultService.prototype.isIgnoredByIgnoreFile;
    isTargetFile: typeof VaultService.prototype.isTargetFile;
    isFileSizeTooLarge: typeof VaultService.prototype.isFileSizeTooLarge;
    getActiveFilePath: typeof VaultService.prototype.getActiveFilePath;
    markFileListPossiblyChanged: typeof VaultService.prototype.markFileListPossiblyChanged;
    isStorageInsensitive: typeof VaultService.prototype.isStorageInsensitive;
    vaultName: typeof VaultService.prototype.getVaultName;

    handleGetVaultName: HandlerFunc<typeof VaultService.prototype.getVaultName>;
    handleScanVault: HandlerFunc<typeof VaultService.prototype.scanVault>;
    handleIsIgnoredByIgnoreFile: HandlerFunc<typeof VaultService.prototype.isIgnoredByIgnoreFile>;
    handleIsTargetFile: HandlerFunc<typeof VaultService.prototype.isTargetFile>;
    handleIsFileSizeTooLarge: HandlerFunc<typeof VaultService.prototype.isFileSizeTooLarge>;
    handleGetActiveFilePath: HandlerFunc<typeof VaultService.prototype.getActiveFilePath>;
    handleMarkFileListPossiblyChanged: HandlerFunc<typeof VaultService.prototype.markFileListPossiblyChanged>;
    handleIsStorageInsensitive: HandlerFunc<typeof VaultService.prototype.isStorageInsensitive>;
    handleVaultName: HandlerFunc<typeof VaultService.prototype.getVaultName>;

    constructor(backend: ServiceBackend, throughHole: ThroughHole) {
        super(backend);
        this._throughHole = throughHole;
        [this.getVaultName, this.handleGetVaultName] = bindMethod(this._throughHole, "vault.getVaultName");
        [this.scanVault, this.handleScanVault] = bindMethod(this._throughHole, "vault.scanVault");
        [this.isIgnoredByIgnoreFile, this.handleIsIgnoredByIgnoreFile] = bindMethod(
            this._throughHole,
            "vault.isIgnoredByIgnoreFile"
        );
        [this.isTargetFile, this.handleIsTargetFile] = bindMethod(this._throughHole, "vault.isTargetFile");
        [this.isFileSizeTooLarge, this.handleIsFileSizeTooLarge] = bindMethod(
            this._throughHole,
            "vault.isFileSizeTooLarge"
        );
        [this.getActiveFilePath, this.handleGetActiveFilePath] = bindMethod(
            this._throughHole,
            "vault.getActiveFilePath"
        );
        [this.markFileListPossiblyChanged, this.handleMarkFileListPossiblyChanged] = bindMethod(
            this._throughHole,
            "vault.markFileListPossiblyChanged"
        );
        [this.isStorageInsensitive, this.handleIsStorageInsensitive] = bindMethod(
            this._throughHole,
            "vault.isStorageInsensitive"
        );
        [this.vaultName, this.handleVaultName] = bindMethod(this._throughHole, "vault.vaultName");
    }
}

export class InjectableTestService extends TestService {
    _throughHole: ThroughHole;
    addTestResult: typeof TestService.prototype.addTestResult;
    handleAddTestResult: HandlerFunc<typeof TestService.prototype.addTestResult>;
    constructor(backend: ServiceBackend, throughHole: ThroughHole) {
        super(backend);
        this._throughHole = throughHole;
        [this.addTestResult, this.handleAddTestResult] = bindMethod(this._throughHole, "test.addTestResult");
    }
}

export class InjectableServiceHub extends ServiceHub {
    protected _serviceBackend = new ServiceBackend();
    protected _throughHole = new ThroughHole();

    protected readonly _api: InjectableAPIService = new InjectableAPIService(this._serviceBackend, this._throughHole);
    // readonly _file: FileService = new ObsidianFileService(this._serviceBackend, this._throughHole);

    protected readonly _path: InjectablePathService = new InjectablePathService(
        this._serviceBackend,
        this._throughHole
    );
    protected readonly _database: InjectableDatabaseService = new InjectableDatabaseService(
        this._serviceBackend,
        this._throughHole
    );
    protected readonly _databaseEvents: InjectableDatabaseEventService = new InjectableDatabaseEventService(
        this._serviceBackend,
        this._throughHole
    );
    protected readonly _replicator: InjectableReplicatorService = new InjectableReplicatorService(
        this._serviceBackend,
        this._throughHole
    );
    protected readonly _fileProcessing: InjectableFileProcessingService = new InjectableFileProcessingService(
        this._serviceBackend,
        this._throughHole
    );
    protected readonly _replication: InjectableReplicationService = new InjectableReplicationService(
        this._serviceBackend,
        this._throughHole
    );
    protected readonly _remote: InjectableRemoteService = new InjectableRemoteService(
        this._serviceBackend,
        this._throughHole
    );
    protected readonly _conflict: InjectableConflictService = new InjectableConflictService(
        this._serviceBackend,
        this._throughHole
    );

    protected readonly _appLifecycle: InjectableAppLifecycleService = new InjectableAppLifecycleService(
        this._serviceBackend,
        this._throughHole
    );
    protected readonly _setting: InjectableSettingService = new InjectableSettingService(
        this._serviceBackend,
        this._throughHole
    );
    protected readonly _tweakValue: InjectableTweakValueService = new InjectableTweakValueService(
        this._serviceBackend,
        this._throughHole
    );
    protected readonly _vault: InjectableVaultService = new InjectableVaultService(
        this._serviceBackend,
        this._throughHole
    );
    protected readonly _test: InjectableTestService = new InjectableTestService(
        this._serviceBackend,
        this._throughHole
    );
    protected readonly _ui: UIService;
    protected readonly _config: ConfigService;

    get API(): InjectableAPIService {
        return this._api;
    }
    get path(): InjectablePathService {
        return this._path;
    }
    get database(): InjectableDatabaseService {
        return this._database;
    }
    get databaseEvents(): InjectableDatabaseEventService {
        return this._databaseEvents;
    }
    get replicator(): InjectableReplicatorService {
        return this._replicator;
    }
    get fileProcessing(): InjectableFileProcessingService {
        return this._fileProcessing;
    }
    get replication(): InjectableReplicationService {
        return this._replication;
    }
    get remote(): InjectableRemoteService {
        return this._remote;
    }
    get conflict(): InjectableConflictService {
        return this._conflict;
    }
    get appLifecycle(): InjectableAppLifecycleService {
        return this._appLifecycle;
    }
    get setting(): InjectableSettingService {
        return this._setting;
    }
    get tweakValue(): InjectableTweakValueService {
        return this._tweakValue;
    }
    get vault(): InjectableVaultService {
        return this._vault;
    }
    get test(): InjectableTestService {
        return this._test;
    }

    get UI(): UIService {
        return this._ui;
    }
    get config(): ConfigService {
        return this._config;
    }

    constructor(services: ServiceInstances & { ui: UIService; config: ConfigService }) {
        super(services);
        this._ui = services.ui;
        this._config = services.config;
    }
}
