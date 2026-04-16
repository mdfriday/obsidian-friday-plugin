#!/bin/bash

# MDFriday Docker 一键安装脚本
# 适用于云服务器环境

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 打印函数
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}$1${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
}

# 检查命令是否存在
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 下载所需文件（如果不存在）
download_required_files() {
    local base_url="https://raw.githubusercontent.com/mdfriday/obsidian-friday-plugin/main/docker"
    local files_needed=("docker-compose.yml" "docker-compose.aliyun.yml")
    local files_downloaded=false
    
    for file in "${files_needed[@]}"; do
        if [ ! -f "$file" ]; then
            print_info "下载 $file..."
            if curl -fsSL "$base_url/$file" -o "$file"; then
                print_success "$file 下载成功"
                files_downloaded=true
            else
                print_error "$file 下载失败"
                exit 1
            fi
        fi
    done
    
    if [ "$files_downloaded" = true ]; then
        echo ""
    fi
}

# 检查 Docker 环境
check_docker_environment() {
    print_header "检查 Docker 环境"
    
    # 检查 Docker
    if ! command_exists docker; then
        print_error "Docker 未安装！"
        echo ""
        echo "请先安装 Docker，然后重新运行此脚本。"
        echo ""
        echo "=== 快速安装 Docker ==="
        echo ""
        echo "Ubuntu/Debian/CentOS:"
        echo "  curl -fsSL https://get.docker.com | sh"
        echo "  sudo systemctl start docker"
        echo "  sudo systemctl enable docker"
        echo ""
        echo "macOS (使用 Colima):"
        echo "  brew install colima docker"
        echo "  colima start"
        echo ""
        echo "其他系统请访问: https://docs.docker.com/engine/install/"
        echo ""
        print_info "安装完成后，请重新运行此安装脚本"
        exit 1
    fi
    
    print_success "Docker 已安装: $(docker --version)"
    
    # 检查 Docker 是否运行
    if ! docker info >/dev/null 2>&1; then
        print_error "Docker 未运行！"
        echo ""
        echo "请启动 Docker 服务，然后重新运行此脚本："
        echo ""
        echo "Linux:"
        echo "  sudo systemctl start docker"
        echo ""
        echo "macOS (Colima):"
        echo "  colima start"
        echo ""
        exit 1
    fi
    
    print_success "Docker 服务运行正常"
    
    # 检查 Docker Compose
    if ! docker compose version >/dev/null 2>&1; then
        print_error "Docker Compose 未安装或版本过旧！"
        echo ""
        echo "Docker Compose V2 是 Docker 的一部分，通常随 Docker 一起安装。"
        echo "如果您看到此错误，请更新 Docker 到最新版本："
        echo ""
        echo "  https://docs.docker.com/compose/install/"
        echo ""
        exit 1
    fi
    
    print_success "Docker Compose 已安装: $(docker compose version)"
    echo ""
}

# 读取用户输入（带默认值）
read_input() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"
    local is_password="$4"
    
    if [ -n "$default" ]; then
        prompt="$prompt [默认: $default]"
    fi
    
    # 从 /dev/tty 读取以支持 curl | bash 方式执行
    if [ "$is_password" = "true" ]; then
        read -s -p "$prompt: " input </dev/tty
        echo ""
    else
        read -p "$prompt: " input </dev/tty
    fi
    
    if [ -z "$input" ] && [ -n "$default" ]; then
        input="$default"
    fi
    
    eval "$var_name='$input'"
}

# 验证域名格式
validate_domain() {
    local domain="$1"
    if [[ ! "$domain" =~ ^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$ ]]; then
        return 1
    fi
    return 0
}

