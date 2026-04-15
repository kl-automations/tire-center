# GCP Manual Setup — Tire Center

> **For:** Maayan (project owner)
> **Created:** 2026-04-13
> **Context:** One-time setup steps in GCP Console and Firebase. Do these before handing off to the developer. When done, share the collected values at the bottom with the dev.
> **Time estimate:** ~2 hours for dev, ~2 hours for prod (do prod only after dev is working)

---

# DEV ENVIRONMENT

> Set this up first. All backend development and ERP testing happens here. Do **not** touch prod until dev is stable.

---

## Step 1 — Create the Dev GCP Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown (top left) → **New Project**
3. Name: `tire-center-dev`
4. Click **Create**
5. Wait for it to appear, then select it as your active project

> ✅ Done when: `tire-center-dev` is your active project in the top bar

---

## Step 2 — Enable Billing

1. In the left menu → **Billing**
2. Link a billing account (or create one)

> ✅ Done when: Billing account is linked to `tire-center-dev`

---

## Step 3 — Enable Required APIs

1. Go to **APIs & Services → Enable APIs and Services**
2. Search and enable each of the following one by one:
   - `Cloud Run API`
   - `Cloud SQL Admin API`
   - `Firestore API`
   - `Cloud Scheduler API`
   - `Secret Manager API`
   - `Artifact Registry API`
   - `Compute Engine API`

> ✅ Done when: All 7 APIs show as "Enabled"

---

## Step 4 — Create Cloud SQL (PostgreSQL) Instance

1. Left menu → **SQL** → **Create Instance**
2. Choose **PostgreSQL**
3. Settings:
   - Instance ID: `tire-center-dev-db`
   - Password: choose a strong password — **save it, you'll need it later**
   - Region: `me-west1` (Tel Aviv) or your preferred region
   - Edition: **Enterprise** (cheapest tier is fine for dev)
   - Machine type: `db-f1-micro` (dev only)
4. Click **Create Instance** — takes ~5 minutes
5. Once created, click the instance → note the **Connection name** (looks like `tire-center-dev:me-west1:tire-center-dev-db`)
6. Go to **Databases** tab → **Create Database** → name: `tiredb`
7. Go to **Users** tab → **Add User Account** → username: `tireuser`, set a password — **save it**

> ✅ Done when: Instance is running, database `tiredb` exists, user `tireuser` exists
> 📋 **Save:** Connection name, DB name (`tiredb`), DB user (`tireuser`), DB password

---

## Step 5 — Set Up Firestore

1. Left menu → **Firestore**
2. Click **Create Database**
3. Mode: **Native mode**
4. Region: same as your Cloud SQL region
5. Click **Create**

> ✅ Done when: Firestore console shows an empty database

---

## Step 6 — Set Up Firebase (Frontend + Firestore access)

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add Project** → select your existing `tire-center-dev` GCP project
3. Follow the setup wizard (you can skip Google Analytics)
4. Once inside Firebase Console → **Hosting** (left menu) → **Get Started**
5. Follow the steps — you don't need to deploy yet, just complete the setup

> ✅ Done when: Firebase Hosting is set up under `tire-center-dev`
> 📋 **Save:** The Firebase project ID (shown in Project Settings — same as GCP project ID: `tire-center-dev`)

---

## Step 7 — Create Firebase Service Account (for backend Firestore writes)

1. In Firebase Console → **Project Settings** (gear icon) → **Service Accounts** tab
2. Click **Generate New Private Key**
3. A `.json` file will download — **keep this file safe, treat it like a password**

