---
title: "Themes and Samples"
weight: 3
---

# Themes and Samples

Themes determine your website's appearance and functionality. Friday offers rich theme selection to present your content in the best way.

---

## Choosing a Theme

### Open Theme Selector

In the right panel's "Theme" area, click the **Change Theme** button.

### Theme Selector Interface

The theme selector contains:

| Area | Function |
|------|----------|
| **Search box** | Search by name, author, tags |
| **Tag filters** | Filter by type (Blog, Book, Page, etc.) |
| **Theme cards** | Show preview, name, description |
| **Live Demo** | Preview theme effect (shown on hover) |
| **Use** button | Select this theme |

### Theme Types

| Tag | Use Case | Example Themes |
|-----|----------|----------------|
| **Book** | Documentation, knowledge base, tutorials | Obsidian Book |
| **Blog** | Personal blog, articles | Hugo Blog |
| **Page** | Single page, resume, landing page | Note |
| **Gallery** | Image showcase, portfolio | Gallery |
| **Business** | Company website, product intro | Corporate |

---

## Auto Theme Selection

Friday recommends themes based on your content type:

| Content Type | Recommended Theme |
|--------------|-------------------|
| Folder (multiple files) | Book (for docs/blog) |
| Single Markdown file | Note (for single page) |

You can always change it manually.

---

## Downloading Samples

Some themes provide **sample content** to help you quickly understand features and best practices.

### How to Download

1. Select a theme
2. If the theme has samples, a **Download Sample** button appears
3. Click the button, sample content downloads to your vault

### Sample Location

Samples download to the `MDFriday` folder in your Obsidian vault:

```
Your Vault/
└── MDFriday/
    └── theme-name/     ← Sample content
        ├── content/
        ├── static/
        └── ...
```

### Using Samples

1. After downloading, right-click `MDFriday/theme-name` folder
2. Select **Publish to Web**
3. Friday auto-detects content structure
4. Generate preview to see the result

This is the best way to learn theme features!

---

## Theme Features

### Obsidian-Style Themes

Themes tagged `Obsidian` support full Obsidian rendering:

- ✅ Obsidian native styles
- ✅ Plugin rendering (like Dataview)
- ✅ Custom CSS snippets
- ✅ Theme styles

### Standard Themes

Themes without the `Obsidian` tag use lightweight rendering:

- ✅ Fast build
- ✅ Standard Markdown support
- ✅ Smaller size
- ⚠️ Some Obsidian-specific syntax may not be supported

---

## Theme Recommendations

### For Beginners

| Theme | Use Case |
|-------|----------|
| **Obsidian Book** | Knowledge base, docs, tutorials |
| **Note** | Quick share single notes |

### Advanced Options

| Theme | Features |
|-------|----------|
| **Hugo Blog** | Classic blog style |
| **Docsy** | Professional documentation site |
| **Gallery** | Image/work showcase |

---

## Theme Configuration

### Basic Configuration

Most themes are configured through:

1. **Site Name**: Displayed in website title
2. **Site Path**: Affects URL structure
3. **Advanced Settings**: Google Analytics, Disqus, etc.

### Theme-Specific Configuration

Some themes support additional configuration, usually through `config` files or frontmatter in content folders.

Download theme samples to see specific configuration methods.

---

## Common Issues

### Q: Theme doesn't look right after switching?

Different themes have different content structure requirements:
1. Ensure your content structure matches theme requirements
2. Reference theme samples for correct structure
3. Regenerate preview

### Q: Can't find a suitable theme?

1. Use search and tag filters
2. Check "Page" tag themes for single pages
3. Download samples to understand theme effects
4. Submit theme requests on GitHub

### Q: Sample download failed?

Check:
1. Network connection working?
2. Download server available?
3. Try switching download server (in settings)

### Q: How to customize themes?

Currently custom themes aren't supported, but you can:
1. Fine-tune styles with CSS snippets
2. Submit theme improvement suggestions on GitHub
3. Contribute your own themes (PRs welcome)

---

## Next Step

After choosing a theme, generate a preview to see the effect:

{{< button relref="local-preview" >}}Local Preview{{< /button >}}

