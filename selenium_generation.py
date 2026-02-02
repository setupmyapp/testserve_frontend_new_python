from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Any, Dict
from groq import Groq
from config import GROQ_API_KEY, MODEL_NAME
import logging
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/selenium", tags=["Selenium Generation"])

# Initialize Groq client
try:
    groq_client = Groq(api_key=GROQ_API_KEY)
except Exception as e:
    logger.error(f"Error initializing Groq client: {e}")
    groq_client = None

# --- Pydantic Models ---

class ActionValue(BaseModel):
    x: Optional[int] = None
    y: Optional[int] = None

class Action(BaseModel):
    index: int
    type: str
    selector: str
    displayName: Optional[str] = None
    value: Optional[Any] = None # Can be string, dictionary (for scroll), bool, etc.
    url: str
    text: Optional[str] = None
    ariaLabel: Optional[str] = None
    dataTestId: Optional[str] = None
    role: Optional[str] = None
    tagName: Optional[str] = None
    name: Optional[str] = None

class AutomationPayload(BaseModel):
    uuid: str
    url: str
    actions: List[Action]
    startTime: int

# --- API Endpoint ---

@router.post("/generate")
async def generate_selenium_code(payload: AutomationPayload):
    if not groq_client:
        raise HTTPException(status_code=500, detail="Groq client not initialized")

    try:
        # Construct the prompt
        prompt = f"""
You are an expert Automation Engineer. Your task is to generate professional, robust Java Selenium code based on the provided JSON script of user actions.

API DETAILS:
The input is a JSON object representing a recorded session.
- `url`: The starting URL.
- `actions`: A list of actions (click, scroll, type, focus, check, select, etc.) performed by the user.

REQUIREMENTS:
1.  **Language Check**: The output MUST be valid Java code using Selenium WebDriver.
2.  **Professional Code Structure**:
    - Use a class structure (e.g., `public class GeneratedTest`).
    - Include a `main` method or TestNG `@Test` method.
    - Initialize `WebDriver` (assume ChromeDriver) properly.
    - Use `WebDriverWait` for element interaction (do not use harsh `Thread.sleep` unless absolutely necessary for specific flows, but prefer explicit waits).
3.  **Selector Handling**:
    - existing `selector` in the JSON is an XPath or similar. Use it.
    - If `selector` is "window" and type is "scroll", handle scrolling using `JavascriptExecutor`.
4.  **Action Mapping**:
    - `click`: `driver.findElement(...).click()`
    - `type`: `driver.findElement(...).sendKeys(...)`
    - `scroll`: `((JavascriptExecutor) driver).executeScript("window.scrollTo(x, y);")` or similar based on the value.
    - `select`: Handle `<select>` dropdowns using `Select` class.
    - `check`: Handle checkboxes.
5.  **Robustness**: Add comments explaining complex steps. formatting should be clean.
6.  **Output Format**: Return a JSON object with a single field `javaCode` containing the raw Java string.

INPUT JSON:
{payload.json()}

OUTPUT JSON FORMAT:
{{
  "javaCode": "..."
}}
"""

        # Call Groq API
        completion = groq_client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You are a senior test automation engineer. Output properly formatted JSON only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            response_format={"type": "json_object"}
        )

        response_text = completion.choices[0].message.content
        
        # Parse response
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            # Fallback if the model returns markdown or something slightly off
            import re
            json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(0))
            else:
                 raise ValueError("Could not parse JSON from AI response")

    except Exception as e:
        logger.error(f"Error generating Selenium code: {e}")
        raise HTTPException(status_code=500, detail=str(e))
