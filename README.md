# OJT Progress Tracker

A full-stack web application for tracking On-the-Job Training (OJT) hours, accomplishments, and progress for each trainee.

## Tech Stack

| Layer     | Technology                          |
| --------- | ----------------------------------- |
| Frontend  | Next.js 14 (App Router, TypeScript) |
| Backend   | Node.js + Express (TypeScript)      |
| Database  | PostgreSQL                          |
| ORM       | Prisma                              |
| Deploy    | Railway (or any Node host)          |

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

## Deployment (Railway)

1. Push the repo to GitHub.
2. Create a **Railway** project and link the repo.
3. Add a **PostgreSQL** plugin; Railway sets `DATABASE_URL` automatically.
4. Set environment variables (`PORT`, `FRONTEND_URL`).
5. Configure build & start commands for each service:
   - **Backend**: build `npm run build`, start `npm start`
   - **Frontend**: build `npm run build`, start `npm start`

---

## License

MIT
