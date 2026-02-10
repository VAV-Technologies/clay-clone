# Deployment Setup Guide

Complete instructions for deploying this Next.js project to a new Vercel account.

## 1. Prerequisites

- GitHub account with this repo pushed
- Vercel account (free tier works)
- Turso account (database)
- Google Cloud account (Vertex AI for Gemini models)
- Azure account (OpenAI + Batch API)
- MailNinja account (email verification)

## 2. Vercel Environment Variables

Set all of these in Vercel → Project → Settings → Environment Variables.

### Database (Turso)

| Variable | Description |
|---|---|
| `TURSO_DATABASE_URL` | Turso database URL, e.g. `libsql://your-db-name-your-org.turso.io` |
| `TURSO_AUTH_TOKEN` | Turso auth token for the database |

### Authentication

| Variable | Description |
|---|---|
| `SITE_PASSWORD` | Password users enter to access the app (simple shared password auth) |

### Cron Job Authentication

| Variable | Description |
|---|---|
| `CRON_SECRET` | Secret token used to authenticate cron job API calls from GitHub Actions |

### Azure OpenAI (primary AI provider)

| Variable | Description |
|---|---|
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL, e.g. `https://your-resource.openai.azure.com` |
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key |
| `AZURE_OPENAI_API_VERSION` | *(Optional)* API version, defaults to `2024-02-15-preview` |

### Azure GPT-5 Nano (optional secondary model)

| Variable | Description |
|---|---|
| `AZURE_GPT5_NANO_ENDPOINT` | *(Optional)* Separate Azure endpoint for GPT-5 Nano model |
| `AZURE_GPT5_NANO_API_KEY` | *(Optional)* API key for the GPT-5 Nano endpoint |

### Azure Batch API (bulk processing at 50% cost)

| Variable | Description |
|---|---|
| `AZURE_BATCH_ENDPOINT` | Azure OpenAI endpoint for batch jobs |
| `AZURE_BATCH_API_KEY` | API key for the batch processing endpoint |
| `AZURE_BATCH_DEPLOYMENT` | *(Optional)* Deployment name, defaults to `gpt-4.1-mini` |

### Google Cloud / Vertex AI (Gemini models)

| Variable | Description |
|---|---|
| `GOOGLE_CLOUD_PROJECT` | Google Cloud project ID |
| `GOOGLE_CLOUD_LOCATION` | *(Optional)* Region, defaults to `us-central1` |
| `GOOGLE_SERVICE_ACCOUNT_BASE64` | Base64-encoded service account JSON key (preferred) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | *(Alternative)* Raw JSON service account key |
| `GEMINI_API_KEY` | *(Alternative)* Gemini API key (if not using Vertex AI / service account) |

> **Note:** For Google AI, you can either use Vertex AI (service account + project) or a Gemini API key. Vertex AI is recommended for production.

### MailNinja (email verification)

| Variable | Description |
|---|---|
| `MAILNINJA_API_KEY` | MailNinja API key for email verification service |

## 3. GitHub Configuration

### GitHub Actions Secret

Go to your repo → Settings → Secrets and variables → Actions → Secrets:

| Secret | Description |
|---|---|
| `CRON_SECRET` | Same value as the `CRON_SECRET` env var in Vercel. Used by cron workflows to authenticate API calls. |

### GitHub Actions Variable

Go to your repo → Settings → Secrets and variables → Actions → Variables:

| Variable | Description |
|---|---|
| `VERCEL_APP_URL` | Your Vercel deployment URL, e.g. `https://your-app.vercel.app` (no trailing slash) |

## 4. External Service Setup

### Turso Database

1. Create an account at [turso.tech](https://turso.tech)
2. Create a new database
3. Get the database URL and auth token
4. Initialize the schema by running locally:
   ```bash
   npm install
   npx drizzle-kit push
   ```
   Make sure you have `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in a local `.env` file first.

### Azure OpenAI

1. Create an Azure OpenAI resource in the Azure portal
2. Deploy a model (e.g. `gpt-4.1-mini`)
3. Copy the endpoint URL and API key
4. For batch processing, you can use the same or a separate Azure OpenAI resource

### Google Cloud / Vertex AI

1. Create a Google Cloud project
2. Enable the Vertex AI API
3. Create a service account with Vertex AI User role
4. Download the JSON key and base64-encode it:
   ```bash
   base64 -w 0 service-account.json
   ```
5. Set the result as `GOOGLE_SERVICE_ACCOUNT_BASE64`

### MailNinja

1. Sign up at MailNinja
2. Get your API key from the dashboard

## 5. Vercel Deployment

1. Go to [vercel.com](https://vercel.com) and import the GitHub repository
2. Framework Preset: **Next.js** (should auto-detect)
3. Add all environment variables from Section 2
4. Deploy

The app uses the following cron jobs via GitHub Actions (not Vercel Cron):
- **Enrichment processing** — runs every 5 minutes (`.github/workflows/enrichment-cron.yml`)
- **Batch job processing** — runs every 10 minutes (`.github/workflows/batch-cron.yml`)

These will start automatically once the GitHub secrets/variables are configured.

## 6. Post-Deployment Verification

- [ ] App loads at your Vercel URL
- [ ] Login works with `SITE_PASSWORD`
- [ ] Can create a new table and add columns
- [ ] AI enrichment processes rows (check Azure OpenAI connectivity)
- [ ] GitHub Actions cron jobs run successfully (check Actions tab)
- [ ] Batch processing works (submit a batch job and wait for completion)
- [ ] Email verification works via MailNinja

## 7. Summary of All Required Env Vars

**Minimum required for the app to work:**
- `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (database)
- `SITE_PASSWORD` (auth)
- `CRON_SECRET` (cron auth)
- `AZURE_OPENAI_ENDPOINT` + `AZURE_OPENAI_API_KEY` (AI)

**For full functionality, also add:**
- `AZURE_BATCH_ENDPOINT` + `AZURE_BATCH_API_KEY` (batch processing)
- `GOOGLE_CLOUD_PROJECT` + `GOOGLE_SERVICE_ACCOUNT_BASE64` (Gemini models)
- `MAILNINJA_API_KEY` (email verification)

**GitHub repo settings:**
- Secret: `CRON_SECRET`
- Variable: `VERCEL_APP_URL`
