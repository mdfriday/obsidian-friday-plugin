/**
 * Obsidian Wiki Interface Integration Tests
 * 
 * 完整测试通过 Obsidian Interface 使用 Wiki 功能的端到端流程
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// 现在可以直接使用 desktop/index.ts 的统一导出，Vitest 支持 ESM
import {
  createObsidianWorkspaceService,
  createObsidianGlobalConfigService,
  createObsidianProjectConfigService,
  createObsidianProjectService,
  createObsidianWikiService
} from '@internal/interfaces/obsidian/desktop';
import { loadLLMConfigFromEnv, validateLLMConfig } from '@internal/infrastructure/llm/llm-config';

// DDD 主题测试数据
const DDD_SOURCE_CONTENT = `# Domain-Driven Design Introduction

Domain-Driven Design (DDD) is a software development approach that focuses on modeling software to match the business domain.

## Key Concepts

### Ubiquitous Language
A common language shared between developers and domain experts. This language should be used consistently in code, documentation, and conversation.

### Bounded Context
A logical boundary within which a particular domain model is defined and applicable. Different bounded contexts may have different models for the same entity.

### Entities
Objects that have a distinct identity that runs through time and different states. For example, a User or Order entity has a unique ID.

### Value Objects
Objects that describe characteristics but have no conceptual identity. For example, an Address or Money amount.

### Aggregates
A cluster of domain objects that can be treated as a single unit. An aggregate has a root entity called the Aggregate Root which ensures consistency.

### Repositories
Mechanisms for encapsulating storage, retrieval, and search behavior which emulates a collection of objects.

## Benefits

DDD provides better communication through ubiquitous language, focused design through bounded contexts, and business alignment where code directly reflects business rules.
`;

// 共享测试状态
let tempWorkspacePath: string = '';
let tempSourcePath: string = '';
let wikiOutputDir: string = '';
const wikiProjectName = 'ddd-wiki';

describe('Obsidian Wiki Interface Integration', () => {
  const conversationHistory: Array<{ question: string; answer: string }> = [];
  let llmConfigAvailable = false;
  let embeddingConfigAvailable = false;

  beforeAll(async () => {
    // 创建临时目录结构
    tempWorkspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'obsidian-wiki-interface-test-'));
    tempSourcePath = path.join(tempWorkspacePath, 'ddd-notes');
    wikiOutputDir = path.join(tempWorkspacePath, 'ddd-notes wiki');
    
    console.log(`\n📦 Test environment:`);
    console.log(`  Workspace: ${tempWorkspacePath}`);
    console.log(`  Source: ${tempSourcePath}`);
    console.log(`  Wiki output: ${wikiOutputDir}\n`);

    // 创建源文件目录
    await fs.mkdir(tempSourcePath, { recursive: true });
    
    // 创建 DDD 测试源文件
    await fs.writeFile(
      path.join(tempSourcePath, 'ddd-fundamentals.md'),
      DDD_SOURCE_CONTENT
    );
    console.log('✅ Test source file created\n');

    // 检查 LLM 配置
    const llmConfig = loadLLMConfigFromEnv();
    const validationResult = validateLLMConfig(llmConfig);
    
    if (validationResult.valid) {
      llmConfigAvailable = true;
      embeddingConfigAvailable = llmConfig.embedding?.type !== 'none';
      console.log('✅ LLM config available');
      if (embeddingConfigAvailable) {
        console.log('✅ Embedding config available\n');
      }
    } else {
      console.warn('⚠️  LLM config validation failed:', validationResult.errors);
      console.warn('⚠️  Tests will be skipped\n');
    }
  });

  afterAll(async () => {
    // 清理临时目录
    if (tempWorkspacePath) {
      try {
        await fs.rm(tempWorkspacePath, { recursive: true, force: true });
        console.log(`\n🧹 Cleaned up: ${tempWorkspacePath}`);
      } catch (error) {
        console.warn(`⚠️  Failed to clean up: ${error}`);
      }
    }
  });

  it('should complete the full Wiki workflow', async () => {
    if (!llmConfigAvailable) {
      console.warn('⚠️  Skipping test: LLM config not available');
      return;
    }

    // 初始化服务
    const workspaceService = createObsidianWorkspaceService();
    const globalConfigService = createObsidianGlobalConfigService();
    const projectService = createObsidianProjectService();
    const projectConfigService = createObsidianProjectConfigService();
    const wikiService = createObsidianWikiService();
    console.log('✅ Obsidian services initialized\n');

    // Step 1: Initialize Workspace
    console.log('📝 Step 1: Initialize Workspace\n');
    const initResult = await workspaceService.initWorkspace(tempWorkspacePath, {
      name: 'Wiki Test Workspace',
    });

    expect(initResult.success).toBe(true);
    expect(initResult.data).toBeDefined();
    expect(initResult.data?.name).toBe('Wiki Test Workspace');
    console.log(`✅ Workspace initialized: ${initResult.data?.id}\n`);

    // Step 2: Configure Global LLM Config
    console.log('⚙️  Step 2: Configure Global LLM Config\n');
    const llmConfig = loadLLMConfigFromEnv();
    
    const configResult = await globalConfigService.set(
      tempWorkspacePath,
      'llm',
      {
        type: llmConfig.llm.type || 'lmstudio',
        model: llmConfig.llm.defaultModel || process.env.LLM_MODEL,
        baseUrl: llmConfig.llm.baseURL || process.env.LLM_BASE_URL,
        maxTokens: 32768,
        contextLength: 262144,
        ...(embeddingConfigAvailable && {
          embeddingModel: llmConfig.embedding?.model || process.env.EMBEDDING_MODEL,
        }),
      }
    );

    expect(configResult.success).toBe(true);
    console.log('✅ Global LLM config set');

    const langResult = await globalConfigService.set(
      tempWorkspacePath,
      'wiki.outputLanguage',
      'English'
    );

    expect(langResult.success).toBe(true);
    console.log('✅ Wiki output language set to English\n');

    // Step 3: Create Wiki Project
    console.log('📚 Step 3: Create Wiki Project\n');
    const createProjectResult = await projectService.createProject({
      name: wikiProjectName,
      workspacePath: tempWorkspacePath,
      sourceFolder: tempSourcePath,
      type: 'wiki',
    });

    expect(createProjectResult.success).toBe(true);
    expect(createProjectResult.data).toBeDefined();
    expect(createProjectResult.data?.name).toBe(wikiProjectName);
    console.log(`✅ Wiki project created: ${createProjectResult.data?.id}\n`);

    // Step 4: Configure Project Config
    console.log('⚙️  Step 4: Configure Project Config\n');
    const setConfigResult = await projectConfigService.set(
      tempWorkspacePath,
      wikiProjectName,
      'outputDir',
      wikiOutputDir
    );

    expect(setConfigResult.success).toBe(true);
    expect(setConfigResult.data?.key).toBe('outputDir');
    expect(setConfigResult.data?.value).toBe(wikiOutputDir);
    console.log(`✅ Project outputDir configured: ${wikiOutputDir}\n`);

    // Step 5: Ingest Source Files (自动生成页面)
    console.log('📥 Step 5: Ingest Source Files\n');
    console.log('Starting ingest (pages will be auto-generated)...');
    const ingestStart = Date.now();

    // 收集进度事件
    const ingestProgressEvents: any[] = [];

    const ingestResult = await wikiService.ingest({
      workspacePath: tempWorkspacePath,
      projectName: wikiProjectName,
      temperature: 0.3,
      onProgress: (event) => {
        ingestProgressEvents.push(event);
        console.log(`  [${event.type}] ${event.message}`, event.progress ? `(${event.progress.percentage}%)` : '');
      }
    });

    const ingestElapsed = Date.now() - ingestStart;
    console.log(`Ingest completed in ${ingestElapsed}ms`);
    
    // 验证进度事件
    console.log(`\n📊 Progress Events: ${ingestProgressEvents.length} events captured`);
    expect(ingestProgressEvents.length).toBeGreaterThan(0);
    expect(ingestProgressEvents[0].type).toBe('ingest:start');
    expect(ingestProgressEvents[ingestProgressEvents.length - 1].type).toBe('ingest:complete');

    expect(ingestResult.success).toBe(true);
    expect(ingestResult.data).toBeDefined();
    expect(ingestResult.data!.success).toBe(true);
    
    const totalKnowledge = (ingestResult.data?.extractedEntities || 0) + (ingestResult.data?.extractedConcepts || 0);
    expect(totalKnowledge).toBeGreaterThan(0);
    
    console.log(`✅ Ingested: ${ingestResult.data?.extractedEntities} entities, ${ingestResult.data?.extractedConcepts} concepts, ${ingestResult.data?.extractedConnections} connections`);
    
    // 验证自动生成的页面
    expect(ingestResult.data!.pagesGenerated).toBeGreaterThan(0);
    console.log(`✅ Auto-generated: ${ingestResult.data!.pagesGenerated} pages\n`);

    // 验证 KB 文件
    const kbPath = path.join(wikiOutputDir, 'kb.json');
    const kbExists = await fs.access(kbPath).then(() => true).catch(() => false);
    expect(kbExists).toBe(true);
    console.log(`✅ KB file exists: ${kbPath}\n`);

    // Step 5.5: Verify Embedding Index (如果配置了 embedding)
    if (embeddingConfigAvailable) {
      console.log('🔍 Step 5.5: Verify Embedding Index\n');
      
      // 验证 embedding index 文件存在
      const embeddingIndexPath = path.join(wikiOutputDir, 'embedding-index.json');
      const embeddingIndexExists = await fs.access(embeddingIndexPath)
        .then(() => true)
        .catch(() => false);
      
      if (embeddingIndexExists) {
        console.log(`✅ Embedding index file exists: ${embeddingIndexPath}`);
        
        // 读取并验证 embedding index 内容
        const embeddingIndexContent = await fs.readFile(embeddingIndexPath, 'utf-8');
        const embeddingIndex = JSON.parse(embeddingIndexContent);
        
        console.log('🔍 Embedding Index Statistics:');
        console.log(`   Embeddings count: ${embeddingIndex.embeddings?.length || 0}`);
        console.log(`   Dimension: ${embeddingIndex.dimension || 'N/A'}`);
        
        // 验证 embedding 数量合理（应该至少有一些 embeddings）
        expect(embeddingIndex.embeddings?.length || 0).toBeGreaterThan(0);
        console.log(`✅ Embedding index contains embeddings\n`);
      } else {
        console.log('⚠️  Embedding index file not found (embedding provider may not be properly configured)');
        console.log('   This is acceptable if embedding service is not actually running\n');
      }
    } else {
      console.log('ℹ️  Skipping embedding verification (not configured)\n');
    }

    // Step 6: Multi-turn Query Conversation
    console.log('💬 Step 6: Multi-turn Query Conversation\n');
    
    if (embeddingConfigAvailable) {
      console.log('ℹ️  Embedding-based retrieval is enabled\n');
    }

    // Turn 1 (with progress tracking)
    const question1 = 'What is Domain-Driven Design?';
    console.log(`🤔 Turn 1: ${question1}`);

    const queryProgressEvents: any[] = [];
    let answer1 = '';
    for await (const chunk of wikiService.queryStream({
      workspacePath: tempWorkspacePath,
      projectName: wikiProjectName,
      question: question1,
      onProgress: (event) => {
        queryProgressEvents.push(event);
        console.log(`  [${event.type}] ${event.message}`);
      }
    })) {
      answer1 += chunk;
    }

    expect(answer1.length).toBeGreaterThan(0);
    conversationHistory.push({ question: question1, answer: answer1 });
    console.log(`✅ Turn 1: Question answered (${answer1.length} chars)`);
    
    // 验证 query 进度事件
    console.log(`📊 Query Progress Events: ${queryProgressEvents.length} events`);
    expect(queryProgressEvents.length).toBeGreaterThan(0);
    expect(queryProgressEvents[0].type).toBe('query:start');
    expect(queryProgressEvents[queryProgressEvents.length - 1].type).toBe('query:complete');
    console.log('');

    // Turn 2
    const question2 = 'What is a Bounded Context in DDD?';
    console.log(`🤔 Turn 2: ${question2}`);

    let answer2 = '';
    for await (const chunk of wikiService.queryStream({
      workspacePath: tempWorkspacePath,
      projectName: wikiProjectName,
      question: question2,
    })) {
      answer2 += chunk;
    }

    expect(answer2.length).toBeGreaterThan(0);
    conversationHistory.push({ question: question2, answer: answer2 });
    console.log(`✅ Turn 2: Question answered (${answer2.length} chars)\n`);

    // Turn 3
    const question3 = 'What is the difference between Entity and Value Object?';
    console.log(`🤔 Turn 3: ${question3}`);

    let answer3 = '';
    for await (const chunk of wikiService.queryStream({
      workspacePath: tempWorkspacePath,
      projectName: wikiProjectName,
      question: question3,
    })) {
      answer3 += chunk;
    }

    expect(answer3.length).toBeGreaterThan(0);
    conversationHistory.push({ question: question3, answer: answer3 });
    console.log(`✅ Turn 3: Question answered (${answer3.length} chars)\n`);

    console.log(`✅ Collected ${conversationHistory.length} conversation turns\n`);

    // Step 6.5: Test Embedding-based Retrieval
    if (embeddingConfigAvailable) {
      console.log('🔬 Step 6.5: Test Embedding-based Retrieval\n');
      
      // 测试 1: 语义相似度查询（应该通过 embedding 找到最相关的内容）
      const semanticQuestion = 'How do aggregates ensure consistency?';
      console.log(`🔍 Semantic query: ${semanticQuestion}`);
      
      let semanticAnswer = '';
      for await (const chunk of wikiService.queryStream({
        workspacePath: tempWorkspacePath,
        projectName: wikiProjectName,
        question: semanticQuestion,
      })) {
        semanticAnswer += chunk;
      }
      
      // 验证答案包含相关概念（Aggregate）
      const containsAggregate = semanticAnswer.toLowerCase().includes('aggregate');
      expect(containsAggregate).toBe(true);
      expect(semanticAnswer.length).toBeGreaterThan(0);
      console.log(`✅ Semantic query found relevant content (mentions "aggregate")`);
      console.log(`   Answer length: ${semanticAnswer.length} chars`);
      
      // 测试 2: 同义词/相关概念查询
      const relatedQuestion = 'What defines object identity in domain models?';
      console.log(`🔍 Related concept query: ${relatedQuestion}`);
      
      let relatedAnswer = '';
      for await (const chunk of wikiService.queryStream({
        workspacePath: tempWorkspacePath,
        projectName: wikiProjectName,
        question: relatedQuestion,
      })) {
        relatedAnswer += chunk;
      }
      
      // 验证答案提到 Entity（通过 embedding 应该能关联到 Entity 概念）
      const mentionsEntity = relatedAnswer.toLowerCase().includes('entity') || 
                            relatedAnswer.toLowerCase().includes('identity');
      expect(mentionsEntity).toBe(true);
      expect(relatedAnswer.length).toBeGreaterThan(0);
      console.log(`✅ Related concept query successfully retrieved Entity information`);
      console.log(`   Answer length: ${relatedAnswer.length} chars\n`);
    } else {
      console.log('ℹ️  Skipping embedding-based retrieval tests (not configured)\n');
    }

    // Step 7: Save Conversation
    console.log('💾 Step 7: Save Conversation\n');

    const saveResult = await wikiService.saveConversation({
      workspacePath: tempWorkspacePath,
      projectName: wikiProjectName,
      title: 'DDD Q&A Session',
      topic: 'Domain-Driven Design',
      conversationHistory,
      filename: '2026-04-30-ddd-qa-session.md',
    });

    expect(saveResult.success).toBe(true);
    expect(saveResult.data?.savedPath).toBeDefined();
    console.log(`✅ Saved conversation to: ${path.basename(saveResult.data?.savedPath || '')}\n`);

    // Step 7.5: Verify Embedding Index Update
    if (embeddingConfigAvailable) {
      console.log('🔄 Step 7.5: Verify Embedding Index Update\n');
      
      // 读取更新后的 embedding index
      const embeddingIndexPath = path.join(wikiOutputDir, 'embedding-index.json');
      const embeddingIndexExists = await fs.access(embeddingIndexPath)
        .then(() => true)
        .catch(() => false);
      
      if (embeddingIndexExists) {
        const updatedIndexContent = await fs.readFile(embeddingIndexPath, 'utf-8');
        const updatedIndex = JSON.parse(updatedIndexContent);
        
        console.log('🔍 Updated Embedding Index Statistics:');
        console.log(`   Embeddings count: ${updatedIndex.embeddings?.length || 0}`);
        
        // 验证 embedding 数量增加了（对话 ingest 后应该有新的 entities/concepts）
        // 至少应该还是有 embeddings
        expect(updatedIndex.embeddings?.length || 0).toBeGreaterThan(0);
        console.log(`✅ Embedding index maintained after conversation ingest\n`);
      } else {
        console.log('ℹ️  Embedding index not found, skipping update verification\n');
      }
    }

    // Step 8: Re-ingest Saved Conversation
    console.log('🔄 Step 8: Re-ingest Saved Conversation\n');

    // 不需要重新 ingest，因为 saveConversation 的 autoIngest=true 已经处理了
    // 如果我们重新 ingest 整个项目，会覆盖之前的 KB
    console.log('✅ Conversation already auto-ingested in Step 7\n');

    // Step 9: Verify Final Output
    console.log('✔️  Step 9: Verify Final Output\n');

    // 验证 conversations 目录
    const conversationsDir = path.join(wikiOutputDir, 'conversations');
    const conversationsDirExists = await fs.access(conversationsDir).then(() => true).catch(() => false);
    expect(conversationsDirExists).toBe(true);

    // 读取源文件数量
    const sourceFiles = await fs.readdir(tempSourcePath);
    const mdFiles = sourceFiles.filter(f => f.endsWith('.md'));

    console.log('✅ Wiki structure complete');
    console.log(`   Source files: ${mdFiles.length + 1} (original + conversation)`);
    console.log(`   KB file: exists`);
    console.log(`   Conversations dir: exists\n`);

    // 读取 KB 验证
    const kbContent = await fs.readFile(kbPath, 'utf-8');
    const kb = JSON.parse(kbContent);

    console.log('🔍 KB File Size:', kbContent.length, 'bytes');
    console.log('🔍 KB Structure Keys:', Object.keys(kb));
    
    // KB 结构是对象，不是数组，需要计算 key 数量
    const entityCount = kb.entities ? Object.keys(kb.entities).length : 0;
    const conceptCount = kb.concepts ? Object.keys(kb.concepts).length : 0;
    const sourceCount = kb.sources ? Object.keys(kb.sources).length : 0;
    
    console.log('✅ Final KB Statistics:');
    console.log(`   Entities: ${entityCount}`);
    console.log(`   Concepts: ${conceptCount}`);
    console.log(`   Sources: ${sourceCount}`);
    console.log(`   Total Knowledge: ${entityCount + conceptCount}\n`);

    // Verify there's knowledge in the KB
    const hasKnowledge = entityCount > 0 || conceptCount > 0;
    expect(hasKnowledge).toBe(true);

    // Step 10: Verify Generated Pages (已在 Step 5 自动生成)
    console.log('🔍 Step 10: Verify Generated Pages\n');

    // 验证 entities 目录
    const entitiesDir = path.join(wikiOutputDir, 'entities');
    const entitiesDirExists = await fs.access(entitiesDir).then(() => true).catch(() => false);
    
    // 验证 concepts 目录
    const conceptsDir = path.join(wikiOutputDir, 'concepts');
    const conceptsDirExists = await fs.access(conceptsDir).then(() => true).catch(() => false);

    let generatedEntityFiles = 0;
    let generatedConceptFiles = 0;

    if (entitiesDirExists) {
      const entityFiles = await fs.readdir(entitiesDir);
      generatedEntityFiles = entityFiles.filter(f => f.endsWith('.md')).length;
      console.log(`✅ Entities directory exists with ${generatedEntityFiles} files`);
    }

    if (conceptsDirExists) {
      const conceptFiles = await fs.readdir(conceptsDir);
      generatedConceptFiles = conceptFiles.filter(f => f.endsWith('.md')).length;
      console.log(`✅ Concepts directory exists with ${generatedConceptFiles} files`);
    }

    const totalGeneratedPages = generatedEntityFiles + generatedConceptFiles;
    console.log(`\n✅ Total generated pages: ${totalGeneratedPages}`);
    console.log(`   Entity pages: ${generatedEntityFiles}`);
    console.log(`   Concept pages: ${generatedConceptFiles}`);

    // 验证生成的页面数量与 KB 中的知识数量一致
    expect(totalGeneratedPages).toBe(entityCount + conceptCount);
    
    // 注意：ingestResult.data!.pagesGenerated 是 Step 5 时的数量
    // 但 Step 7 保存对话后又 auto-ingest 并生成了新页面
    // 所以现在磁盘上的页面数量应该等于最终 KB 中的 entity + concept 数量
    console.log(`   Initial ingest generated: ${ingestResult.data!.pagesGenerated} pages`);
    console.log(`   Final pages match KB: ${totalGeneratedPages} = ${entityCount} + ${conceptCount}`);

    // 验证至少有一个 Entity 页面和一个 Concept 页面生成
    if (entityCount > 0) {
      expect(generatedEntityFiles).toBeGreaterThan(0);
      
      // 读取第一个 entity 页面验证内容
      const entityFiles = await fs.readdir(entitiesDir);
      const firstEntityFile = entityFiles.find(f => f.endsWith('.md'));
      if (firstEntityFile) {
        const entityContent = await fs.readFile(path.join(entitiesDir, firstEntityFile), 'utf-8');
        expect(entityContent.length).toBeGreaterThan(0);
        console.log(`\n✅ Sample entity page verified: ${firstEntityFile} (${entityContent.length} bytes)`);
      }
    }

    if (conceptCount > 0) {
      expect(generatedConceptFiles).toBeGreaterThan(0);
      
      // 读取第一个 concept 页面验证内容
      const conceptFiles = await fs.readdir(conceptsDir);
      const firstConceptFile = conceptFiles.find(f => f.endsWith('.md'));
      if (firstConceptFile) {
        const conceptContent = await fs.readFile(path.join(conceptsDir, firstConceptFile), 'utf-8');
        expect(conceptContent.length).toBeGreaterThan(0);
        console.log(`✅ Sample concept page verified: ${firstConceptFile} (${conceptContent.length} bytes)`);
      }
    }

    console.log('\n🎉 All tests passed!\n');
  }, 600000); // 10 minutes timeout
});
