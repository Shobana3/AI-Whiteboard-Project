import os
import base64
import json
import re
import hashlib
import threading
from io import BytesIO
from PIL import Image
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

# ─── Single Groq Client ───────────────────────────────────────────────────────
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))
VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"
CHAT_MODEL   = "llama-3.3-70b-versatile"

# ─── In-memory cache ──────────────────────────────────────────────────────────
_drawing_cache  = {}
_guidance_cache = {}
_drawing_lock   = threading.Lock()
_guidance_lock  = threading.Lock()

print("✅ Groq client ready — caching enabled to reduce API costs")

# ─── Language name map (code → full name for prompts) ────────────────────────
LANGUAGE_NAMES = {
    "en-US": "English",
    "ta-IN": "Tamil",
    "hi-IN": "Hindi",
    "te-IN": "Telugu",
    "kn-IN": "Kannada",
    "ml-IN": "Malayalam",
    "mr-IN": "Marathi",
    "bn-IN": "Bengali",
    "gu-IN": "Gujarati",
    "pa-IN": "Punjabi",
    "es-ES": "Spanish",
    "fr-FR": "French",
    "de-DE": "German",
    "zh-CN": "Chinese (Simplified)",
    "ar-SA": "Arabic",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "pt-BR": "Portuguese (Brazilian)",
}

def get_language_name(lang_code: str) -> str:
    """Return human-readable language name from BCP-47 code."""
    if not lang_code:
        return "English"
    # Exact match
    if lang_code in LANGUAGE_NAMES:
        return LANGUAGE_NAMES[lang_code]
    # Prefix match (e.g. "ta" → "Tamil")
    prefix = lang_code.split("-")[0].lower()
    for code, name in LANGUAGE_NAMES.items():
        if code.lower().startswith(prefix):
            return name
    return "English"


# ─── Helpers ──────────────────────────────────────────────────────────────────
def resize_image(canvas_base64: str, max_size: int = 512) -> str:
    if "," in canvas_base64:
        canvas_base64 = canvas_base64.split(",")[1]
    img = Image.open(BytesIO(base64.b64decode(canvas_base64))).convert("RGB")
    w, h = img.size
    if max(w, h) > max_size:
        ratio = max_size / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
    buf = BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def image_hash(canvas_base64: str) -> str:
    raw = canvas_base64.split(",")[1] if "," in canvas_base64 else canvas_base64
    return hashlib.md5(raw[:2000].encode()).hexdigest()


def parse_json(text: str) -> dict:
    clean = re.sub(r"```json|```", "", text).strip()
    return json.loads(clean)


