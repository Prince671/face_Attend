import os
import json
import asyncio
import logging
import requests

logger = logging.getLogger(__name__)


class AIAssistant:
    """
    AI helper for timetable/image analysis.

    OpenRouter is the only AI provider used by the application. The configured
    model must support the modality being requested, especially timetable image
    analysis.
    """

    def __init__(self):
        self.openrouter_api_key = os.getenv("OPENROUTER_API_KEY") or ""
        self.openrouter_model = os.getenv("OPENROUTER_MODEL", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free")
        fallback_value = os.getenv("OPENROUTER_FALLBACK_MODELS", "openrouter/free")
        self.openrouter_fallback_models = [
            model.strip()
            for model in fallback_value.split(",")
            if model.strip()
        ]
        self.openrouter_base_url = os.getenv("OPENROUTER_API_BASE", "https://openrouter.ai/api/v1")
        self.openrouter_site_url = os.getenv("OPENROUTER_SITE_URL", "http://localhost:5173")
        self.openrouter_app_name = os.getenv("OPENROUTER_APP_NAME", "StudySphere")

        if self.openrouter_api_key:
            logger.info("AIAssistant initialized with OpenRouter model %s", self.openrouter_model)
        else:
            logger.warning("AIAssistant: OPENROUTER_API_KEY is not set")

    def _is_available(self) -> bool:
        return bool(self.openrouter_api_key)

    @staticmethod
    def _clean_json(text: str) -> dict:
        text = (text or "").strip()
        if "```" in text:
            parts = text.split("```")
            text = parts[1] if len(parts) > 1 else text
            if text.strip().lower().startswith("json"):
                text = text.strip()[4:]
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start:end + 1]
        return json.loads(text.strip())

    def _generate_openrouter_content(
        self,
        prompt: str,
        base64_image: str | None = None,
        media_type: str = "image/jpeg",
        max_tokens: int = 2048,
        response_mime_type: str = "application/json",
        model: str | None = None,
    ) -> str:
        content = [{"type": "text", "text": prompt}]
        if base64_image:
            content.insert(0, {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{media_type or 'image/jpeg'};base64,{base64_image}"
                },
            })

        payload = {
            "model": model or self.openrouter_model,
            "messages": [{"role": "user", "content": content}],
            "temperature": 0.1,
            "max_tokens": max_tokens,
        }
        if response_mime_type == "application/json":
            payload["response_format"] = {"type": "json_object"}

        response = requests.post(
            f"{self.openrouter_base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.openrouter_api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": self.openrouter_site_url,
                "X-Title": self.openrouter_app_name,
            },
            json=payload,
            timeout=120,
        )
        response.raise_for_status()
        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            raise ValueError("OpenRouter returned no choices")
        message = choices[0].get("message") or {}
        text = message.get("content") or ""
        if isinstance(text, list):
            text = "".join(part.get("text", "") for part in text if isinstance(part, dict))
        if not text:
            text = message.get("reasoning") or message.get("reasoning_content") or ""
        if isinstance(text, list):
            text = "".join(part.get("text", "") for part in text if isinstance(part, dict))
        if not text:
            raise ValueError("OpenRouter returned an empty response")
        return text

    def _generate_content(
        self,
        prompt: str,
        base64_image: str | None = None,
        media_type: str = "image/jpeg",
        max_tokens: int = 2048,
        response_mime_type: str = "application/json",
    ) -> str:
        if self.openrouter_api_key:
            errors = []
            models = [self.openrouter_model, *self.openrouter_fallback_models]
            for model in dict.fromkeys(models):
                try:
                    return self._generate_openrouter_content(prompt, base64_image, media_type, max_tokens, response_mime_type, model)
                except Exception as exc:
                    errors.append(f"{model}: {exc}")
                    logger.warning("OpenRouter model %s failed: %s", model, exc)
            if errors:
                raise RuntimeError("; ".join(errors))
            raise RuntimeError("OpenRouter request failed")
        raise RuntimeError("No AI provider is configured")

    async def analyze_image(self, base64_image: str, context: str = "") -> dict:
        if not self._is_available():
            return {"available": False, "message": "AI API key is not configured"}
        try:
            prompt = (
                "You are an AI assistant for an attendance management system. "
                "Analyze this image and respond only with valid JSON using this shape: "
                '{"person_present":true,"anomalies":[],"confidence":0,"concerns":"","verdict":"genuine"}. '
                'Use verdict values "genuine", "suspicious", or "spoof". '
                f"Context: {context}"
            )
            text = await asyncio.to_thread(self._generate_content, prompt, base64_image, "image/jpeg", 512)
            return self._clean_json(text)
        except json.JSONDecodeError:
            logger.exception("AI image JSON parse error")
            return {"person_present": True, "anomalies": [], "confidence": 70, "verdict": "genuine"}
        except Exception as e:
            logger.exception("AI analyze_image error")
            return {"error": str(e), "available": True}

    async def analyze_timetable_image(self, base64_image: str, department: str = "", media_type: str = "image/jpeg", semester: str = "") -> dict:
        if not self._is_available():
            return {
                "available": False,
                "message": "AI API key is not configured. Upload an Excel/CSV timetable or set OPENROUTER_API_KEY."
            }
        def row_targets_for_department(name: str) -> list[tuple[str, str]]:
            normalized = (name or "").strip().lower()
            if any(token in normalized for token in ["computer", "cse", "cs"]):
                return [
                    ("CS-VIII", "8"),
                    ("CS-VI", "6"),
                    ("CS IV-I", "4"),
                    ("CS IV-II", "4"),
                    ("DIP(CS)-VI", "6"),
                    ("DIP(CS)-IV", "4"),
                    ("MCA-II", "2"),
                ]
            return []

        def build_prompt(row_label: str = "", semester_value: str = "") -> str:
            row_instruction = (
                "Extract every lecture/lab slot for every visible semester that belongs to the target department. "
                "If the image includes CS-VIII, CS-VI, CS IV-I, CS IV-II, DIP(CS)-VI, DIP(CS)-IV or similar rows, include all of them. "
                "Do not limit extraction to the currently selected admin semester. "
                "For semester values, convert CS-VIII to 8, CS-VI to 6, CS IV-I to 4, CS IV-II to 4, DIP(CS)-VI to 6, DIP(CS)-IV to 4. "
            )
            if row_label:
                row_instruction = (
                    f"Extract only the timetable cells from the row labeled {row_label}. "
                    f"Set semester to {semester_value} for every returned slot. "
                    "Read this row across every day block (MON through SAT), including the columns after recess. "
                )
            return (
                "You are reading an academic weekly timetable image. "
                f"Target department: {department}. "
                f"{row_instruction}"
                "Ignore recess, off, lunch, empty cells, library, sports, headings, and room footer rows. "
                "Do not invent slots. If text is unclear, omit that cell. "
                "Return only valid JSON with this exact shape: "
                '{"slots":[{"day":"MON","semester":"6","subjectCode":"CD","subjectName":"CD",'
                '"startTime":"09:30","endTime":"10:30","room":"","faculty":"PT"}]}. '
                "Use 24-hour HH:MM times. Day must be MON/TUE/WED/THUR/FRI/SAT. "
                "For labs, keep the lab title in subjectName, such as ADA LAB-I or PROJECT WORK-LAB-I."
            )

        def parse_pipe_slots(text: str) -> list:
            slots = []
            for raw_line in (text or "").splitlines():
                line = raw_line.strip().strip("`")
                if not line or "|" not in line:
                    continue
                if line.upper().startswith("DAY|") or line.upper().startswith("```"):
                    continue
                parts = [part.strip() for part in line.split("|")]
                if len(parts) < 5:
                    continue
                day, semester_value, subject_name, start_time, end_time = parts[:5]
                room = parts[5] if len(parts) > 5 else ""
                faculty = parts[6] if len(parts) > 6 else ""
                if not day or not semester_value or not subject_name or not start_time or not end_time:
                    continue
                slots.append({
                    "day": day.upper(),
                    "semester": semester_value,
                    "subjectCode": subject_name,
                    "subjectName": subject_name,
                    "startTime": start_time,
                    "endTime": end_time,
                    "room": room,
                    "faculty": faculty,
                })
            return slots

        def build_pipe_prompt() -> str:
            return (
                "You are reading an academic weekly timetable image. "
                f"Target department: {department}. "
                "Extract every lecture/lab slot for every visible semester row that belongs to this department. "
                "Include rows such as CS-VIII, CS-VI, CS IV-I, CS IV-II, DIP(CS)-VI, DIP(CS)-IV, and MCA-II when visible. "
                "Convert semester labels to numbers: CS-VIII=8, CS-VI=6, CS IV-I=4, CS IV-II=4, DIP(CS)-VI=6, DIP(CS)-IV=4, MCA-II=2. "
                "Ignore recess, off, lunch, empty cells, library, sports, headings, and room footer rows. "
                "Do not invent unclear cells. "
                "Return plain text only. No markdown. No JSON. "
                "Each lecture must be exactly one line in this pipe-delimited format:\n"
                "DAY|SEMESTER|SUBJECT|START_TIME|END_TIME|ROOM|FACULTY\n"
                "Use MON/TUE/WED/THUR/FRI/SAT and 24-hour HH:MM times. "
                "Keep lab titles in SUBJECT, such as ADA LAB-I or PROJECT WORK-LAB-I."
            )

        async def extract_row(row_label: str, semester_value: str) -> list:
            text = await asyncio.to_thread(
                self._generate_content,
                build_prompt(row_label, semester_value),
                base64_image,
                media_type or "image/jpeg",
                8192,
                "application/json",
            )
            parsed = self._clean_json(text)
            slots = parsed.get("slots", [])
            if not isinstance(slots, list):
                return []
            for slot in slots:
                if isinstance(slot, dict):
                    slot["semester"] = semester_value
                    slot.setdefault("semesterLabel", row_label)
            return slots

        try:
            targets = row_targets_for_department(department)
            if targets:
                try:
                    text = await asyncio.to_thread(
                        self._generate_content,
                        build_pipe_prompt(),
                        base64_image,
                        media_type or "image/jpeg",
                        16384,
                        "text/plain",
                    )
                    slots = parse_pipe_slots(text)
                    if slots:
                        return {"slots": slots, "format": "pipe"}
                except Exception:
                    logger.exception("AI pipe timetable extraction failed")

                semaphore = asyncio.Semaphore(2)

                async def guarded_extract(label: str, semester_value: str):
                    async with semaphore:
                        return await extract_row(label, semester_value)

                results = await asyncio.gather(
                    *(guarded_extract(label, semester_value) for label, semester_value in targets),
                    return_exceptions=True,
                )
                slots = []
                for result in results:
                    if isinstance(result, Exception):
                        logger.warning("AI row-level timetable extraction failed: %s", result)
                        continue
                    slots.extend(result)
                if slots:
                    return {"slots": slots, "partial": True}

            prompt = build_prompt()
            text = await asyncio.to_thread(self._generate_content, prompt, base64_image, media_type or "image/jpeg", 8192)
            parsed = self._clean_json(text)
            slots = parsed.get("slots", [])
            if not isinstance(slots, list):
                slots = []
            return {"slots": slots}
        except json.JSONDecodeError:
            logger.exception("AI timetable JSON parse error")
            return {
                "slots": [],
                "error": "AI could not return valid timetable JSON. Upload an Excel/CSV timetable or try a clearer image."
            }
        except Exception as e:
            logger.exception("AI analyze_timetable_image error")
            if "429" in str(e) or "Too Many Requests" in str(e):
                return {
                    "slots": [],
                    "error": "AI rate limit reached while analyzing the timetable. Please wait a minute and try again."
                }
            return {"slots": [], "error": f"AI timetable analysis failed: {e}"}

    async def generate_attendance_summary(self, attendance_data: dict) -> str:
        if not self._is_available():
            return "AI summary not available because no AI API key is configured."
        try:
            prompt = (
                "Generate a brief 2-3 sentence professional attendance summary.\n"
                f"Student: {attendance_data.get('student_name')}\n"
                f"Subject: {attendance_data.get('subject')}\n"
                f"Total Lectures: {attendance_data.get('total')}\n"
                f"Attended: {attendance_data.get('attended')}\n"
                f"Percentage: {attendance_data.get('percentage')}%\n"
                "Include a recommendation if below 75%. "
                'Return JSON: {"summary":"..."}'
            )
            text = await asyncio.to_thread(self._generate_content, prompt, None, "image/jpeg", 300)
            return self._clean_json(text).get("summary", "AI summary not available")
        except Exception as e:
            return f"Unable to generate summary: {e}"

    async def detect_attendance_fraud(self, verification_data: dict) -> dict:
        if not self._is_available():
            return {"fraud_risk": "unknown", "reason": "No AI API key is configured"}
        try:
            prompt = (
                "You are a security AI for an attendance system. Analyze this data for fraud.\n"
                f"Face Confidence: {verification_data.get('confidence')}%\n"
                f"Liveness Score: {verification_data.get('liveness_score')}\n"
                f"Eye Open Score: {verification_data.get('eye_open_score')}\n"
                f"Body Language Score: {verification_data.get('body_language_score')}\n"
                f"Quality Score: {verification_data.get('quality_score')}\n"
                'Respond only with JSON: {"fraud_risk":"low","risk_factors":[],"recommendation":""}'
            )
            text = await asyncio.to_thread(self._generate_content, prompt, None, "image/jpeg", 300)
            return self._clean_json(text)
        except Exception as e:
            return {"fraud_risk": "unknown", "reason": str(e)}
