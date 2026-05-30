# StudySphere - Smart Attendance and LMS Platform

StudySphere is a full-stack attendance management and learning management platform for colleges and departments. It combines face-based attendance, academic structure management, teacher/student dashboards, subject classrooms, LMS content, realtime notifications, room chat, quizzes, and reporting in one MERN application.

The LMS is attached directly to the existing academic hierarchy:

```text
Course -> Branch -> Semester -> Subject -> Teachers / Students
```

Every subject can work as a classroom with attendance, materials, assignments, quizzes, announcements, doubts, calendar events, and analytics.

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
  backend/              Express API, Socket.IO, MongoDB models
  frontend/             React + Vite application
  ml-service/           FastAPI face recognition and liveness service
  docker-compose.yml    Optional containerized local stack
  README.md
```

## Prerequisites

- Node.js 18 or newer
- npm
- MongoDB local instance or MongoDB Atlas URI
- Python 3.11, 3.12, or 3.13 for the ML service
- Optional: Docker and Docker Compose

## Environment Variables

Create environment files in each service as needed.

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
ML_KEEPALIVE_URL=https://face-attend-ml-backend.onrender.com/health
ML_KEEPALIVE_INTERVAL_MS=60000
ML_KEEPALIVE_TIMEOUT_MS=10000

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

### Redis Notes

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

WebAuthn/passkey registration only works on `localhost` or HTTPS domains. On deployment, the relying party ID must match the frontend domain, not the Render/backend API domain.

For Vercel + Render, set these backend environment variables on Render:

```env
FRONTEND_URL=https://your-frontend.vercel.app
WEBAUTHN_ORIGIN=https://your-frontend.vercel.app
WEBAUTHN_RP_ID=
```

Leave `WEBAUTHN_RP_ID` empty unless you are intentionally sharing passkeys across subdomains. If you set it, it must be equal to the frontend hostname or a valid parent domain of it.

### Frontend `.env`

```env
VITE_API_URL=http://localhost:5000/api
VITE_SOCKET_URL=http://localhost:5000
# Optional for Render/Vercel if websocket upgrade returns 500
VITE_SOCKET_TRANSPORTS=polling
VITE_SOCKET_DISABLE_UPGRADE=true
```

If the frontend is served behind the same domain/proxy as the backend, both frontend values can be omitted because the app falls back to `/api` and `/`.

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

## Local Setup

### 1. Backend

```bash
cd backend
npm install
npm run seed
npm run dev
```

Backend runs on:

```text
http://localhost:5000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on:

```text
http://localhost:5173
```

### 3. ML Service

```bash
cd ml-service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Or run with Uvicorn:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

ML service runs on:

```text
http://localhost:8000
```

## Docker Setup

The repository includes a `docker-compose.yml` for MongoDB, backend, frontend, and ML service.

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

To start only Redis from Docker Compose:

```bash
docker compose up -d redis
```

Docker Desktop must be running before this command is used.

## Useful Commands

### Backend

```bash
cd backend
npm run dev
npm start
npm run seed
npm run sync:subjects
npm audit --audit-level=moderate
```

### Frontend

```bash
cd frontend
npm run dev
npm run build
npm run preview
npm audit --audit-level=moderate
```

### Backend Syntax Check

```bash
cd backend
node --check server.js
```

## LMS Workflow

1. Admin creates course, branch, semester, subject, and assigns a teacher.
2. Teacher opens the subject classroom from the Subjects page.
3. Teacher creates material, assignment, quiz, or announcement as draft.
4. Teacher publishes when ready.
5. Enrolled students receive realtime updates without refreshing.
6. Students view material, submit assignments, attempt quizzes, and ask doubts.
7. Teacher grades submissions or releases quiz results.
8. Student dashboards and classroom views update with the latest LMS state.

## Quiz Import Format

CSV/XLSX quiz import should include these columns:

```text
Question, Option 1, Option 2, Option 3, Option 4, Correct Option
```

The correct option should match one of the provided options. Manual quiz creation remains available and supports adding or removing options per question.

## Sample Data Files

The repository contains sample import files that can be used for testing:

```text
Project_Management_SDLC_Quiz_15Q.xlsx
Project_Management_Attendance_Import.xlsx
Students_Sem6_BTech_ComputerScience_Import.xlsx
VIT_CSE_Timetable.xlsx
```

## Testing Checklist

Use this checklist after major changes:

- Frontend build passes with `npm run build`.
- Backend starts without syntax/runtime errors.
- Backend and frontend audits pass with no moderate-or-higher vulnerabilities.
- Student can access only enrolled subject classrooms.
- Teacher can manage only assigned subject classrooms.
- Department admin can manage only department-scoped subjects.
- Material draft, publish, delete, and realtime student update work.
- Assignment draft, publish, online/offline submission, lock after submit, grading, feedback, and release work.
- Quiz draft, manual creation, CSV/XLSX import, publish, attempt, close, auto-release, release review, and teacher marks view work.
- Calendar displays assignment, quiz, and announcement events with correct dot indicators.
- Discussion create, reply, resolve, delete, and reply notification work.
- Deadline summary notifications show readable item names and real `submitted/total` or `attempted/total` counts.
- Attendance history date-range fetch shows local loading and returns correct records.
- Mobile subject cards, dashboard cards, classroom tabs, and submission modals do not overlap.

## Pre-Push Checklist

Run these before pushing code:

```bash
cd frontend
npm run build
```

```bash
cd backend
node --check server.js
npm audit --audit-level=moderate
```

```bash
cd frontend
npm audit --audit-level=moderate
```

Then confirm:

- `.env` files are not staged.
- Local uploads/exports are not staged.
- `frontend/dist`, `backend/uploads`, `backend/exports`, caches, and logs are not staged.
- The backend starts with Redis enabled and also works with `CACHE_ENABLED=false`.
- Login works for student, teacher, department admin, and super admin accounts used in testing.

## Security Notes

- Replace default secrets and passwords before production use.
- Keep `.env` files out of version control.
- Use HTTPS in production for camera, biometric, and auth flows.
- Use a strong `JWT_SECRET`.
- Restrict CORS origins to trusted frontend domains.
- Keep MongoDB credentials private and rotate them if exposed.

## Production Notes

- Build the frontend with `npm run build`.
- Run the backend with `NODE_ENV=production`.
- Configure Cloudinary for all uploaded media; the app does not serve local upload folders.
- Configure Redis only through secure environment variables.
- Configure reverse proxy routes for `/api` and Socket.IO.
- Keep the ML service close to the backend for lower latency.
- Add a `/health` monitor for the ML service and use an uptime monitor or paid always-on hosting to avoid cold starts. The backend can also ping `ML_KEEPALIVE_URL` every `60000ms` when `ML_KEEPALIVE_ENABLED=true`.
- Monitor scheduled notification jobs for assignment/quiz deadlines and reminders.
