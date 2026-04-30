# Main.ts Chat 集成代码补丁

## 1. 在文件顶部添加 import (在第 41 行附近)

```typescript
// 添加 Chat 相关 import
import type {ChatView} from "./chat/ChatView";
import {VIEW_TYPE_FRIDAY_CHAT} from "./chat/ChatRuntime";
```

## 2. 在 FridayPlugin 类属性中添加 (在第 186 行附近)

```typescript
// Dynamic module references for PC-only features
private ThemeSelectionModalClass?: typeof ThemeSelectionModal
private FoundryProjectManagementModalClass?: typeof FoundryProjectManagementModal
private themeApiService?: typeof import("./theme/themeApiService").themeApiService
// ✅ 添加 Chat 相关
private ChatViewClass?: typeof ChatView
```

## 3. 在 initDesktopFeatures 方法中添加 Chat 初始化 (在第 252 行附近)

```typescript
private async initDesktopFeatures(): Promise<void> {
	// Dynamically import PC-only modules
	const [
		{ default: ServerView },
		{ ThemeSelectionModal },
		{ FoundryProjectManagementModal },
		{ Site },
		{ themeApiService },
		// ✅ 添加 Chat 导入
		{ ChatView }
	] = await Promise.all([
		import('./server'),
		import('./theme/modal'),
		import('./projects/foundryModal'),
		import('./site'),
		import('./theme/themeApiService'),
		// ✅ 添加 Chat 模块
		import('./chat/ChatView')
	]);

	// Import PC-only styles
	await Promise.all([
		import('./styles/theme-modal.css'),
		import('./styles/publish-settings.css'),
		import('./styles/project-modal.css'),
		import('./styles/live-sync.css'),
		// ✅ 添加 Chat 样式
		import('./chat/styles/chat.css')
	]);

	// Store dynamic module references
	this.ThemeSelectionModalClass = ThemeSelectionModal;
	this.FoundryProjectManagementModalClass = FoundryProjectManagementModal;
	this.themeApiService = themeApiService;
	// ✅ 添加 Chat 引用
	this.ChatViewClass = ChatView;

	// ... 现有代码 ...

	// ✅ 在注册其他 view 之后，添加 Chat View 注册
	// Register Chat view (在第 293 行附近，this.app.workspace.onLayoutReady 之前)
	try {
		this.registerView(VIEW_TYPE_FRIDAY_CHAT, (leaf) => {
			if (this.ChatViewClass) {
				return new this.ChatViewClass(leaf, this);
			}
			throw new Error('ChatView not loaded');
		});
	} catch (e) {
		console.error('[Friday] Chat view already registered, skipping');
	}

	// ✅ 添加 Chat Ribbon 图标 (在第 303 行之后)
	this.addRibbonIcon('message-square', 'Friday Chat (Beta)', async () => {
		await this.activateChatView();
	});

	// ✅ 添加 Chat 命令 (在第 332 行之后)
	this.addCommand({
		id: "open-friday-chat",
		name: "Open Friday Chat",
		callback: () => {
			this.activateChatView();
		}
	});

	// ... 其余代码保持不变 ...
}
```

## 4. 在文件末尾添加新方法 (在 class 内部最后)

```typescript
// ==================== Chat 相关方法 ====================

/**
 * 获取或创建 Wiki 项目
 * 用于 Chat Runtime
 */
async getOrCreateProjectForFolder(folderPath: string): Promise<string> {
	// 生成项目名（folder name + -wiki 后缀）
	const projectName = `${folderPath}-wiki`;
	
	// 检查项目是否已存在
	const existingProject = await this.getFoundryProject(projectName);
	
	if (existingProject) {
		return projectName;
	}
	
	// 项目不存在，创建新的 wiki 项目
	const folder = this.app.vault.getAbstractFileByPath(folderPath);
	if (!(folder instanceof TFolder)) {
		throw new Error(`Folder not found: ${folderPath}`);
	}
	
	// 创建项目
	const created = await this.createFoundryProject(projectName, folder, null);
	if (!created) {
		throw new Error(`Failed to create project: ${projectName}`);
	}
	
	return projectName;
}

/**
 * 发布文件夹
 * 用于 Chat Runtime
 */
async publishFolder(
	folderPath: string,
	options?: {
		onProgress?: (progress: { message: string; percent: number }) => void;
	}
): Promise<{ success: boolean; url?: string; error?: string }> {
	try {
		// 获取文件夹对象
		const folder = this.app.vault.getAbstractFileByPath(folderPath);
		if (!(folder instanceof TFolder)) {
			throw new Error(`Folder not found: ${folderPath}`);
		}
		
		// 使用现有的 publishTo 方法
		// 注意：这里使用 'mdf-free' 作为默认发布方式
		await this.publishTo(folder, 'mdf-free');
		
		// 获取项目名并构建 URL
		const projectName = `${folderPath}-wiki`;
		const previewId = await nameToIdAsync(projectName);
		const url = `https://mdfriday.com/f/${previewId}`;
		
		return {
			success: true,
			url,
		};
	} catch (error) {
		console.error('[Friday] Publish folder failed:', error);
		return {
			success: false,
			error: (error as Error).message,
		};
	}
}

/**
 * 激活 Chat View
 */
async activateChatView(): Promise<void> {
	const { workspace } = this.app;
	
	// 查找已存在的 Chat leaf
	let leaf = workspace.getLeavesOfType(VIEW_TYPE_FRIDAY_CHAT)[0];
	
	if (!leaf) {
		// 如果不存在，在右侧边栏创建新的 leaf
		const rightLeaf = workspace.getRightLeaf(false);
		if (rightLeaf) {
			await rightLeaf.setViewState({
				type: VIEW_TYPE_FRIDAY_CHAT,
				active: true,
			});
			leaf = rightLeaf;
		}
	}
	
	// 显示 leaf
	if (leaf) {
		workspace.revealLeaf(leaf);
	}
}
```

## 5. 在 ChatRuntime.ts 中修复 import

在 `src/chat/ChatRuntime.ts` 的顶部，需要确保正确 import FridayPlugin：

```typescript
import type FridayPlugin from '../main';
```

---

## 总结

这个补丁添加了：
1. Chat View 的动态导入
2. Chat View 的注册
3. Ribbon 图标和命令
4. 两个辅助方法供 ChatRuntime 使用：
   - `getOrCreateProjectForFolder()` - 获取或创建 Wiki 项目
   - `publishFolder()` - 发布文件夹到 MDFriday
   - `activateChatView()` - 激活 Chat 视图

下一步需要实际修改 main.ts 文件来应用这些更改。
