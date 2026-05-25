#!/bin/bash
# Manual deploy to Hetzner — use when GitHub Actions is unavailable
# Run from your Mac: bash scripts/deploy.sh

set -e

SERVER="appuser@YOUR_HETZNER_IP"
SHA=$(git rev-parse HEAD)

echo "🚀 Deploying $SHA to Hetzner..."

# Build and push image
docker build -t ghcr.io/Whatever-Piyush/chirawa/api:$SHA .
docker push ghcr.io/Whatever-Piyush/chirawa/api:$SHA

# Deploy via SSH
ssh $SERVER << REMOTE
  set -e
  cd /opt/chirawa
  git pull origin main
  docker pull ghcr.io/Whatever-Piyush/chirawa/api:$SHA
  pnpm install --frozen-lockfile
  pnpm --filter @chirawa/api db:migrate:prod
  pm2 reload ecosystem.config.js --env production
  pm2 save
  echo "✅ Done"
REMOTE

echo "✅ Deploy complete"
