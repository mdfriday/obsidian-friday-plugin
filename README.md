# Friday

## Friday is your digital asset creation assistant

Write in Obsidian. Sync across devices. Publish instantly. Share with the world. Own everything.

---

## ✨ Demos

**Live Sync across devices**:

![Live Sync Demo](demo/livesync-demo.gif)

**Instant Publishing**:

![Instant Publishing Demo](demo/cus-publish.gif)

---

## 🎨 Beautiful Themes, Ready to Use

Choose a professional design.
Download sample notes.
Start publishing in minutes.

- 📚 Documentation / Knowledge Base: [Quartz](https://help.mdfriday.com) | [Book](https://mdfriday.com/mdf/themes/book/) | [Note](https://mdfriday.com/mdf/themes/notes/)
- 📰 Blog: [Beautiful](https://mdfriday.com/mdf/themes/beautiful/) | [Awesome](https://mdfriday.com/mdf/themes/awesome/)
- 📄 Resume & Portfolio: [Resume](https://mdfriday.com/mdf/themes/resume/) | [Portfolio](https://sunwei.xyz/)
- 🚀 Landing & Company: [Landing](https://mdfriday.com/mdf/themes/landing/) | [Company](https://mdfriday.com/mdf/themes/company/)
- 🎤 Slides: [Slides](https://mdfriday.com/mdf/themes/slides/)

More themes available inside the plugin.

---

## 📚 Learn More

- Documentation: 👉 [https://help.mdfriday.com/index.html](https://help.mdfriday.com/index.html)
- Website: 👉 [https://mdfriday.com](https://mdfriday.com)
- Community: 👉 [https://discord.gg/t7FHJ6qNzT](https://discord.gg/t7FHJ6qNzT)

---

## 🐳 Self-Hosting with Docker

Deploy your own MDFriday instance on any cloud server.

### Prerequisites

Before running the installation script, ensure you have:

1. **Docker installed and running**
   
   If Docker is not installed, install it first:
   
   ```bash
   # Ubuntu/Debian/CentOS - Quick install
   curl -fsSL https://get.docker.com | sh
   sudo systemctl start docker
   sudo systemctl enable docker
   ```
   
   For other systems, visit [Docker Installation Guide](https://docs.docker.com/engine/install/)

2. **A domain name** pointed to your server

3. **Open firewall ports** - 80 (HTTP) and 443 (HTTPS)

### One-Command Installation

Once Docker is ready, deploy MDFriday with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/mdfriday/obsidian-friday-plugin/main/docker/install.sh | bash
```

The interactive installer will:
- ✅ Download required configuration files automatically
- ✅ Verify Docker environment
- 📝 Collect configuration (domain, admin account, etc.)
- 🌐 Let you choose Docker registry (auto-detects best option for your location)
- 📦 Pull images and start services

**For servers in China**: The installer will detect your location and recommend Aliyun Registry for faster downloads.

### Manual Installation

If you prefer to review the script before running:

```bash
# Download the installation script
curl -fsSL https://raw.githubusercontent.com/mdfriday/obsidian-friday-plugin/main/docker/install.sh -o install.sh

# Review the script
cat install.sh

# Make it executable and run
chmod +x install.sh
./install.sh
```

### What Gets Installed

- 🗄️ **CouchDB** - for data synchronization across devices
- 🌐 **Caddy** - reverse proxy with automatic HTTPS certificates
- 🚀 **Hugoverse** - the MDFriday application server

All services run in Docker containers with automatic health checks, log rotation, and easy management.

For detailed configuration options and troubleshooting, see [`docker/README.md`](docker/README.md).

---

## 🚀 Start Building Today

Your notes are seeds.
Friday helps them grow into assets.

Just write.
Friday brings it to life.

---

## 🙏 Acknowledgements

Friday is inspired by:

- [Hugo](https://github.com/gohugoio/hugo) – static site philosophy
- [LiveSync](https://github.com/vrtmrz/obsidian-livesync) – multi-device synchronization
- [Quartz](https://github.com/jackyzha0/quartz)  – digital garden publishing ideas