> ✅ Done when: You have the `.json` service account file
> 📋 **Save:** The `.json` file contents (you'll paste the whole thing as a secret)

---

## Step 8 — Set Up Artifact Registry (for Docker images)

1. In GCP Console → **Artifact Registry** → **Create Repository**
2. Settings:
   - Name: `tire-center`
   - Format: **Docker**
   - Region: same as the rest
3. Click **Create**

> ✅ Done when: Repository `tire-center` appears in Artifact Registry

---

## Step 9 — Create Dev VM with Static IP (for ERP whitelisting)

> Cloud Run alone cannot give a static IP without a Load Balancer (that's a prod concern). For dev, a small VM is simpler and gives you a static IP directly.

1. Left menu → **Compute Engine → VM Instances** → **Create Instance**
2. Settings:
   - Name: `tire-center-dev-vm`
   - Region: same as the rest
   - Machine type: `e2-micro` (free tier eligible)
   - Boot disk: **Debian** or **Ubuntu**, 10GB is fine
   - Firewall: check **Allow HTTP traffic** and **Allow HTTPS traffic**
3. Click **Create**
4. Once running, click the VM → **Edit**
5. Under **Network interfaces** → click the interface → change **External IPv4 address** from "Ephemeral" to **Reserve Static Address**
   - Name: `tire-center-dev-ip`
   - Click **Reserve**
6. Note the static IP address

> ✅ Done when: VM is running and has a reserved static external IP
> 📋 **Save:** The static IP address — share this with the ERP team for whitelisting

---

## Step 10 — Store Dev Secrets in Secret Manager

1. Left menu → **Security → Secret Manager**
2. Click **Create Secret** for each of the following:

| Secret name | Value |
|---|---|
| `JWT_SECRET` | Any long random string (e.g. generate at [randomkeygen.com](https://randomkeygen.com)) |
| `DB_PASSWORD` | The `tireuser` password you set in Step 4 |
| `WEBHOOK_SECRET` | Any long random string — **share this with the ERP team** |
| `FIREBASE_SERVICE_ACCOUNT` | Paste the full contents of the `.json` file from Step 7 |

For each: Name → Secret name above. Secret value → the value. Leave everything else default. Click **Create Secret**.

> ✅ Done when: All 4 secrets appear in Secret Manager

---

## Step 11 — Grant VM Access to Secrets

1. Left menu → **IAM & Admin → IAM**
2. Find the **Compute Engine default service account** (looks like `[number]-compute@developer.gserviceaccount.com`)
3. Click the pencil icon → **Add Role** → add `Secret Manager Secret Accessor`
4. Save

> ✅ Done when: The service account has the Secret Manager Secret Accessor role

---

## Step 12 — Configure Cloud Scheduler (Dev)

> Do this after the developer has deployed the backend to the VM and gives you the URL.

1. Left menu → **Cloud Scheduler** → **Create Job**
2. Settings:
   - Name: `nightly-cleanup-dev`
   - Region: same as the rest
   - Frequency: `0 0 * * *` (midnight every night)
   - Timezone: `Asia/Jerusalem`
3. Target type: **HTTP**
   - URL: `http://<static-vm-ip>/internal/cleanup` ← get this from developer
   - HTTP method: `POST`
   - Auth header: **Add OIDC token**, service account: the Compute Engine default service account
4. Click **Create**

> ✅ Done when: Job appears in Cloud Scheduler. Click **Run Now** once to test — it should show "Success"

---

## Dev Handoff Checklist — Share These With the Developer

When done with the dev setup, send the developer the following:

```
CLOUD_SQL_CONNECTION_NAME = [from Step 4]
DB_NAME                   = tiredb
DB_USER                   = tireuser
DB_PASSWORD               = [from Step 4]
FIREBASE_PROJECT_ID       = tire-center-dev
ARTIFACT_REGISTRY_REPO    = [region]-docker.pkg.dev/tire-center-dev/tire-center
VM_STATIC_IP              = [from Step 9]
```

Secrets are already in Secret Manager — the developer reads them from there via env vars, no need to share them directly.

---
---

# PRODUCTION ENVIRONMENT

> **Do not start this section until the dev environment is fully working and signed off.**
> All steps mirror dev but with stronger settings, different secret values, and Cloud Run instead of a VM.

---

## Step P1 — Create the Prod GCP Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click the project dropdown → **New Project**
3. Name: `tire-center-prod`
4. Click **Create** and select it as your active project

> ✅ Done when: `tire-center-prod` is your active project in the top bar

---

## Step P2 — Enable Billing

1. Left menu → **Billing**
2. Link a billing account

> ✅ Done when: Billing account is linked to `tire-center-prod`

---

## Step P3 — Enable Required APIs

Same as dev — enable all 7:
- `Cloud Run API`
- `Cloud SQL Admin API`
- `Firestore API`
- `Cloud Scheduler API`
- `Secret Manager API`
- `Artifact Registry API`
- `Compute Engine API`

> ✅ Done when: All 7 APIs show as "Enabled"

---

## Step P4 — Create Cloud SQL (PostgreSQL) Instance

Same as dev but with a stronger machine type:

1. Left menu → **SQL** → **Create Instance** → **PostgreSQL**
2. Settings:
   - Instance ID: `tire-center-prod-db`
   - Password: a **new** strong password — do not reuse the dev password
   - Region: same as dev
   - Edition: **Enterprise**
   - Machine type: `db-g1-small` (or higher — do not use `db-f1-micro` in prod)
3. Click **Create Instance**
4. Create database: name `tiredb`
5. Create user: `tireuser`, set a **new** password

> ✅ Done when: Instance running, `tiredb` and `tireuser` exist
> 📋 **Save:** Connection name, DB password

---

## Step P5 — Set Up Firestore

Same as dev:

1. Left menu → **Firestore** → **Create Database**
2. Mode: **Native mode**
3. Region: same as prod Cloud SQL
4. Click **Create**

> ✅ Done when: Firestore console shows an empty database

---

## Step P6 — Set Up Firebase (Frontend + Firestore access)

Same as dev but linked to the prod project:

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add Project** → select `tire-center-prod`
3. Follow the setup wizard
4. Set up Firebase Hosting

> ✅ Done when: Firebase Hosting is set up under `tire-center-prod`
> 📋 **Save:** Firebase project ID (`tire-center-prod`)

---

## Step P7 — Create Firebase Service Account

Same as dev — generate a new private key for the prod project:

1. Firebase Console → **Project Settings** → **Service Accounts**
2. Click **Generate New Private Key**

> ✅ Done when: You have the prod `.json` service account file
> 📋 **Save:** The `.json` file contents

---

## Step P8 — Set Up Artifact Registry

Same as dev but in the prod project:

1. **Artifact Registry** → **Create Repository**
   - Name: `tire-center`
   - Format: **Docker**
   - Region: same as the rest

> ✅ Done when: Repository `tire-center` appears in Artifact Registry

---

## Step P9 — Reserve a Static IP for the Load Balancer

> Cloud Run does not have a static IP by default. In production, a Load Balancer sits in front of Cloud Run and holds the static IP. This is the IP the ERP team whitelists.

1. Left menu → **VPC Network → IP Addresses** → **Reserve External Static Address**
2. Settings:
   - Name: `tire-center-prod-ip`
   - Type: **Global**
   - IP version: **IPv4**
3. Click **Reserve**
4. Note the static IP address

> ✅ Done when: A global static IP is reserved
> 📋 **Save:** The static IP address — share this with the ERP team to replace the dev IP in their whitelist

---

## Step P10 — Deploy Cloud Run Service

> Do this after the developer has built and pushed the prod Docker image.

1. Left menu → **Cloud Run** → **Create Service**
2. Settings:
   - Container image: from Artifact Registry (`[region]-docker.pkg.dev/tire-center-prod/tire-center/backend:latest`)
   - Region: same as the rest
   - Authentication: **Require authentication** (all public traffic goes through the Load Balancer)
   - Set all env vars / secrets (see Step P11 first)
3. Click **Create**

> ✅ Done when: Cloud Run service is deployed and the health check returns `{"status":"ok"}`

---

## Step P11 — Store Prod Secrets in Secret Manager

**Use completely different values from dev — do not copy dev secrets.**

1. Left menu → **Security → Secret Manager**
2. Create the same 4 secrets with new values:

| Secret name | Value |
|---|---|
| `JWT_SECRET` | New long random string — not the same as dev |
| `DB_PASSWORD` | The `tireuser` password from Step P4 |
| `WEBHOOK_SECRET` | New long random string — **share this new value with the ERP team** |
| `FIREBASE_SERVICE_ACCOUNT` | Contents of the prod `.json` file from Step P7 |

> ✅ Done when: All 4 secrets appear in Secret Manager for `tire-center-prod`

---

## Step P12 — Grant Cloud Run Access to Secrets

1. Left menu → **IAM & Admin → IAM**
2. Find the **Compute Engine default service account** (`[number]-compute@developer.gserviceaccount.com`)
3. Add role: `Secret Manager Secret Accessor`
4. Save

> ✅ Done when: The service account has the Secret Manager Secret Accessor role

---

## Step P13 — Set Up Load Balancer (links static IP → Cloud Run)

1. Left menu → **Network Services → Load Balancing** → **Create Load Balancer**
2. Choose **Application Load Balancer (HTTP/S)**
3. Scope: **Global**
4. **Backend configuration:**
   - Add a backend → type: **Serverless NEG**
   - Create a Serverless NEG pointing to your Cloud Run service
5. **Frontend configuration:**
   - Protocol: **HTTPS**
   - IP address: select `tire-center-prod-ip` (reserved in Step P9)
   - Add an SSL certificate (use Google-managed)
6. Click **Create**

> ✅ Done when: Load Balancer is created and the static IP routes to your Cloud Run service

---

## Step P14 — Configure Cloud Scheduler (Prod)

> Do this after the Load Balancer is set up.

1. Left menu → **Cloud Scheduler** → **Create Job**
2. Settings:
   - Name: `nightly-cleanup-prod`
   - Region: same as the rest
   - Frequency: `0 0 * * *` (midnight every night)
   - Timezone: `Asia/Jerusalem`
3. Target type: **HTTP**
   - URL: `https://<load-balancer-domain>/internal/cleanup`
   - HTTP method: `POST`
   - Auth header: **Add OIDC token**, service account: Compute Engine default service account
4. Click **Create**

> ✅ Done when: Job appears in Cloud Scheduler. Click **Run Now** to test.

---

## Prod Handoff Checklist — Share These With the Developer

```
CLOUD_SQL_CONNECTION_NAME = [from Step P4]
DB_NAME                   = tiredb
DB_USER                   = tireuser
DB_PASSWORD               = [from Step P4]
FIREBASE_PROJECT_ID       = tire-center-prod
ARTIFACT_REGISTRY_REPO    = [region]-docker.pkg.dev/tire-center-prod/tire-center
LOAD_BALANCER_IP          = [from Step P9]
```

Secrets are already in Secret Manager — the developer reads them from there, no need to share them directly.
