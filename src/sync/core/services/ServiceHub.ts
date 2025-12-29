import type {
    APIService,
    PathService,
    DatabaseService,
    DatabaseEventService,
    ReplicatorService,
    FileProcessingService,
    ReplicationService,
    RemoteService,
    AppLifecycleService,
    SettingService,
    TweakValueService,
    VaultService,
    ConflictService,
    TestService,
    UIService,
} from "./Services.ts";

export type ServiceInstances = {
    API?: APIService;
    path?: PathService;
    database?: DatabaseService;
    databaseEvents?: DatabaseEventService;
    replicator?: ReplicatorService;
    fileProcessing?: FileProcessingService;
    replication?: ReplicationService;
    remote?: RemoteService;
    conflict?: ConflictService;
    appLifecycle?: AppLifecycleService;
    setting?: SettingService;
    tweakValue?: TweakValueService;
    vault?: VaultService;
    test?: TestService;
    ui?: UIService;
};

export abstract class ServiceHub {
    protected abstract _api: APIService;
    protected abstract _path: PathService;
    protected abstract _database: DatabaseService;
    protected abstract _databaseEvents: DatabaseEventService;
    protected abstract _replicator: ReplicatorService;
    protected abstract _fileProcessing: FileProcessingService;
    protected abstract _replication: ReplicationService;
    protected abstract _remote: RemoteService;
    protected abstract _conflict: ConflictService;
    protected abstract _appLifecycle: AppLifecycleService;
    protected abstract _setting: SettingService;
    protected abstract _tweakValue: TweakValueService;
    protected abstract _vault: VaultService;
    protected abstract _test: TestService;
    protected abstract _ui: UIService;

    protected _injected: ServiceInstances = {};
    constructor(services: ServiceInstances = {}) {
        for (const service of Object.values(services)) {
            service.setServices(this);
        }
        this._injected = services;
    }

    get API(): APIService {
        return this._injected.API || this._api;
    }
    get path(): PathService {
        return this._injected.path || this._path;
    }
    get database(): DatabaseService {
        return this._injected.database || this._database;
    }
    get databaseEvents(): DatabaseEventService {
        return this._injected.databaseEvents || this._databaseEvents;
    }
    get replicator(): ReplicatorService {
        return this._injected.replicator || this._replicator;
    }
    get fileProcessing(): FileProcessingService {
        return this._injected.fileProcessing || this._fileProcessing;
    }
    get replication(): ReplicationService {
        return this._injected.replication || this._replication;
    }
    get remote(): RemoteService {
        return this._injected.remote || this._remote;
    }
    get conflict(): ConflictService {
        return this._injected.conflict || this._conflict;
    }
    get appLifecycle(): AppLifecycleService {
        return this._injected.appLifecycle || this._appLifecycle;
    }
    get setting(): SettingService {
        return this._injected.setting || this._setting;
    }
    get tweakValue(): TweakValueService {
        return this._injected.tweakValue || this._tweakValue;
    }
    get vault(): VaultService {
        return this._injected.vault || this._vault;
    }
    get test(): TestService {
        return this._injected.test || this._test;
    }

    get UI(): UIService {
        return this._injected.ui || this._ui;
    }
}
