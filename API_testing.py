import json
import re
from typing import List, Dict, Any, Union
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from urllib.parse import urlparse, parse_qs

# =================================================
# MODELS
# =================================================

class EndpointRequest(BaseModel):
    name: str
    method: str
    url: str
    authType: str = "none"
    body: Union[str, Dict[str, Any], None] = None
    headers: Dict[str, str] = {}

class FrontendPayload(BaseModel):
    name: str
    projectId: str
    version: str
    source: str
    endpoints: List[EndpointRequest]

class SingleApiRequest(BaseModel):
    api_name: str
    method: str
    endpoint: str
    headers: List[str] = []
    auth: str = "none"
    path_params: List[str] = []
    query_params: List[str] = []
    body_fields: List[str] = []

# =================================================
# ROUTER
# =================================================

router = APIRouter(prefix="/testing", tags=["API Testing"])

# =================================================
# GROQ INIT
# =================================================

from groq import Groq
from config import GROQ_API_KEY, MODEL_NAME

# Load environment variables
import os
from dotenv import load_dotenv

load_dotenv()

try:
    from app import groq_client
except ImportError:
    groq_client = Groq(api_key=GROQ_API_KEY)

# =================================================
# SYSTEM PROMPT
# =================================================

SYSTEM_PROMPT = """
You are a senior API QA engineer.

Rules:
- Output ONLY valid JSON
- No markdown
- No explanations
- No comments
- request_variation must be JSON-safe
"""

# =================================================
# PROMPT BUILDER (NO TEST COUNT LIMIT)
# =================================================

def build_prompt(api: Dict[str, Any]) -> str:
    return f"""
Generate API test cases like a senior QA engineer.

API DETAILS:
Name: {api['api_name']}
Method: {api['method']}
Endpoint: {api['endpoint']}
Auth: {api['auth']}
Headers: {api['headers']}
Path Params: {api['path_params']}
Query Params: {api['query_params']}
Body Fields: {api['body_fields']}

Rules:
- Decide number of test cases yourself
- Cover positive, negative, edge, security only if applicable
- Do NOT invent fields
- GET / DELETE must NOT have body

Output format:
{{
  "test_cases": [
    {{
      "test_case_id": "TC01",
      "category": "positive | negative | edge | security",
      "test_case_name": "",
      "request_variation": {{
        "headers": {{}},
        "body": {{}}
      }},
      "expected_status_code": 200,
      "expected_behavior": ""
    }}
  ]
}}

Return ONLY JSON.
"""

# =================================================
# GROQ CALL
# =================================================

def call_groq(prompt: str) -> str:
    response = groq_client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt}
        ],
        temperature=0.2
    )
    return response.choices[0].message.content

# =================================================
# JSON SAFE PARSER
# =================================================

def safe_extract_json(text: str) -> Dict[str, Any]:
    if not text:
        raise ValueError("Empty AI response")

    text = re.sub(r"```json|```", "", text).strip()

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError("No JSON found")

    raw = match.group()

    # basic repairs
    raw = raw.replace("\n", " ")
    raw = re.sub(r",\s*}", "}", raw)
    raw = re.sub(r",\s*]", "]", raw)

    return json.loads(raw)

# =================================================
# AI JSON REPAIR (ENTERPRISE FIX)
# =================================================

def repair_with_ai(broken_text: str) -> Dict[str, Any]:
    repair_prompt = f"""
Fix the JSON below.
Do not change structure or meaning.
Return ONLY valid JSON.

BROKEN:
{broken_text}
"""
    response = groq_client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": "You fix broken JSON. Output JSON only."},
            {"role": "user", "content": repair_prompt}
        ],
        temperature=0
    )
    return safe_extract_json(response.choices[0].message.content)

# =================================================
# SANITIZER
# =================================================

def sanitize_test_cases(test_cases: List[Dict[str, Any]], method: str):
    cleaned = []

    for tc in test_cases:
        rv = tc.get("request_variation", {})
        rv.setdefault("headers", {})

        if method in ("GET", "DELETE"):
            rv.pop("body", None)

        if isinstance(rv.get("body"), dict):
            for k, v in rv["body"].items():
                if isinstance(v, str):
                    rv["body"][k] = v.replace("<", "").replace(">", "")

        cleaned.append({
            "test_case_id": tc.get("test_case_id"),
            "category": tc.get("category"),
            "test_case_name": tc.get("test_case_name"),
            "request_variation": rv,
            "expected_status_code": tc.get("expected_status_code"),
            "expected_behavior": tc.get("expected_behavior", "")
        })

    return cleaned

# =================================================
# BULK API GENERATION
# =================================================

@router.post("/generate")
async def generate_testcases(payload: FrontendPayload):
    results = []

    for endpoint in payload.endpoints:
        test_cases = []
        error = None

        for attempt in range(3):  # retry
            try:
                parsed_url = urlparse(endpoint.url.replace("{{baseUrl}}", ""))

                body_fields = []
                if endpoint.body:
                    try:
                        obj = json.loads(endpoint.body) if isinstance(endpoint.body, str) else endpoint.body
                        if isinstance(obj, dict):
                            body_fields = list(obj.keys())
                    except Exception:
                        pass

                api = {
                    "api_name": endpoint.name,
                    "method": endpoint.method.upper(),
                    "endpoint": parsed_url.path,
                    "headers": list(endpoint.headers.keys()),
                    "auth": endpoint.authType,
                    "path_params": re.findall(r"\{([^}]+)\}", parsed_url.path),
                    "query_params": list(parse_qs(parsed_url.query).keys()),
                    "body_fields": body_fields
                }

                ai_text = call_groq(build_prompt(api))

                try:
                    parsed = safe_extract_json(ai_text)
                except Exception:
                    parsed = repair_with_ai(ai_text)

                test_cases = sanitize_test_cases(parsed.get("test_cases", []), api["method"])
                error = None
                break

            except Exception as e:
                error = str(e)

        results.append({
            "api_name": endpoint.name,
            "method": endpoint.method,
            "endpoint": endpoint.url,
            "test_cases": test_cases,
            "error": error
        })

    return {
        "total_apis": len(results),
        "results": results
    }

# =================================================
# SINGLE API
# =================================================

@router.post("/generate-single")
async def generate_single_api_testcases(api: SingleApiRequest):
    ai_text = call_groq(build_prompt(api.dict()))

    try:
        parsed = safe_extract_json(ai_text)
    except Exception:
        parsed = repair_with_ai(ai_text)

    test_cases = sanitize_test_cases(parsed.get("test_cases", []), api.method.upper())

    return {
        "api_name": api.api_name,
        "method": api.method,
        "endpoint": api.endpoint,
        "test_cases": test_cases
    }
