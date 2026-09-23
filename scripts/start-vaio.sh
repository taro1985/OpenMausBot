#!/bin/bash
cd /home/taro/OpenMausBot
export PATH=/usr/local/bin:/usr/bin:$PATH
export NODE_ENV=production
export OMB_PORT=8000
export OMB_STATIC_DIR=/home/taro/OpenMausBot/dist

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

exec node dist-server/index.js