# ─── 1. analyze_drawing ───────────────────────────────────────────────────────
def analyze_drawing(
    canvas_base64: str = None,
    user_text: str = "",
    child_age: int = 6,
    language: str = "en-US"          # ← NEW parameter
) -> dict:
    lang_name = get_language_name(language)

    fallback = {
        "identified_object": user_text or "something creative",
        "confidence": 0.7,
        "ml_detected": user_text or "unknown",
        "ml_confidence": 0.7,
        "ml_all_predictions": [],
        "completion_description": "A wonderful creative drawing!",
        "encouragement": "Amazing work! You are so creative! 🌟",
        "drawing_steps": ["Keep drawing!", "Add more details", "Color it in", "Show everyone!"],
        "fun_fact": "Drawing helps develop creativity and fine motor skills!",
        "color_suggestions": ["red", "blue", "yellow"],
        "similar_objects": [],
        "learning_activity": "Try drawing the same thing from memory!",
        "guidance": {
            "title": "Keep Drawing!",
            "difficulty": "easy",
            "steps": [{"step": 1, "instruction": "Add more details", "emoji": "✏️", "tip": "Have fun!"}],
            "final_encouragement": "You are amazing!",
            "color_palette": ["red", "blue"],
            "fun_facts": ["Drawing is great for your brain!"]
        }
    }

    # ── Cache check (include language in key) ────────────────────────────────
    cache_key = None
    if canvas_base64 and len(canvas_base64) > 100:
        cache_key = image_hash(canvas_base64) + f"_{child_age}_{user_text}_{language}"
        with _drawing_lock:
            if cache_key in _drawing_cache:
                print("✅ Cache hit — skipping API call")
                return _drawing_cache[cache_key]

    # ── Build message content ────────────────────────────────────────────────
    content = []

    if canvas_base64 and len(canvas_base64) > 100:
        try:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{resize_image(canvas_base64)}"}
            })
        except Exception as e:
            print(f"Image error: {e}")

    TRACE_SHAPE_NAMES = {
        "cat","house","star","sun","tree","heart","fish","bird","car",
        "flower","apple","moon","butterfly","elephant","rocket",
        "dog","lion","rabbit","penguin","turtle","dinosaur","whale","owl",
        "bus","train","airplane","boat","bicycle","helicopter",
        "cloud","rainbow","mountain","cactus","mushroom",
        "banana","ice cream","icecream","pizza","cake",
        "crown","balloon","guitar","umbrella","bell","key"
    }
    user_text_clean = (user_text or "").strip()
    is_trace_hint = user_text_clean.lower().split(" — ")[0].strip() in TRACE_SHAPE_NAMES

    if is_trace_hint:
        shape_name = user_text_clean.split(" — ")[0].strip()
        hint_block = f'''The child was tracing a dotted guide shape of a "{shape_name}".
IMPORTANT: The identified_object MUST be "{shape_name.lower()}". Set confidence to at least 0.88.
Generate all encouragement, fun facts, steps, and guidance relevant to a {shape_name.lower()}.'''
    elif user_text_clean:
        hint_block = f'The child described their drawing as: "{user_text_clean}". Use this as a strong hint when identifying.'
    else:
        hint_block = ""

    # ── LANGUAGE INSTRUCTION injected into prompt ────────────────────────────
    lang_instruction = (
        f'\n\nIMPORTANT: You MUST write ALL text values in the JSON response in {lang_name}. '
        f'This includes: completion_description, encouragement, drawing_steps, fun_fact, '
        f'learning_activity, guidance.title, guidance.steps[].instruction, '
        f'guidance.steps[].tip, guidance.final_encouragement, guidance.fun_facts. '
        f'The JSON keys must remain in English. Only the values should be in {lang_name}.'
        if lang_name != "English" else ""
    )

    content.append({"type": "text", "text": f"""You are Sparky, a friendly AI for a children's drawing app.
A child aged {child_age} drew something on a white canvas.
{hint_block}{lang_instruction}

IDENTIFICATION RULES:
- Look carefully at the whole image and identify the most likely object, animal, or scene.
- If the drawing is a plain geometric shape with NO extra details, call it by its shape name: "square", "rectangle", "circle", "triangle", "lines".
- For ALL other drawings — even rough or simple ones — identify the most likely real object. Children's drawings are often rough; use context and any hint provided.
- NEVER return "something creative" or vague non-answers. Always make your best specific guess.

Respond ONLY with this exact JSON structure — no markdown, no extra text:
{{
  "identified_object": "simple object name",
  "confidence": 0.85,
  "ml_detected": "same as identified_object",
  "ml_all_predictions": [
    {{"label": "first guess", "score": 0.85}},
    {{"label": "second guess", "score": 0.10}},
    {{"label": "third guess", "score": 0.05}}
  ],
  "completion_description": "1-2 friendly sentences about the drawing",
  "encouragement": "fun positive message for a {child_age}-year-old",
  "drawing_steps": ["improvement step 1", "step 2", "step 3", "step 4"],
  "fun_fact": "interesting fact about this object for a {child_age}-year-old",
  "color_suggestions": ["color1", "color2", "color3"],
  "similar_objects": ["related object 1", "related object 2"],
  "learning_activity": "one fun activity related to this drawing",
  "guidance": {{
    "title": "How to Draw a [object]",
    "difficulty": "easy",
    "steps": [
      {{"step": 1, "instruction": "draw instruction", "emoji": "✏️", "tip": "helpful tip"}},
      {{"step": 2, "instruction": "draw instruction", "emoji": "🎨", "tip": "helpful tip"}},
      {{"step": 3, "instruction": "draw instruction", "emoji": "🌈", "tip": "helpful tip"}}
    ],
    "final_encouragement": "exciting finish message",
    "color_palette": ["color1", "color2"],
    "fun_facts": ["fact about drawing this object"]
  }}
}}"""})

    try:
        response = groq_client.chat.completions.create(
            model=VISION_MODEL,
            messages=[{"role": "user", "content": content}],
            max_tokens=1000,
            temperature=0.7,
        )
        result = parse_json(response.choices[0].message.content)
        result["ml_confidence"] = result.get("confidence", 0.7)
        print(f"✅ API call done: {result.get('identified_object')} ({result.get('confidence', 0):.0%})")

        if cache_key:
            with _drawing_lock:
                _drawing_cache[cache_key] = result
                if len(_drawing_cache) > 50:
                    oldest = next(iter(_drawing_cache))
                    del _drawing_cache[oldest]

        return result
    except Exception as e:
        print(f"analyze_drawing error: {e}")
        return fallback


