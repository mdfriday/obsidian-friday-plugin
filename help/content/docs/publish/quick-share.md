---
title: "Quick Share"
weight: 1
---

# Quick Share

Quick Share is Friday's simplest publishing method—just one click, and your note is accessible online.

---

## What is Quick Share?

Quick Share lets you:
- 🚀 **One-click publish** a single Markdown note
- 🔗 **Get a link** to share with anyone
- ⚡ **Instant availability** completes in seconds

---

## Prerequisites

- ✅ Friday License activated
- ✅ Currently viewing a Markdown file

---

## How to Use

### Step 1: Open a Note

Open the Markdown note you want to share in Obsidian.

### Step 2: Click the Globe Icon

In the top right of the note, you'll see a **🌐 globe icon**. Click it.

{{% hint info %}}
**Can't find the globe icon?**  
Ensure you're viewing a Markdown file (.md) and Friday plugin is enabled.
{{% /hint %}}

### Step 3: Wait for Build

After clicking, Friday will automatically:

1. Open the right panel
2. Set SitePath for sharing mode
3. Build your note into a webpage
4. Prepare for MDFriday Share publishing

You'll see progress indicators.

### Step 4: Publish and Share

After build completes:

1. Browser auto-opens the preview page
2. Publish option auto-selects "MDFriday Share"
3. Click the **Publish** button
4. Copy the generated link and share

---

## Link Format

Quick Share links are formatted as:

```
https://mdfriday.com/s/{user-directory}/{preview-id}/
```

Example:
```
https://mdfriday.com/s/abc123/xyz789/
```

---

## Important Notes

### Content Visibility

- Quick Share content is **publicly accessible**
- Anyone with the link can view it
- Don't share sensitive or private information

### Link Duration

- Links are active immediately after publishing
- Currently no auto-expiration
- Contact support to delete if needed

### Images and Attachments

- Images in notes are auto-processed and uploaded
- Supports Obsidian's internal link format
- Large files may take longer to build

---

## Quick Share vs Full Publish

| Feature | Quick Share | Full Publish |
|---------|-------------|--------------|
| Content Scope | Single note | Entire folder |
| Steps | 1 step | Multiple configuration steps |
| Theme Selection | Auto (Note theme) | Customizable |
| SitePath | Auto-generated | Customizable |
| Use Case | Temporary sharing | Long-term website |

---

## Common Issues

### Q: Clicking globe icon does nothing?

Check:
1. Is License activated?
2. Is current file a .md file?
3. Are you on desktop Obsidian? (Mobile doesn't support full publish yet)

### Q: Build failed?

Possible reasons:
1. Unsupported special syntax in note
2. Network connection issues
3. Image too large or unsupported format

Solutions:
- Check error message
- Check network connection
- Simplify note content and retry

### Q: How to update shared content?

1. Modify your note
2. Click globe icon again
3. Re-publish

New content replaces old (using same link).

### Q: Can I share with specific people only?

Currently Quick Share links are public. For restricted access:
- Use full publish with password protection
- Private link feature (planned)

---

## Next Step

Want more control? Learn the full publishing features:

{{< button relref="/docs/publish/right-panel" >}}Right Panel Guide{{< /button >}}

