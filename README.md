# Tire Center

A full-stack Progressive Web App (PWA) for managing tyre-service orders at automotive shops. Mechanics use the app on mobile to receive jobs from the ERP, photograph tyres (via Carool AI analysis), submit diagnoses, and get manager approval — all in real time.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript, Vite, Tailwind CSS v4 |
| Backend | Python 3.11, FastAPI, Uvicorn |
| Database | PostgreSQL (asyncpg) |
| Auth | JWT (python-jose) |
| ERP | SOAP via zeep |
| AI tyre analysis | Carool REST API |
| Push notifications | Firebase Admin SDK |
| Secrets | GCP Secret Manager |
| Hosting | GCP VM / Cloud Run + nginx |

---

## Project Structure

```
tire-center/
├── backend/
│   ├── main.py                 # App entry point, lifespan, router registration
│   ├── config.py               # Loads all secrets from GCP Secret Manager at startup
│   ├── logging_utils.py        # Structured logging helpers
│   ├── adapters/
│   │   ├── erp.py              # SOAP client for ERP (zeep)
│   │   └── carool.py           # Carool AI photo-analysis REST client (httpx)
│   ├── routers/
│   │   ├── auth.py             # POST /api/auth/request-code, /verify
│   │   ├── orders.py           # GET /api/orders
│   │   ├── diagnosis.py        # POST /api/diagnosis
│   │   ├── carool.py           # POST /api/carool/session|photo|finalize
│   │   └── webhooks.py         # POST /api/webhook/erp, /carool
│   ├── middleware/
│   │   └── auth.py             # JWT bearer token dependency
│   ├── models/
│   │   └── schemas.py          # Pydantic request/response models
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/     # React components (Login, Dashboard, Diagnosis, …)
│   │   │   ├── NavigationContext.tsx
│   │   │   └── ThemeContext.tsx
│   │   ├── locales/            # i18n translation files (he, ru, ar)
│   │   └── styles/
│   ├── public/
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── docs/
├── mintlify-docs/              # API reference docs
├── quick-tools.md              # VM commands, deploy steps, tool reference
└── README.md
```

---

## Service-Order Flow

```
ERP → GET /api/orders          (mechanic fetches open jobs)
    → POST /api/carool/session  (open Carool AI session, optional)
    → POST /api/carool/photo    (upload tyre photos, up to 8)
    → POST /api/carool/finalize (trigger async AI analysis)
    ← POST /api/webhook/carool  (Carool fires results back)
    → POST /api/diagnosis       (mechanic submits completed diagnosis → ERP)
    ← POST /api/webhook/erp     (ERP fires approval / decline)
```

---

## Frontend Features

- **PWA** — installable on Android/iOS, works on mobile browsers
- **Multilingual** — Hebrew (default, RTL), Russian, Arabic via i18next
- **Dark / Light theme**
- **Two-step SMS login** — user code → OTP, 15-second rate-limit guard on the login button
- **Drag-and-drop** tyre action assignment (react-dnd)
- **Carool camera flow** — per-wheel photo capture with sidewall + tread uploads
- **Real-time approval status** via Firebase push notifications

---

## Backend Features

- **Stateless JWT auth** — tokens issued after OTP verification, validated on every request
- **ERP SOAP integration** — fetches open orders, submits diagnoses, maps action/reason codes
- **Carool integration** — toggleable via `CAROOL_ENABLED` secret (set to `"0"` to disable)
- **Async PostgreSQL** — asyncpg with connection pooling
- **All secrets from GCP Secret Manager** — no `.env` files; app refuses to start if required secrets are missing

---

## Running Locally

### Backend

Requires Python 3.11+ and a GCP project with the required secrets configured.

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt

# GCP project must be set so config.py can reach Secret Manager
export GCP_PROJECT_ID=your-project-id

uvicorn main:app --reload --port 8080
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api/*` to `http://localhost:8080`.

### Build for production

```bash
cd frontend
npm run build
# Output: frontend/dist/  — deploy to the VM's /home/memla/frontend/dist/
```

---

## Deployment

See **[quick-tools.md](quick-tools.md)** for full VM commands, nginx config, certbot SSL setup, and GCP Secret Manager usage.
