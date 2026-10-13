## Introduction

**MDFriday** is a digital asset creation assistant. Write in Obsidian, sync across devices, and publish instantly to the web.

## Features

- **Instant Publishing**: Write Markdown in Obsidian and publish as a professional website with one click.
- **Multi-Device Sync**: Real-time cross-device sync via CouchDB.
- **Rich Themes**: 500+ beautiful themes for docs, blogs, resumes, portfolios, slides, and more.

## Setup Notes

### Quick Start (IP Access)

Fill in your server IP. 1Panel auto-assigns a port. Access after installation:

```
http://your-server-ip:port
```

Requests go directly to Hugoverse, bypassing Caddy.

### Bind Domain (Optional)

If you have a domain, fill in domain and HTTPS port:
1. Create a website in 1Panel, reverse proxy to `http://127.0.0.1:HTTP-port`
2. Apply for SSL certificate and enable HTTPS

### Enable DNSPod (Optional)

For automatic DNS certificate management via Caddy, set `DNSPOD_ENABLED=true` and fill in credentials.
