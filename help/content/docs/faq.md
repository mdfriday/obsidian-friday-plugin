---
title: "FAQ"
weight: 5
---

# Frequently Asked Questions

Collection of most common questions and solutions.

---

## Installation & Activation

### Q: Can't find Friday settings after installation?

**Solution**:
1. Confirm plugin is installed: Settings → Community plugins → Installed plugins
2. Confirm plugin is enabled: Toggle is on
3. Restart Obsidian

### Q: License activation failed?

**Checklist**:
- [ ] License Key format correct (`MDF-XXXX-XXXX-XXXX`)
- [ ] No extra spaces
- [ ] Network connection working
- [ ] License not expired
- [ ] Device limit not exceeded

### Q: How to check License status?

Open Settings → Friday, License area shows:
- License Key (masked)
- Valid until
- Plan type
- Storage usage

---

## Sync Issues

### Q: Sync not working?

**Troubleshooting**:
1. Confirm License is activated
2. Check network connection
3. Check status bar sync icon
4. Try manual sync: Command palette → "Sync: Pull from Server"

### Q: Lost encryption password?

{{% hint danger %}}
**This is serious**

If password is truly lost and cannot be recovered:
1. Local data on current device is unaffected
2. Cloud encrypted data is irrecoverable
3. Need to re-upload local data (will overwrite cloud)
{{% /hint %}}

**Prevention**:
- Save in password manager
- Make paper backup
- Send to your own email

### Q: Two devices have sync conflicts?

Friday attempts auto-merge. If auto-merge fails:
1. Both versions are kept
2. Manually choose which to keep
3. Recommend avoiding simultaneous edits on same file

### Q: Sync is slow?

Possible reasons:
- First sync transfers all data
- Network speed limitations
- Many images or attachments

Suggestions:
- Sync with stable network
- Large files take longer
- Be patient with first sync

---

## Publishing Issues

### Q: Preview build failed?

**Common causes and solutions**:

| Problem | Solution |
|---------|----------|
| No content selected | Right-click folder/file → Publish to Web |
| Theme download failed | Check network, try different download server |
| Markdown syntax errors | Check note content, fix errors |
| Image path errors | Ensure images in vault, use relative paths |

### Q: Preview page won't open?

**Check**:
1. Look at actual port in preview link
2. Confirm firewall allows port
3. Try regenerating preview

### Q: Netlify publish failed?

**Checklist**:
- [ ] Access Token correct
- [ ] Project ID correct
- [ ] Token has sufficient permissions
- [ ] Netlify account OK

### Q: FTP upload failed?

**Troubleshooting**:
1. Use "Test Connection" to verify
2. Check username/password
3. Check remote directory permissions
4. Try checking "Ignore Certificate"

### Q: Styles missing after publish?

**Cause**: SitePath misconfigured

**Solution**:
1. Confirm SitePath matches actual deployment path
2. Regenerate preview and publish
3. Clear browser cache

---

## Theme Issues

### Q: Themes not loading?

**Solution**:
1. Check network connection
2. Try different download server: Settings → Friday → Download Server
3. Wait a few seconds and retry

### Q: Theme doesn't look right after switching?

Different themes have different content structure requirements:
1. Download theme sample to learn correct structure
2. Adjust content to fit theme
3. Some themes only suit specific content types

### Q: How to get more themes?

1. Browse in theme selector
2. Use tag filters
3. Follow Friday updates for new themes

---

## Performance Issues

### Q: Obsidian became slow?

**Possible causes**:
1. Preview files using too much space
2. Syncing many files

**Solutions**:
1. Clean unneeded preview history
2. Check sync file count
3. Restart Obsidian

### Q: Preview files using too much space?

**Cleaning methods**:
1. Click Friday button to open Project Management
2. Select project → Clear History
3. Or manually delete `.obsidian/plugins/friday/preview/` directory

---

## Mobile Issues

### Q: Does mobile support publishing?

Currently mobile only supports:
- ✅ License activation
- ✅ Sync functionality

Not yet supported:
- ❌ Preview generation
- ❌ Website publishing

Due to mobile platform limitations. Future versions may add support.

### Q: Does mobile sync work?

Yes! Mobile sync works identically to desktop:
- Auto sync
- End-to-end encryption
- Real-time updates

---

## Other Questions

### Q: How to contact support?

- GitHub Issues: [Submit issue](https://github.com/mdfriday/obsidian-friday-plugin/issues)
- Email: support@mdfriday.com

### Q: How to contribute code?

PRs welcome!
1. Fork the project
2. Create branch
3. Submit code
4. Open Pull Request

### Q: Is there a community group?

Follow MDFriday official channels for latest info.

### Q: How to get updates?

- Obsidian auto-prompts for plugin updates
- Follow GitHub Releases for changelogs
- Important updates announced via official channels

---

## Still Have Questions?

If the above doesn't solve your problem:

1. **Search GitHub Issues**: Someone may have had similar issues
2. **Submit new Issue**: Describe your problem clearly
3. **Contact support**: Get one-on-one help

{{% hint info %}}
**When submitting issues, please provide**:
- Obsidian version
- Friday plugin version
- Operating system
- Detailed problem description
- Error screenshots (if any)
{{% /hint %}}