# ─── 2. generate_drawing_guidance ─────────────────────────────────────────────
def generate_drawing_guidance(
    object_name: str,
    child_age: int = 6,
    language: str = "en-US"          # ← NEW parameter
) -> dict:
    lang_name = get_language_name(language)
    cache_key = f"{object_name.lower().strip()}_{child_age}_{language}"

    with _guidance_lock:
        if cache_key in _guidance_cache:
            print("✅ Guidance cache hit — no API call needed")
            return _guidance_cache[cache_key]

    # Check drawing cache
    with _drawing_lock:
        cache_snapshot = list(_drawing_cache.values())
    for cached in cache_snapshot:
        if (cached.get("identified_object", "").lower() == object_name.lower()
                and "guidance" in cached):
            print("✅ Guidance found in drawing cache — no API call needed")
            return cached["guidance"]

    lang_instruction = (
        f' Write all text values (title, instructions, tips, encouragement, fun_facts) in {lang_name}. JSON keys stay in English.'
        if lang_name != "English" else ""
    )

    print(f"Making guidance API call for: {object_name} in {lang_name}")
    try:
        response = groq_client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[{"role": "user", "content": (
                f'Step-by-step drawing guide for a {child_age}-year-old to draw "{object_name}".{lang_instruction} '
                f'JSON only, no markdown: {{"title":"How to Draw {object_name}","difficulty":"easy",'
                f'"steps":[{{"step":1,"instruction":"...","emoji":"✏️","tip":"..."}}],'
                f'"final_encouragement":"...","color_palette":["color1"],"fun_facts":["fact1"]}}'
            )}],
            max_tokens=500,
            temperature=0.7,
        )
        result = parse_json(response.choices[0].message.content)
        with _guidance_lock:
            _guidance_cache[cache_key] = result
        return result
    except Exception as e:
        print(f"Guidance error: {e}")
        return {
            "title": f"How to Draw a {object_name}",
            "difficulty": "easy",
            "steps": [
                {"step": 1, "instruction": "Start with basic shapes", "emoji": "✏️", "tip": "Take it slow!"},
                {"step": 2, "instruction": "Add details",             "emoji": "🎨", "tip": "Have fun!"},
                {"step": 3, "instruction": "Color it in",             "emoji": "🌈", "tip": "Use your favorite colors!"},
            ],
            "final_encouragement": "Amazing job! You are an artist!",
            "color_palette": ["red", "blue", "green"],
            "fun_facts": ["Drawing is a great skill!"],
        }


