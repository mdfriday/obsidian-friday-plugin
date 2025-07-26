# Obsidian 插件功能需求文档 - 文件夹右键发布站点

## 📌 功能目标

用户在 Obsidian 中右键文件夹，选择“Build as site”，通过弹出的右侧面板进行站点配置、预览与发布操作，整个流程无需持久化管理项目状态，追求极简、高效、零心智负担的使用体验。

## 🧭 使用流程说明

### 1. 用户右键文件夹
- 在文件资源管理器中右键任意文件夹（TFolder）
- 出现菜单项：`Build as site`
- 仅在文件夹（非文件）上显示此菜单项

### 2. 弹出右侧面板（MDFriday Service View）
自动打开 Obsidian 右侧浮动面板，并选中 Friday_Service 类型的 view, 这个 view 是一个 tab 类型的结构，默认选中的是 Site 栏。
在 Site 栏里，展示的内容依次如下：

1. 内容路径： 当前右键的文件夹的文件名 | 只读 
2. 站点名称： 默认是当前文件夹名 | 可编辑 
3. 使用主题： 默认是 theme-book | 可选择，是一个下拉菜单， 菜单里的菜单项来自于 plugin.settings 里
4. 预览章节： 有一个预览铵钮，及生成的预览链接。将内容构建成站点，并为生成的站点文件，启动 http server 服务，方便用户预览
5. 发布章节： 有一个发布按钮，还有一个发布选项的下拉列表。只有预览成功生成了预览链接后，发布按钮才会激活，点击后，会使用 src/svelte/ProgressBar 来显示上传进度。上传成功后会在按钮下方显示成功状态。
6. 服务介绍： 在 Server.svelte 里用 <Info/> 来显示了服务介绍，现在我们要让这个信息贴在最下面，因为这只是个提示信息。

## 🔁 预览行为细节说明

点击 预览按钮 后：

- 在 plugin (obsidian-vault/.obsidian/plugins/mdfriday/preview/) 路径下创建一个随机文件夹， 如 acdfxxx
- 在该文件夹下创建配置文件 config.json, 详细内容参照后面的 config.json 细节章节
- 将用户选中的文件夹里所有的内容都拷贝到 preview/acdfxxx/content 目录下
- 构建站点：这一步先空出来，后面我会手动补充
- 检测 HTTP SERVER 是否启动，如果没有，则启动，根目录是 preview。 如启动的服务地址是 http://localhost:1314/
- 打开默认浏览器访问本次预览的地址: http://localhost:1314/acdfxxx/，展示实时构建结果
- Obsidian 监控选中文件夹中 `.md` 文件的变更，实时同步更新到本地构建（热重载）
- 用户可边写边看效果，提升信心

### config.json 细节

```json
{
  "baseURL": "/acdfxxx/", //来自于随机生成的文件夹名
  "title": "Test real example Site",
  "contentDir": "content",
  "publishDir": "public",
  "defaultContentLanguage": "en",
  "taxonomies": {
    "tag": "tags",
    "category": "categories"
  },
  "module": {
    "imports": [
      {
        "path": "http://localhost:8090/long-teng.zip"
      }
    ]
  },
  "params": {
    "environment": "development"
  }
} 
```

