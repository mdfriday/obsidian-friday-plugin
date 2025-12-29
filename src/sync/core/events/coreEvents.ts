import type { FilePathWithPrefix, ObsidianLiveSyncSettings } from "../common/types";

export const EVENT_LAYOUT_READY = "layout-ready";
export const EVENT_PLUGIN_LOADED = "plugin-loaded";
export const EVENT_PLUGIN_UNLOADED = "plugin-unloaded";
export const EVENT_SETTING_SAVED = "setting-saved";
export const EVENT_FILE_RENAMED = "file-renamed";
export const EVENT_FILE_SAVED = "file-saved";
export const EVENT_LEAF_ACTIVE_CHANGED = "leaf-active-changed";

export const EVENT_DATABASE_REBUILT = "database-rebuilt";

export const EVENT_LOG_ADDED = "log-added";

export const EVENT_REQUEST_OPEN_SETUP_URI = "request-open-setup-uri";
export const EVENT_REQUEST_COPY_SETUP_URI = "request-copy-setup-uri";

export const EVENT_REQUEST_RELOAD_SETTING_TAB = "reload-setting-tab";

export const EVENT_REQUEST_OPEN_PLUGIN_SYNC_DIALOG = "request-open-plugin-sync-dialog";

export const EVENT_FILE_CHANGED = "event-file-changed";
export const EVENT_DOCUMENT_STUB_CREATED = "document-stub-created";

export const EVENT_REQUEST_OPEN_P2P_SETTINGS = "request-open-p2p-settings";

// export const EVENT_FILE_CHANGED = "file-changed";

declare global {
    interface LSEvents {
        [EVENT_FILE_SAVED]: undefined;
        [EVENT_SETTING_SAVED]: ObsidianLiveSyncSettings;
        [EVENT_LAYOUT_READY]: undefined;
        [EVENT_FILE_CHANGED]: { file: FilePathWithPrefix; automated: boolean };
        [EVENT_DOCUMENT_STUB_CREATED]: {
            toc: Set<string>;
            stub: { [key: string]: { [key: string]: Map<string, Record<string, string>> } };
        };
        [EVENT_FILE_RENAMED]: { newPath: FilePathWithPrefix; old: FilePathWithPrefix };

        [EVENT_DATABASE_REBUILT]: undefined;
        [EVENT_REQUEST_OPEN_P2P_SETTINGS]: undefined;
    }
}
