import {App, FileSystemAdapter} from "obsidian";
import type {User} from "./user";
import {API_URL_DEV} from "./main";
import * as path from "path";

export class Hugoverse {
	basePath: string;

	apiUrl: string;

	app: App
	user:User

	constructor(apiUrl = API_URL_DEV, user:User, app: App) {
		this.apiUrl = apiUrl;
		this.user = user;
		this.app = app;

		const adapter = app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			this.basePath = adapter.getBasePath();
		}
	}

	generateDownloadUrl(filename: string): string {
		return `${this.apiUrl}/api/uploads/themes/${filename}`;
	}

	projectDirPath(filepath: string): string {
		const projDirPath = path.join(path.dirname(filepath), "MDFriday");

		console.log("MDFriday projectDirPath: ", projDirPath);

		return projDirPath;
	}

}