# ─── 3. chat_with_ai ──────────────────────────────────────────────────────────
def chat_with_ai(
    messages: list,
    child_age: int = 6,
    language: str = "en-US"          # ← NEW parameter
) -> str:
    lang_name = get_language_name(language)

    if not messages:
        return "Hi there! I am Sparky! What would you like to talk about? 🎨"

    valid_messages = [
        {
            "role": "assistant" if m["role"] == "assistant" else "user",
            "content": str(m["content"]).strip()
        }
        for m in messages[-3:]
        if m.get("content") and str(m["content"]).strip()
    ]

    if not valid_messages:
        return "Hi there! I am Sparky! What would you like to talk about? 🎨"

    # Language instruction added to system prompt
    lang_instruction = (
        f' IMPORTANT: You MUST reply in {lang_name} only. The child speaks {lang_name}.'
        if lang_name != "English" else ""
    )

    try:
        response = groq_client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[
                {"role": "system", "content": (
                    f'You are "Sparky", a fun AI companion for children aged 4-12. '
                    f'Helping a child aged {child_age}. Give short, simple, friendly replies.{lang_instruction} '
                    f'Use plain text sentences. You may use 1 emoji at most per reply, at the end only. '
                    f'Do NOT use multiple emojis or put emojis in the middle of sentences.'
                )}
            ] + valid_messages,
            max_tokens=200,
            temperature=0.8,
        )
        return response.choices[0].message.content
    except Exception as e:
        print(f"Chat error: {e}")
        return "Oops! I had a little trouble. Try asking me again! 🤖"


# ─── 4. generate_dot_to_dot ────────────────────────────────────────────────────
def generate_dot_to_dot(object_name: str, child_age: int = 6) -> dict:
    cache_key = f"dotdot_{object_name.lower().strip()}_{child_age}"
    with _guidance_lock:
        if cache_key in _guidance_cache:
            print(f"Dot-to-dot cache hit for: {object_name}")
            return _guidance_cache[cache_key]

    fallback = {
        "object_name": object_name,
        "dots": [
            {"number": 1, "x": 150, "y": 80},
            {"number": 2, "x": 220, "y": 60},
            {"number": 3, "x": 260, "y": 120},
            {"number": 4, "x": 240, "y": 180},
            {"number": 5, "x": 180, "y": 210},
            {"number": 6, "x": 120, "y": 180},
            {"number": 7, "x": 100, "y": 120},
            {"number": 8, "x": 150, "y": 80},
        ],
        "hint": f"Connect the dots to draw a {object_name}!",
        "encouragement": "You are doing amazing! Keep going!",
        "fun_fact": f"Drawing a {object_name} is a great way to practice your art skills!",
        "total_dots": 8,
    }

    try:
        response = groq_client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[{
                "role": "user",
                "content": f"""Create a dot-to-dot drawing guide for a {child_age}-year-old child to draw a "{object_name}".

Generate numbered dots (x, y coordinates) on a 300x300 grid (x: 20-280, y: 20-280).
The dots should trace the outline of a simple recognizable "{object_name}" shape when connected in order.
Use 8 to 14 dots — enough to make the shape clear but not too hard for a child.
Make sure the first and last dot are close together to close the shape if needed.

Respond ONLY with valid JSON, no markdown:
{{
  "object_name": "{object_name}",
  "dots": [
    {{"number": 1, "x": 150, "y": 50}},
    {{"number": 2, "x": 200, "y": 80}}
  ],
  "hint": "short fun instruction like Connect the dots to reveal a {object_name}!",
  "encouragement": "fun positive message when child finishes",
  "fun_fact": "one interesting fact about {object_name} for a {child_age}-year-old",
  "total_dots": 10
}}"""
            }],
            max_tokens=600,
            temperature=0.4,
        )
        result = parse_json(response.choices[0].message.content)
        with _guidance_lock:
            _guidance_cache[cache_key] = result
        print(f"Dot-to-dot generated for: {object_name} with {result.get('total_dots', '?')} dots")
        return result
    except Exception as e:
        print(f"Dot-to-dot error: {e}")
        return fallback