# GitHub Actions Secrets Required

Go to: GitHub repo → Settings → Secrets and variables → Actions → New secret

## Required secrets

| Secret name | What it is | How to get |
|---|---|---|
| `HETZNER_HOST` | Server IP address | From Hetzner console after Step 16 |
| `HETZNER_SSH_KEY` | Private SSH key for appuser | Generated in Step 16 |
| `JWT_PRIVATE_KEY_TEST` | RSA private key for test runs | Run: `node scripts/generate-dev-keys.mjs` |
| `JWT_PUBLIC_KEY_TEST` | RSA public key for test runs | Same command above |

## How to add HETZNER_SSH_KEY

1. Generate a dedicated deploy key on your Mac:
```bash
   ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/chirawa_deploy
```
2. Copy PUBLIC key to Hetzner server (Step 16):
```bash
   cat ~/.ssh/chirawa_deploy.pub
   # Add this to /home/appuser/.ssh/authorized_keys on server
```
3. Copy PRIVATE key to GitHub secret:
```bash
   cat ~/.ssh/chirawa_deploy
   # Paste entire output as HETZNER_SSH_KEY secret
```

## GITHUB_TOKEN
This is automatic — GitHub provides it. No setup needed.
It's used to push Docker images to GitHub Container Registry.
