#!/bin/bash
# 人生目标具象画 - 本地服务器启动器
# 双击此文件即可启动；保持终端窗口开着，然后浏览器打开 http://localhost:8000
cd "$(dirname "$0")"
echo "=========================================="
echo "  人生目标具象画 已启动"
echo "  电脑访问: http://localhost:8000"
echo "  手机访问: http://$(ipconfig getifaddr en0 2>/dev/null || echo '（查看下方 IP）'):8000"
echo "  按 Ctrl+C 停止服务器"
echo "=========================================="
python3 -m http.server 8000 --bind 0.0.0.0
