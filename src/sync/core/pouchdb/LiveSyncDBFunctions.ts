import {
    type EntryDoc,
    type EntryMilestoneInfo,
    MILESTONE_DOCID as MILESTONE_DOC_ID,
    type RemoteDBSettings,
    type ChunkVersionRange,
    TweakValuesShouldMatchedTemplate,
    TweakValuesTemplate,
    type TweakValues,
    DEVICE_ID_PREFERRED,
    TweakValuesDefault,
    type DeviceInfo,
} from "../common/types.ts";
import { extractObject, isObjectDifferent, resolveWithIgnoreKnownError } from "../common/utils.ts";

// This interface is expected to be unnecessary because of the change in dependency direction

/// Connectivity

// Should we move ENSURE_DB_RESULT and ensureRemoteIsCompatible to the replication utility?
export type ENSURE_DB_RESULT =
    | "OK"
    | "INCOMPATIBLE"
    | "LOCKED"
    | "NODE_LOCKED"
    | "NODE_CLEANED"
    | ["MISMATCHED", TweakValues];

/**
 * Ensures that the remote database is compatible with the current device.
 *
 * @param infoSrc - The information about the remote database (which retrieved from the remote).
 * @param setting - The current settings.
 * @param deviceNodeID - The ID of the current device node.
 * @param currentVersionRange - The current version range of the database.
 * @param updateCallback - The callback function to update the remote milestone.
 * @returns A promise that resolves to the result of ensuring compatibility.
 */
export async function ensureRemoteIsCompatible(
    infoSrc: EntryMilestoneInfo | false,
    setting: RemoteDBSettings,
    deviceNodeID: string,
    currentVersionRange: ChunkVersionRange,
    nodeDeviceInfo: DeviceInfo,
    updateCallback: (info: EntryMilestoneInfo) => Promise<void>
): Promise<ENSURE_DB_RESULT> {
    const now = Date.now();
    const baseMilestone: EntryMilestoneInfo = {
        _id: MILESTONE_DOC_ID,
        type: "milestoneinfo",
        created: (new Date() as any) / 1,
        locked: false,
        accepted_nodes: [deviceNodeID],
        node_chunk_info: { [deviceNodeID]: currentVersionRange },
        node_info: {
            [deviceNodeID]: {
                ...nodeDeviceInfo,
                last_connected: 0,
                progress: "",
            },
        },
        tweak_values: {},
    };
    let remoteMilestone = infoSrc;
    if (!remoteMilestone) remoteMilestone = baseMilestone;

    const currentTweakValues = extractObject(TweakValuesTemplate, setting);

    remoteMilestone.node_chunk_info = { ...baseMilestone.node_chunk_info, ...remoteMilestone.node_chunk_info };
    let writeMilestone =
        remoteMilestone.node_chunk_info[deviceNodeID].min != currentVersionRange.min ||
        remoteMilestone.node_chunk_info[deviceNodeID].max != currentVersionRange.max ||
        isObjectDifferent(remoteMilestone.tweak_values?.[deviceNodeID], currentTweakValues) ||
        typeof remoteMilestone._rev == "undefined" ||
        !(DEVICE_ID_PREFERRED in remoteMilestone.tweak_values);

    if (!remoteMilestone.node_info) {
        remoteMilestone.node_info = {};
    }
    if (!(deviceNodeID in remoteMilestone.node_info)) {
        remoteMilestone.node_info[deviceNodeID] = {
            ...nodeDeviceInfo,
            last_connected: 0,
            progress: "",
        };
        writeMilestone = true;
    }
    const info = remoteMilestone.node_info[deviceNodeID];
    const keys = ["device_name", "app_version", "plugin_version", "vault_name", "progress"] as (keyof DeviceInfo)[];
    for (const key of keys) {
        if (info[key] != nodeDeviceInfo[key]) {
            remoteMilestone.node_info[deviceNodeID][key] = nodeDeviceInfo[key];
            writeMilestone = true;
        }
    }

    const diffLastConnected = now - (remoteMilestone.node_info[deviceNodeID].last_connected || 0);
    // Prevent updating last_connected too frequently
    if (diffLastConnected > 60000) {
        remoteMilestone.node_info[deviceNodeID].last_connected = now;
        writeMilestone = true;
    }

    if (writeMilestone) {
        remoteMilestone.node_chunk_info[deviceNodeID].min = currentVersionRange.min;
        remoteMilestone.node_chunk_info[deviceNodeID].max = currentVersionRange.max;
        remoteMilestone.tweak_values = { ...(remoteMilestone.tweak_values ?? {}), [deviceNodeID]: currentTweakValues };
        if (!(DEVICE_ID_PREFERRED in remoteMilestone.tweak_values)) {
            remoteMilestone.tweak_values[DEVICE_ID_PREFERRED] = currentTweakValues;
        }
        await updateCallback(remoteMilestone);
    }

    // Check compatibility and make sure available version
    //
    // v min of A                  v max of A
    // |   v  min of B             |   v max of B
    // |   |                       |   |
    // |   |<---   We can use  --->|   |
    // |   |                       |   |
    // If globalMin and globalMax is suitable, we can upgrade.
    let globalMin = currentVersionRange.min;
    let globalMax = currentVersionRange.max;
    for (const nodeId of remoteMilestone.accepted_nodes) {
        if (nodeId == deviceNodeID) continue;
        if (nodeId in remoteMilestone.node_chunk_info) {
            const nodeInfo = remoteMilestone.node_chunk_info[nodeId];
            globalMin = Math.max(nodeInfo.min, globalMin);
            globalMax = Math.min(nodeInfo.max, globalMax);
        } else {
            globalMin = 0;
            globalMax = 0;
        }
    }

    if (globalMax < globalMin) {
        if (!setting.ignoreVersionCheck) {
            return "INCOMPATIBLE";
        }
    }

    if (!setting.disableCheckingConfigMismatch) {
        // If there is no preferred tweak, set my own as preferred at first.
        const preferred_tweak = remoteMilestone.tweak_values?.[DEVICE_ID_PREFERRED] ?? currentTweakValues;
        const current_tweak = currentTweakValues as TweakValues;
        const preferred_should_matched = extractObject(TweakValuesShouldMatchedTemplate, {
            ...TweakValuesDefault,
            ...preferred_tweak,
        });
        const current_should_matched = extractObject(TweakValuesShouldMatchedTemplate, {
            ...TweakValuesDefault,
            ...current_tweak,
        });
        if (isObjectDifferent(preferred_should_matched, current_should_matched, true)) {
            return ["MISMATCHED", preferred_tweak];
        }
    }

    if (remoteMilestone.locked) {
        if (remoteMilestone.accepted_nodes.indexOf(deviceNodeID) == -1) {
            if (remoteMilestone.cleaned) {
                return "NODE_CLEANED";
            }
            return "NODE_LOCKED";
        }
        return "LOCKED";
    }

    return "OK";
}

export async function ensureDatabaseIsCompatible(
    db: PouchDB.Database<EntryDoc>,
    setting: RemoteDBSettings,
    deviceNodeID: string,
    currentVersionRange: ChunkVersionRange,
    nodeDeviceInfo: DeviceInfo
): Promise<ENSURE_DB_RESULT> {
    const remoteMilestone = await resolveWithIgnoreKnownError<EntryMilestoneInfo | false>(
        db.get(MILESTONE_DOC_ID),
        false
    );
    const ret = await ensureRemoteIsCompatible(
        remoteMilestone,
        setting,
        deviceNodeID,
        currentVersionRange,
        nodeDeviceInfo,
        async (info) => {
            await db.put(info);
        }
    );
    return ret;
}
