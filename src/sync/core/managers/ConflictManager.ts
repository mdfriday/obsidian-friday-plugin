import { type Diff, diff_match_patch, DIFF_DELETE, DIFF_INSERT, DIFF_EQUAL } from "diff-match-patch";
import { readString, decodeBinary } from "octagonal-wheels/binary";
import { Logger, LOG_LEVEL_VERBOSE, LOG_LEVEL_INFO } from "octagonal-wheels/common/logger";
import {
    type EntryDoc,
    type FilePathWithPrefix,
    type diff_result_leaf,
    type LoadedEntry,
    MISSING_OR_ERROR,
    NOT_CONFLICTED,
    type DIFF_CHECK_RESULT_AUTO,
} from "../common/types.ts";
import {
    getDocData,
    tryParseJSON,
    generatePatchObj,
    flattenObject,
    applyPatch,
    isSensibleMargeApplicable,
    isObjectMargeApplicable,
} from "../common/utils.ts";
import type { EntryManager } from "../managers/EntryManager/EntryManager.ts";
import { isErrorOfMissingDoc } from "../pouchdb/utils_couchdb.ts";

type AutoMergeOutcomeOK = {
    ok: DIFF_CHECK_RESULT_AUTO;
};

type AutoMergeCanBeDoneByDeletingRev = {
    result: string;
    conflictedRev: string;
};

type UserActionRequired = {
    leftRev: string;
    rightRev: string;
    leftLeaf: diff_result_leaf | false;
    rightLeaf: diff_result_leaf | false;
};

export type AutoMergeResult = Promise<AutoMergeOutcomeOK | AutoMergeCanBeDoneByDeletingRev | UserActionRequired>;

export interface ConflictManagerOptions {
    entryManager: EntryManager;
    database: PouchDB.Database<EntryDoc>;
}
export class ConflictManager {
    options: ConflictManagerOptions;
    constructor(options: ConflictManagerOptions) {
        this.options = options;
    }
    get database(): PouchDB.Database<EntryDoc> {
        return this.options.database;
    }

