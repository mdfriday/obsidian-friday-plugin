import { createHash } from "crypto";

export function nameToId(name: string): string {
	return createHash("sha256")
		.update(name.trim().toLowerCase()) // 规范化，避免大小写/空格影响
		.digest("hex")
		.slice(0, 8);
}
