# Darkpools

A trading journal, deployed to https://darkpools.deeapps.net on an existing AWS server
that already hosts two other applications.

## Status

Project kickoff. The application scaffold lands after the server survey below.

## Server setup

Run these on the server as the user that will own the deployment
(for example through EC2 Instance Connect in the AWS console).

1. Survey the server. Read-only and prints no secrets; paste the output back to Claude.

   ```bash
   curl -fsSL https://raw.githubusercontent.com/dhulfiqar8409/Trading-journal-/claude/trading-journal-aws-pnsmv4/scripts/survey.sh | bash
   ```

2. Create the deploy key. It installs a dedicated public key on the server and prints the
   private key once. Store that private key as the GitHub Actions secret `SSH_PRIVATE_KEY`
   (repository Settings, then Secrets and variables, then Actions). Never paste it into the chat.

   ```bash
   curl -fsSL https://raw.githubusercontent.com/dhulfiqar8409/Trading-journal-/claude/trading-journal-aws-pnsmv4/scripts/add-deploy-key.sh | bash
   ```

Deployments run from GitHub Actions over SSH using that key.
