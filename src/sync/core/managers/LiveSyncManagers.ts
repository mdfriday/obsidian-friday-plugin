import { LiveSyncError } from "../common/LSError.ts";
import type {
    EntryDoc,
    DocumentID,
    EntryHasPath,
    FilePathWithPrefix,
    FilePath,
    RemoteDBSettings,
} from "../common/types";
import { ContentSplitter } from "../ContentSplitter/ContentSplitters.ts";
import { ChangeManager } from "../managers/ChangeManager.ts";
import { ChunkFetcher } from "../managers/ChunkFetcher.ts";
import { ChunkManager } from "../managers/ChunkManager.ts";
import { ConflictManager } from "../managers/ConflictManager.ts";
import { EntryManager } from "../managers/EntryManager/EntryManager.ts";
import { HashManager } from "../managers/HashManager/HashManager.ts";
import type { LiveSyncAbstractReplicator } from "../replication/LiveSyncAbstractReplicator.ts";
import { NetworkManagerBrowser, type NetworkManager } from "./NetworkManager.ts";

export interface LiveSyncManagersOptions {
    database: PouchDB.Database<EntryDoc>;
    getActiveReplicator: () => LiveSyncAbstractReplicator;
    id2path: (id: DocumentID, entry: EntryHasPath, stripPrefix?: boolean) => FilePathWithPrefix;
    path2id: (filename: FilePathWithPrefix | FilePath, prefix?: string) => Promise<DocumentID>;
    settings: RemoteDBSettings;

    networkManager?: NetworkManager;
}
export class LiveSyncManagers {
    hashManager!: HashManager;
    chunkFetcher!: ChunkFetcher;
    changeManager!: ChangeManager<EntryDoc>;
    chunkManager!: ChunkManager;
    splitter!: ContentSplitter;
    entryManager!: EntryManager;
    conflictManager!: ConflictManager;
    networkManager!: NetworkManager;

    options: LiveSyncManagersOptions;
    constructor(options: LiveSyncManagersOptions) {
        this.options = options;
        if (options.networkManager) {
            this.networkManager = options.networkManager;
        } else {
            if ("navigator" in globalThis) {
                this.networkManager = new NetworkManagerBrowser();
            } else {
                throw new LiveSyncError("No NetworkManager available");
            }
        }
    }
    get settings() {
        return this.options.settings;
    }

    async teardownManagers() {
        if (this.changeManager) {
            this.changeManager.teardown();
            this.changeManager = undefined!;
        }
        if (this.chunkFetcher) {
            this.chunkFetcher.destroy();
            this.chunkFetcher = undefined!;
        }
        if (this.chunkManager) {
            this.chunkManager.destroy();
            this.chunkManager = undefined!;
        }
        return await Promise.resolve();
    }
    getProxy() {
        const getDB = () => this.options.database;
        const getChangeManager = () => this.changeManager;
        const getChunkManager = () => this.chunkManager;
        const getReplicator = () => this.options.getActiveReplicator();
        const getSettings = () => this.options.settings;
        const getEntryManager = () => this.entryManager;
        const getHashManager = () => this.hashManager;
        const getChunkFetcher = () => this.chunkFetcher;
        const getSplitter = () => this.splitter;
        const proxy = {
            get database() {
                return getDB();
            },
            get changeManager() {
                return getChangeManager();
            },
            get chunkManager() {
                return getChunkManager();
            },
            getActiveReplicator() {
                return getReplicator();
            },
            get settings() {
                return getSettings();
            },
            get entryManager() {
                return getEntryManager();
            },
            get hashManager() {
                return getHashManager();
            },
            $$path2id: (filename: FilePathWithPrefix | FilePath, prefix?: string): Promise<DocumentID> => {
                return this.options.path2id(filename, prefix);
            },
            $$id2path: (id: DocumentID, entry: EntryHasPath, stripPrefix?: boolean): FilePathWithPrefix => {
                return this.options.id2path(id, entry, stripPrefix);
            },
            get chunkFetcher() {
                return getChunkFetcher();
            },
            get splitter() {
                return getSplitter();
            },
        };
        return proxy;
    }
    async initManagers() {
        await this.teardownManagers();
        const proxy = this.getProxy();
        this.hashManager = new HashManager({
            ...proxy,
        });
        this.splitter = new ContentSplitter({
            ...proxy,
        });
        await this.splitter.initialise(proxy);
        await this.hashManager.initialise();

        this.changeManager = new ChangeManager(proxy);

        this.chunkManager = new ChunkManager({
            ...proxy,
            maxCacheSize: this.settings.hashCacheMaxCount * 10,
        });
        this.chunkFetcher = new ChunkFetcher(proxy);
        this.entryManager = new EntryManager({
            ...proxy,
        });
        this.conflictManager = new ConflictManager({
            ...proxy,
        });
    }

    clearCaches() {
        this.chunkManager?.clearCaches();
    }

    async prepareHashFunction() {
        const proxy = this.getProxy();
        this.hashManager = new HashManager(proxy);
        await this.hashManager.initialise();
    }
}
