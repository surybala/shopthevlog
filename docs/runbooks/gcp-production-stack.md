# TripMirror Production Runbook on Google Cloud

This runbook stands up the first production stack for `vlogshopper.com` with:

- `apps/web` deployed to Cloud Run as the public Next.js app
- `backend` deployed to Cloud Run as the AI pipeline API
- Supabase retained for auth, Postgres, and Storage
- Google Cloud handling image builds, secrets, DNS, TLS, load balancing, monitoring, and alerting

This document assumes a single Google Cloud project for the first production environment.

## 1. Target Architecture

- `https://vlogshopper.com` and `https://www.vlogshopper.com`
  - global external Application Load Balancer
  - serverless NEG pointing at Cloud Run service `vlogshopper-web`
- `https://api.vlogshopper.com`
  - global external Application Load Balancer
  - serverless NEG pointing at Cloud Run service `vlogshopper-ai`
- Supabase
  - primary Postgres
  - auth
  - object storage
- Sentry
  - customer-facing error and degradation monitoring
- Cloud Monitoring
  - uptime checks
  - Cloud Run latency and 5xx alarms
  - notification channels

Official references:
- [Cloud Build → Artifact Registry](https://docs.cloud.google.com/build/docs/building/store-artifacts-in-artifact-registry)
- [Certificate Manager DNS authorization](https://docs.cloud.google.com/certificate-manager/docs/deploy-google-managed-dns-auth)
- [Cloud Run secrets](https://docs.cloud.google.com/run/docs/configuring/jobs/secrets)
- [Cloud Monitoring alerting and uptime checks](https://cloud.google.com/monitoring/alerts)

## 2. Required Production Services

Enable these APIs:

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  certificatemanager.googleapis.com \
  compute.googleapis.com \
  dns.googleapis.com \
  monitoring.googleapis.com \
  logging.googleapis.com
```

Use a dedicated project, for example:

- Project ID: `vlogshopper-prod`
- Region: `us-central1`

## 3. Artifact Registry

Create one Docker repository:

```bash
gcloud artifacts repositories create vlogshopper-prod \
  --repository-format=docker \
  --location=us-central1 \
  --description="TripMirror production images"
```

## 4. Secrets and Runtime Configuration

Store every production secret in Secret Manager.

### Web secrets

- `next-public-supabase-url`
- `next-public-supabase-anon-key`
- `next-public-base-url`
- `ai-pipeline-url`
- `next-public-sentry-dsn`
- `sentry-dsn-web`
- `sentry-traces-sample-rate-web`
- `sentry-profiles-sample-rate-web`
- `admin-emails`
- `allowed-emails`
- `allow-open-signups`
- `stripe-secret-key`
- `stripe-webhook-secret`

### Backend secrets

- `database-url`
- `app-env`
- `app-secret-key`
- `cors-origins`
- `supabase-url`
- `supabase-secret-key`
- `supabase-storage-bucket`
- `youtube-client-id`
- `youtube-client-secret`
- `youtube-redirect-uri`
- `youtube-api-key`
- `instagram-client-id`
- `instagram-client-secret`
- `instagram-redirect-uri`
- `tiktok-client-key`
- `tiktok-client-secret`
- `tiktok-redirect-uri`
- `gemini-api-key`
- `google-places-api-key`
- `redis-url`
- `sentry-dsn-backend`
- `sentry-traces-sample-rate-backend`
- `sentry-profiles-sample-rate-backend`

Example:

```bash
printf '%s' 'https://YOUR-PROJECT.supabase.co' | \
  gcloud secrets create next-public-supabase-url --data-file=-
```

For updates:

```bash
printf '%s' 'new-value' | \
  gcloud secrets versions add next-public-supabase-url --data-file=-
```

## 5. Production Environment Values

Use the repo examples as the baseline:

- [apps/web/.env.example](../../apps/web/.env.example)
- [backend/.env.example](../../backend/.env.example)

### Required web runtime variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_BASE_URL=https://vlogshopper.com`
- `AI_PIPELINE_URL=https://api.vlogshopper.com`
- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_DSN`
- `ADMIN_EMAILS`
- `ALLOWED_EMAILS`
- `ALLOW_OPEN_SIGNUPS=false`

### Required backend runtime variables

- `DATABASE_URL`
- `APP_ENV=production`
- `APP_SECRET_KEY`
- `CORS_ORIGINS=https://vlogshopper.com,https://www.vlogshopper.com`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_STORAGE_BUCKET=ai-pipeline-assets`
- `GEMINI_API_KEY`
- `GOOGLE_PLACES_API_KEY`
- social platform keys as used by your onboarding/import flows
- `SENTRY_DSN`

## 6. Build and Deploy Containers

The repo now includes:

- [apps/web/Dockerfile](../../apps/web/Dockerfile)
- [backend/Dockerfile](../../backend/Dockerfile)
- [deploy/cloudbuild.web.yaml](../../deploy/cloudbuild.web.yaml)
- [deploy/cloudbuild.backend.yaml](../../deploy/cloudbuild.backend.yaml)

### Web deploy

```bash
gcloud builds submit \
  --config deploy/cloudbuild.web.yaml \
  --substitutions _REGION=us-central1,_AR_REPO=vlogshopper-prod,_SERVICE=vlogshopper-web
```

### Backend deploy

```bash
gcloud builds submit \
  --config deploy/cloudbuild.backend.yaml \
  --substitutions _REGION=us-central1,_AR_REPO=vlogshopper-prod,_SERVICE=vlogshopper-ai
```

After the first deploy, update each Cloud Run service to attach its secrets.

### Web Cloud Run settings

- CPU: `1`
- Memory: `1Gi`
- Min instances: `1`
- Max instances: start with `10`
- Concurrency: `80`
- Request timeout: `300s`

Suggested secret/env wiring:

```bash
gcloud run services update vlogshopper-web \
  --region us-central1 \
  --set-env-vars NEXT_PUBLIC_BASE_URL=https://vlogshopper.com,AI_PIPELINE_URL=https://api.vlogshopper.com,ALLOW_OPEN_SIGNUPS=false \
  --set-secrets NEXT_PUBLIC_SUPABASE_URL=next-public-supabase-url:latest,NEXT_PUBLIC_SUPABASE_ANON_KEY=next-public-supabase-anon-key:latest,NEXT_PUBLIC_SENTRY_DSN=next-public-sentry-dsn:latest,SENTRY_DSN=sentry-dsn-web:latest,ADMIN_EMAILS=admin-emails:latest,ALLOWED_EMAILS=allowed-emails:latest
```

### Backend Cloud Run settings

- CPU: `2`
- Memory: `2Gi`
- Min instances: `0` or `1`
- Max instances: start with `5`
- Concurrency: `4`
- Request timeout: `900s`

Suggested secret/env wiring:

```bash
gcloud run services update vlogshopper-ai \
  --region us-central1 \
  --set-env-vars APP_ENV=production,CORS_ORIGINS=https://vlogshopper.com,https://www.vlogshopper.com,SUPABASE_STORAGE_BUCKET=ai-pipeline-assets \
  --set-secrets DATABASE_URL=database-url:latest,APP_SECRET_KEY=app-secret-key:latest,SUPABASE_URL=supabase-url:latest,SUPABASE_SECRET_KEY=supabase-secret-key:latest,YOUTUBE_CLIENT_ID=youtube-client-id:latest,YOUTUBE_CLIENT_SECRET=youtube-client-secret:latest,YOUTUBE_REDIRECT_URI=youtube-redirect-uri:latest,YOUTUBE_API_KEY=youtube-api-key:latest,INSTAGRAM_CLIENT_ID=instagram-client-id:latest,INSTAGRAM_CLIENT_SECRET=instagram-client-secret:latest,INSTAGRAM_REDIRECT_URI=instagram-redirect-uri:latest,TIKTOK_CLIENT_KEY=tiktok-client-key:latest,TIKTOK_CLIENT_SECRET=tiktok-client-secret:latest,TIKTOK_REDIRECT_URI=tiktok-redirect-uri:latest,GEMINI_API_KEY=gemini-api-key:latest,GOOGLE_PLACES_API_KEY=google-places-api-key:latest,REDIS_URL=redis-url:latest,SENTRY_DSN=sentry-dsn-backend:latest
```

## 7. Create the Global HTTPS Entry Points

Use a global external Application Load Balancer with serverless NEGs.

Recommended public host split:

- `vlogshopper.com` → web
- `www.vlogshopper.com` → web
- `api.vlogshopper.com` → backend

### 7.1 Reserve a global IP

```bash
gcloud compute addresses create vlogshopper-web-ip --global
gcloud compute addresses create vlogshopper-api-ip --global
```

Fetch the IPs:

```bash
gcloud compute addresses describe vlogshopper-web-ip --global
gcloud compute addresses describe vlogshopper-api-ip --global
```

### 7.2 Create serverless NEGs

```bash
gcloud compute network-endpoint-groups create vlogshopper-web-neg \
  --region=us-central1 \
  --network-endpoint-type=serverless \
  --cloud-run-service=vlogshopper-web

gcloud compute network-endpoint-groups create vlogshopper-ai-neg \
  --region=us-central1 \
  --network-endpoint-type=serverless \
  --cloud-run-service=vlogshopper-ai
```

### 7.3 Create backend services

```bash
gcloud compute backend-services create vlogshopper-web-backend \
  --global \
  --load-balancing-scheme=EXTERNAL_MANAGED

gcloud compute backend-services add-backend vlogshopper-web-backend \
  --global \
  --network-endpoint-group=vlogshopper-web-neg \
  --network-endpoint-group-region=us-central1

gcloud compute backend-services create vlogshopper-ai-backend \
  --global \
  --load-balancing-scheme=EXTERNAL_MANAGED

gcloud compute backend-services add-backend vlogshopper-ai-backend \
  --global \
  --network-endpoint-group=vlogshopper-ai-neg \
  --network-endpoint-group-region=us-central1
```

## 8. TLS Certificates with DNS Authorization

Use Certificate Manager with DNS authorization.

Create DNS authorizations:

```bash
gcloud certificate-manager dns-authorizations create vlogshopper-root-auth \
  --domain="vlogshopper.com"

gcloud certificate-manager dns-authorizations create vlogshopper-api-auth \
  --domain="api.vlogshopper.com"
```

Create the DNS CNAME records exactly as Certificate Manager tells you to.

Then create certificates:

```bash
gcloud certificate-manager certificates create vlogshopper-web-cert \
  --domains="vlogshopper.com,www.vlogshopper.com" \
  --dns-authorizations="vlogshopper-root-auth"

gcloud certificate-manager certificates create vlogshopper-api-cert \
  --domains="api.vlogshopper.com" \
  --dns-authorizations="vlogshopper-api-auth"
```

## 9. URL Maps, Proxies, and Forwarding Rules

Create one HTTPS proxy per frontend:

```bash
gcloud compute url-maps create vlogshopper-web-map \
  --default-service=vlogshopper-web-backend

gcloud compute url-maps create vlogshopper-api-map \
  --default-service=vlogshopper-ai-backend
```

Attach certificates using target HTTPS proxies:

```bash
gcloud compute target-https-proxies create vlogshopper-web-proxy \
  --url-map=vlogshopper-web-map \
  --certificate-manager-certificates=vlogshopper-web-cert

gcloud compute target-https-proxies create vlogshopper-api-proxy \
  --url-map=vlogshopper-api-map \
  --certificate-manager-certificates=vlogshopper-api-cert
```

Create forwarding rules:

```bash
gcloud compute forwarding-rules create vlogshopper-web-https \
  --global \
  --load-balancing-scheme=EXTERNAL_MANAGED \
  --network-tier=PREMIUM \
  --address=vlogshopper-web-ip \
  --target-https-proxy=vlogshopper-web-proxy \
  --ports=443

gcloud compute forwarding-rules create vlogshopper-api-https \
  --global \
  --load-balancing-scheme=EXTERNAL_MANAGED \
  --network-tier=PREMIUM \
  --address=vlogshopper-api-ip \
  --target-https-proxy=vlogshopper-api-proxy \
  --ports=443
```

Optional but recommended:
- create HTTP → HTTPS redirect frontends for root and `www`

## 10. DNS for `vlogshopper.com`

You can manage DNS in Cloud DNS or in your registrar. Since you asked for wiring to the load balancer, the key records are:

- `A @` → web global IP
- `A www` → web global IP
- `A api` → api global IP
- Certificate Manager CNAME validation records

If using Cloud DNS:

```bash
gcloud dns managed-zones create vlogshopper-zone \
  --dns-name="vlogshopper.com." \
  --description="TripMirror production zone"
```

Then create records in the zone:

- apex A record for `vlogshopper.com`
- `www` A record
- `api` A record
- any CNAMEs provided by Certificate Manager DNS authorizations

If your registrar hosts DNS, add the same records there instead.

## 11. Supabase Production Checklist

- allow `https://vlogshopper.com` and `https://www.vlogshopper.com` in Supabase auth redirect URLs
- allow backend egress IPs or public access patterns required for Postgres pooler
- confirm Storage bucket `ai-pipeline-assets` exists
- confirm service-role/secret key is production-scoped
- run Prisma migrations against production before first launch

From `apps/web`:

```bash
npx prisma migrate deploy
```

## 12. Smoke Tests Before Opening the Beta

### Public app

- `https://vlogshopper.com` loads
- `https://www.vlogshopper.com` loads
- `https://api.vlogshopper.com/health` returns healthy
- login/signup/waitlist redirect behavior is correct

### Creator flow

- import a real creator vlog
- process the vlog
- confirm review queue shows opportunities
- publish a Trip Kit
- verify storefront renders the published kit

### Subscriber flow

- discover page loads
- follow a creator
- save a Trip Kit
- premium gating works

## 13. Monitoring and Customer-Facing Alerts

### Already in the app

- Sentry is wired in for Next.js and FastAPI
- backend metrics available at `/health/metrics`
- web admin observability snapshot available at `/api/admin/observability`

### Create Cloud Monitoring notification channels

At minimum:

- email to founders/operators
- Slack webhook or PagerDuty for urgent alerts

### Uptime checks

Create uptime checks for:

- `https://vlogshopper.com/`
- `https://vlogshopper.com/discover`
- `https://api.vlogshopper.com/health`

Alert if:

- 2 or more consecutive failures
- latency exceeds your chosen threshold for multiple windows

### Cloud Run alert policies

Create policies for both `vlogshopper-web` and `vlogshopper-ai`:

- request count drops unexpectedly during active periods
- 5xx rate exceeds 2% for 5 minutes
- P95 latency exceeds:
  - web: `2s`
  - backend process trigger endpoints: `5s`
- instance crash/restart spikes

### Customer-facing degradation alarms

Create alerting around:

- web route errors for:
  - `/api/creator/scan`
  - `/api/vlogs/[id]/process`
  - `/api/vlogs/[id]/publish`
  - `/api/checkout/subscribe`
  - `/api/account/follow`
  - `/api/account/saved-kits`
- backend health metrics:
  - failed vlog processing spikes
  - slow processing spikes
  - large review queue backlog

### Sentry alert rules

Recommended alerts:

- any new issue on checkout, publish, process, or auth callback
- high event volume for `Video processing is temporarily unavailable`
- repeated backend exceptions containing `GEMINI_API_KEY`, `yt-dlp`, Supabase auth, or database connectivity

## 14. Runbook for Incidents

### Web 5xx spike

1. Check Cloud Run revisions for `vlogshopper-web`
2. Check Sentry release health
3. Roll back to prior revision if needed
4. Confirm `https://vlogshopper.com/` and `/discover`

### Processing failures spike

1. Check `https://api.vlogshopper.com/health`
2. Check backend Sentry issues
3. Check `/health/metrics`
4. Confirm `GEMINI_API_KEY`, Supabase secret, and YouTube access still valid
5. Pause creator onboarding if failures persist

### Auth or waitlist failures

1. Check Supabase status
2. Validate `ADMIN_EMAILS`, `ALLOWED_EMAILS`, `ALLOW_OPEN_SIGNUPS`
3. Verify auth callback redirects

## 15. Recommended First Beta Settings

- keep whitelist closed
- invite 3 to 5 creators
- keep imported video caps low by plan
- monitor every processed vlog manually for the first week
- review Sentry and Cloud Monitoring daily

## 16. After the First Successful Production Deploy

Do these immediately:

1. Deploy both services.
2. Confirm certificates are `ACTIVE`.
3. Switch DNS records to the load balancer IPs.
4. Run smoke tests.
5. Confirm uptime checks are green.
6. Confirm Sentry receives test events from web and backend.
7. Invite the first beta creators.
