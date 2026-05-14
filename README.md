# FaceAttend — Attendance Management System 

## Python Version
> ⚠️  Use **Python 3.13** (or 3.11/3.12). Previous versions used `dlib` + `face-recognition` +
> `mediapipe` which all fail on 3.13. This version uses **InsightFace + ONNX Runtime** instead.

---

## 1 — Backend (Node.js)

```bash
cd backend
cp .env.example .env        # fill in MONGO_URI, JWT_SECRET, ML_SERVICE_URL, FRONTEND_URL
npm install
npm run seed                # creates default admin: admin@faceattend.com / admin123
npm run dev                 # http://localhost:5000
```

---

## 2 — Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

---

## 3 — ML Service (Python 3.13)

### Step 1 — Create virtual environment

```bash
cd ml-service
python -m venv venv

# macOS / Linux
source venv/bin/activate

# Windows
venv\Scripts\activate
```

### Step 2 — Install all dependencies (no compiler needed!)

```bash
pip install -r requirements.txt
```

InsightFace installs via pre-built ONNX wheels. No CMake, no C++ compiler, no dlib required.

### Step 3 — Configure environment

```bash
cp .env.example .env
# Set ANTHROPIC_API_KEY if you want the AI analysis feature (optional)
```

### Step 4 — Start the ML service

```bash
python main.py
```

Or with uvicorn directly:

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Expected startup output:
```
✅ LivenessDetector initialized (vectorised OpenCV/NumPy)
✅ BodyLanguageAnalyzer initialized (OpenCV Haar + HOG)
✅ ImageProcessor initialized
✅ InsightFace loaded successfully
✅ FaceAnalyzer ready (InsightFace / CPU)
🚀 Starting FaceAttend ML Service v3.0 on port 8000
🐍 Python 3.13 compatible — using InsightFace + ONNX Runtime
```

> On first run, InsightFace will download the `buffalo_sc` model (~20 MB) automatically.

---

## Backend .env

```
PORT=5000
MONGO_URI=mongodb://localhost:27017/attendance_db
JWT_SECRET=change_this_to_something_long_and_random
JWT_EXPIRE=7d
ML_SERVICE_URL=http://localhost:8000
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
ADMIN_EMAIL=admin@school.edu
ADMIN_PASSWORD=Admin@123456
ADMIN_NAME=System Administrator
DEPARTMENT_ADMIN_PASSWORD=Dept@123456
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_FOLDER=faceattend
```

Student profile photos and verified attendance captures are uploaded to Cloudinary. The backend keeps only Cloudinary URLs/public IDs in MongoDB and uses temporary local files only while validating or uploading images.

Department admin accounts are created by `npm run seed`:

| Department | Email |
|---|---|
| Computer Science | cse.admin@school.edu |
| Information Technology | it.admin@school.edu |
| Electronics | electronics.admin@school.edu |
| Mechanical | mechanical.admin@school.edu |
| Civil | civil.admin@school.edu |
| Chemical | chemical.admin@school.edu |
| Electrical | electrical.admin@school.edu |

All department admins use `DEPARTMENT_ADMIN_PASSWORD` by default and can manage only their own department's students, subjects, lectures, attendance, and analytics.

---

## All Bugs Fixed in v3.0

| # | Bug | Fix |
|---|-----|-----|
| 1 | Lectures not showing on student dashboard | `getDashboard` now returns `allLectures` + `upcomingLectures`. Dashboard UI has a new "Recent Lectures" card |
| 2 | Socket join fires before user loads | `SocketContext` now waits for `user._id` before connecting |
| 3 | `GET /subjects/my-subjects` hits `/:id` route | Static routes placed before parameterised in all route files |
| 4 | `reject` used `DELETE` with body (stripped by some clients) | Changed to `PUT /students/:id/reject` in route + frontend |
| 5 | `subjectController` had no try/catch | Full error handling added |
| 6 | `dlib` / `face-recognition` / `mediapipe` fail on Python 3.13 | Replaced with InsightFace + ONNX Runtime (no compiler, works on 3.13) |
| 7 | Liveness detector Python pixel loop (timeout) | Fully vectorised NumPy LBP — 100-500× faster |
| 8 | MediaPipe body language fails on 3.13 | Replaced with OpenCV Haar cascade + HOG detector |
| 9 | AI assistant blocks FastAPI event loop | All Anthropic SDK calls run via `asyncio.to_thread()` |
| 10 | Controllers missing try/catch | All controllers now have full error handling |
| 11 | Null io guard missing | All socket emits guarded with `if (io)` |
| 12 | Notification route ordering bug | Static routes before `/:id/read` |
