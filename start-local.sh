#!/usr/bin/env bash
set -e
if [ -z "$VITAMIN_ADMIN_PASSWORD" ]; then
  read -rsp "请设置本次后台登录密码: " VITAMIN_ADMIN_PASSWORD
  echo
  export VITAMIN_ADMIN_PASSWORD
fi
if [ -z "$VITAMIN_SESSION_SECRET" ]; then
  VITAMIN_SESSION_SECRET="$(date +%s)-$$-$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  export VITAMIN_SESSION_SECRET
fi
echo "正在启动： http://localhost:3000"
node server.js
