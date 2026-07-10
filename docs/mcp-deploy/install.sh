#!/usr/bin/env bash
# ============================================================
# AI Chat 知识库 MCP Server 一键安装脚本
#
# 用法：
#   1. cd 到本目录 (docs/mcp-deploy)
#   2. cp .env.example .env
#   3. 编辑 .env 填入 DASHSCOPE_API_KEY / 向量库配置 / 域名
#   4. sudo ./install.sh
#
# 脚本幂等，可重复运行：每次会基于当前 .env 重新生成配置并重启服务。
# 已存在的用户/目录/venv 会被复用，不会破坏数据。
# ============================================================
set -euo pipefail

# ---- 常量 ----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/mcp"
RUN_USER="mcp"
RUN_GROUP="mcp"
VENV_DIR="${INSTALL_DIR}/venv"
SERVICE_NAME="mcp-server"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
NGINX_CONF_PATH="/etc/nginx/conf.d/mcp.conf"

# ---- 颜色 ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERR]${NC} $*" >&2; }

# ---- 前置检查 ----
[[ $EUID -eq 0 ]] || { err "请用 root 运行：sudo ./install.sh"; exit 1; }

for cmd in python3 nginx openssl systemctl; do
    command -v "$cmd" >/dev/null 2>&1 || { err "缺少依赖：$cmd，请先安装"; exit 1; }
done

ENV_FILE="${SCRIPT_DIR}/.env"
[[ -f "$ENV_FILE" ]] || {
    err "找不到 .env，请先执行：cp .env.example .env 并填写"
    exit 1
}

# ---- 解析 .env（systemd EnvironmentFile 格式：KEY=VALUE，忽略注释和空行）----
get_env() {
    local key="$1"
    # 只取第一个匹配，去掉前后引号
    grep -E "^${key}=" "$ENV_FILE" | head -n1 | sed -E "s/^${key}=//; s/^\"//; s/\"$//; s/^'//; s/'$//"
}

DASHSCOPE_API_KEY=$(get_env DASHSCOPE_API_KEY)
VSTORE_TYPE=$(get_env VECTOR_STORE_TYPE)
VSTORE_URL=$(get_env VECTOR_STORE_URL)
VSTORE_COLLECTION=$(get_env VECTOR_STORE_COLLECTION)
MCP_TRANSPORT=$(get_env MCP_TRANSPORT)
MCP_HOST=$(get_env MCP_HOST)
MCP_PORT=$(get_env MCP_PORT)
MCP_DOMAIN=$(get_env MCP_DOMAIN)
MCP_TOKEN=$(get_env MCP_TOKEN)

# ---- 校验必填 ----
missing=()
[[ -z "$DASHSCOPE_API_KEY" || "$DASHSCOPE_API_KEY" == "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" ]] && missing+=("DASHSCOPE_API_KEY")
[[ -z "$VSTORE_TYPE" ]] && missing+=("VECTOR_STORE_TYPE")
[[ -z "$VSTORE_URL" ]] && missing+=("VECTOR_STORE_URL")
[[ -z "$VSTORE_COLLECTION" ]] && missing+=("VECTOR_STORE_COLLECTION")
[[ -z "$MCP_DOMAIN" ]] && missing+=("MCP_DOMAIN")

