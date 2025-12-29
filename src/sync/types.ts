/**
 * Friday Sync Module - Type Definitions
 * 
 * Re-exports types from the core library for use in Friday plugin.
 */

// Re-export all types from core
export * from "./core/common/types";

// Re-export replicator types
export type { 
    LiveSyncAbstractReplicator, 
    LiveSyncReplicatorEnv, 
    ReplicationStat,
    ReplicationCallback,
} from "./core/replication/LiveSyncAbstractReplicator";

export type { 
    LiveSyncCouchDBReplicatorEnv 
} from "./core/replication/couchdb/LiveSyncReplicator";

export { 
    LiveSyncCouchDBReplicator 
} from "./core/replication/couchdb/LiveSyncReplicator";

// Re-export local database types
export type { 
    LiveSyncLocalDBEnv,
    ChunkRetrievalResult,
} from "./core/pouchdb/LiveSyncLocalDB";

export { 
    LiveSyncLocalDB 
} from "./core/pouchdb/LiveSyncLocalDB";

// Re-export service types
export type { ServiceHub } from "./core/services/ServiceHub";

// Re-export encryption utilities
export { 
    encryptString, 
    decryptString, 
    tryDecryptString 
} from "./core/encryption/stringEncryption";

// Re-export i18n
export { $msg, setLang } from "./core/common/i18n";

// Re-export logger
export { Logger } from "./core/common/logger";

// Re-export utilities
export { 
    isCloudantURI 
} from "./core/pouchdb/utils_couchdb";
