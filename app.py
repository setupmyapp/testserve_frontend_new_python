import json
import traceback
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from groq import Groq
import os
from dotenv import load_dotenv
from typing import Optional
import uvicorn
from test_scenarios import router as test_scenarios_router
from API_testing import router as api_testing_router
import logging

# Load environment variables
load_dotenv()

app = FastAPI()

# Include routers with their respective prefixes
app.include_router(test_scenarios_router, prefix="/api")
app.include_router(api_testing_router, prefix="/api")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Groq client
try:
    groq_client = Groq(api_key=os.getenv('GROQ_API_KEY'))
    MODEL_NAME = "llama-3.1-8b-instant"
except Exception as e:
    print(f"Error initializing Groq client: {e}")
    groq_client = None

# In-memory storage for responses and stop events
generated_responses = {}
stop_events = {}

@app.get("/")
async def root():
    return {"message": "Welcome to the Groq API FastAPI Server"}

@app.post("/generate")
async def generate_test_cases(request: Request):
    try:
        data = await request.json()
        # Get testcase from request (required)
        if "testcase" not in data or not data["testcase"]:
            raise HTTPException(
                status_code=400,
                detail={"error": "The 'testcase' field is required"}
            )
            
        prompt_text = data["testcase"]
        platform = data.get("platform", "web")
            
        if not groq_client:
            raise HTTPException(status_code=500, detail="Groq client not initialized")
        
        # Create the structured prompt
        prompt = f"""
        Generate test cases in JSON format based on the following test case description and platform.
        Follow the exact structure and include all specified fields.

        ### Test Case Description:
        {prompt_text}
        
        ### Platform: {platform}
        
        ### Requirements for each test case:
        - testCaseID: Format as TCXXX (e.g., TC001, TC002, etc.)
        - testScenario: Brief description of the test scenario
        - testSteps: Exactly 3 steps (include placeholders if needed)
        - expectedResults: Expected outcome
        - priority: High, Medium (default), or Low
        - automatable: Yes (default) or No
        - coverage: Positive, Negative, or EdgeCase (default: Positive)
        - predefine: True (default) or False

        ### Output Format (JSON array of test cases):
        {{
            "testCases": [
                {{
                    "testCaseID": "TC001",
                    "testScenario": "Scenario description",
                    "testSteps": ["Step 1", "Step 2", "Step 3"],
                    "expectedResults": "Expected result",
                    "priority": "Medium",
                    "automatable": "Yes",
                    "coverage": "Positive",
                    "predefine": "True"
                }}
            ]
        }}

        Generate at least 5 comprehensive test cases covering different scenarios including positive, negative, and edge cases.
        """
        
        # Get completion from Groq
        completion = groq_client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You are a test case generator that outputs valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,  # Lower temperature for more consistent output
            max_tokens=2048,
            response_format={"type": "json_object"}  # Ensure JSON output
        )
        
        # Extract and parse the response
        response_text = completion.choices[0].message.content
        
        try:
            # Try to parse the response as JSON
            test_cases = json.loads(response_text)
            return test_cases
        except json.JSONDecodeError:
            # If parsing fails, try to extract JSON from the response
            import re
            json_match = re.search(r'\[\s*\{.*\}\s*\]', response_text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(0))
            return {"test_cases": response_text}  # Fallback to raw response if JSON parsing fails
            
    except json.JSONDecodeError as e:
        logging.error(f"Invalid JSON payload: {e}")
        raise HTTPException(
            status_code=422, 
            detail={"error": "Invalid JSON payload", "details": str(e)}
        )
    except Exception as e:
        logging.error(f"Failed to generate test cases: {e}")
        error_details = {
            "error": "Failed to generate test cases",
            "message": str(e),
            "type": type(e).__name__
        }
        if hasattr(e, 'response') and hasattr(e.response, 'text'):
            error_details["api_response"] = e.response.text
        return JSONResponse(
            status_code=500,
            content=error_details
        )

@app.post("/stream")
async def stream_text(request: Request):
    data = await request.json()
    prompt = data.get("prompt")
    
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")
    
    if not groq_client:
        raise HTTPException(status_code=500, detail="Groq client not initialized")
    
    async def generate():
        try:
            stream = groq_client.chat.completions.create(
                model=MODEL_NAME,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=1024,
                stream=True
            )
            
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield f"data: {chunk.choices[0].delta.content}\n\n"
                    
        except Exception as e:
            yield f"data: Error: {str(e)}\n\n"
    
    return Response(generate(), media_type="text/event-stream")

if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=5000, reload=True)
