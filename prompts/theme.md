在我们的 @Site.svelte 里，当我们选择更换主题时，会打开 @modal.ts 供用户选择。 但目前的实现并没有和后端进行交互。
现在，我们要拓展主题选择功能，并真实与后端进行交互。
并包含功能，在 modal view 里，最上面是搜索框，搜索框下面显示了所有的TAGS， 用户可以通过选择这些 TAGS 快速搜索。 
下面展示的是根据搜索结果显示的主题卡片，目前卡片的功能我们已经实现。但用的是假数据。
我们需要参考 src/shorcode 的实现真实的数据和页面交互功能。
其中 Template 的 API_ENDPOINTS 对应的有 /api/templates, /api/template, /api/template/search, /api/template/tags , type: Template。
目前 shortcode 实现了所有需要的 API功能，这样方便用户进行页面交互。
同时，请依据以下格式进行代码生成：

1. 在 src/theme 目录下存放所有 theme 相关的 API 服务代码，
2. 在 src/svelte 目录下存放 HTML， CSS 相关的代码
3. 保证 theme modal 的样式风格和 @Site.svelte 保持一到。

下面是真实的后端 Theme 数据结构：

```json
{
	"uuid": "51f5d3d5-db0a-4c41-b766-9dccf703ca10",
	"status": "public",
	"namespace": "Theme",
	"id": 1,
	"slug": "book",
	"hash": "",
	"timestamp": 1753837129000,
	"updated": 1753842829205,
	"name": "Book",
	"author": "MDFriday",
	"version": "1.0",
	"screenshot": "/api/uploads/d66e65ad754f15723096c1156d043cbe/2025/07/tn.png",
	"download_url": "http://localhost:1314/api/uploads/themes/long-teng.zip",
	"demo_url": "http://mdfriday.com",
	"tags": [
		"Book",
		"Doc"
	]
}
```