    async getConflictedDoc(path: FilePathWithPrefix, rev: string): Promise<false | diff_result_leaf> {
        try {
            const doc = await this.options.entryManager.getDBEntry(path, { rev: rev }, false, true, true);
            if (doc === false) return false;
            let data = getDocData(doc.data);
            if (doc.datatype == "newnote") {
                data = readString(new Uint8Array(decodeBinary(doc.data)));
            } else if (doc.datatype == "plain") {
                // NO OP.
            }
            return {
                deleted: doc.deleted || doc._deleted,
                ctime: doc.ctime,
                mtime: doc.mtime,
                rev: rev,
                data: data,
            };
        } catch (ex) {
            if (isErrorOfMissingDoc(ex)) {
                return false;
            }
        }
        return false;
    }
    async mergeSensibly(
        path: FilePathWithPrefix,
        baseRev: string,
        currentRev: string,
        conflictedRev: string
    ): Promise<Diff[] | false> {
        const baseLeaf = await this.getConflictedDoc(path, baseRev);
        const leftLeaf = await this.getConflictedDoc(path, currentRev);
        const rightLeaf = await this.getConflictedDoc(path, conflictedRev);
        let autoMerge = false;
        if (baseLeaf == false || leftLeaf == false || rightLeaf == false) {
            return false;
        }
        if (leftLeaf.deleted && rightLeaf.deleted) {
            // Both are deleted
            return false;
        }
        // diff between base and each revision
        const dmp = new diff_match_patch();
        const mapLeft = dmp.diff_linesToChars_(baseLeaf.data, leftLeaf.data);
        const diffLeftSrc = dmp.diff_main(mapLeft.chars1, mapLeft.chars2, false);
        dmp.diff_charsToLines_(diffLeftSrc, mapLeft.lineArray);
        const mapRight = dmp.diff_linesToChars_(baseLeaf.data, rightLeaf.data);
        const diffRightSrc = dmp.diff_main(mapRight.chars1, mapRight.chars2, false);
        dmp.diff_charsToLines_(diffRightSrc, mapRight.lineArray);
        function splitDiffPiece(src: Diff[]): Diff[] {
            const ret = [] as Diff[];
            do {
                const d = src.shift();
                if (d === undefined) {
                    return ret;
                }
                const pieces = d[1].split(/([^\n]*\n)/).filter((f) => f != "");
                if (typeof d == "undefined") {
                    break;
                }
                if (d[0] != DIFF_DELETE) {
                    ret.push(...pieces.map((e) => [d[0], e] as Diff));
                }
                if (d[0] == DIFF_DELETE) {
                    const nd = src.shift();

                    if (typeof nd != "undefined") {
                        const piecesPair = nd[1].split(/([^\n]*\n)/).filter((f) => f != "");
                        if (nd[0] == DIFF_INSERT) {
                            // it might be pair
                            for (const pt of pieces) {
                                ret.push([d[0], pt]);
                                const pairP = piecesPair.shift();
                                if (typeof pairP != "undefined") ret.push([DIFF_INSERT, pairP]);
                            }
                            ret.push(...piecesPair.map((e) => [nd[0], e] as Diff));
                        } else {
                            ret.push(...pieces.map((e) => [d[0], e] as Diff));
                            ret.push(...piecesPair.map((e) => [nd[0], e] as Diff));
                        }
                    } else {
                        ret.push(...pieces.map((e) => [0, e] as Diff));
                    }
                }
            } while (src.length > 0);
            return ret;
        }

        const diffLeft = splitDiffPiece(diffLeftSrc);
        const diffRight = splitDiffPiece(diffRightSrc);

        let rightIdx = 0;
        let leftIdx = 0;
        const merged = [] as Diff[];
        autoMerge = true;
        LOOP_MERGE: do {
            if (leftIdx >= diffLeft.length && rightIdx >= diffRight.length) {
                break LOOP_MERGE;
            }
            const leftItem = diffLeft[leftIdx] ?? [0, ""];
            const rightItem = diffRight[rightIdx] ?? [0, ""];
            leftIdx++;
            rightIdx++;
            // when completely same, leave it .
            if (leftItem[0] == DIFF_EQUAL && rightItem[0] == DIFF_EQUAL && leftItem[1] == rightItem[1]) {
                merged.push(leftItem);
                continue;
            }
            if (leftItem[0] == DIFF_DELETE && rightItem[0] == DIFF_DELETE && leftItem[1] == rightItem[1]) {
                // when deleted evenly,
                const nextLeftIdx = leftIdx;
                const nextRightIdx = rightIdx;
                const [nextLeftItem, nextRightItem] = [
                    diffLeft[nextLeftIdx] ?? [0, ""],
                    diffRight[nextRightIdx] ?? [0, ""],
                ];
                if (
                    nextLeftItem[0] == DIFF_INSERT &&
                    nextRightItem[0] == DIFF_INSERT &&
                    nextLeftItem[1] != nextRightItem[1]
                ) {
                    //but next line looks like different
                    autoMerge = false;
                    break;
                } else {
                    merged.push(leftItem);
                    continue;
                }
            }
            // when inserted evenly
            if (leftItem[0] == DIFF_INSERT && rightItem[0] == DIFF_INSERT) {
                if (leftItem[1] == rightItem[1]) {
                    merged.push(leftItem);
                    continue;
                } else {
                    // sort by file date.
                    if (leftLeaf.mtime <= rightLeaf.mtime) {
                        merged.push(leftItem);
                        merged.push(rightItem);
                        continue;
                    } else {
                        merged.push(rightItem);
                        merged.push(leftItem);
                        continue;
                    }
                }
            }
            // when on inserting, index should be fixed again.
            if (leftItem[0] == DIFF_INSERT) {
                rightIdx--;
                merged.push(leftItem);
                continue;
            }
            if (rightItem[0] == DIFF_INSERT) {
                leftIdx--;
                merged.push(rightItem);
                continue;
            }
            // except insertion, the line should not be different.
            if (rightItem[1] != leftItem[1]) {
                //TODO: SHOULD BE PANIC.
                Logger(
                    `MERGING PANIC:${leftItem[0]},${leftItem[1]} == ${rightItem[0]},${rightItem[1]}`,
                    LOG_LEVEL_VERBOSE
                );
                autoMerge = false;
                break LOOP_MERGE;
            }
            if (leftItem[0] == DIFF_DELETE) {
                if (rightItem[0] == DIFF_EQUAL) {
                    merged.push(leftItem);
                    continue;
                } else {
                    //we cannot perform auto merge.
                    autoMerge = false;
                    break LOOP_MERGE;
                }
            }
            if (rightItem[0] == DIFF_DELETE) {
                if (leftItem[0] == DIFF_EQUAL) {
                    merged.push(rightItem);
                    continue;
                } else {
                    //we cannot perform auto merge.
                    autoMerge = false;
                    break LOOP_MERGE;
                }
            }
            Logger(
                `Weird condition:${leftItem[0]},${leftItem[1]} == ${rightItem[0]},${rightItem[1]}`,
                LOG_LEVEL_VERBOSE
            );
            // here is the exception
            break LOOP_MERGE;
        } while (leftIdx < diffLeft.length || rightIdx < diffRight.length);
        if (autoMerge) {
            Logger(`Sensibly merge available`, LOG_LEVEL_VERBOSE);
            return merged;
        } else {
            return false;
        }
    }

