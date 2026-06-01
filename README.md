<div align="center">

# 🎓 StudySphere

### Smart Attendance & Learning Management Platform

*A unified platform combining face-based attendance, classroom management, LMS content, and real-time collaboration for modern colleges.*

[![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)

[![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

[![Vite](https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)
[![Redux](https://img.shields.io/badge/Redux_Toolkit-764ABC?style=for-the-badge&logo=redux&logoColor=white)](https://redux-toolkit.js.org/)

[![JWT](https://img.shields.io/badge/JWT-000000?style=for-the-badge&logo=jsonwebtokens&logoColor=white)](https://jwt.io/)
[![Cloudinary](https://img.shields.io/badge/Cloudinary-3448C5?style=for-the-badge&logo=cloudinary&logoColor=white)](https://cloudinary.com/)
[![Mongoose](https://img.shields.io/badge/Mongoose-880000?style=for-the-badge&logo=mongoose&logoColor=white)](https://mongoosejs.com/)
[![Framer Motion](https://img.shields.io/badge/Framer_Motion-0055FF?style=for-the-badge&logo=framer&logoColor=white)](https://www.framer.com/motion/)

![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=flat-square&logo=nodedotjs)
![Python Version](https://img.shields.io/badge/python-3.11%20%7C%203.12%20%7C%203.13-blue?style=flat-square&logo=python)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Environment Variables](#-environment-variables)
- [Local Setup](#-local-setup)
- [Docker Setup](#-docker-setup)
- [LMS Workflow](#-lms-workflow)
- [Quiz Import Format](#-quiz-import-format)
- [Sample Data Files](#-sample-data-files)
- [Testing Checklist](#-testing-checklist)
- [Pre-Push Checklist](#-pre-push-checklist)
- [Security Notes](#-security-notes)
- [Production Notes](#-production-notes)

---

## 🌐 Overview

StudySphere is a full-stack **attendance management** and **learning management platform** built for colleges and departments. It combines face-based attendance, academic structure management, teacher/student dashboards, subject classrooms, LMS content, real-time notifications, room chat, quizzes, and reporting — all in one MERN application.

The LMS is attached directly to the existing academic hierarchy:

```
Course → Branch → Semester → Subject → Teachers / Students
```

Every subject functions as a full classroom with attendance, materials, assignments, quizzes, announcements, doubts, calendar events, and analytics.

## Push-Ready Notes

- Do not commit `.env` files, local media, generated exports, logs, caches, or build output.
- Uploaded media should be stored in Cloudinary or another cloud provider, not in local `uploads`, `captures`, `chat-media`, or LMS media folders.
- MongoDB remains the source of truth. Redis is optional and should only be used as a cache/temp-data layer.
- The app should continue working if Redis is disabled with `CACHE_ENABLED=false`.
- Before pushing, run the build/check commands in the **Pre-Push Checklist** section.

## Current Capabilities

### Attendance

- Face-based student registration and login support through the ML service.
- Lecture creation, start/stop attendance, and lecture-wise attendance records.
- Subject-wise attendance history, date-range filtering, Excel export, and imported attendance support.
- Attendance disputes with admin/teacher resolution.
- Low-attendance monitoring and notifications.

### LMS Classrooms

- Shared `Subject Classroom` page for admin, teacher, and student roles.
- Classroom tabs: Overview, Attendance, Materials, Assignments, Quizzes, Calendar, Doubts, and Analytics.
- Student view is scoped to enrolled subjects.
- Teacher view is scoped to assigned subjects.
- Department admin view is scoped to department subjects.
- Students do not see classroom analytics; analytics are for staff/admin workflows.

### Materials

- Teacher/admin can organize material in folders, create material as draft, publish it later, and delete it.
- Supports uploaded files and links such as PDF, image, video, Excel, and notes.
- Materials can be tagged by topic/unit such as `Unit 1`, `SDLC`, or `Agile`.
- Published material is reflected to target students through realtime updates.

### Assignments

- Teacher/admin can create assignments as drafts and publish later.
- Supports title, instructions, due date, marks, topic tags, attachments, and submission mode.
- Submission mode can be `offline` or `online`.
- Offline assignments do not show file upload controls on the student side.
- Once a student marks/submits an assignment, it is locked from further editing.
- Staff can view submissions, grade, provide feedback, and release results.
- Assignment cards include submission counts and staff submission views.

### Quizzes

- Teacher/admin can create quizzes manually or import from CSV/XLSX.
- Manual quiz creation supports editable question/options and variable option count.
- Import format supports question, options, and correct option.
- Quizzes can be drafted, published, attempted, closed, and released.
- Quiz controls include timer support, shuffled question order, tab-switch warnings, and one-question-at-a-time mode.
- Active quiz cards expand for better attempt UX.
- After release, students can review selected answers, correct answers, and explanations where available.
- After release or expiry, completed quizzes cannot be attempted again.
- Teacher/admin can view marks for each student after release.

### LMS Calendar

- Calendar shows assignment dates, assignment deadlines, quiz open/close dates, and announcements.
- Dots indicate event types and active/deadline states.
- Active assignment/quiz dots blink until the deadline or close time is reached.
- Clicking a date shows the events scheduled for that date.
- Lectures are intentionally excluded from the LMS calendar.

### Doubts and Discussions

- Students can create doubts inside a subject classroom.
- Teacher/admin can reply, resolve, and delete discussions.
- Students receive notifications when a staff member replies.
- Teacher dashboard can surface open/unread doubts.

### Realtime Notifications

- Socket.IO is used for role-scoped realtime updates.
- Redux Toolkit and RTK Query are used on the frontend for shared API cache/state, request reuse, and targeted invalidation.
- Students receive realtime updates for published materials, assignments, quizzes, announcements, grades, and discussion replies.
- Teacher profiles do not receive a popup for every individual assignment/quiz submission.
- Teachers receive one summary notification when an assignment deadline or quiz close time is reached.
- Deadline summaries use readable assignment/quiz names and real completion counts.

### Dashboards

- Student dashboard includes attendance progress, enrolled subjects, pending LMS work, recent materials, grades, and quiz/assignment state.
- Teacher dashboard includes lectures, assigned subjects, low attendance, pending submissions, quiz summaries, and doubts.
- Department admin dashboard includes LMS overview, classroom monitoring, teacher activity, assignment/quiz completion, and announcement moderation.
- Super admin manages global system scope and academic/admin controls.

### UI and UX

- Responsive dark-themed interface built with React, Tailwind CSS, Framer Motion, and Lucide icons.
- Mobile views use smaller cards/text, horizontal scrolling where needed, and compact action icons.
- Classroom metric cards are compact and horizontally scrollable on mobile.
- Assignment and quiz cards use responsive grids with scroll behavior on smaller screens.
- Loading states are shown near the data being fetched instead of relying on a global top progress line.
- Browser zoom is disabled at the app shell level for consistent layout behavior.

## Tech Stack

### Frontend

- React 18
- Vite
- Tailwind CSS
- React Router
- Redux Toolkit and RTK Query
- Axios
- Socket.IO Client
- Framer Motion
- Lucide React
- Recharts
- React Hot Toast

### Backend

- Node.js
- Express
- MongoDB with Mongoose
- JWT authentication
- Socket.IO
- Redis cache support
- Multer uploads
- ExcelJS import/export
- Nodemailer
- Helmet, CORS, rate limiting, and validation middleware

### ML Service

- Python FastAPI
- InsightFace and ONNX Runtime
- OpenCV and NumPy
- Liveness checks and face matching helpers
- Optional AI analysis hooks

## Project Structure

```text
studysphere/
├── backend/                    # Express API, Socket.IO, MongoDB models
│   ├── controllers/
│   ├── models/
│   ├── routes/
│   ├── middleware/
│   ├── utils/
│   └── server.js
├── frontend/                   # React + Vite application
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── store/              # Redux Toolkit + RTK Query
│   │   └── main.jsx
│   └── vite.config.js
├── ml-service/                 # FastAPI face recognition + liveness
│   ├── main.py
│   └── requirements.txt
├── docker-compose.yml          # Containerized local stack
└── README.md
```

---

## Prerequisites

- Node.js 18 or newer
- npm
- MongoDB local instance or MongoDB Atlas URI
- Python 3.11, 3.12, or 3.13 for the ML service
- Optional: Docker and Docker Compose

## Environment Variables

> ⚠️ Never commit `.env` files to version control.

### Backend `.env`

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/attendance_system
JWT_SECRET=change_this_secret
JWT_EXPIRE=7d
FRONTEND_URL=http://localhost:5173
ML_SERVICE_URL=http://localhost:8000

# Biometric/passkey login
# In production, set FRONTEND_URL/WEBAUTHN_ORIGIN to the exact deployed frontend origin.
# Example: https://your-app.vercel.app
WEBAUTHN_ORIGIN=http://localhost:5173
# Optional. Usually leave empty so the backend derives it from the trusted frontend domain.
WEBAUTHN_RP_ID=

# Optional ML keep-alive ping from the Node backend
ML_KEEPALIVE_ENABLED=true
ML_KEEPALIVE_URL=https://ml-service.com/health
ML_KEEPALIVE_INTERVAL_MS=30000
ML_KEEPALIVE_TIMEOUT_MS=45000

# Optional Mongo tuning
DNS_SERVERS=1.1.1.1,8.8.8.8
MONGO_MAX_POOL_SIZE=50
MONGO_MIN_POOL_SIZE=5

# Optional mail/cloud integrations
EMAIL_HOST=
EMAIL_PORT=
EMAIL_USER=
EMAIL_PASS=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_FOLDER=studysphere

# Optional Redis cache
REDIS_URL=redis://127.0.0.1:6379
CACHE_ENABLED=true
CACHE_DEFAULT_TTL_SECONDS=60
REDIS_MAX_WAIT_MS=30000
REDIS_CONNECT_TIMEOUT_MS=1500
REDIS_COMMAND_TIMEOUT_MS=1200
REDIS_RETRY_COOLDOWN_MS=60000

# Seed defaults
ADMIN_EMAIL=admin@school.edu
ADMIN_PASSWORD=Admin@123456
ADMIN_NAME=System Administrator
DEPARTMENT_ADMIN_PASSWORD=Dept@123456
```

### 🔴 Redis Notes

Redis is optional. Use it for caching dashboards, classroom summaries, notification counts, chat summaries, OTP/temp data, and future Socket.IO scaling. Do not use Redis as the primary database.

For local development without Redis:

```env
CACHE_ENABLED=false
```

For a hosted Redis provider such as Upstash, use the Redis database connection string in `REDIS_URL`. It usually starts with `redis://` or `rediss://`. Do not paste a `redis-cli ...` command into `REDIS_URL`.

Example:

```env
REDIS_URL=rediss://default:<password>@<host>:6379
CACHE_ENABLED=true
```

If your local network blocks the hosted Redis TCP connection, keep `CACHE_ENABLED=false` locally and enable Redis only in deployment.

In production, Redis is treated as an optional speed layer. MongoDB remains the source of truth. If Redis is unavailable or slow, the backend falls back to MongoDB instead of failing the request. `REDIS_MAX_WAIT_MS` caps Redis waits at 30 seconds even if a larger timeout is accidentally configured; keep the connect/command values low for better user-facing performance. Check `/api/ready`; it reports `cache: "connected"`, `cache: "fallback"`, or `cache: "disabled"`.

### Biometric Deployment Notes

WebAuthn/passkey registration requires `localhost` or HTTPS. For Vercel + Render deployments:

```env
FRONTEND_URL=https://your-frontend.vercel.app
WEBAUTHN_ORIGIN=https://your-frontend.vercel.app
WEBAUTHN_RP_ID=
```

Leave `WEBAUTHN_RP_ID` empty unless intentionally sharing passkeys across subdomains.

### Frontend `.env`

```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
# Optional for Render/Vercel if websocket upgrade returns 500
VITE_SOCKET_TRANSPORTS=polling
VITE_SOCKET_DISABLE_UPGRADE=true
```

> If the frontend is served behind the same domain/proxy as the backend, both values can be omitted — the app falls back to `/api` and `/`.

### ML Service `.env`

```env
PORT=8000
FACE_RECOGNITION_TOLERANCE=0.42
FACE_RECOGNITION_MODEL=large
LIVENESS_THRESHOLD=0.60
MIN_FACE_CONFIDENCE=0.55

# Optional AI assistant integration
ANTHROPIC_API_KEY=
```

---

## 🚀 Local Setup

### 1. Backend

```bash
cd backend
npm install
npm run seed
npm run dev
```

> Runs at **http://localhost:5000**

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

> Runs at **http://localhost:5173**

### 3. ML Service

```bash
cd ml-service
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
python main.py
```

Or with Uvicorn:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

> Runs at **http://localhost:8000**

---

## 🐳 Docker Setup

```bash
docker compose up --build
```

Default exposed services:

```text
Frontend:   http://localhost:5173
Backend:    http://localhost:5000
ML Service: http://localhost:8000
MongoDB:    localhost:27017
```

To start only Redis:

```bash
docker compose up -d redis
```

Docker Desktop must be running before this command is used.

## Useful Commands

### Backend

```bash
cd backend
npm run dev            # Start with hot reload
npm start              # Start production
npm run seed           # Seed initial data
npm run sync:subjects  # Sync subject enrollments
npm audit --audit-level=moderate
node --check server.js # Syntax check
```

### Frontend

```bash
cd frontend
npm run dev     # Start dev server
npm run build   # Production build
npm run preview # Preview production build locally
npm audit --audit-level=moderate
```

---

## 📝 Push-Ready Notes

- Do **not** commit `.env` files, local media, generated exports, logs, caches, or build output
- Uploaded media must be stored in Cloudinary, not in local `uploads`, `captures`, `chat-media`, or LMS media folders
- MongoDB is the source of truth — Redis is a cache/temp-data layer only
- The app must continue working if Redis is disabled with `CACHE_ENABLED=false`
- Run the build/check commands in the **Pre-Push Checklist** before every push

---

<div align="center">

Made with ❤️ for modern education

</div>
