---
title: "Right Panel"
weight: 2
---

# Right Panel

The right panel is Friday's main operation area, giving you full control over website building and publishing.

---

## Opening the Panel

Two ways to open the right panel:

### Method 1: Context Menu

1. In the file list, right-click on a **folder** or **Markdown file**
2. Select **Publish to Web**

### Method 2: Command Palette

1. Press `Ctrl/Cmd + P` to open command palette
2. Search for "Friday" or "Publish"
3. Select the appropriate command

---

## Panel Areas Explained

The right panel contains these sections from top to bottom:

### 1️⃣ Multilingual Content

This area manages your website content sources.

| Element | Description |
|---------|-------------|
| **Content Path** | Shows your selected folder or file name |
| **Language Selection** | Set language for each content (Chinese, English, etc.) |
| **Default** tag | Indicates primary language version |
| **Clear** button | Removes all selected content |
| **×** button | Removes single language version (shown with multiple languages) |

**Multilingual Support:**

Friday supports multilingual websites. If you have content in multiple languages:

1. First add the main language content folder
2. Right-click other language folders and select "Publish to Web" to add them
3. Set the correct language for each content

### 2️⃣ Site Name

Enter your website title, displayed in the site header.

```
Site Name: [My Blog          ]
```

### 3️⃣ Site Assets

Manage static resources (images, CSS, JS, etc.).

- Shows currently set assets folder
- Click "Clear Assets" to remove

**Setting Site Assets:**

1. Right-click a folder in the file list
2. Select **Set as Site Assets**
3. Files in that folder will be copied to `/static` directory

### 4️⃣ Advanced Settings

Click to expand more configuration options:

| Setting | Description | Example |
|---------|-------------|---------|
| **Site Path (SitePath)** | URL path for the website | `/`, `/blog`, `/s/xxx/yyy` |
| **Site Password** | Set access password | Leave empty for public |
| **Google Analytics ID** | Traffic analytics | `G-XXXXXXXXXX` |
| **Disqus Shortname** | Comment system | `your-site-name` |


### 5️⃣ Theme Selection

Choose your website's visual style.

- **Current theme name**: Shows selected theme
- **Change Theme** button: Opens theme selector
- **Download Sample** button: Downloads theme sample content (if available)


### 6️⃣ Preview

Preview website before publishing.

- **Generate Preview** / **Regenerate Preview** button
- Progress bar shows build progress
- Preview link (shown after build)
- **Export Site** button (download as ZIP)


### 7️⃣ Publish

Publish website to the internet.

- **Publish Method** dropdown: Select publishing platform
- Platform configuration area (varies by selection)
- **Publish** button


---

## Typical Workflows

### Publishing a Folder

1. Right-click content folder → **Publish to Web**
2. Enter site name
3. (Optional) Set site assets folder
4. Select theme
5. Click **Generate Preview** → Check result
6. Select publish method → Click **Publish**

### Publishing a Single File

1. Right-click Markdown file → **Publish to Web**
2. Enter site name
3. Select theme suitable for single page (like Note)
4. Generate preview → Publish

### Creating Multilingual Website

1. Prepare multilingual content folders (e.g., `content`, `content.zh`)
2. Right-click main folder → **Publish to Web**
3. Right-click other language folders → **Publish to Web** (adds as new language)
4. Set correct language for each content
5. Generate preview → Publish

---

## Smart Folder Detection

Friday auto-detects Hugo-style folder structures:

```
my-site/
├── content/      → Auto-detected as English content
├── content.zh/   → Auto-detected as Chinese content
└── static/       → Auto-detected as site assets
```

When you right-click the parent folder of such a structure, Friday auto-configures all content and assets.

---

## Common Issues

### Q: Content not showing correctly?

Check:
1. Selected the correct folder/file?
2. Language settings correct?
3. Theme suitable for your content type?

### Q: How to clear current configuration?

Click the **Clear** button in the "Multilingual Content" area to remove all selected content.

### Q: Why can't I see certain settings?

Some advanced settings need to be expanded. Click the ▶ icon next to "Advanced Settings" to expand.

---

## Next Steps

{{% columns %}}

### Choose Theme

Learn how to select and use themes

{{< button relref="theme-and-sample" >}}Themes and Samples{{< /button >}}

===

### Preview Website

Preview before publishing

{{< button relref="local-preview" >}}Local Preview{{< /button >}}

{{% /columns %}}

