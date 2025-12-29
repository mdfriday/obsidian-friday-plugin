import { Logger, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE } from "../common/logger";
import type { CouchDBConnection, EntryLeaf } from "../common/types";
import { QueueProcessor } from "octagonal-wheels/concurrency/processor";
import { arrayToChunkedArray, sizeToHumanReadable } from "../common/utils";
import { serialized } from "octagonal-wheels/concurrency/lock";
import { _requestToCouchDBFetch } from "./utils_couchdb";

export async function purgeUnreferencedChunks(
    db: PouchDB.Database,
    dryRun: boolean,
    connSetting?: CouchDBConnection,
    performCompact = false
) {
    const info = await db.info();
    let resultCount = 0;
    const getSize = function (info: PouchDB.Core.DatabaseInfo, key: "active" | "external" | "file") {
        return Number.parseInt((info as any)?.sizes?.[key] ?? 0);
    };
    const keySuffix = connSetting ? "-remote" : "-local";
    Logger(`${dryRun ? "Counting" : "Cleaning"} ${connSetting ? "remote" : "local"} database`, LOG_LEVEL_NOTICE);

    if (connSetting) {
        Logger(
            `Database active-size: ${sizeToHumanReadable(getSize(info, "active"))}, external-size:${sizeToHumanReadable(
                getSize(info, "external")
            )}, file-size: ${sizeToHumanReadable(getSize(info, "file"))}`,
            LOG_LEVEL_NOTICE
        );
    }
    Logger(`Collecting unreferenced chunks on ${info.db_name}`, LOG_LEVEL_NOTICE, "gc-count-chunk" + keySuffix);
    const chunks = await collectUnreferencedChunks(db);
    resultCount = chunks.length;
    if (chunks.length == 0) {
        Logger(`No unreferenced chunks! ${info.db_name}`, LOG_LEVEL_NOTICE, "gc-count-chunk" + keySuffix);
    } else {
        Logger(
            `Number of unreferenced chunks on ${info.db_name}: ${chunks.length}`,
            LOG_LEVEL_NOTICE,
            "gc-count-chunk" + keySuffix
        );
        if (dryRun) {
            Logger(`DryRun of cleaning ${connSetting ? "remote" : "local"} database up: Done`, LOG_LEVEL_NOTICE);
            return resultCount;
        }
        if (connSetting) {
            Logger(`Cleaning unreferenced chunks on remote`, LOG_LEVEL_NOTICE, "gc-purge" + keySuffix);
            await purgeChunksRemote(connSetting, chunks);
        } else {
            Logger(`Cleaning unreferenced chunks on local`, LOG_LEVEL_NOTICE, "gc-purge" + keySuffix);
            await purgeChunksLocal(db, chunks);
        }
        Logger(`Cleaning unreferenced chunks done!`, LOG_LEVEL_NOTICE, "gc-purge" + keySuffix);
    }

    if (performCompact) {
        Logger(`Compacting database...`, LOG_LEVEL_NOTICE, "gc-compact" + keySuffix);
        await db.compact();
        Logger(`Compacting database done`, LOG_LEVEL_NOTICE, "gc-compact" + keySuffix);
    }
    if (connSetting) {
        const endInfo = await db.info();
        Logger(
            `Processed database active-size: ${sizeToHumanReadable(
                getSize(endInfo, "active")
            )}, external-size:${sizeToHumanReadable(
                getSize(endInfo, "external")
            )}, file-size: ${sizeToHumanReadable(getSize(endInfo, "file"))}`,
            LOG_LEVEL_NOTICE
        );
        Logger(
            `Reduced sizes: active-size: ${sizeToHumanReadable(
                getSize(info, "active") - getSize(endInfo, "active")
            )}, external-size:${sizeToHumanReadable(
                getSize(info, "external") - getSize(endInfo, "external")
            )}, file-size: ${sizeToHumanReadable(getSize(info, "file") - getSize(endInfo, "file"))}`,
            LOG_LEVEL_NOTICE
        );
    }
    Logger(`Cleaning ${connSetting ? "remote" : "local"} database up: Done`, LOG_LEVEL_NOTICE);
    return resultCount;
}
export function transferChunks(
    key: string,
    label: string,
    dbFrom: PouchDB.Database,
    dbTo: PouchDB.Database,
    items: {
        id: string;
        rev: string;
    }[]
) {
    let totalProcessed = 0;
    const total = items.length;
    return new QueueProcessor(
        async (batched) => {
            // Narrow down to only the chunks which are not in the local.
            const requestItems = batched.map((e) => e.id);
            const local = await dbTo.allDocs({ keys: requestItems });
            const batch = local.rows.filter((e) => "error" in e && e.error == "not_found").map((e) => e.key);
            return batch;
        },
        {
            batchSize: 50,
            concurrentLimit: 5,
            suspended: true,
            delay: 100,
        },
        items
    )
        .pipeTo(
            new QueueProcessor(
                async (chunkIds) => {
                    const docs = await dbFrom.allDocs({ keys: chunkIds, include_docs: true });
                    const filteredDocs = docs.rows.filter((e) => !("error" in e)).map((e: any) => e.doc as EntryLeaf);
                    return filteredDocs;
                },
                {
                    batchSize: 25,
                    concurrentLimit: 1,
                    suspended: true,
                    delay: 100,
                }
            )
        )
        .pipeTo(
            new QueueProcessor(
                async (docs) => {
                    try {
                        await dbTo.bulkDocs(docs, { new_edits: false });
                    } catch (ex) {
                        Logger(`${label}: Something went wrong on balancing`, LOG_LEVEL_NOTICE);
                        Logger(ex, LOG_LEVEL_VERBOSE);
                    } finally {
                        totalProcessed += docs.length;
                        Logger(`${label}: ${totalProcessed} / ${total}`, LOG_LEVEL_NOTICE, "balance-" + key);
                    }
                    return;
                },
                { batchSize: 100, delay: 100, concurrentLimit: 2, suspended: false }
            )
        )
        .startPipeline()
        .waitForAllDoneAndTerminate();
}
// Complement unbalanced chunks between databases which were separately cleaned up.

