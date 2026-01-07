---
title: "SitePath Guide"
weight: 5
---

# SitePath Guide

SitePath (Site Path) determines your website's location in the URL. Correct SitePath configuration is crucial for proper website operation.

---

## What is SitePath?

SitePath is the website's **base URL path**.

Examples:
- SitePath `/` → Website at `https://example.com/`
- SitePath `/blog` → Website at `https://example.com/blog/`
- SitePath `/docs/v2` → Website at `https://example.com/docs/v2/`

---

## Why SitePath Matters

SitePath affects:

| Aspect | Impact |
|--------|--------|
| **Page links** | All internal links generated based on SitePath |
| **Resource paths** | CSS, JS, images load paths |
| **Navigation** | Menu, breadcrumb links |
| **SEO** | URL structure indexed by search engines |

{{% hint danger %}}
**Wrong SitePath = Broken Website**

If SitePath is misconfigured:
- Pages won't load
- Styles missing (shows as plain text)
- Links return 404 errors
{{% /hint %}}

---

## SitePath for Different Platforms

### MDFriday Share

When you activate License and use MDFriday Share, SitePath auto-sets to:

```
/s/{user-directory}/{preview-id}
```

Example: `/s/abc123/xyz789`

**No manual configuration needed**, Friday handles it automatically.

### Netlify

If your Netlify site is at root domain (e.g., `https://my-site.netlify.app/`):

```
/
```

If at subdirectory (e.g., `https://my-site.netlify.app/docs/`):

```
/docs
```

### FTP / Own Server

Depends on your server configuration:

| Scenario | SitePath |
|----------|----------|
| Root directory deployment | `/` |
| Subdirectory deployment (e.g., /blog) | `/blog` |
| Subdomain | `/` |

---

## Configuring SitePath

### Location

In right panel → Expand "Advanced Settings" → **Site Path**

### Format Requirements

- ✅ Must start with `/`
- ✅ Cannot end with `/` (except root path)
- ✅ Only letters, numbers, `-`, `_`

**Correct examples:**
```
/
/blog
/docs/v2
/my-site
```

**Incorrect examples:**
```
blog          ← Missing leading /
/blog/        ← Cannot end with /
/我的博客     ← Cannot contain Chinese
```

---

## Common Scenarios

### Scenario 1: Quick Share

When using Quick Share, SitePath auto-sets to MDFriday Share format.

**What you do**: Nothing, handled automatically.

### Scenario 2: Netlify Root Domain

Publishing to Netlify, accessing via root domain.

**Configuration:**
```
Site Path: /
```

### Scenario 3: Netlify Subdirectory

Deploying under Netlify site subdirectory, e.g., `my-site.netlify.app/docs/`.

**Configuration:**
```
Site Path: /docs
```

### Scenario 4: FTP Subdirectory

Uploading to FTP server's `/var/www/html/blog/` directory, website at `example.com/blog/`.

**Configuration:**
```
Site Path: /blog
```

---

## Troubleshooting

### Symptom: Page is plain text without styles

**Cause**: SitePath doesn't match actual deployment path, CSS fails to load.

**Solution:**
1. Confirm actual access URL
2. Adjust SitePath to match
3. Regenerate preview and publish

### Symptom: Clicking links shows 404

**Cause**: Internal links use wrong paths.

**Solution:**
1. Check SitePath configuration
2. Ensure it matches deployment location
3. Rebuild

### Symptom: Images not showing

**Cause**: Image paths calculated incorrectly.

**Solution:**
1. Verify SitePath configuration
2. Check if images are in site assets folder
3. Rebuild

---

## Advanced: Understanding Path Generation

Assuming SitePath is `/blog`, links in the website generate like this:

| Type | Generated URL |
|------|---------------|
| Homepage | `/blog/` |
| Article page | `/blog/posts/my-article/` |
| CSS file | `/blog/css/style.css` |
| Image | `/blog/images/photo.jpg` |

This is why SitePath must match actual deployment path—all resources depend on it.

---

## Common Issues

### Q: Not sure what to fill?

- **Using MDFriday Share**: Don't fill, auto-handled
- **Using Netlify root domain**: Fill `/`
- **Using FTP**: Fill the URL path matching your upload directory

### Q: Can I change SitePath of published site?

Yes, but requires rebuild and republish. Previously shared links will break.

### Q: Can MDFriday Share path be customized?

Currently no. MDFriday Share uses fixed format `/s/{user-directory}/{ID}` to ensure user content isolation.

---

## Next Step

After understanding SitePath, choose the right publishing method:

{{< button relref="publish-options" >}}Publishing Options{{< /button >}}

