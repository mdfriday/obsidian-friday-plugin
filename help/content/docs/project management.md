---
title: "Project Management"
weight: 4
---

# Project Management

When creating multiple websites or maintaining one long-term, project management helps you efficiently manage all configurations.

---

## What is a Project?

In Friday, a **project** is a collection of website configurations:

| Configuration | Description |
|---------------|-------------|
| Content Path | Source folder/file for website content |
| Site Name | Website title |
| Theme | Selected theme |
| SitePath | Website path configuration |
| Publish Config | Netlify/FTP account info |
| Advanced Settings | GA, Disqus, password, etc. |

Every time you build a preview, these configurations auto-save as a project.

---

## Friday Button

In Obsidian's left sidebar, you'll see a **🎲 dice icon**—this is the Friday button.

### Clicking the Friday Button

Opens the **Project Management** panel, showing:

- List of all saved projects
- Basic info for each project
- Action buttons

---

## Project List

The project list shows each project's:

| Info | Description |
|------|-------------|
| **Project Name** | Your set site name |
| **Content Path** | Content source |
| **Theme** | Selected theme name |
| **Updated** | Last build time |

---

## Project Actions

### Apply to Panel

Clicking a project card or "Apply" button loads all its configurations to the right panel:

- ✅ Auto-sets content path
- ✅ Auto-sets site name
- ✅ Auto-sets theme
- ✅ Auto-sets publish configuration
- ✅ Auto-sets advanced options

This lets you **restore** previous configurations with one click, no reconfiguration needed.

### Export History Build

If a project has build history, you can export previous build results:

1. Click "Export" button
2. Choose save location
3. Get a ZIP containing website files

### Clear History

If project preview files use too much space:

1. Click "Clear History" button
2. Confirm clearing
3. All preview files for that project are deleted

{{% hint warning %}}
**Note**  
After clearing history, previous preview files cannot be recovered. Export first if needed.
{{% /hint %}}

---

## Benefits of Project Management

### 1. Quick Project Switching

If you maintain multiple websites:

- Blog
- Documentation site
- Portfolio
- Company website

Each has different configurations. Project management lets you switch with one click, no need to remember each site's settings.

### 2. Configurations Don't Get Lost

All configurations auto-save:

- Theme selection
- Publish accounts
- Advanced settings

Even after closing Obsidian, configurations remain.

### 3. History Tracking

View each project's:

- Build history
- Publish records
- Change times

---

## Project Storage

Project data is saved in the plugin directory:

```
.obsidian/plugins/friday/projects-data.json
```

Preview files are saved in:

```
.obsidian/plugins/friday/preview/{preview-id}/
```

---

## Common Issues

### Q: Are projects auto-saved?

Yes. Every time you generate a preview, current configuration auto-saves as a project (or updates existing project).

### Q: How to delete a project?

Currently direct deletion isn't supported. You can:
1. Clear the project's history (frees space)
2. Ignore unneeded projects

### Q: Too many projects?

Project list sorts by update time, most recently used first. Frequently used projects naturally appear at top.

### Q: Can I manually edit project configurations?

Not recommended. Project configurations auto-update with each build. To modify:
1. Apply project to panel
2. Modify configuration
3. Regenerate preview

### Q: Can projects sync to other devices?

Currently project data is local, not synced via Friday. If needed:
1. Manually backup `projects-data.json` file
2. Or configure separately on each device

---

## Workflow Suggestions

### Single Project Users

If you maintain only one website:

1. Use normally, project auto-saves
2. Next publish, configuration is already there
3. No need to think about project management

### Multi-Project Users

If you maintain multiple websites:

1. Use different content folders for each website
2. Build each website once, configuration auto-saves
3. When switching, click Friday button
4. Select project, one-click apply configuration
5. Modify and rebuild/publish

---

## Next Step

You've now mastered all Friday core features!

Have questions? Check the FAQ:

{{< button relref="/docs/faq" >}}FAQ{{< /button >}}