# 验证 IP 地址格式
validate_ip() {
    local ip="$1"
    if [[ ! "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
        return 1
    fi
    
    # 检查每个数字是否在 0-255 范围内
    IFS='.' read -ra ADDR <<< "$ip"
    for i in "${ADDR[@]}"; do
        if [ "$i" -gt 255 ]; then
            return 1
        fi
    done
    return 0
}

# 验证端口号
validate_port() {
    local port="$1"
    if [[ ! "$port" =~ ^[0-9]+$ ]] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
        return 1
    fi
    return 0
}

# 验证邮箱格式
validate_email() {
    local email="$1"
    if [[ ! "$email" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
        return 1
    fi
    return 0
}

# 收集配置信息
collect_configuration() {
    print_header "配置 MDFriday"
    
    echo "请输入以下配置信息（必填项需要提供，可选项可以直接回车使用默认值）"
    echo ""
    
    # DOMAIN（必填）
    while true; do
        read_input "请输入您的域名（如 mdfriday.com）" "" DOMAIN
        if [ -z "$DOMAIN" ]; then
            print_error "域名不能为空！"
            continue
        fi
        if ! validate_domain "$DOMAIN"; then
            print_error "域名格式不正确！"
            continue
        fi
        break
    done
    
    # SERVER_IP（必填）
    while true; do
        read_input "请输入云服务器的公网 IP 地址" "" SERVER_IP
        if [ -z "$SERVER_IP" ]; then
            print_error "服务器 IP 不能为空！"
            continue
        fi
        if ! validate_ip "$SERVER_IP"; then
            print_error "IP 地址格式不正确！"
            continue
        fi
        break
    done
    
    echo ""
    
    # HTTP_PORT
    while true; do
        read_input "HTTP 端口" "80" HTTP_PORT
        if ! validate_port "$HTTP_PORT"; then
            print_error "端口号必须是 1-65535 之间的数字！"
            continue
        fi
        break
    done
    
    # HTTPS_PORT
    while true; do
        read_input "HTTPS 端口" "443" HTTPS_PORT
        if ! validate_port "$HTTPS_PORT"; then
            print_error "端口号必须是 1-65535 之间的数字！"
            continue
        fi
        break
    done
    
    echo ""
    print_info "配置 MDFriday 管理员账户"
    
    # ADMIN_EMAIL（必填）
    while true; do
        read_input "管理员邮箱" "" ADMIN_EMAIL
        if [ -z "$ADMIN_EMAIL" ]; then
            print_error "管理员邮箱不能为空！"
            continue
        fi
        if ! validate_email "$ADMIN_EMAIL"; then
            print_error "邮箱格式不正确！"
            continue
        fi
        break
    done
    
    # ADMIN_PASSWORD（必填）
    while true; do
        read_input "管理员密码（至少 8 位）" "" ADMIN_PASSWORD "true"
        if [ -z "$ADMIN_PASSWORD" ]; then
            print_error "管理员密码不能为空！"
            continue
        fi
        if [ ${#ADMIN_PASSWORD} -lt 8 ]; then
            print_error "密码长度至少为 8 位！"
            continue
        fi
        break
    done
    
    echo ""
    print_info "配置 CouchDB 数据库"
    
    # COUCHDB_USER（必填）
    while true; do
        read_input "CouchDB 管理员用户名" "admin" COUCHDB_USER
        if [ -z "$COUCHDB_USER" ]; then
            print_error "CouchDB 用户名不能为空！"
            continue
        fi
        break
    done
    
    # COUCHDB_PASSWORD（必填）
    while true; do
        read_input "CouchDB 管理员密码（至少 8 位）" "" COUCHDB_PASSWORD "true"
        if [ -z "$COUCHDB_PASSWORD" ]; then
            print_error "CouchDB 密码不能为空！"
            continue
        fi
        if [ ${#COUCHDB_PASSWORD} -lt 8 ]; then
            print_error "密码长度至少为 8 位！"
            continue
        fi
        break
    done
    
    # Caddy 配置（使用默认值，不需要用户输入）
    CADDY_HOST="caddy"
    CADDY_PORT="2019"
    
    echo ""
    print_info "配置 DNS 服务（用于 HTTPS 证书自动签发）"
    echo "如果您使用 DNSPod 作为 DNS 服务商，可以配置自动证书签发"
    echo "如果暂时不配置，可以直接回车跳过，后续可在 .env.local 中添加"
    echo ""
    
    # DNSPOD_ENABLED
    read_input "是否启用 DNSPod？(y/n)" "n" DNSPOD_ENABLED_INPUT
    if [[ "$DNSPOD_ENABLED_INPUT" =~ ^[Yy]$ ]]; then
        DNSPOD_ENABLED="true"
        
        read_input "DNSPod Secret ID" "" DNSPOD_ID
        read_input "DNSPod Secret Key" "" DNSPOD_SECRET "true"
        echo ""
    else
        DNSPOD_ENABLED="false"
        DNSPOD_ID=""
        DNSPOD_SECRET=""
    fi
    
    echo ""
    print_info "选择 Docker 镜像源"
    echo ""
    
    # 尝试检测服务器地理位置（基于 IP）
    local recommended="1"
    local location_hint=""
    
    # 简单检测：检查是否能快速访问阿里云
    if timeout 2 curl -s http://registry.cn-hangzhou.aliyuncs.com > /dev/null 2>&1; then
        recommended="2"
        location_hint=" (检测到您可能在中国，推荐使用阿里云)"
    fi
    
    echo "Docker 镜像下载源选择："
    echo "  1) Docker Hub (国际) - 适合海外服务器"
    echo "  2) 阿里云镜像源 (中国) - 国内服务器推荐，下载速度更快${location_hint}"
    echo ""
    
    # REGISTRY_CHOICE
    while true; do
        read_input "请选择镜像源 [1-2]" "$recommended" REGISTRY_CHOICE
        if [[ "$REGISTRY_CHOICE" == "1" ]]; then
            USE_ALIYUN="false"
            print_success "已选择: Docker Hub (国际镜像源)"
            break
        elif [[ "$REGISTRY_CHOICE" == "2" ]]; then
            USE_ALIYUN="true"
            print_success "已选择: 阿里云镜像源 (registry.cn-hangzhou.aliyuncs.com)"
            break
        else
            print_error "无效选择，请输入 1 或 2"
        fi
    done
    
    echo ""
    print_success "配置信息收集完成！"
}

# 生成 .env.local 文件
generate_env_file() {
    print_header "生成配置文件"
    
    local env_file=".env.local"
    
    print_info "正在生成 $env_file..."
    
    cat > "$env_file" <<EOF
# ============================================
# MDFriday Docker Configuration
# Generated by install.sh on $(date)
# ============================================

# MDFriday Configuration
DOMAIN=$DOMAIN
SERVER_IP=$SERVER_IP
HTTP_PORT=$HTTP_PORT
HTTPS_PORT=$HTTPS_PORT

# MDFriday Admin
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD=$ADMIN_PASSWORD

# CouchDB Admin
COUCHDB_USER=$COUCHDB_USER
COUCHDB_PASSWORD=$COUCHDB_PASSWORD

# Caddy（Docker 容器网络地址）
CADDY_HOST=$CADDY_HOST
CADDY_PORT=$CADDY_PORT

# DNSPod
DNSPOD_ENABLED=$DNSPOD_ENABLED
DNSPOD_ID=$DNSPOD_ID
DNSPOD_SECRET=$DNSPOD_SECRET
EOF

    print_success "配置文件已生成: $env_file"
    echo ""
}

# 显示配置摘要
show_configuration_summary() {
    print_header "配置摘要"
    
    echo "域名:           $DOMAIN"
    echo "服务器 IP:      $SERVER_IP"
    echo "HTTP 端口:      $HTTP_PORT"
    echo "HTTPS 端口:     $HTTPS_PORT"
    echo "管理员邮箱:     $ADMIN_EMAIL"
    echo "CouchDB 用户:   $COUCHDB_USER"
    echo "DNSPod 启用:    $DNSPOD_ENABLED"
    if [ "$USE_ALIYUN" = "true" ]; then
        echo "镜像源:         阿里云镜像源 (registry.cn-hangzhou.aliyuncs.com)"
    else
        echo "镜像源:         Docker Hub"
    fi
    echo ""
}

# 拉取 Docker 镜像
pull_docker_images() {
    print_header "拉取 Docker 镜像"
    
    # 构建 docker compose 命令
    local compose_cmd="docker compose -f docker-compose.yml"
    if [ "$USE_ALIYUN" = "true" ]; then
        compose_cmd="$compose_cmd -f docker-compose.aliyun.yml"
        print_info "使用阿里云镜像源拉取镜像..."
    else
        print_info "正在从 Docker Hub 拉取镜像..."
    fi
    
    if $compose_cmd --env-file .env.local pull; then
        print_success "Docker 镜像拉取完成"
    else
        print_error "Docker 镜像拉取失败！"
        echo ""
        if [ "$USE_ALIYUN" = "true" ]; then
            print_warning "提示: 如果阿里云镜像拉取失败，可以尝试使用 Docker Hub"
        else
            print_warning "提示: 如果 Docker Hub 拉取失败，国内服务器可以尝试使用阿里云镜像源"
        fi
        exit 1
    fi
    echo ""
}

# 启动服务
start_services() {
    print_header "启动服务"
    
    # 构建 docker compose 命令
    local compose_cmd="docker compose -f docker-compose.yml"
    if [ "$USE_ALIYUN" = "true" ]; then
        compose_cmd="$compose_cmd -f docker-compose.aliyun.yml"
    fi
    
    print_info "正在启动 MDFriday 服务..."
    if $compose_cmd --env-file .env.local up -d; then
        print_success "服务启动成功！"
    else
        print_error "服务启动失败！"
        echo ""
        echo "请检查日志："
        if [ "$USE_ALIYUN" = "true" ]; then
            echo "  docker compose -f docker-compose.yml -f docker-compose.aliyun.yml --env-file .env.local logs"
        else
            echo "  docker compose --env-file .env.local logs"
        fi
        exit 1
    fi
    echo ""
}

# 显示访问信息
show_access_info() {
    print_header "安装完成"
    
    print_success "MDFriday 已成功安装并启动！"
    echo ""
    echo "访问信息："
    echo "-----------------------------------"
    
    if [ "$DNSPOD_ENABLED" = "true" ]; then
        echo "🌐 应用地址:    https://app.${DOMAIN}"
        echo "🗄️  CouchDB:     https://cdb.${DOMAIN}/_utils"
    else
        echo "🌐 应用地址:    http://${DOMAIN}:${HTTP_PORT}"
        echo "🗄️  CouchDB:     http://cdb.${DOMAIN}:${HTTP_PORT}/_utils"
        echo ""
        echo "⚠️  注意: 您未启用 DNSPod，无法自动签发 HTTPS 证书"
        echo "   如需启用 HTTPS，请配置 DNS 服务并重新运行安装"
    fi
    
    echo ""
    echo "管理员账户："
    echo "-----------------------------------"
    echo "📧 邮箱:        $ADMIN_EMAIL"
    echo "🔑 密码:        (您设置的密码)"
    echo ""
    echo "常用命令："
    echo "-----------------------------------"
    
    # 根据镜像源显示正确的命令
    if [ "$USE_ALIYUN" = "true" ]; then
        local compose_files="-f docker-compose.yml -f docker-compose.aliyun.yml"
        echo "查看服务状态:   docker compose $compose_files --env-file .env.local ps"
        echo "查看日志:       docker compose $compose_files --env-file .env.local logs -f"
        echo "停止服务:       docker compose $compose_files --env-file .env.local down"
        echo "重启服务:       docker compose $compose_files --env-file .env.local restart"
    else
        echo "查看服务状态:   docker compose --env-file .env.local ps"
        echo "查看日志:       docker compose --env-file .env.local logs -f"
        echo "停止服务:       docker compose --env-file .env.local down"
        echo "重启服务:       docker compose --env-file .env.local restart"
    fi
    
    echo ""
    echo "配置文件位置:   $(pwd)/.env.local"
    echo ""
    
    if [ "$DNSPOD_ENABLED" != "true" ]; then
        print_warning "DNS 配置提示："
        echo "请确保将以下 DNS 记录添加到您的域名服务商："
        echo "  类型  主机记录  记录值"
        echo "  A     @         $SERVER_IP"
        echo "  A     *         $SERVER_IP"
        echo ""
    fi
    
    print_info "首次启动可能需要 1-2 分钟初始化，请耐心等待"
    echo "如遇问题，请查看日志或访问: https://github.com/mdfriday/obsidian-friday-plugin"
    echo ""
}

# 主函数
main() {
    clear
    print_header "MDFriday Docker 安装向导"
    
    echo "欢迎使用 MDFriday 一键安装脚本！"
    echo "本脚本将帮助您在云服务器上快速部署 MDFriday"
    echo ""
    echo "安装过程包括："
    echo "  1. 检查 Docker 环境"
    echo "  2. 收集配置信息"
    echo "  3. 生成配置文件"
    echo "  4. 拉取 Docker 镜像"
    echo "  5. 启动服务"
    echo ""
    
    read -p "按回车键开始安装..." </dev/tty
    
    # 下载所需文件
    download_required_files
    
    # 执行安装步骤
    check_docker_environment
    collect_configuration
    show_configuration_summary
    
    read -p "确认以上配置无误？按回车继续，Ctrl+C 取消..." </dev/tty
    
    generate_env_file
    pull_docker_images
    start_services
    show_access_info
}

# 运行主函数
main
