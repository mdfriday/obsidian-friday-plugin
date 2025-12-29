import { serialized } from "octagonal-wheels/concurrency/lock";
import { Logger } from "../common/logger";
import { LOG_LEVEL_VERBOSE } from "../common/types";

export type SomeDocument<T extends object> = PouchDB.Core.ExistingDocument<T> & PouchDB.Core.ChangesMeta;

export type PouchDBShim<T extends object> = {
    info: () => Promise<PouchDB.Core.DatabaseInfo>;
    changes: (options: PouchDB.Core.ChangesOptions) => Promise<PouchDB.Core.ChangesResponse<T>>;
    revsDiff: (diff: PouchDB.Core.RevisionDiffOptions) => Promise<PouchDB.Core.RevisionDiffResponse>;
    bulkDocs: (
        docs: PouchDB.Core.PostDocument<any>[],
        options?: PouchDB.Core.BulkDocsOptions
    ) => Promise<(PouchDB.Core.Response | PouchDB.Core.Error)[]>;
    bulkGet: (options: PouchDB.Core.BulkGetOptions) => Promise<PouchDB.Core.BulkGetResponse<T>>;
    put: (doc: PouchDB.Core.PutDocument<any>, options?: PouchDB.Core.PutOptions) => Promise<PouchDB.Core.Response>;
    get: (id: string, options?: PouchDB.Core.GetOptions) => Promise<T & PouchDB.Core.IdMeta & PouchDB.Core.GetMeta>;
};

type CompatibleDatabase<T extends object> = PouchDB.Database<SomeDocument<T>> | PouchDBShim<SomeDocument<T>>;
export async function upsert<V extends object, T extends SomeDocument<V> = SomeDocument<V>>(
    db: CompatibleDatabase<object>,
    id: string,
    func: (doc: T) => T
): Promise<T> {
    try {
        const doc = (await db.get(id)) as T;
        const updated = func(doc);
        const result = await db.put(updated, {});
        if (result && result.ok) {
            return updated;
        }
        throw new Error("Failed to update");
    } catch (ex: any) {
        if (ex.name === "not_found") {
            const result = await db.put(
                func({
                    _id: id,
                } as T),
                {}
            );
            if (result && result.ok) {
                return func({
                    _id: id,
                } as T);
            }
            throw new Error("Failed to insert");
        } else {
            throw ex;
        }
    }
}

export type ShimReplicationOptionBase = {
    rewind?: boolean;
    batch_size?: number;
};
export type ShimReplicationOneShot = {
    live?: false;
    controller?: AbortController;
} & ShimReplicationOptionBase;

export type ShimReplicationOptionContinuous = {
    live: true;
    controller: AbortController;
} & ShimReplicationOptionBase;

