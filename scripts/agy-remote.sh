#!/bin/bash
# agy-remote.sh: VAIOから手元PC（LAVIE）の Antigravity CLI へ安全に中継実行するラッパー

TARGET="192.168.100.2"
if ! ping -c 1 -W 1 192.168.100.2 >/dev/null 2>&1; then
  TARGET="192.168.1.27"
fi

quoted_args=()
for arg in "$@"; do
  quoted_args+=( "$(printf "%q" "$arg")" )
done

exec ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 taro@${TARGET} \
  "systemd-run --user --pipe --wait -q --collect /home/taro/.local/bin/agy ${quoted_args[*]}"
