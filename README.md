<div align="center">

# 🎓 StudySphere

### Smart Attendance & Learning Management Platform

_A unified platform combining face-based attendance, classroom management, LMS content, and real-time collaboration for modern colleges._

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

---

## 🏗 Architecture

```
studysphere/
  ├── frontend/         React + Vite SPA
  ├── backend/          Express API + Socket.IO + MongoDB
  ├── ml-service/       FastAPI face recognition + liveness
  └── docker-compose.yml
```

| Service    | Port    | Purpose                      |
| ---------- | ------- | ---------------------------- |
| Frontend   | `5173`  | React + Vite UI              |
| Backend    | `5000`  | Express REST API + Socket.IO |
| ML Service | `8000`  | FastAPI face recognition     |
| MongoDB    | `27017` | Primary database             |
| Redis      | `6379`  | Optional cache layer         |

---

## ✨ Features

### 📸 Attendance

- Face-based student registration and login via the ML service
- Lecture creation, start/stop attendance, and lecture-wise records
- Subject-wise attendance history, date-range filtering, Excel export, and imported attendance support
- Attendance disputes with admin/teacher resolution
- Low-attendance monitoring and notifications

### 📚 LMS Classrooms

- Shared `Subject Classroom` page for admin, teacher, and student roles
- Tabs: **Overview · Attendance · Materials · Assignments · Quizzes · Calendar · Doubts · Analytics**
- Student view scoped to enrolled subjects; teacher view scoped to assigned subjects
- Department admin view scoped to department subjects

### 📂 Materials

- Organize material in folders, create as draft, publish later, and delete
- Supports uploaded files and links — PDF, image, video, Excel, and notes
- Tag materials by topic/unit (e.g. `Unit 1`, `SDLC`, `Agile`)
- Real-time updates push published material to enrolled students

### 📝 Assignments

- Draft → publish workflow with title, instructions, due date, marks, tags, and attachments
- `offline` and `online` submission modes
- Submissions locked after student submits; staff can grade, give feedback, and release results
- Submission counts visible on assignment cards

### 🧠 Quizzes

- Manual creation or CSV/XLSX import
- Draft → publish → attempt → close → release lifecycle
- Timer support, shuffled questions, tab-switch warnings, one-question-at-a-time mode
- Post-release review showing selected answers, correct answers, and explanations
- Teacher marks view per student after release

### 📅 LMS Calendar

- Shows assignment dates/deadlines, quiz open/close dates, and announcements
- Blinking dots for active assignments/quizzes until deadline or close time

### 💬 Doubts and Discussions

- Students create doubts inside subject classrooms
- Teacher/admin can reply, resolve, and delete discussions
- Notifications sent to students when staff replies

### 🔔 Real-time Notifications

- Socket.IO for role-scoped real-time updates
- RTK Query for shared API cache and targeted invalidation
- Deadline summary notifications with readable names and real completion counts

### 📊 Dashboards

| Role            | Dashboard Contents                                                                 |
| --------------- | ---------------------------------------------------------------------------------- |
| **Student**     | Attendance progress, pending work, recent materials, grades, quiz/assignment state |
| **Teacher**     | Lectures, low attendance, pending submissions, quiz summaries, doubts              |
| **Dept. Admin** | LMS overview, classroom monitoring, teacher activity, completion stats             |
| **Super Admin** | Global system scope, academic and admin controls                                   |

---

## 🛠 Tech Stack

### Frontend

