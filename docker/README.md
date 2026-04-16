# MDFriday Docker Deployment Guide

Deploy your own MDFriday instance using Docker. This guide covers everything from quick installation to advanced configuration.

## 🚀 Quick Start

### Step 1: Install Docker

**If Docker is already installed, skip to Step 2.**

#### Ubuntu/Debian/CentOS

```bash
# Install Docker using official script
curl -fsSL https://get.docker.com | sh

# Start and enable Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Verify installation
docker --version
docker compose version
```

#### macOS

Using Colima (lightweight Docker alternative):

```bash
# Install via Homebrew
brew install colima docker docker-compose

# Start Colima
colima start

# Verify installation
docker --version
docker compose version
```

#### Other Systems

Visit [Docker Installation Guide](https://docs.docker.com/engine/install/) for detailed instructions.

### Step 2: Run Installation Script

Once Docker is ready, run the one-command installer:

```bash
curl -fsSL https://raw.githubusercontent.com/mdfriday/obsidian-friday-plugin/main/docker/install.sh | bash
```

The interactive installer will:
1. ✅ Download required files (docker-compose.yml, docker-compose.aliyun.yml)
2. ✅ Verify Docker environment
3. 📝 Collect configuration information
4. 🌐 Detect location and recommend Docker registry (Docker Hub or Aliyun)
5. 🔧 Generate `.env.local` configuration file
6. 📦 Pull Docker images
7. 🎉 Start all services

### Prerequisites

Before running the installation script, ensure your server has:

- ✅ **Docker**: Version 20.10 or higher (see Step 1 above)
- ✅ **Docker Compose**: V2 (included with modern Docker installations)
- ✅ **Domain**: A registered domain name
- ✅ **Server**: Cloud server with public IP address
- ✅ **Ports**: 80 (HTTP) and 443 (HTTPS) open in firewall
- ✅ **Terminal Access**: SSH access to your server

**Note**: The installation script will check all requirements and guide you if anything is missing.

## 📋 Configuration Options

### Docker Registry Selection

The installer allows you to choose the Docker registry:

- **Docker Hub** (Default): Best for international servers
- **Aliyun Container Registry**: Recommended for servers in China (faster and more stable)

This selection is made during the interactive installation process.

### Required Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `DOMAIN` | Your primary domain name | `mdfriday.com` |
| `SERVER_IP` | Server's public IP address | `203.0.113.10` |
| `ADMIN_EMAIL` | Administrator email | `admin@mdfriday.com` |
| `ADMIN_PASSWORD` | Administrator password (min 8 chars) | `SecurePass123!` |
| `COUCHDB_USER` | CouchDB admin username | `admin` |
| `COUCHDB_PASSWORD` | CouchDB admin password (min 8 chars) | `DbSecure456!` |

### Optional Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `HTTP_PORT` | HTTP port | `80` |
| `HTTPS_PORT` | HTTPS port | `443` |
| `DNSPOD_ENABLED` | Enable DNSPod for automatic HTTPS | `false` |
| `DNSPOD_ID` | DNSPod Secret ID | - |
| `DNSPOD_SECRET` | DNSPod Secret Key | - |

### Internal Configuration (Auto-configured)

| Variable | Description | Default |
|----------|-------------|---------|
| `CADDY_HOST` | Caddy service hostname | `caddy` |
| `CADDY_PORT` | Caddy admin API port | `2019` |

## 🛠️ Manual Installation

If you prefer manual setup:

### Step 1: Download Files

```bash
# Create directory
mkdir mdfriday
cd mdfriday

# Download docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/mdfriday/obsidian-friday-plugin/main/docker/docker-compose.yml -o docker-compose.yml

# Download Aliyun override (optional, for China)
curl -fsSL https://raw.githubusercontent.com/mdfriday/obsidian-friday-plugin/main/docker/docker-compose.aliyun.yml -o docker-compose.aliyun.yml

# Download .env.example
curl -fsSL https://raw.githubusercontent.com/mdfriday/obsidian-friday-plugin/main/docker/.env.example -o .env.example
```

### Step 2: Create Configuration

```bash
# Copy example to .env.local
cp .env.example .env.local

# Edit configuration
nano .env.local
```

### Step 3: Deploy

**Using Docker Hub:**

```bash
# Pull images
docker compose --env-file .env.local pull

# Start services
docker compose --env-file .env.local up -d
```

**Using Aliyun Registry (recommended for China):**

```bash
# Pull images
docker compose -f docker-compose.yml -f docker-compose.aliyun.yml --env-file .env.local pull

# Start services
docker compose -f docker-compose.yml -f docker-compose.aliyun.yml --env-file .env.local up -d
```

## 🔧 Service Management

### View Service Status

```bash
docker compose --env-file .env.local ps
```

### View Logs

```bash
# All services
docker compose --env-file .env.local logs -f

# Specific service
docker compose --env-file .env.local logs -f hugoverse
docker compose --env-file .env.local logs -f couchdb
docker compose --env-file .env.local logs -f caddy
```

### Restart Services

```bash
# Restart all
docker compose --env-file .env.local restart

# Restart specific service
docker compose --env-file .env.local restart hugoverse
```

### Stop Services

```bash
docker compose --env-file .env.local down
```

### Update Services

```bash
# Pull latest images
docker compose --env-file .env.local pull

# Restart with new images
docker compose --env-file .env.local up -d
```

## 🌐 Docker Registry Options

### Why Registry Selection Matters

Docker image download speed varies significantly by region:
- **International servers**: Docker Hub is usually fast
- **China servers**: Aliyun Container Registry is significantly faster and more reliable

### Registry Options

The installation script provides intelligent registry selection:

| Registry | Best For | Auto-Detection | Image URL Example |
|----------|----------|----------------|-------------------|
| Docker Hub | International servers | Default | `mdfriday/hugoverse:latest` |
| Aliyun | China servers | ✅ Auto-recommended if in China | `registry.cn-hangzhou.aliyuncs.com/mdfriday/hugoverse:latest` |

**Smart Detection**: The installer tests connectivity to Aliyun registry and automatically recommends the best option based on your server's location.

### How It Works

The installation script automatically handles registry selection:
1. During installation, you'll be prompted to choose a registry
2. If you select Aliyun, the script uses `docker-compose.aliyun.yml` as an override
3. All services (CouchDB, Caddy, Hugoverse) will pull from the selected registry

### Manual Registry Switching

If you need to switch registries after installation:

**Switch to Aliyun:**

```bash
# Stop services
docker compose --env-file .env.local down

# Pull from Aliyun and restart
docker compose -f docker-compose.yml -f docker-compose.aliyun.yml --env-file .env.local pull
docker compose -f docker-compose.yml -f docker-compose.aliyun.yml --env-file .env.local up -d
```

**Switch to Docker Hub:**

```bash
# Stop services
docker compose -f docker-compose.yml -f docker-compose.aliyun.yml --env-file .env.local down

# Pull from Docker Hub and restart
docker compose --env-file .env.local pull
docker compose --env-file .env.local up -d
```

## 🌐 DNS Configuration

### Without DNSPod (Manual DNS)

Add these DNS records to your domain provider:

| Type | Host | Value |
|------|------|-------|
| A | @ | Your server IP |
| A | * | Your server IP |

**Note**: Without DNSPod, you'll need to manually configure SSL certificates or use HTTP only.

### With DNSPod (Automatic HTTPS)

1. Get DNSPod credentials:
   - Log in to [DNSPod Console](https://console.dnspod.cn/)
   - Navigate to API Keys
   - Create a new key (Secret ID and Secret Key)

2. Enable during installation:
   - Set `DNSPOD_ENABLED=true`
   - Provide `DNSPOD_ID` and `DNSPOD_SECRET`

3. Caddy will automatically:
   - Request Let's Encrypt certificates
   - Configure HTTPS
   - Handle certificate renewal

## 📁 Data Storage

All data is stored in `./data/` directory:

```
./data/
├── couchdb/          # CouchDB database files
│   ├── data/
│   └── local.d/
├── caddy/            # Caddy certificates and config
│   ├── data/
│   └── config/
├── hugoverse/        # Application data and published sites
└── backups/          # Database backups
```

### Backup

```bash
# Backup entire data directory
tar -czf mdfriday-backup-$(date +%Y%m%d).tar.gz data/

# Backup only database
tar -czf couchdb-backup-$(date +%Y%m%d).tar.gz data/couchdb/
```

### Restore

```bash
# Stop services
docker compose --env-file .env.local down

# Restore data
tar -xzf mdfriday-backup-YYYYMMDD.tar.gz

# Start services
docker compose --env-file .env.local up -d
```

## 🔍 Troubleshooting

### Check Service Health

```bash
# View service health status
docker compose --env-file .env.local ps

# Check specific service
docker inspect hugoverse-app --format='{{.State.Health.Status}}'
```

### Common Issues

#### Port Already in Use

If ports 80 or 443 are already in use:

```bash
# Check what's using the port
sudo lsof -i :80
sudo lsof -i :443

# Stop conflicting service
sudo systemctl stop nginx  # or apache2
```

Or change ports in `.env.local`:

```bash
HTTP_PORT=8080
HTTPS_PORT=8443
```

#### CouchDB Connection Failed

```bash
# Check CouchDB logs
docker compose --env-file .env.local logs couchdb

# Verify CouchDB is running
curl http://localhost:5984/_up
```

#### Caddy Certificate Issues

```bash
# Check Caddy logs
docker compose --env-file .env.local logs caddy

# Verify DNS records
dig +short yourdomain.com
dig +short app.yourdomain.com

# Test Caddy config
docker compose --env-file .env.local exec caddy caddy validate --config /etc/caddy/Caddyfile
```

#### Slow Image Downloads

If Docker image downloads are very slow:

**For China servers:**
- Run the installer again and choose option `2` (Aliyun Registry)
- Or manually switch to Aliyun (see Registry Options section above)

**For international servers:**
- Ensure Docker Hub is accessible
- Check your network connection
- Try using a different network or VPN

### Service URLs

After deployment, access services at:

- **Application**: `https://app.yourdomain.com` (or `http://yourdomain.com:80` without HTTPS)
- **CouchDB Admin**: `https://cdb.yourdomain.com/_utils` (or `http://cdb.yourdomain.com:80/_utils`)
- **Caddy Admin API**: `http://localhost:2019` (internal only)

## 🔒 Security Recommendations

1. **Use Strong Passwords**: Both admin and CouchDB passwords should be complex
2. **Enable HTTPS**: Use DNSPod or another DNS provider for automatic certificates
3. **Firewall**: Only expose ports 80, 443, and 22 (SSH)
4. **Regular Updates**: Pull and deploy new images regularly
5. **Backup**: Schedule regular backups of the `./data/` directory

## 📚 Advanced Configuration

### Using Colima (macOS)

If you're using Colima instead of Docker Desktop:

```bash
# Start Colima
colima start

# Verify Docker is running
docker ps

# Proceed with installation
./install.sh
```

### Custom Data Directories

Edit `.env.local` to customize data locations:

```bash
COUCHDB_HOST_DATA_DIR=/custom/path/couchdb
CADDY_HOST_DATA_DIR=/custom/path/caddy
HUGOVERSE_HOST_DATA_DIR=/custom/path/hugoverse
BACKUPS_HOST_DIR=/custom/path/backups
```

### Environment Variables

All environment variables supported by the application can be added to `.env.local`. See `docker-compose.yml` for the complete list.

## 🆘 Getting Help

- **Documentation**: [https://help.mdfriday.com](https://help.mdfriday.com)
- **Community**: [Discord](https://discord.gg/t7FHJ6qNzT)
- **Issues**: [GitHub Issues](https://github.com/mdfriday/obsidian-friday-plugin/issues)

## 📜 License

MDFriday is open source software. See the main repository for license details.
