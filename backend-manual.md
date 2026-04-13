# GCP Manual Setup — Tire Center

> **For:** Maayan (project owner)
> **Created:** 2026-04-13
> **Context:** One-time setup steps in GCP Console and Firebase. Do these before handing off to the developer. When done, share the collected values at the bottom with the dev.
> **Time estimate:** ~2 hours total

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

> ✅ Done when: All 6 APIs show as "Enabled"

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

## Step 6 — Set Up Firebase Hosting (Frontend)

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

## Step 9 — Store Secrets in Secret Manager

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

## Step 10 — Grant Cloud Run Access to Secrets

1. Left menu → **IAM & Admin → IAM**
2. Find the **Compute Engine default service account** (looks like `[number]-compute@developer.gserviceaccount.com`)
3. Click the pencil icon → **Add Role** → add `Secret Manager Secret Accessor`
4. Save

> ✅ Done when: The service account has the Secret Manager Secret Accessor role

---

## Step 11 — Configure Cloud Scheduler (Nightly Cleanup)

> Do this after the developer has deployed the backend to Cloud Run and gives you the Cloud Run URL.

1. Left menu → **Cloud Scheduler** → **Create Job**
2. Settings:
   - Name: `nightly-cleanup`
   - Region: same as the rest
   - Frequency: `0 0 * * *` (midnight every night)
   - Timezone: `Asia/Jerusalem`
3. Target type: **HTTP**
   - URL: `https://<cloud-run-url>/internal/cleanup` ← get this from developer
   - HTTP method: `POST`
   - Auth header: **Add OIDC token**, service account: the Compute Engine default service account
4. Click **Create**

> ✅ Done when: Job appears in Cloud Scheduler. Click **Run Now** once to test — it should show "Success"

---

## Step 12 — Repeat for Production

Once dev is working, repeat Steps 1–11 for production:
- Project name: `tire-center-prod`
- Use **stronger** machine type for Cloud SQL (`db-g1-small` or higher)
- Use **different** secret values than dev (different `JWT_SECRET`, `WEBHOOK_SECRET`, etc.)
- Never copy data from dev to prod

---

## Handoff Checklist — Share These With the Developer

When done with the dev setup, send the developer the following:

```
CLOUD_SQL_CONNECTION_NAME = [from Step 4]
DB_NAME                   = tiredb
DB_USER                   = tireuser
DB_PASSWORD               = [from Step 4]
FIREBASE_PROJECT_ID       = tire-center-dev
ARTIFACT_REGISTRY_REPO    = [region]-docker.pkg.dev/tire-center-dev/tire-center
```

Secrets are already in Secret Manager — the developer reads them from there via Cloud Run env vars, no need to share them directly.