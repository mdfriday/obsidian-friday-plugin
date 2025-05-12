# 实现 Shortcode 实时预览

当用户在 Obsidian 里，用如下 block 代码形式，输入 Shortcode 时，用户可以把笔记切换到预览模式进行查看。

```shortcode
{{< Storytelling-TextCover-001
logo="不黑学长"
avatar="/images/avatar.png"
mainTitle="让完播率>50% (3/3)"
subtitle="6种文案公式"
description="爆款拆解/爆款要素/文案结构"
newTagText="全新整理"
footerContent="运营技巧,爆款选题,文案写作,数据复盘"
/>}}
```

## 业务模型

- Shortcode 类，提供所有 Shortcode 的服务。如注册、解析等
- Shortcode API, 提供所有 Shortcode 的 API。如获取 Shortcode 分布列表、获取 Shortcode tags 列表等
- Shortcode UI, 提供 Shortcode 的 UI。如 Shortcode 列表、Shortcode 搜索等

## 解决方案

1. 当用户将笔记切换到预览模式时，Obsidian 会触发 markdown 渲染，并在渲染后会进入 post process 模式。我们在这个时候重新渲染 shortcode block
2. 将 shortcode block 里的所有内容，以字符的形式传递给 Shortcode 类实例的 render 方法，进行渲染
3. 将得到的 HTML 结果，替换现有的 block 内容

## 代码结构

Shortcode 相关的代码都放在 src/shortcode 目录下

Obsidian 事件注册则在 src/main.ts

## 任务拆分

- 注册 Obsidian 事件
- 扫描 Shortcode block
- 通过 Shortcode 实例解析当前 block 所包含的 shortcode names
- 查询是否注册了这些 Shortcodes
- 如果没有，则通过 API 从后端获取，解析，并注册
- 进行渲染
- 将渲染结果替换当前 block

## 通用任务

- 所有的注解都用英语

## 限制

- 不要修改现有代码结构
- 每次生成代码前，都先将解决方案及新生成的代码展示出来，经我确认，我确认后，再正式生成，并合并到代码库里