if [[ ${#missing[@]} -gt 0 ]]; then
    err "以下 .env 项未填写或仍是占位符：${missing[*]}"
    err "请编辑 ${ENV_FILE} 后重试"
    exit 1
fi

# sse 模式才需要 nginx；stdio 模式只装 server
USE_NGINX=true
[[ "$MCP_TRANSPORT" == "stdio" ]] && USE_NGINX=false

if [[ "$USE_NGINX" == true && -z "$MCP_PORT" ]]; then
    MCP_PORT=8765
fi

# ---- 生成 token（若 .env 里留空）----
if [[ "$USE_NGINX" == true && -z "$MCP_TOKEN" ]]; then
    MCP_TOKEN="$(openssl rand -hex 32)"
    # 写回 .env，方便用户查
    if grep -q "^MCP_TOKEN=" "$ENV_FILE"; then
        sed -i "s|^MCP_TOKEN=.*|MCP_TOKEN=${MCP_TOKEN}|" "$ENV_FILE"
    else
        echo "MCP_TOKEN=${MCP_TOKEN}" >> "$ENV_FILE"
    fi
    ok "已生成随机 MCP_TOKEN 并写回 .env"
fi

log "配置摘要："
echo "  部署目录      : ${INSTALL_DIR}"
echo "  运行用户      : ${RUN_USER}"
echo "  向量库类型    : ${VSTORE_TYPE}"
echo "  向量库地址    : ${VSTORE_URL}"
echo "  集合/表名     : ${VSTORE_COLLECTION}"
echo "  传输模式      : ${MCP_TRANSPORT}"
if [[ "$USE_NGINX" == true ]]; then
    echo "  监听          : ${MCP_HOST}:${MCP_PORT} (本地)"
    echo "  对外域名      : https://${MCP_DOMAIN}/mcp"
    echo "  访问 Token    : ${MCP_TOKEN:0:8}...(已隐藏，完整值见 .env)"
fi
echo ""

# ============================================================
# 步骤 1：创建运行用户
# ============================================================
log "步骤 1/6：创建运行用户 ${RUN_USER}"
if id "$RUN_USER" &>/dev/null; then
    ok "用户 ${RUN_USER} 已存在，跳过"
else
    useradd --system --no-create-home --shell /usr/sbin/nologin "$RUN_USER"
    ok "已创建系统用户 ${RUN_USER}（无 home、无登录 shell）"
fi

# ============================================================
# 步骤 2：部署代码与 venv
# ============================================================
log "步骤 2/6：部署代码到 ${INSTALL_DIR}"
mkdir -p "$INSTALL_DIR"
cp -f "${SCRIPT_DIR}/mcp_vector_server.py" "${INSTALL_DIR}/"
cp -f "${SCRIPT_DIR}/requirements.txt" "${INSTALL_DIR}/"

# venv（幂等：已存在则复用，每次重新装依赖以升级）
if [[ ! -d "$VENV_DIR" ]]; then
    log "创建 venv..."
    python3 -m venv "$VENV_DIR"
fi
log "安装 Python 依赖（mcp[cli]）..."
"$VENV_DIR/bin/pip" install --upgrade pip >/dev/null
"$VENV_DIR/bin/pip" install -r "${INSTALL_DIR}/requirements.txt" 2>&1 | grep -E "Successfully|already satisfied" || true
ok "依赖就绪"

PYTHON_BIN="${VENV_DIR}/bin/python"

# ============================================================
# 步骤 3：写入 .env 到部署目录并设权限
# ============================================================
log "步骤 3/6：写入环境变量到 ${INSTALL_DIR}/.env"
cp -f "$ENV_FILE" "${INSTALL_DIR}/.env"
chown "${RUN_USER}:${RUN_GROUP}" "${INSTALL_DIR}/.env"
chmod 600 "${INSTALL_DIR}/.env"
ok "已写入，权限 600 属主 ${RUN_USER}"

# 部署目录整体属主
chown -R "${RUN_USER}:${RUN_GROUP}" "$INSTALL_DIR"

# ============================================================
# 步骤 4：安装 systemd service
# ============================================================
log "步骤 4/6：安装 systemd service"
ENV_FILE_DEPLOY="${INSTALL_DIR}/.env"
sed -e "s|__INSTALL_DIR__|${INSTALL_DIR}|g" \
    -e "s|__PYTHON_BIN__|${PYTHON_BIN}|g" \
    -e "s|__ENV_FILE__|${ENV_FILE_DEPLOY}|g" \
    -e "s|__RUN_USER__|${RUN_USER}|g" \
    -e "s|__RUN_GROUP__|${RUN_GROUP}|g" \
    "${SCRIPT_DIR}/mcp-server.service" > "$SERVICE_PATH"
ok "已写入 ${SERVICE_PATH}"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1
systemctl restart "$SERVICE_NAME"
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "${SERVICE_NAME} 已启动"
else
    err "${SERVICE_NAME} 启动失败，查看日志：journalctl -u ${SERVICE_NAME} -n 50"
    exit 1
fi

# stdio 模式到此结束
if [[ "$USE_NGINX" == false ]]; then
    echo ""
    ok "安装完成（stdio 模式，无 nginx）"
    echo "  由智能体以 stdio 方式拉起，配置示例见 docs/mcp-setup.md"
    exit 0
fi

# ============================================================
# 步骤 5：安装 nginx 配置
# ============================================================
log "步骤 5/6：安装 nginx 配置"

CERT_PATH="/etc/letsencrypt/live/${MCP_DOMAIN}/fullchain.pem"
KEY_PATH="/etc/letsencrypt/live/${MCP_DOMAIN}/privkey.pem"
CERT_EXISTS=false
[[ -f "$CERT_PATH" && -f "$KEY_PATH" ]] && CERT_EXISTS=true

# 生成 nginx 配置（带 HTTPS）
sed -e "s|__MCP_DOMAIN__|${MCP_DOMAIN}|g" \
    -e "s|__MCP_TOKEN__|${MCP_TOKEN}|g" \
    -e "s|__MCP_PORT__|${MCP_PORT}|g" \
    "${SCRIPT_DIR}/nginx.conf" > "$NGINX_CONF_PATH"
ok "已写入 ${NGINX_CONF_PATH}"

# 证书检测
if [[ "$CERT_EXISTS" == false ]]; then
    warn "未找到 ${MCP_DOMAIN} 的 HTTPS 证书"
    warn "证书路径不存在：${CERT_PATH}"
    echo ""
    echo "请按以下步骤申请证书（Let's Encrypt 免费）："
    echo "  1) 确认 ${MCP_DOMAIN} 已 DNS 解析到本机公网 IP"
    echo "  2) 确认安全组/防火墙已放行 TCP 80 和 443"
    echo "  3) 安装 certbot："
    echo "       apt install -y certbot python3-certbot-nginx   # Debian/Ubuntu"
    echo "       yum install -y certbot python3-certbot-nginx   # RHEL/CentOS"
    echo "  4) 申请证书（certbot 会自动改 nginx 配置加 HTTPS）："
    echo "       certbot --nginx -d ${MCP_DOMAIN}"
    echo "  5) 证书申请成功后，重新生成 nginx 配置（覆盖 certbot 的，保留我们的 token 鉴权 + SSE 优化）："
    echo "       sudo ${SCRIPT_DIR}/install.sh"
    echo ""
    warn "证书就绪前，nginx 暂不 reload，MCP server 已在本地 ${MCP_HOST}:${MCP_PORT} 运行"
    warn "可先本地验证：curl http://${MCP_HOST}:${MCP_PORT}/"
    echo ""
    ok "MCP server 安装完成（待配 HTTPS 证书后对外可用）"
    exit 0
fi

# 证书存在，测试并 reload nginx
if nginx -t 2>&1 | grep -q "successful"; then
    systemctl reload nginx
    ok "nginx 配置测试通过并已 reload"
else
    err "nginx 配置测试失败："
    nginx -t
    err "请检查后手动执行：systemctl reload nginx"
    exit 1
fi

# ============================================================
# 步骤 6：验证
# ============================================================
log "步骤 6/6：验证"
echo ""
echo "──────────────────────────────────────────────────────────"
ok "MCP Server 安装完成"
echo "──────────────────────────────────────────────────────────"
echo ""
echo "【服务状态】"
echo "  systemctl status ${SERVICE_NAME}"
echo "  journalctl -u ${SERVICE_NAME} -f      # 实时日志"
echo ""
echo "【本地验证（不带 token，应被 nginx 拒绝）】"
echo "  curl -i https://${MCP_DOMAIN}/mcp"
echo ""
echo "【本地验证（带 token，应返回 MCP 响应）】"
echo "  curl -i 'https://${MCP_DOMAIN}/mcp?token=${MCP_TOKEN}'"
echo ""
echo "【智能体 / 演示页接入配置】"
echo "  {"
echo "    \"mcpServers\": {"
echo "      \"ai-chat-knowledge\": {"
echo "        \"url\": \"https://${MCP_DOMAIN}/mcp?token=${MCP_TOKEN}\""
echo "      }"
echo "    }"
echo "  }"
echo ""
echo "【常用运维命令】"
echo "  改配置：vim ${INSTALL_DIR}/.env && systemctl restart ${SERVICE_NAME}"
echo "  改 nginx：vim ${NGINX_CONF_PATH} && nginx -t && systemctl reload nginx"
echo "  查 token：grep MCP_TOKEN ${ENV_FILE}"
echo ""
echo "──────────────────────────────────────────────────────────"