export async function balanceChunkPurgedDBs(local: PouchDB.Database, remote: PouchDB.Database) {
    Logger(`Complement missing chunks between databases`, LOG_LEVEL_NOTICE);
    try {
        const { onlyOnLocal, onlyOnRemote } = await collectUnbalancedChunkIDs(local, remote);
        const localToRemote = transferChunks("l2r", "local -> remote", local, remote, onlyOnLocal);
        const remoteToLocal = transferChunks("r2l", "remote -> local", remote, local, onlyOnRemote);
        await Promise.all([localToRemote, remoteToLocal]);
        Logger(`local -> remote: Done`, LOG_LEVEL_NOTICE, "balance-l2r");
        Logger(`remote -> local: Done`, LOG_LEVEL_NOTICE, "balance-r2l");
    } catch (ex) {
        Logger("Something went wrong on balancing!", LOG_LEVEL_NOTICE);
        Logger(ex, LOG_LEVEL_VERBOSE);
    }
    Logger("Complement completed!", LOG_LEVEL_NOTICE);
}
export async function fetchAllUsedChunks(local: PouchDB.Database, remote: PouchDB.Database) {
    try {
        const chunksOnRemote = await collectChunks(remote, "INUSE");
        await transferChunks("r2l", "remote -> local", remote, local, chunksOnRemote);
        Logger(`remote -> local: Done`, LOG_LEVEL_NOTICE, "balance-r2l");
    } catch (ex) {
        Logger("Something went wrong on balancing!", LOG_LEVEL_NOTICE);
        Logger(ex, LOG_LEVEL_VERBOSE);
    }
}
export async function purgeChunksLocal(db: PouchDB.Database, docs: { id: string; rev: string }[]) {
    await serialized("purge-local", async () => {
        try {
            // Back chunks up to the _local of local database to see the history.
            Logger(`Purging unused ${docs.length} chunks `, LOG_LEVEL_NOTICE, "purge-local-backup");
            const batchDocsBackup = arrayToChunkedArray(docs, 100);
            let total = { ok: 0, exist: 0, error: 0 };
            for (const docsInBatch of batchDocsBackup) {
                const backupDocsFrom = await db.allDocs({ keys: docsInBatch.map((e) => e.id), include_docs: true });
                const backupDocs = backupDocsFrom.rows
                    .filter((e) => "doc" in e)
                    .map((e) => {
                        const chunk = { ...(e as any).doc };
                        delete chunk._rev;
                        chunk._id = `_local/${chunk._id}`;
                        return chunk;
                    });
                const ret = await db.bulkDocs(backupDocs);
                total = ret
                    .map((e) => ({
                        ok: "ok" in e ? 1 : 0,
                        exist: "status" in e && e.status == 409 ? 1 : 0,
                        error: "status" in e && e.status != 409 ? 1 : 0,
                    }))
                    .reduce((p, c) => ({ ok: p.ok + c.ok, exist: p.exist + c.exist, error: p.error + c.error }), total);
                Logger(
                    `Local chunk backed up: new:${total.ok} ,exist:${total.exist}, error:${total.error}`,
                    LOG_LEVEL_NOTICE,
                    "purge-local-backup"
                );
                const erroredItems = ret.filter((e) => "error" in e && e.status != 409);
                for (const item of erroredItems) {
                    Logger(`Failed to back up: ${item.id} / ${item.rev}`, LOG_LEVEL_VERBOSE);
                }
            }
        } catch (ex) {
            Logger(`Could not back up chunks`);
            Logger(ex, LOG_LEVEL_VERBOSE);
        }

        Logger(`Purging unused ${docs.length} chunks... `, LOG_LEVEL_NOTICE, "purge-local");
        const batchDocs = arrayToChunkedArray(docs, 100);
        let totalRemoved = 0;
        for (const docsInBatch of batchDocs) {
            //@ts-ignore: type def missing
            const removed = await db.purgeMulti(docsInBatch.map((e) => [e.id, e.rev]));
            const removedCount = Object.values(removed).filter((e) => "ok" in (e as object)).length;
            totalRemoved += removedCount;
            Logger(`Purging:  ${totalRemoved} / ${docs.length}`, LOG_LEVEL_NOTICE, "purge-local");
        }

        Logger(
            `Purging unused chunks done!: ${totalRemoved} chunks has been deleted.`,
            LOG_LEVEL_NOTICE,
            "purge-local"
        );
    });
}
export async function collectUnbalancedChunkIDs(local: PouchDB.Database, remote: PouchDB.Database) {
    const chunksOnLocal = await collectChunks(local, "INUSE");
    const chunksOnRemote = await collectChunks(remote, "INUSE");
    const onlyOnLocal = chunksOnLocal.filter((e) => !chunksOnRemote.some((ee) => ee.id == e.id));
    const onlyOnRemote = chunksOnRemote.filter((e) => !chunksOnLocal.some((ee) => ee.id == e.id));
    return { onlyOnLocal, onlyOnRemote };
}
export async function collectChunks(db: PouchDB.Database, type: "INUSE" | "DANGLING" | "ALL") {
    const rows = await collectChunksUsage(db);

    const rowF = type == "ALL" ? rows : rows.filter((e) => (type == "DANGLING" ? e.value == 0 : e.value != 0));
    const ids = rowF.flatMap((e) => e.key);
    const docs = (await db.allDocs({ keys: ids })).rows;
    const items = docs.filter((e) => !("error" in e)).map((e: any) => ({ id: e.id, rev: e.value.rev }));
    return items;
}
async function prepareChunkDesignDoc(db: PouchDB.Database) {
    const chunkDesignDoc = {
        _id: "_design/chunks",
        _rev: undefined as any,
        ver: 2,
        views: {
            collectDangling: {
                map: function (doc: any) {
                    if (doc._id.startsWith("h:")) {
                        //@ts-ignore
                        emit([doc._id], 0);
                    } else {
                        if ("children" in doc) {
                            //@ts-ignore
                            doc.children.forEach((e) => emit([e], 1));
                        }
                    }
                }.toString(),
                reduce: "_sum",
            },
        },
    };
    // save it
    let updateDDoc = false;
    try {
        const old = await db.get<typeof chunkDesignDoc>(chunkDesignDoc._id);
        if (old?.ver ?? 0 < chunkDesignDoc.ver) {
            chunkDesignDoc._rev = old._rev;
            updateDDoc = true;
        }
    } catch (ex: any) {
        if (ex.status == 404) {
            // NO OP
            updateDDoc = true;
        } else {
            Logger(`Failed to make design document for operating chunks`);
            Logger(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }
    try {
        if (updateDDoc) {
            await db.put<typeof chunkDesignDoc>(chunkDesignDoc);
        }
    } catch (ex: any) {
        // NO OP.
        Logger(`Failed to make design document for operating chunks`);
        Logger(ex, LOG_LEVEL_VERBOSE);
        return false;
    }
    return true;
}

export async function collectChunksUsage(db: PouchDB.Database) {
    if (!(await prepareChunkDesignDoc(db))) {
        Logger(`Could not prepare design document for operating chunks`);
        return [];
    }
    const q = await db.query("chunks/collectDangling", { reduce: true, group: true });
    const rows = q.rows as { value: number; key: string[] }[];
    return rows;
}

export function collectUnreferencedChunks(db: PouchDB.Database) {
    return collectChunks(db, "DANGLING");
}
export async function purgeChunksRemote(setting: CouchDBConnection, docs: { id: string; rev: string }[]) {
    await serialized("purge-remote", async () => {
        const CHUNK_SIZE = 100;

        function makeChunkedArrayFromArray<T>(items: T[]): T[][] {
            const chunked = [];
            for (let i = 0; i < items.length; i += CHUNK_SIZE) {
                chunked.push(items.slice(i, i + CHUNK_SIZE));
            }
            return chunked;
        }

        const buffer = makeChunkedArrayFromArray(docs);
        for (const chunkedPayload of buffer) {
            const rets = await _requestToCouchDBFetch(
                `${setting.couchDB_URI}/${setting.couchDB_DBNAME}`,
                setting.couchDB_USER,
                setting.couchDB_PASSWORD,
                "_purge",
                Object.fromEntries(chunkedPayload.map((e) => [e.id, [e.rev]])),
                "POST"
            );
            // const result = await rets();
            Logger(JSON.stringify(await rets.json()), LOG_LEVEL_VERBOSE);
        }
        return;
    });
}
