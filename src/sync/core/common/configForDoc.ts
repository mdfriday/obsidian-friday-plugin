import type { Confirm } from "../interfaces/Confirm";
import { isCloudantURI } from "../pouchdb/utils_couchdb";
import { $msg } from "./i18n";
import { LOG_LEVEL_INFO, LOG_LEVEL_NOTICE, LOG_LEVEL_VERBOSE, Logger } from "./logger";
import { getConfName, type AllSettingItemKey } from "./settingConstants";
import { ChunkAlgorithmNames, E2EEAlgorithmNames, E2EEAlgorithms, type ObsidianLiveSyncSettings } from "./types";

enum ConditionType {
    PLATFORM_CASE_INSENSITIVE = "platform-case-insensitive",
    PLATFORM_CASE_SENSITIVE = "platform-case-sensitive",
    REMOTE_CASE_SENSITIVE = "remote-case-sensitive",
}
export enum RuleLevel {
    Must,
    Necessary,
    Recommended,
    Optional,
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type BaseRule<TType extends string, TValue> = {
    // type: TType;
    level?: RuleLevel;
    requireRebuild?: boolean;
    requireRebuildLocal?: boolean;
    recommendRebuild?: boolean;
    reason?: string;
    reasonFunc?: (settings: Partial<ObsidianLiveSyncSettings>) => string;
    condition?: ConditionType[];
    detectionFunc?: (settings: Partial<ObsidianLiveSyncSettings>) => boolean;
    value?: TValue;
    valueDisplay?: string;
    valueDisplayFunc?: (settings: Partial<ObsidianLiveSyncSettings>) => string;
    obsoleteValues?: TValue[];
};

// Number-related rules
type NumberRuleExact = BaseRule<"number", number> & {};

type NumberRuleRange = BaseRule<"number", number> & {
    min?: number;
    max?: number;
    step?: number;
};

// String-related rules
type StringRangeRule = BaseRule<"string", string> & {
    minLength?: number;
    maxLength?: number;
    regexp?: string;
};

type StringRule = BaseRule<"string", string> & {
    // value: string;
};

// Boolean-related rules
type BooleanRule = BaseRule<"boolean", boolean> & {};

// type NotTarget = BaseRule<"ignored", unknown>;

// Define appropriate rule types based on property types
export type RuleForType<T> = T extends number
    ? NumberRuleExact | NumberRuleRange
    : T extends string
      ? StringRule | StringRangeRule
      : T extends boolean
        ? BooleanRule
        : never;

type OriginalSettings = Partial<ObsidianLiveSyncSettings>;

// Strongly typed regulation mapping
export type DoctorRegulation = {
    version: string;
    rules: {
        [P in keyof OriginalSettings]: RuleForType<OriginalSettings[P]>;
    };
};
export const DoctorRegulationV0_24_16: DoctorRegulation = {
    version: "0.24.16",
    rules: {
        sendChunksBulk: {
            value: false,
            reason: "This is an obsolete setting and we should not enable this no more",
            level: RuleLevel.Must,
        },
        sendChunksBulkMaxSize: {
            value: 1,
            reason: "This is an obsolete setting and we should not enable this no more",
            level: RuleLevel.Must,
        },
        doNotUseFixedRevisionForChunks: {
            value: true,
            reason: "This value has been reverted at v0.24.16 for garbage collection of chunks.",
            level: RuleLevel.Recommended,
        },
        handleFilenameCaseSensitive: {
            value: false,
            reason: "If Self-hosted LiveSync is Case-Sensitive, unexpected file operations may occur when synchronising with Windows, Android or other devices. This value should only be enabled if all devices have a Case-Sensitive file system.",
            requireRebuild: true,
            level: RuleLevel.Recommended,
        },
        useIndexedDBAdapter: {
            value: true,
            requireRebuildLocal: true,
            level: RuleLevel.Optional,
            reason: "The old option is active. This is not a performance-appropriate setting.",
        },
        useEden: {
            reason: "This option is no longer recommended.",
            level: RuleLevel.Optional,
            value: false,
        },
        hashAlg: {
            obsoleteValues: ["sha1", "xxhash32", ""],
            value: "xxhash64",
            level: RuleLevel.Necessary,
            reason: "The hash function is set to the old fallback. This should be retried. This may result in a change to the new fallback.",
        },
        disableCheckingConfigMismatch: {
            value: false,
            level: RuleLevel.Recommended,
            reason: "If you disabled an older version of the dialogue because it was hard to understand, try it once in the latest version.",
        },
        enableCompression: {
            value: false,
            level: RuleLevel.Recommended,
            requireRebuild: true,
            reason: "This option will be sunset soon.",
        },
    },
} as const;

export const DoctorRegulationV0_24_30: DoctorRegulation = {
    version: "0.24.30",
    rules: {
        ...DoctorRegulationV0_24_16.rules,
        usePluginSyncV2: {
            value: true,
            level: RuleLevel.Recommended,
            reason: "This option is now enabled by default. If you have problems with the new plugin, please report them.",
        },
        chunkSplitterVersion: {
            value: "v3-rabin-karp",
            valueDisplay: ChunkAlgorithmNames["v3-rabin-karp"],
            level: RuleLevel.Recommended,
            reason: "Chunk splitting has been optimised for more effective de-duplication. This is the new default value.",
        },
        customChunkSize: {
            min: 55,
            // max: 1000,
            value: 60,
            valueDisplay: "60 (detected on if less than 55)",
            level: RuleLevel.Recommended,
            detectionFunc: (settings: Partial<ObsidianLiveSyncSettings>) =>
                settings?.chunkSplitterVersion === "v3-rabin-karp" && !isCloudantURI(settings?.couchDB_URI || ""),
            reason: "With the V3 Rabin-Karp chunk splitter and Self-hosted CouchDB, the chunk size is set to 60 (means around 6MB) by default. This is in effect the maximum chunk size, which in practice is divided more finely.",
        },
    },
};

export const DoctorRegulationV0_25_0: DoctorRegulation = {
    version: "0.25.0",
    rules: {
        ...DoctorRegulationV0_24_30.rules,
        E2EEAlgorithm: {
            value: E2EEAlgorithms.V2,
            valueDisplay: E2EEAlgorithmNames[E2EEAlgorithms.V2],
            level: RuleLevel.Recommended,
            reasonFunc: (_) => $msg("Doctor.RULES.E2EE_V02500.REASON"),
        },
    },
} as const;
export const DoctorRegulationV0_25_27: DoctorRegulation = {
    version: "0.25.27",
    rules: {
        ...DoctorRegulationV0_25_0.rules,
        useIndexedDBAdapter: undefined,
    },
};

export const DoctorRegulation = DoctorRegulationV0_25_27;

export function checkUnsuitableValues(
    setting: Partial<ObsidianLiveSyncSettings>,
    regulation: DoctorRegulation = DoctorRegulation
): DoctorRegulation {
    const result: DoctorRegulation = {
        version: regulation.version,
        rules: {},
    };
    for (const key in regulation.rules) {
        if (!regulation.rules.hasOwnProperty(key)) continue;
        const rule = regulation.rules[key as keyof OriginalSettings];
        if (!rule) continue;

        const value = setting[key as keyof OriginalSettings];
        if (rule.value === value) {
            Logger(`Rule satisfied: ${key} is ${value}`);
            continue;
        }
        if (typeof value == "number" && "min" in rule && "max" in rule) {
            const min = rule.min ?? Number.MIN_SAFE_INTEGER;
            const max = rule.max ?? Number.MAX_SAFE_INTEGER;
            if (value >= min && value <= max) {
                Logger(`Rule satisfied: ${key} is ${value} between ${min} and ${max}`);
                continue;
            }
        }
        if (rule.detectionFunc && !rule.detectionFunc(setting)) {
            Logger(`Rule condition satisfied: ${key} is ${value}, and detection function returned false`);
            continue;
        }
        //@ts-ignore
        result.rules[key as keyof OriginalSettings] = rule;
        Logger(`Rule violation: ${key} is ${value} but should be ${rule.value}`);
    }
    return result;
}

export const RebuildOptions = {
    AutomaticAcceptable: 0,
    ConfirmIfRequired: 1,
    SkipEvenIfRequired: 2,
} as const;
export type RebuildOptionsType = (typeof RebuildOptions)[keyof typeof RebuildOptions];
export type DoctorOptions = {
    localRebuild: RebuildOptionsType;
    remoteRebuild: RebuildOptionsType;
    activateReason?: string;
    forceRescan?: boolean;
};

export type DoctorResult = {
    settings: ObsidianLiveSyncSettings;
    shouldRebuild: boolean;
    shouldRebuildLocal: boolean;
    isModified: boolean;
};
export type HasConfirm = {
    confirm: Confirm;
};

export async function performDoctorConsultation(
    env: HasConfirm,
    settings: ObsidianLiveSyncSettings,
    {
        localRebuild = RebuildOptions.ConfirmIfRequired,
        remoteRebuild = RebuildOptions.ConfirmIfRequired,
        activateReason = "updated",
        forceRescan = false,
    }: DoctorOptions
): Promise<DoctorResult> {
    let shouldRebuild = false;
    let shouldRebuildLocal = false;
    let isModified = false;
    function getResult(): DoctorResult {
        return {
            settings,
            shouldRebuild,
            shouldRebuildLocal,
            isModified,
        };
    }

    const r = checkUnsuitableValues(settings);
    if (!forceRescan && r.version == settings.doctorProcessedVersion) {
        const isIssueFound = Object.keys(r.rules).length > 0;
        const msg = isIssueFound ? "Issues found" : "No issues found";
        Logger(`${msg} but marked as to be silent`, LOG_LEVEL_VERBOSE);
        return getResult();
    }
    const issues = Object.entries(r.rules);
    if (issues.length == 0) {
        Logger($msg("Doctor.Message.NoIssues"), activateReason !== "updated" ? LOG_LEVEL_NOTICE : LOG_LEVEL_INFO);
        return getResult();
    } else {
        const OPT_YES = `${$msg("Doctor.Button.Yes")}` as const;
        const OPT_NO = `${$msg("Doctor.Button.No")}` as const;
        const OPT_DISMISS = `${$msg("Doctor.Button.DismissThisVersion")}` as const;
        // this._log(`Issues found in ${key}`, LOG_LEVEL_VERBOSE);
        const issues = Object.keys(r.rules)
            .map((key) => `- ${getConfName(key as AllSettingItemKey)}`)
            .join("\n");
        const msg = await env.confirm.askSelectStringDialogue(
            $msg("Doctor.Dialogue.Main", { activateReason, issues }),
            [OPT_YES, OPT_NO, OPT_DISMISS],
            {
                title: $msg("Doctor.Dialogue.Title"),
                defaultAction: OPT_YES,
            }
        );
        if (msg == OPT_DISMISS) {
            settings.doctorProcessedVersion = r.version;
            // await this.core.saveSettings();
            isModified = true;
            Logger("Marked as to be silent", LOG_LEVEL_VERBOSE);
            return {
                settings,
                shouldRebuild,
                shouldRebuildLocal,
                isModified,
            };
        }
        if (msg != OPT_YES) return getResult();
        const issueItems = Object.entries(r.rules) as [keyof ObsidianLiveSyncSettings, RuleForType<any>][];
        Logger(`${issueItems.length} Issue(s) found `, LOG_LEVEL_VERBOSE);
        let idx = 0;
        const applySettings = {} as Partial<ObsidianLiveSyncSettings>;
        const OPT_FIX = `${$msg("Doctor.Button.Fix")}` as const;
        const OPT_SKIP = `${$msg("Doctor.Button.Skip")}` as const;
        const OPTION_FIX_WITHOUT_REBUILD = `${$msg("Doctor.Button.FixButNoRebuild")}` as const;
        let skipped = 0;
        for (const [key, value] of issueItems) {
            const levelMap = {
                [RuleLevel.Necessary]: $msg("Doctor.Level.Necessary"),
                [RuleLevel.Recommended]: $msg("Doctor.Level.Recommended"),
                [RuleLevel.Optional]: $msg("Doctor.Level.Optional"),
                [RuleLevel.Must]: $msg("Doctor.Level.Must"),
            };
            const level = value.level ? levelMap[value.level] : "Unknown";
            const options = [OPT_FIX] as [typeof OPT_FIX | typeof OPT_SKIP | typeof OPTION_FIX_WITHOUT_REBUILD];
            let askRebuild = false;
            let askRebuildLocal = false;
            if (value.requireRebuild) {
                if (remoteRebuild == RebuildOptions.AutomaticAcceptable) {
                    askRebuild = false;
                    shouldRebuild = true;
                } else if (remoteRebuild == RebuildOptions.ConfirmIfRequired) {
                    askRebuild = true;
                } else if (remoteRebuild == RebuildOptions.SkipEvenIfRequired) {
                    askRebuild = false;
                    shouldRebuild = false;
                }
            }
            if (value.requireRebuildLocal) {
                if (localRebuild == RebuildOptions.AutomaticAcceptable) {
                    askRebuildLocal = false;
                    shouldRebuildLocal = true;
                } else if (localRebuild == RebuildOptions.ConfirmIfRequired) {
                    askRebuildLocal = true;
                } else if (localRebuild == RebuildOptions.SkipEvenIfRequired) {
                    askRebuildLocal = false;
                    shouldRebuildLocal = false;
                }
            }
            if (askRebuild || askRebuildLocal) {
                options.push(OPTION_FIX_WITHOUT_REBUILD);
            }
            options.push(OPT_SKIP);
            const note = `${askRebuild ? $msg("Doctor.Message.RebuildRequired") : ""}${askRebuildLocal ? $msg("Doctor.Message.RebuildLocalRequired") : ""}`;

            const ret = await env.confirm.askSelectStringDialogue(
                $msg("Doctor.Dialogue.MainFix", {
                    name: getConfName(key as AllSettingItemKey),
                    current: `${settings[key]}`,
                    reason: value.reasonFunc?.(settings) ?? value.reason ?? " N/A ",
                    ideal: `${value.valueDisplayFunc ? value.valueDisplayFunc(settings) : value.value}`,
                    //@ts-ignore
                    level: `${level}`,
                    note: note,
                }),
                options,
                {
                    title: $msg("Doctor.Dialogue.TitleFix", { current: `${++idx}`, total: `${issueItems.length}` }),
                    defaultAction: OPT_FIX,
                }
            );

            if (ret == OPT_FIX || ret == OPTION_FIX_WITHOUT_REBUILD) {
                //@ts-ignore
                applySettings[key] = value.value;
                if (ret == OPT_FIX) {
                    shouldRebuild = shouldRebuild || askRebuild || false;
                    shouldRebuildLocal = shouldRebuildLocal || askRebuildLocal || false;
                }
                isModified = true;
            } else {
                skipped++;
            }
        }
        if (Object.keys(applySettings).length > 0) {
            settings = {
                ...settings,
                ...applySettings,
            };
        }
        if (skipped == 0) {
            settings.doctorProcessedVersion = r.version;
            isModified = true;
        } else {
            if (
                (await env.confirm.askYesNoDialog($msg("Doctor.Message.SomeSkipped"), {
                    title: $msg("Doctor.Dialogue.TitleAlmostDone"),
                    defaultOption: "No",
                })) == "no"
            ) {
                // Some skipped, and user wants
                settings.doctorProcessedVersion = r.version;
                isModified = true;
            }
        }
    }
    return getResult();
}
