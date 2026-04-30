# CSS Animation Implementation for Wiki Progress

## Overview
Implemented CSS-based animation solution for displaying progress during Wiki ingest and query operations in the Friday Chat UI.

## Implementation Date
2026-04-30

## Problem
User wanted to see visual feedback (animation) during long-running Wiki operations (ingest, query) rather than just static text, while Foundry retained its callback-based progress mechanism.

## Solution: CSS Animation with HTML Injection

### 1. ChatRuntime Changes (`src/chat/ChatRuntime.ts`)

#### Ingest Progress Animation

Modified `handleWikiIngest` to inject animated HTML into the tool call delta stream:

```typescript
// 4. 显示处理中动画
yield {
	type: 'tool_call_delta',
	id: toolId,
	delta: '<div class="friday-wiki-progress">' +
	       '<div class="friday-spinner"></div>' +
	       '<span class="friday-progress-text">Processing files and generating wiki</span>' +
	       '</div>\n\n' +
	       '<div class="friday-progress-hint">💡 Detailed progress in DevTools Console (Ctrl/Cmd+Shift+I)</div>\n\n',
};

// 5. 执行 ingest（收集关键进度）
const keyProgress: string[] = [];
const result = await this.wikiService.ingest(projectName, (event) => {
	// 收集关键进度事件
	if (event.type === 'ingest:file:complete') {
		const progressText = event.progress 
			? ` [${event.progress.current}/${event.progress.total}]`
			: '';
		keyProgress.push(`✓ File processed${progressText}`);
	} else if (event.type === 'ingest:pages:complete') {
		keyProgress.push(`✓ Generated ${event.metadata?.pageCount || 0} wiki pages`);
	}
	
	// 所有事件输出到控制台
	console.log(`[${event.type}] ${event.message}${progressText}`);
});

// 6. 显示关键进度摘要
if (keyProgress.length > 0) {
	yield {
		type: 'tool_call_delta',
		id: toolId,
		delta: keyProgress.join('\n') + '\n\n',
	};
}
```

**Key Features:**
- Spinner animation (`friday-spinner`) shows continuous activity
- Static text (`Processing files and generating wiki`) with pulsing animation
- Progress callback collects key events (file completion, page generation)
- Detailed progress goes to DevTools Console
- Key milestones displayed in UI as list
- Final result shows entity/concept/connection counts

#### Query Progress Animation

Modified `handleWikiQuery` similarly:

```typescript
const toolId = `query-${Date.now()}`;
yield {
	type: 'tool_call_start',
	id: toolId,
	name: 'wiki_query',
	input: { question },
};

// 显示查询动画
yield {
	type: 'tool_call_delta',
	id: toolId,
	delta: '<div class="friday-wiki-progress">' +
	       '<div class="friday-spinner"></div>' +
	       '<span class="friday-progress-text">Searching knowledge base</span>' +
	       '</div>\n\n',
};

// 流式查询 with progress callback
let firstChunk = true;
for await (const chunk of this.wikiService.queryStream(projectName, question, (event) => {
	console.log(`[${event.type}] ${event.message}`);
})) {
	// 第一个 chunk 替换动画
	if (firstChunk) {
		yield {
			type: 'tool_call_delta',
			id: toolId,
			delta: chunk,
		};
		firstChunk = false;
	} else {
		yield {
			type: 'tool_call_delta',
			id: toolId,
			delta: chunk,
		};
	}
}

yield {
	type: 'tool_call_result',
	id: toolId,
	result: '✅ Query completed',
};
```

**Key Features:**
- Shows spinner during search
- First LLM response chunk replaces the animation
- Subsequent chunks stream normally
- Progress events logged to console

### 2. CSS Styles (`src/chat/styles/chat.css`)

Added three new CSS classes:

#### `.friday-wiki-progress`
Container for progress display:
```css
.friday-wiki-progress {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px;
	margin: 8px 0;
	background: var(--background-primary-alt);
	border-radius: 8px;
	border: 1px solid var(--background-modifier-border);
}
```

#### `.friday-spinner`
Rotating spinner animation:
```css
.friday-spinner {
	width: 20px;
	height: 20px;
	border: 3px solid var(--background-modifier-border);
	border-top-color: var(--interactive-accent);
	border-radius: 50%;
	animation: friday-spin 0.8s linear infinite;
}

@keyframes friday-spin {
	to {
		transform: rotate(360deg);
	}
}
```

#### `.friday-progress-text`
Pulsing text animation:
```css
.friday-progress-text {
	color: var(--text-normal);
	font-size: 0.95em;
	font-weight: 500;
	animation: friday-pulse 1.5s ease-in-out infinite;
}

@keyframes friday-pulse {
	0%, 100% {
		opacity: 1;
	}
	50% {
		opacity: 0.6;
	}
}
```

#### `.friday-progress-hint`
Hint text styling:
```css
.friday-progress-hint {
	color: var(--text-muted);
	font-size: 0.85em;
	font-style: italic;
	padding: 4px 8px;
	background: var(--background-secondary);
	border-radius: 4px;
	border-left: 2px solid var(--text-muted);
}
```

## User Experience

### During Ingest (`/wiki @folder`)
1. User sees:
   - Spinner rotating continuously
   - "Processing files and generating wiki" text pulsing
   - Hint to check DevTools Console for detailed progress
2. Key milestones appear as they happen:
   - `✓ File processed [1/5]`
   - `✓ File processed [2/5]`
   - ...
   - `✓ Generated 25 wiki pages`
3. Final result summary:
   - Entity/Concept/Connection counts
   - Pages generated count
   - Next steps suggestion

### During Query
1. User sees:
   - Spinner rotating
   - "Searching knowledge base" text pulsing
2. Animation replaced by first LLM response chunk
3. Subsequent chunks stream in real-time
4. "✅ Query completed" when done

### DevTools Console (Optional Detail)
All progress events still logged with full details:
```
[ingest:file:start] Processing file: llm-wiki-karpathy.md
[ingest:file:complete] Completed file: llm-wiki-karpathy.md [1/5] (20%)
[ingest:llm:entity:extracted] Extracted 15 entities
[ingest:llm:concept:extracted] Extracted 8 concepts
...
[ingest:pages:start] Generating wiki pages
[ingest:pages:complete] Generated 25 wiki pages
```

## Advantages of CSS Animation Approach

1. **No Foundry Changes**: Foundry keeps callback-based progress
2. **Simple Implementation**: Pure CSS, no complex state management
3. **Clear User Feedback**: Continuous spinner shows system is working
4. **Balanced Detail**: UI shows key milestones, Console has full detail
5. **Performance**: CSS animations are GPU-accelerated
6. **Maintainable**: Clear separation between visual feedback and data processing

## Technical Notes

- `tool_call_delta` chunks can contain HTML (Claudian's `MessageRenderer` renders it)
- CSS animations run independently of JS execution
- Progress callback remains synchronous/callback-based in Foundry
- No polling or shared state required in plugin
- Spinner continues until first actual content chunk replaces it

## Related Files

- `src/chat/ChatRuntime.ts` - Runtime with progress HTML injection
- `src/chat/styles/chat.css` - Animation styles
- Foundry progress callback remains unchanged

## Future Enhancements (Optional)

If more detailed UI progress needed in future:
1. Show progress percentage in UI (e.g., "Processing files (60%)")
2. Add progress bar component
3. Display current file name in UI
4. Animate milestone items as they appear

Current solution is sufficient for MVP/beta release.