    async mergeObject(
        path: FilePathWithPrefix,
        baseRev: string,
        currentRev: string,
        conflictedRev: string
    ): Promise<string | false> {
        try {
            const baseLeaf = await this.getConflictedDoc(path, baseRev);
            const leftLeaf = await this.getConflictedDoc(path, currentRev);
            const rightLeaf = await this.getConflictedDoc(path, conflictedRev);
            if (baseLeaf == false || leftLeaf == false || rightLeaf == false) {
                Logger(`Could not load leafs for merge`, LOG_LEVEL_VERBOSE);
                Logger(
                    `${baseLeaf ? "base" : "missing base"}, ${leftLeaf ? "left" : "missing left"}, ${rightLeaf ? "right" : "missing right"} }`,
                    LOG_LEVEL_VERBOSE
                );
                return false;
            }
            if (leftLeaf.deleted && rightLeaf.deleted) {
                Logger(`Both are deleted`, LOG_LEVEL_VERBOSE);
                return false;
            }
            const baseObj = { data: tryParseJSON(baseLeaf.data, {}) } as Record<string | number | symbol, any>;
            const leftObj = { data: tryParseJSON(leftLeaf.data, {}) } as Record<string | number | symbol, any>;
            const rightObj = { data: tryParseJSON(rightLeaf.data, {}) } as Record<string | number | symbol, any>;

            const diffLeft = generatePatchObj(baseObj, leftObj);
            const diffRight = generatePatchObj(baseObj, rightObj);

            // If each value of the same key has been modified, the automatic merge should be prevented.
            //TODO Does it have to be a configurable item?
            const diffSetLeft = new Map(flattenObject(diffLeft));
            const diffSetRight = new Map(flattenObject(diffRight));
            for (const [key, value] of diffSetLeft) {
                if (diffSetRight.has(key)) {
                    if (diffSetRight.get(key) == value) {
                        // No matter, if changed to the same value.
                        diffSetRight.delete(key);
                    }
                }
            }
            for (const [key, value] of diffSetRight) {
                if (diffSetLeft.has(key) && diffSetLeft.get(key) != value) {
                    // Some changes are conflicted
                    Logger(`Conflicted key:${key}`, LOG_LEVEL_VERBOSE);
                    return false;
                }
            }

            const patches = [
                { mtime: leftLeaf.mtime, patch: diffLeft },
                { mtime: rightLeaf.mtime, patch: diffRight },
            ].sort((a, b) => a.mtime - b.mtime);
            let newObj = { ...baseObj };
            for (const patch of patches) {
                newObj = applyPatch(newObj, patch.patch);
            }
            Logger(`Object merge is applicable!`, LOG_LEVEL_VERBOSE);
            return JSON.stringify(newObj.data);
        } catch (ex) {
            Logger("Could not merge object");
            Logger(ex, LOG_LEVEL_VERBOSE);
            return false;
        }
    }
    async tryAutoMergeSensibly(path: FilePathWithPrefix, test: LoadedEntry, conflicts: string[]) {
        const conflictedRev = conflicts[0];
        const conflictedRevNo = Number(conflictedRev.split("-")[0]);
        //Search
        const revFrom = await this.database.get<EntryDoc>(await this.options.entryManager.path2id(path), {
            revs_info: true,
        });
        const commonBase =
            (revFrom._revs_info || []).filter(
                (e) => e.status == "available" && Number(e.rev.split("-")[0]) < conflictedRevNo
            )?.[0]?.rev ?? "";
        let p = undefined;
        if (commonBase) {
            if (isSensibleMargeApplicable(path)) {
                const result = await this.mergeSensibly(path, commonBase, test._rev!, conflictedRev);
                if (result) {
                    p = result
                        .filter((e) => e[0] != DIFF_DELETE)
                        .map((e) => e[1])
                        .join("");
                    // can be merged.
                    Logger(`Sensible merge:${path}`, LOG_LEVEL_INFO);
                } else {
                    Logger(`Sensible merge is not applicable.`, LOG_LEVEL_VERBOSE);
                }
            } else if (isObjectMargeApplicable(path)) {
                // can be merged.
                const result = await this.mergeObject(path, commonBase, test._rev!, conflictedRev);
                if (result) {
                    Logger(`Object merge:${path}`, LOG_LEVEL_INFO);
                    p = result;
                } else {
                    Logger(`Object merge is not applicable..`, LOG_LEVEL_VERBOSE);
                }
            }
            if (p !== undefined) {
                return { result: p, conflictedRev };
            }
        }
        return false;
    }
    async tryAutoMerge(path: FilePathWithPrefix, enableMarkdownAutoMerge: boolean): AutoMergeResult {
        const test = await this.options.entryManager.getDBEntry(
            path,
            { conflicts: true, revs_info: true },
            false,
            false,
            true
        );
        if (test === false) return { ok: MISSING_OR_ERROR };
        if (test == null) return { ok: MISSING_OR_ERROR };
        if (!test._conflicts) return { ok: NOT_CONFLICTED };
        if (test._conflicts.length == 0) return { ok: NOT_CONFLICTED };
        const conflicts = test._conflicts.sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]));
        if ((isSensibleMargeApplicable(path) || isObjectMargeApplicable(path)) && enableMarkdownAutoMerge) {
            const autoMergeResult = await this.tryAutoMergeSensibly(path, test, conflicts);
            if (autoMergeResult !== false) {
                return autoMergeResult;
            }
        }
        // should be one or more conflicts;
        const leftLeaf = await this.getConflictedDoc(path, test._rev!);
        const rightLeaf = await this.getConflictedDoc(path, conflicts[0]);
        return { leftRev: test._rev!, rightRev: conflicts[0], leftLeaf, rightLeaf };
    }
}
