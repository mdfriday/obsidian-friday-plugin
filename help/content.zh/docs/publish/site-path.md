---
title: "SitePath 指南"
weight: 5
---

# SitePath 指南

SitePath（站点路径）决定了你的网站在 URL 中的位置。正确配置 SitePath 对网站正常运行至关重要。

---

## 什么是 SitePath？

SitePath 是网站的 **基础 URL 路径**。

示例：
- SitePath `/` → 网站在 `https://example.com/`
- SitePath `/blog` → 网站在 `https://example.com/blog/`
- SitePath `/docs/v2` → 网站在 `https://example.com/docs/v2/`

---

## 为什么 SitePath 很重要

SitePath 影响：

| 方面 | 影响 |
|------|------|
| **页面链接** | 所有内部链接根据 SitePath 生成 |
| **资源路径** | CSS、JS、图片加载路径 |
| **导航** | 菜单、面包屑链接 |
| **SEO** | 搜索引擎索引的 URL 结构 |

{{% hint danger %}}
**SitePath 错误 = 网站崩溃**

如果 SitePath 配置错误：
- 页面无法加载
- 样式丢失（显示为纯文本）
- 链接返回 404 错误
{{% /hint %}}

---

## 不同平台的 SitePath

### MDFriday Share

当你激活 License 并使用 MDFriday Share 时，SitePath 会自动设置为：

```
/s/{用户目录}/{预览ID}
```

示例：`/s/abc123/xyz789`

**无需手动配置**，Friday 会自动处理。

### Netlify

如果你的 Netlify 站点在根域名（如 `https://my-site.netlify.app/`）：

```
/
```

如果在子目录（如 `https://my-site.netlify.app/docs/`）：

```
/docs
```

### FTP / 自己的服务器

取决于你的服务器配置：

| 场景 | SitePath |
|------|----------|
| 根目录部署 | `/` |
| 子目录部署（如 /blog） | `/blog` |
| 子域名 | `/` |

---

## 配置 SitePath

### 位置

在右侧面板 → 展开「高级设置」→ **Site Path**

### 格式要求

- ✅ 必须以 `/` 开头
- ✅ 不能以 `/` 结尾（根路径除外）
- ✅ 只能包含字母、数字、`-`、`_`

**正确示例：**
```
/
/blog
/docs/v2
/my-site
```

**错误示例：**
```
blog          ← 缺少开头的 /
/blog/        ← 不能以 / 结尾
/我的博客     ← 不能包含中文
```

---

## 常见场景

### 场景 1：快速分享

使用快速分享时，SitePath 自动设置为 MDFriday Share 格式。

**你要做的**：什么都不用做，自动处理。

### 场景 2：Netlify 根域名

发布到 Netlify，通过根域名访问。

**配置：**
```
Site Path: /
```

### 场景 3：Netlify 子目录

部署到 Netlify 站点的子目录下，如 `my-site.netlify.app/docs/`。

**配置：**
```
Site Path: /docs
```

### 场景 4：FTP 子目录

上传到 FTP 服务器的 `/var/www/html/blog/` 目录，网站在 `example.com/blog/`。

**配置：**
```
Site Path: /blog
```

---

## 问题排查

### 症状：页面是纯文本，没有样式

**原因**：SitePath 与实际部署路径不匹配，CSS 加载失败。

**解决方案：**
1. 确认实际访问 URL
2. 调整 SitePath 使其匹配
3. 重新生成预览并发布

### 症状：点击链接显示 404

**原因**：内部链接使用了错误的路径。

**解决方案：**
1. 检查 SitePath 配置
2. 确保与部署位置匹配
3. 重新构建

### 症状：图片不显示

**原因**：图片路径计算错误。

**解决方案：**
1. 验证 SitePath 配置
2. 检查图片是否在站点资源文件夹中
3. 重新构建

---

## 进阶：理解路径生成

假设 SitePath 是 `/blog`，网站中的链接会这样生成：

| 类型 | 生成的 URL |
|------|-----------|
| 首页 | `/blog/` |
| 文章页面 | `/blog/posts/my-article/` |
| CSS 文件 | `/blog/css/style.css` |
| 图片 | `/blog/images/photo.jpg` |

这就是为什么 SitePath 必须与实际部署路径匹配——所有资源都依赖它。

---

## 常见问题

### Q：不确定填什么？

- **使用 MDFriday Share**：不用填，自动处理
- **使用 Netlify 根域名**：填 `/`
- **使用 FTP**：填与你上传目录对应的 URL 路径

### Q：能更改已发布站点的 SitePath 吗？

可以，但需要重新构建并发布。之前分享的链接会失效。

### Q：MDFriday Share 的路径能自定义吗？

目前不能。MDFriday Share 使用固定格式 `/s/{用户目录}/{ID}` 来确保用户内容隔离。

---

## 下一步

了解 SitePath 后，选择合适的发布方式：

{{< button relref="publish-options" >}}发布选项{{< /button >}}

