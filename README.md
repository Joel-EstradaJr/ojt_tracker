# OJT Progress Tracker

A full-stack web application for tracking On-the-Job Training (OJT) hours, accomplishments, and progress for each trainee.

## Tech Stack

| Layer     | Technology                          |
| --------- | ----------------------------------- |
| Frontend  | Next.js 14 (App Router, TypeScript) |
| Backend   | Node.js + Express (TypeScript)      |
| Database  | PostgreSQL                          |
| ORM       | Prisma                              |
| Deploy    | Vercel (Frontend) + Render (Backend) + Supabase (DB) |

## Features

- **Trainee cards** with progress bars on a dashboard
- **Password-protected** access per trainee (bcrypt hashed)
- **Time logging** with auto-calculated hours
- **Export** logs to CSV, Excel (.xlsx), and PDF
- **Import** logs from a CSV file
- **Cascade delete** – removing a trainee also removes their logs

---

## Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9 (or yarn / pnpm)
- **PostgreSQL** running locally or a remote connection string

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Joel-EstradaJr/ojt_tracker.git
cd ojt_tracker
```

### 2. Set up the database

Create a PostgreSQL database (e.g. `ojt_tracker`), then copy the env example:

```bash
cp .env.example backend/.env
```

Edit `backend/.env` and set your connection string:

```
DATABASE_URL=postgresql://user:password@localhost:5432/ojt_tracker
PORT=4000
FRONTEND_URL=http://localhost:3000
```

### 3. Install dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 4. Run Prisma migrations

```bash
cd backend
npx prisma migrate dev --name init
```

This creates the database tables and generates the Prisma client.

### 5. Start the servers

In **two separate terminals**:

```bash
# Terminal 1 — Backend (http://localhost:4000)
cd backend
npm run dev

# Terminal 2 — Frontend (http://localhost:3000)
cd frontend
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Project Structure

```
ojt-progress-tracker/
├── frontend/
│   ├── app/                  # Next.js App Router pages
│   │   ├── layout.tsx
│   │   ├── page.tsx          # Dashboard (landing)
│   │   ├── globals.css
│   │   └── trainee/[id]/
│   │       └── page.tsx      # Trainee detail page
│   ├── components/           # Reusable UI components
│   ├── lib/                  # API helpers
│   ├── types/                # Shared TypeScript types
│   ├── package.json
│   └── tsconfig.json
│
├── backend/
│   ├── src/
│   │   ├── controllers/      # Request handlers
│   │   ├── routes/           # Express route definitions
│   │   ├── middleware/        # Multer upload, etc.
│   │   ├── utils/            # Prisma client singleton
│   │   └── server.ts         # Express entry point
│   ├── prisma/
│   │   └── schema.prisma     # Database schema
│   ├── package.json
│   └── tsconfig.json
│
├── .env.example
├── .gitignore
└── README.md
```

---

## API Endpoints

### Trainees

| Method | Path                     | Description              |
| ------ | ------------------------ | ------------------------ |
| POST   | `/trainees`              | Create trainee           |
| GET    | `/trainees`              | List all trainees        |
| GET    | `/trainees/:id`          | Get trainee by ID        |
| POST   | `/trainees/:id/verify`   | Verify trainee password  |
| DELETE | `/trainees/:id`          | Delete trainee + logs    |

### Logs

| Method | Path              | Description               |
| ------ | ----------------- | ------------------------- |
| POST   | `/logs`           | Create a log entry        |
| GET    | `/logs/:traineeId`| Get all logs for trainee  |
| PUT    | `/logs/:id`       | Update a log entry        |
| DELETE | `/logs/entry/:id` | Delete a log entry        |

### Export

| Method | Path                        | Description        |
| ------ | --------------------------- | ------------------ |
| GET    | `/export/csv/:traineeId`    | Download CSV       |
| GET    | `/export/excel/:traineeId`  | Download Excel     |
| GET    | `/export/pdf/:traineeId`    | Download PDF       |

### Import

| Method | Path                        | Description                 |
| ------ | --------------------------- | --------------------------- |
| POST   | `/import/csv/:traineeId`    | Upload CSV (multipart form) |

---

## CSV Import Format

The CSV file should have these columns:

```csv
date,timeIn,timeOut,accomplishments
2026-03-01,2026-03-01T08:00:00,2026-03-01T17:00:00,Worked on project setup
```

---

## Deployment (Vercel + Render + Supabase)

### Database (Supabase)

1. Create a Supabase project.
2. Get the Postgres connection string from **Project Settings → Database**.
3. Use that connection string as the backend `DATABASE_URL` (Supabase typically requires SSL, so include `?sslmode=require` if it’s not already present).

### Backend (Render)

Create a new Render Web Service with **Root Directory** = `backend`.

Render commands (backend service):
- Build: `npm ci --include=dev && npm run build`
- Start: `npm start` (runs `prisma migrate deploy` automatically)
- Health check: `/health`

Backend environment variables on Render:
- `DATABASE_URL` = Supabase connection string
- `FRONTEND_URL` = your Vercel frontend URL (e.g. `https://<project>.vercel.app`)
- `JWT_SECRET`, `JWT_EXPIRY`, `SUPER_NAME`, `SUPER_PASSWORD`
- `SMTP_EMAIL`, `SMTP_PASSWORD` (used for admin-triggered emails)
- `EMAIL_INTERNAL_KEY` (must match Vercel)

### Frontend (Vercel)

Deploy the `frontend/` project to Vercel.

Frontend environment variables on Vercel:
- `BACKEND_URL` = your Render backend URL (e.g. `https://<service>.onrender.com`)
- `SMTP_EMAIL`, `SMTP_PASSWORD` (used by Vercel API routes for verification emails)
- `EMAIL_INTERNAL_KEY` (must match Render)

Notes:
- The frontend uses Next.js rewrites to proxy `/api/*` to the backend, while some `/api/...` endpoints are implemented as Vercel API routes (email-related flows).
- After changing env vars on Vercel/Render, redeploy/restart for them to take effect.

---

## License

MIT
