---
title: "Local Preview"
weight: 4
---

# Local Preview

Before publishing, the preview feature lets you ensure the website looks as expected.

---

## Why Preview?

- ✅ **Check layout**: Ensure content displays correctly
- ✅ **Verify links**: Ensure internal links work
- ✅ **View styling**: Confirm theme effects meet expectations
- ✅ **Test features**: Check navigation, search, etc.

---

## Generating Preview

### Steps

1. Complete content and theme configuration in the right panel
2. Click **Generate Preview** button
3. Wait for build to complete (progress bar shown)
4. On success, browser auto-opens preview page

### Build Process

The build process includes:

| Stage | Description |
|-------|-------------|
| 1. Prepare environment | Create temp directory, configure theme |
| 2. Process content | Convert Markdown, process images |
| 3. Build site | Generate HTML pages |
| 4. Start server | Launch local preview server |

---

## Preview Link

After build completes, you'll see the preview link:

```
Preview Link
http://localhost:8090/
```

Click the link to view in browser.

{{% hint info %}}
**About port**  
Default uses port 8090. If occupied, system auto-selects another port.
{{% /hint %}}

---

## Live Reload

Friday supports **Live Reload**:

1. Keep preview page open
2. Modify your note content
3. After saving, preview page auto-refreshes

See your changes in real-time!

---

## Regenerating Preview

If you:
- Modified content
- Changed theme
- Adjusted configuration

Click **Regenerate Preview** button to update.

---

## Exporting Site

After satisfactory preview, you can export the website as a ZIP file:

1. Click **Export Site** button
2. Choose save location
3. Get a ZIP containing complete website files

The exported ZIP can be:
- Uploaded to any static hosting service
- Deployed to your own server
- Saved as backup

---

## Preview Directory Structure

Preview files are saved in the plugin directory:

```
.obsidian/plugins/friday/preview/
└── {preview-id}/
    ├── config.json      # Site configuration
    ├── content/         # Content files
    └── public/          # Generated website files
```

{{% hint warning %}}
**Note**  
Preview files are temporary and may be cleaned up. Use export to preserve them.
{{% /hint %}}

---

## Common Issues

### Q: Preview build failed?

Check:
1. Is content selected correctly?
2. Is a theme selected?
3. Read the error message

Common causes:
- Markdown syntax errors
- Incorrect image paths
- Theme download failed

### Q: Preview page won't open?

Possible reasons:
1. **Port occupied**: Check actual port in logs
2. **Firewall blocking**: Allow Obsidian network access
3. **Server crashed**: Regenerate preview

### Q: Preview differs from published result?

Preview and publish use the same build process, results should be identical. If different:
1. Check SitePath configuration
2. Confirm using latest preview
3. Clear browser cache and check

### Q: How to clean preview files?

Preview files use disk space. To clean:
1. Open Project Management (click left sidebar Friday icon)
2. Find the project
3. Click "Clear History"

Or manually delete `.obsidian/plugins/friday/preview/` directory.

### Q: Can I preview multiple sites simultaneously?

Yes. Each preview uses a different port, so you can:
1. Preview Site A
2. Without closing, preview Site B
3. Both previews accessible at the same time

---

## Next Steps

After satisfactory preview, understand SitePath configuration, then publish:

{{% columns %}}

### Understand SitePath

Learn about website path configuration

{{< button relref="site-path" >}}SitePath Guide{{< /button >}}

===

### Publish Website

Publish your site to the internet

{{< button relref="publish-options" >}}Publishing Options{{< /button >}}

{{% /columns %}}