![React](https://img.shields.io/badge/-React_18-20232A?logo=react&logoColor=61DAFB)
![Vite](https://img.shields.io/badge/-Vite-646CFF?logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/-Tailwind-06B6D4?logo=tailwindcss&logoColor=white)
![Redux](https://img.shields.io/badge/-RTK_Query-764ABC?logo=redux&logoColor=white)
![Framer](https://img.shields.io/badge/-Framer_Motion-0055FF?logo=framer&logoColor=white)
![Recharts](https://img.shields.io/badge/-Recharts-22B5BF)
![Socket.IO](https://img.shields.io/badge/-Socket.IO_Client-010101?logo=socketdotio&logoColor=white)

### Backend

![Node.js](https://img.shields.io/badge/-Node.js-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/-Express-000000?logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/-MongoDB-47A248?logo=mongodb&logoColor=white)
![Redis](https://img.shields.io/badge/-Redis-DC382D?logo=redis&logoColor=white)
![JWT](https://img.shields.io/badge/-JWT-000000?logo=jsonwebtokens&logoColor=white)
![Socket.IO](https://img.shields.io/badge/-Socket.IO-010101?logo=socketdotio&logoColor=white)
![ExcelJS](https://img.shields.io/badge/-ExcelJS-217346?logo=microsoftexcel&logoColor=white)
![Cloudinary](https://img.shields.io/badge/-Cloudinary-3448C5?logo=cloudinary&logoColor=white)

### ML Service

![Python](https://img.shields.io/badge/-Python-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/-FastAPI-009688?logo=fastapi&logoColor=white)
![OpenCV](https://img.shields.io/badge/-OpenCV-5C3EE8?logo=opencv&logoColor=white)
![ONNX](https://img.shields.io/badge/-ONNX_Runtime-005CED)

---

## 📁 Project Structure

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

## ✅ Prerequisites

| Requirement         | Version                     |
| ------------------- | --------------------------- |
| Node.js             | 18 or newer                 |
| npm                 | Latest                      |
| MongoDB             | Local instance or Atlas URI |
| Python              | 3.11, 3.12, or 3.13         |
| Docker _(optional)_ | Latest                      |

---

## 🔐 Environment Variables

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

Redis is **optional** and used as a speed layer only. MongoDB remains the source of truth. The app gracefully falls back to MongoDB when Redis is unavailable.

| Scenario                    | Config                                                            |
| --------------------------- | ----------------------------------------------------------------- |
| Local dev without Redis     | `CACHE_ENABLED=false`                                             |
| Hosted Redis (e.g. Upstash) | `REDIS_URL=rediss://default:<password>@<host>:6379`               |
| Check cache status          | `GET /api/ready` → reports `connected`, `fallback`, or `disabled` |

### 🔒 Biometric Deployment Notes

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

| Service    | URL                   |
| ---------- | --------------------- |
| Frontend   | http://localhost:5173 |
| Backend    | http://localhost:5000 |
| ML Service | http://localhost:8000 |
| MongoDB    | localhost:27017       |

To start only Redis:

```bash
docker compose up -d redis
```

> Docker Desktop must be running before this command.

---

## 📖 LMS Workflow

```
1. Admin creates Course → Branch → Semester → Subject → assigns Teacher
2. Teacher opens the subject classroom from the Subjects page
3. Teacher creates Material / Assignment / Quiz / Announcement as draft
4. Teacher publishes when ready
5. Enrolled students receive real-time updates without refreshing
6. Students view material, submit assignments, attempt quizzes, and ask doubts
7. Teacher grades submissions or releases quiz results
8. Student dashboards and classroom views reflect the latest LMS state
```

---

## 📊 Quiz Import Format

CSV/XLSX quiz import columns:

| Column           | Description                                    |
| ---------------- | ---------------------------------------------- |
| `Question`       | The question text                              |
| `Option 1`       | First answer choice                            |
| `Option 2`       | Second answer choice                           |
| `Option 3`       | Third answer choice                            |
| `Option 4`       | Fourth answer choice                           |
| `Correct Option` | Must match one of the provided options exactly |

Manual quiz creation is also available and supports variable option counts per question.

---

## 📁 Sample Data Files

| File                                              | Purpose                    |
| ------------------------------------------------- | -------------------------- |
| `Project_Management_SDLC_Quiz_15Q.xlsx`           | Sample quiz import         |
| `Project_Management_Attendance_Import.xlsx`       | Sample attendance import   |
| `Students_Sem6_BTech_ComputerScience_Import.xlsx` | Sample student bulk import |
| `VIT_CSE_Timetable.xlsx`                          | Sample timetable           |

---

## 🧪 Testing Checklist

Use this checklist after major changes:

- [ ] Frontend build passes with `npm run build`
- [ ] Backend starts without syntax/runtime errors
- [ ] Backend and frontend audits pass with no moderate-or-higher vulnerabilities
- [ ] Student can access only enrolled subject classrooms
- [ ] Teacher can manage only assigned subject classrooms
- [ ] Department admin can manage only department-scoped subjects
- [ ] Material draft, publish, delete, and real-time student update work
- [ ] Assignment draft, publish, online/offline submission, lock after submit, grading, feedback, and release work
- [ ] Quiz draft, manual creation, CSV/XLSX import, publish, attempt, close, auto-release, release review, and teacher marks view work
- [ ] Calendar displays assignment, quiz, and announcement events with correct dot indicators
- [ ] Discussion create, reply, resolve, delete, and reply notification work
- [ ] Deadline summary notifications show readable item names and real `submitted/total` or `attempted/total` counts
- [ ] Attendance history date-range fetch shows local loading and returns correct records
- [ ] Mobile subject cards, dashboard cards, classroom tabs, and submission modals do not overlap

---

## ✅ Pre-Push Checklist

Run these before every push:

```bash
# 1. Build frontend
cd frontend && npm run build

# 2. Check backend syntax
cd backend && node --check server.js

# 3. Audit both services
cd backend && npm audit --audit-level=moderate
cd frontend && npm audit --audit-level=moderate
```

Then confirm:

- [ ] `.env` files are **not** staged
- [ ] Local uploads/exports are **not** staged
- [ ] `frontend/dist`, `backend/uploads`, `backend/exports`, caches, and logs are **not** staged
- [ ] Backend starts with Redis enabled **and** also works with `CACHE_ENABLED=false`
- [ ] Login works for student, teacher, department admin, and super admin accounts

---

## 🔒 Security Notes

> Replace all default secrets and passwords before any production deployment.

- Keep `.env` files out of version control (use `.gitignore`)
- Use HTTPS in production for camera, biometric, and auth flows
- Use a strong, randomly generated `JWT_SECRET`
- Restrict CORS origins to trusted frontend domains only
- Keep MongoDB credentials private and rotate immediately if exposed
- Store all uploaded media in Cloudinary — never serve local upload folders

---

## 🚢 Production Notes

| Step              | Details                                                            |
| ----------------- | ------------------------------------------------------------------ |
| Frontend build    | `npm run build` in `/frontend`                                     |
| Backend mode      | `NODE_ENV=production`                                              |
| Media storage     | Configure Cloudinary — local upload folders are not served         |
| Redis             | Configure only via secure environment variables                    |
| Reverse proxy     | Route `/api` and Socket.IO upgrades through your proxy             |
| ML service        | Keep close to backend for lower latency                            |
| ML keep-alive     | Set `ML_KEEPALIVE_ENABLED=true` to avoid cold starts on free tiers |
| Health monitoring | Add `/health` monitor for the ML service                           |
| Scheduled jobs    | Monitor assignment/quiz deadline notification jobs                 |

---

## 📦 Useful Commands

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