export type ShimReplicationOption = ShimReplicationOneShot | ShimReplicationOptionContinuous;
export type ProgressInfo = {
    lastSeq: number;
    maxSeqInBatch: number;
};
export type ShimReplicationProgressReportFunc<T extends object> = (
    progress: SomeDocument<T>[],
    progressInfo: ProgressInfo
) => Promise<void>;
export async function replicateShim<T extends CompatibleDatabase<V>, U extends CompatibleDatabase<V>, V extends object>(
    targetDB: T,
    sourceDB: U,
    progress: ShimReplicationProgressReportFunc<V>,
    option: ShimReplicationOption = {}
) {
    try {
        // Retrieve target (usually local) info (and check if the local is accessible and for the database name)
        const targetDBInfo = await targetDB.info();

        // Retrieve source (Usually remote) info (and check if the remote is accessible)
        const sourceDBInfo = await sourceDB.info();

        const sourceMaxSeq = sourceDBInfo.update_seq;
        const maxNumSeq = Number.parseInt(`${sourceMaxSeq}`.split("-")[0]);

        // Replication to the database should be serialized.
        await serialized(`replication-${targetDBInfo.db_name}-${sourceDBInfo.db_name}`, async () => {
            const syncHeaderMsg = `Replication from ${sourceDBInfo.db_name} to ${targetDBInfo.db_name}
Source: ${sourceDBInfo.db_name} (${sourceDBInfo.update_seq})
Target: ${targetDBInfo.db_name} (${targetDBInfo.update_seq})`;
            Logger(syncHeaderMsg, LOG_LEVEL_VERBOSE);
            // Checkpoint retrieval
            // The checkpoint is a document that stores the last sequence number that has been replicated.
            // We can track the changes efficiently by using the checkpoint.
            // It stores `mark` on the source, and actual sequence number for the target.
            // (it is a bit confusing. However, usually, the target is the local database and it can be updated faster and less traffic).
            const targetDBName = targetDBInfo.db_name;
            const sourceDBName = sourceDBInfo.db_name;

            // Update the `mark` on the target database.
            // Ambiguous name, but, indeed, it just only for detecting the either or both databases have been rebuilt.
            // Therefore, It does not have to be a time stamp, but it must not be repeated even if we do not having knowledge.
            // It should be lost when the source has been rebuilt. Hence, `since` on the target database will be reset (by reading a different checkpoint document).
            const sourceCheckpointID = `_local/replication-checkpoint-mark-${targetDBName}-${sourceDBName}`;
            const sourceCheckpointData = await upsert<{ mark: string }>(sourceDB, sourceCheckpointID, (doc) => {
                const previousMark: string = doc.mark ?? new Date().getTime().toString();
                const mark = option.rewind ? new Date().getTime().toString() : previousMark;
                return {
                    ...doc,
                    mark: mark,
                };
            });
            Logger(
                `Replication from ${sourceDBName} to ${targetDBName} with mark ${sourceCheckpointData.mark}`,
                LOG_LEVEL_VERBOSE
            );

            const mark = sourceCheckpointData.mark;
            // (For the sake for avoiding troubles connected to the same name destination database, previous document needs to be kept as documentation of `mark` differences).
            const targetCheckpointID = `_local/replication-checkpoint-${targetDBName}-${mark}`;
            const targetCheckpointData = await upsert<{ since: string | number }>(
                targetDB,
                targetCheckpointID,
                (doc) => {
                    return {
                        ...doc,
                        since: doc.since ?? "",
                    };
                }
            );

            let since = targetCheckpointData.since;
            Logger(`Replication from ${sourceDBName} to ${targetDBName} / since ${since}`, LOG_LEVEL_VERBOSE);
            const batch_size = option.batch_size ?? 33; // Default batch size is 33, probably works well on trystero.
            do {
                // Fetch changes from the source database.
                const changes = await sourceDB.changes({
                    since,
                    style: "all_docs",
                    limit: batch_size,
                });
                // If there is no changes, then we can break the loop.
                if (changes.results.length === 0) break;
                // If the replication has been aborted, we should break the loop.
                if (option.controller?.signal?.aborted) break;

                const changesResults = changes.results;

                // Check the missing revisions on the target database.
                const diffCheckParamA = changesResults.map((e) => [e.id, e.changes.map((e) => e.rev)] as const);
                const diffCheckParam = diffCheckParamA.reduce(
                    (acc, [id, revs]) => {
                        return {
                            ...acc,
                            [id]: [...(acc[id] ?? []), ...revs],
                        };
                    },
                    {} as { [key: string]: string[] }
                );
                const diff = await targetDB.revsDiff(diffCheckParam);
                const diffEntries = Object.entries(diff);
                const missing = diffEntries
                    .filter((e) => e[1].missing !== undefined)
                    .map((e) => [e[0], e[1].missing] as [string, string[]]);
                const request = missing.map(([id, revs]) => revs.map((rev) => ({ id, rev }))).flat();
                // Fetch missing docs from the source database.
                if (request.length !== 0) {
                    // If some docs are missing (in the range), we should fetch them from the source database.
                    const docs = await sourceDB.bulkGet({ docs: request, revs: true });
                    // write missing docs to the target database.
                    const fetchedMissingDocs = docs.results
                        .map((e) => e.docs)
                        .flat()
                        .filter((e) => "ok" in e)
                        .map((e) => e.ok);

                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const _ = await targetDB.bulkDocs(fetchedMissingDocs, { new_edits: false });
                    // new_edits = false: means that we aimed to write the docs as they are, even if they are conflicted.
                    // Hence, we can resolve the conflicts.
                    // await delay(25); // Delay for a while to avoid the rate limit.
                    // Run the progress function.
                    const changedTargetDocs = await targetDB.bulkGet({
                        docs: [...new Set(changesResults.map((e) => ({ id: e.id })))],
                    });
                    const fetchDocs = changedTargetDocs.results
                        .map((e) => e.docs)
                        .flat()
                        .filter((e) => "ok" in e)
                        .map((e) => e.ok);
                    const docWithSeq = fetchDocs.map((e) => ({
                        doc: e,
                        seq: Math.max.apply(undefined, [
                            changesResults
                                .filter((e2) => e2.id === e._id)
                                .map((e2) => `${e2.seq}`.split("-")[0])
                                .map((e2) => parseInt(e2))
                                .reduce((a, b) => Math.max(a, b), 0),
                            0,
                        ]),
                    }));
                    // const compareRevs = (a: string, b: string) => Number.parseInt(a.split("-")[0]) - Number.parseInt(b.split("-")[0]);
                    // const orderedDocs = docs2process.sort((a, b) => compareRevs(a._rev, b._rev));
                    const processedDocs = docWithSeq.sort((a, b) => a.seq - b.seq).map((e) => e.doc);
                    // const maxSeq = changes.results.map(e => e.seq).reduce((prev, seq) => {
                    //     const prevNum = `${prev}`.split("-")[0];
                    //     const seqNum = `${seq}`.split("-")[0];
                    //     if (prevNum < seqNum) {
                    //         return seq;
                    //     }
                    //     return prev;
                    // }
                    //     , "");
                    const allSecs = Number.parseInt(`${changes.last_seq}`.split("-")[0]);
                    try {
                        await progress(processedDocs, {
                            lastSeq: allSecs,
                            maxSeqInBatch: maxNumSeq,
                        }); // Report the progress.
                    } catch (ex) {
                        Logger(`Failed to process the progress on shim-replication`);
                        Logger(ex, LOG_LEVEL_VERBOSE);
                    }
                    since = changes.last_seq;
                } else {
                    // Update checkpoint
                    since = changes.last_seq;
                }
                await upsert<{ since: string | number }>(targetDB, targetCheckpointID, (doc) => {
                    return {
                        ...doc,
                        since: since,
                    };
                });
            } while (true);
        });
    } catch (ex) {
        Logger(`Failed to replicate the database`, LOG_LEVEL_VERBOSE);
        Logger(ex, LOG_LEVEL_VERBOSE);
    }
    Logger(`Replication has been completed`, LOG_LEVEL_VERBOSE);
}
