# Friday

Turn MD docs to website, in minutes.

Transform your Markdown documents into professional, multilingual websites. 
With 500+(we are working hard to adapt them) free themes and powerful shortcodes to enhance your pages, it's as easy as taking notes.

## Demo

![basic functionality](https://raw.githubusercontent.com/mdfriday/obsidian-friday-plugin/main/demo/demo-preview.gif)

### Youtube Demo

[![YouTube Demo](https://img.youtube.com/vi/LiU-FeT7n28/0.jpg)](https://youtu.be/LiU-FeT7n28?si=6QZZXeIdxMdLl-IP)

## More Resources

- **[Official Website](https://mdfriday.com)**
- **[Help Docs](https://help.mdfriday.com)**
- **[Theme Gallery](https://gallery.mdfriday.com)**

## Getting Support

We're here to help! Here's how to reach us:

- **Submit an Issue**: If you encounter any issues, feel free to open an issue on our [GitHub Repository](https://github.com/mdfriday/obsidian-friday-plugin/issues).
- **Email Support**: You can also contact us via email at [support@mdfriday.com](mailto:support@mdfriday.com). Please note that while we strive to respond promptly, replies may not be immediate.

### One-on-One Support

- **WeChat**: wayde191
- **X (Twitter)**: [@szm_tech](https://x.com/szm_tech)

## Buy Me a Coffee ☕

If you like Friday and want to support its development, you can donate here:  
[![Buy Me a Coffee](https://www.paypal.com/en_US/i/btn/btn_donate_LG.gif)](https://paypal.me/mdfriday?country.x=C2&locale.x=zh_XC)

## Features

- **Launch in Minutes**: Convert your Markdown documents into fully functional websites within minutes, no technical setup required.
- **Full Ownership**: Own your domain, hosting, and site files entirely. No vendor lock-in, and you can export your site anytime.
- **No-Trace Mode**: Privacy-focused, ensuring all intermediate build files are removed for a completely private workflow.
- **No Technical Knowledge Needed**: No need to learn HTML, CSS, or JavaScript—just write in Markdown, and we handle the rest.
- **Export as Image**: Convert your notes to beautiful images for easy sharing on social media or in presentations.

## How to Use

1. **Install the Obsidian Plugin**
	- Go to Obsidian's plugin store, search for **Friday** with author **MDFriday**, and download the plugin.
	- Enable **Friday** from Obsidian's settings.

2. **Register Your Account**
	- Open the **Friday** settings page in Obsidian.
	- Register for an account by providing the required information. This is necessary to access additional features and deploy your site.

3. **Create a Friday Note**
	- With MDFriday enabled, create a new note and provide a name and description for your site.
	- Your note will automatically be recognized as a potential website page.

4. **Customize and Preview**
	- Select a theme from the available options and configure settings in the frontmatter to suit your needs.
	- Click **Preview** to see how your site will look with the selected theme and configurations.

5. **Deploy**
	- When you're ready to publish, you can deploy your site with a single click.
	- Your site will be live within minutes, with options to further manage and update it.

## Export as Image Feature

The Export as Image feature allows you to convert your Obsidian notes into beautiful images for sharing.

### Using Local Images

When using local images in your notes that you want to export as an image, follow these guidelines:

1. **Preferred Image Path Formats**:
   - Wiki links: `![[image.png]]` (recommended)
   - Relative paths: `![alt text](images/image.png)`
   - Vault absolute paths: `![alt text](/path/from/vault/root/image.png)`

2. **For Plugin Shortcodes**:
   If you're using shortcodes that reference images (like `characterImage="avatar.png"`), ensure the image is:
   - In the same directory as your note
   - Or use a full path from the vault root (e.g., `characterImage="/Images/avatar.png"`)

3. **Background Images in CSS Styles**:
   When using background images in custom CSS or HTML elements:
   - Use relative paths: `style="background-image: url(images/background.png)"`
   - Or vault absolute paths: `style="background-image: url(/path/from/vault/root/background.png)"`
   - The plugin will automatically convert Obsidian's internal `app://` URLs to proper data URLs in the export

4. **Troubleshooting**:
   - If images don't appear in the exported image, check the console for warnings
   - Look for red-bordered images (for `<img>` elements) or orange-bordered elements (for background images) in the export preview
   - Verify that the image exists in your vault at the specified path
   - For stubborn images, try using the filename directly in the same folder as your note

### Export Options

- **Resolution**: Choose from 1x to 4x for different quality levels
- **Format**: Export as PNG or JPG
- **Width**: Customize the width of your exported image
- **Padding**: Add consistent padding around your content
- **File Name**: Option to include or exclude the note's filename at the top of the image

## What's Next

Friday is under active development, and we're constantly working on new features, bug fixes, and theme optimizations. 
Keep an eye out for updates!

## Troubleshooting

### Using Developer Console to Debug Image Export Issues

If you're experiencing issues with images not appearing in your exported note, you can use Obsidian's Developer Console to diagnose the problem:

1. **Open Developer Console**:
   - Windows/Linux: Press `Ctrl+Shift+I`
   - Mac: Press `Cmd+Option+I`
   - Or use the menu: `Help > Toggle Developer Tools`

2. **View Warnings and Errors**:
   - In the Console tab, look for entries that begin with "Unresolved images:"
   - These will list all images that the plugin couldn't find in your vault

3. **Check Image Paths**:
   - For background images in CSS, ensure the path is correctly formatted 
   - For app:// URLs, the plugin will attempt to locate the file by name in your vault

4. **Resolving Common Issues**:
   - Move images to the same folder as your note for easier reference
   - Use wiki links (`![[image.png]]`) for the most reliable image embedding
   - Ensure image filenames don't contain special characters
   - For background images in CSS, try using absolute vault paths (starting with /)

### Visual Indicators in Preview

When previewing your export, the plugin provides visual cues for problematic images:

- **Red-bordered elements**: Regular `<img>` elements that couldn't be resolved
- **Orange-bordered elements**: Background images in CSS that couldn't be resolved
- **Hover tooltips**: Hover over these elements to see the specific path that caused the issue

## Feedback & Contribution

Your feedback helps us improve. 
If you have suggestions, requests, or want to contribute, feel free to join us by contributing code, suggesting features, or sharing your experience in our repository.
