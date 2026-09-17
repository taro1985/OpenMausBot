#!/bin/bash
export PATH=$PATH:/home/taro/.nvm/versions/node/v22.23.2/bin
echo "=== 本番ビルドを実行中 ==="
npx --yes pnpm build && npx --yes pnpm build:server
echo "=== ビルド完了 ==="
