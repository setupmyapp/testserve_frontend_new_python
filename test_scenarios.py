from fastapi import APIRouter, HTTPException, Request
import json
import os
import re
import logging
from typing import Dict, Any, List
from groq import Groq, GroqError

router = APIRouter()

# Configuration
MODEL_NAME = "llama-3.1-8b-instant"

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_groq_client():
    api_key = os.getenv('GROQ_API_KEY')
    if not api_key:
        raise GroqError("GROQ_API_KEY environment variable is not set")
    return Groq(api_key=api_key)

@router.post('/generate_test_scenarios')
async def generate_test_scenarios(request: Request):
    # Get user story from the request
    try:
        data = await request.json()
        user_story = data.get('user_story', '')
        platform = data.get('platform', 'web')  # Default to 'web' if not specified
        logger.info("Received user story: %s", user_story)
    except Exception as e:
        logger.error("Invalid JSON format: %s", str(e))
        raise HTTPException(status_code=400, detail={"error": "Invalid JSON format", "details": str(e)})

    if not user_story:
        raise HTTPException(status_code=400, detail={"error": "No user story provided"})

    # Create prompt for the model
    prompt = f"""
    Ensure the analysis and generation of test scenarios comprehensively cover every detail mentioned in the user story. list of test scenarios in the following format:

    1. Verify user authentication for accessing the \"My Records\" section.
    2. Ensure unauthorized users cannot access appointment details.
    3. Confirm \"My Records\" is accessible after login.
    4. Test that updated appointment details are validated against existing data in the database.
    5. Verify that changes to appointment details (e.g., date, time, reason for visit) trigger a conflict check.
    6. Ensure that invalid updates (e.g., empty fields) result in error messages or notifications.
    7. Test that the \"My Appointments\" section displays upcoming appointments correctly.
    8. Verify that the edit option is visible and functional on each appointment card.
    9. Confirm that user interface components are accessible for patients with disabilities.

    User Story:
    {user_story}
    Platform: {platform}

    Output should follow the exact numbering and format above.
    No lines or content should be missed, and all possible scenarios must be identified and included. The output should provide thorough coverage of the user story, leaving no requirements or conditions unaddressed.
    """

    try:
        # Initialize Groq client
        client = get_groq_client()
        
        # Send request to Groq API
        logger.info("Sending request to Groq API")
        
        chat_completion = client.chat.completions.create(
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            model=MODEL_NAME,
            max_tokens=1500,
            temperature=0.5,
        )
        
        generated_text = chat_completion.choices[0].message.content
        logger.info("Received response from Groq API")

        # Extract test scenarios using regex
        scenarios = re.findall(r"\d+\.\s.*", generated_text)
        logger.info("Extracted %d test scenarios", len(scenarios))

        return {"test_scenarios": scenarios}

    except Exception as e:
        logger.error("API error: %s", str(e))
        raise HTTPException(status_code=500, detail={"error": f"API error: {str(e)}"})

@router.post('/generate_test_cases')
async def generate_test_cases(request: Request):
    try:
        # Get test scenarios from the request
        data = await request.json()
        test_scenarios = data.get('test_scenarios', [])
        
        if not test_scenarios:
            raise HTTPException(status_code=400, detail={"error": "No test scenarios provided"})

        # Initialize Groq client
        client = get_groq_client()
        
        # Process each test scenario and generate test cases
        results = {}
        
        for scenario in test_scenarios:
            # Clean the scenario text (remove numbering if present)
            scenario_text = re.sub(r'^\d+\.\s*', '', str(scenario)).strip()
            
            # Create prompt for the model to generate test cases for this scenario
            prompt = f"""
            Generate exactly 3 test cases for the following scenario:
            "{scenario_text}"
            
            The test cases should be in this exact JSON format:
            
            {{
                "test_cases": [
                    {{
                        "testCaseID": "TC001",
                        "testScenario": "Verify successful login with valid credentials",
                        "testSteps": [
                            "Step 1: Enter valid email and password",
                            "Step 2: Click login",
                            "Step 3: Verify redirection to account page"
                        ],
                        "expectedResults": "User is logged in and redirected to account page",
                        "priority": "High",
                        "automatable": "Yes",
                        "coverage": "Positive",
                        "predefine": "True"
                    }},
                    {{
                        "testCaseID": "TC002",
                        "testScenario": "Verify login fails with invalid password",
                        "testSteps": [
                            "Step 1: Enter valid email and wrong password",
                            "Step 2: Click login",
                            "Step 3: Verify error message"
                        ],
                        "expectedResults": "App shows 'Invalid credentials' error",
                        "priority": "High",
                        "automatable": "Yes",
                        "coverage": "Negative",
                        "predefine": "True"
                    }},
                    {{
                        "testCaseID": "TC003",
                        "testScenario": "Verify login with maximum login attempts",
                        "testSteps": [
                            "Step 1-5: Attempt login with wrong password 5 times",
                            "Step 6: Try with correct password",
                            "Step 7: Verify account is locked"
                        ],
                        "expectedResults": "Account is locked after 5 failed attempts",
                        "priority": "Medium",
                        "automatable": "Yes",
                        "coverage": "EdgeCase",
                        "predefine": "True"
                    }}
                ]
            }}
             
            Important:
            1. Generate exactly 3 test cases for the given scenario
            2. Follow the exact same JSON structure as the example
            3. Include testCaseID, testScenario, testSteps, expectedResults, priority, automatable, coverage, and predefine fields
            4. Make sure testSteps is an array of strings starting with "Step X:"
            5. Keep the same field names and casing as in the example
            """
            
            try:
                # Send request to Groq API
                chat_completion = client.chat.completions.create(
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a test case generator that outputs valid JSON arrays of test cases. Generate exactly 3 test cases per scenario."
                        },
                        {
                            "role": "user",
                            "content": prompt,
                        }
                    ],
                    model=MODEL_NAME,
                    response_format={"type": "json_object"},
                    temperature=0.3,
                    max_tokens=1500,
                )
                
                # Extract and parse the response
                response_text = chat_completion.choices[0].message.content
                
                try:
                    # Parse the JSON response
                    response_data = json.loads(response_text)
                    
                    # Store the test cases for this scenario
                    if 'test_cases' in response_data and isinstance(response_data['test_cases'], list):
                        # Ensure testCaseID is properly formatted for each test case
                        for i, tc in enumerate(response_data['test_cases'], 1):
                            tc['testCaseID'] = f"TC{i:03d}"
                        
                        results[scenario_text] = response_data['test_cases']
                    else:
                        results[scenario_text] = [{
                            "error": "Invalid response format from API"
                        }]
                        
                except json.JSONDecodeError as e:
                    logger.error(f"Failed to parse test case JSON for scenario: {e}")
                    results[scenario_text] = [{
                        "error": f"Failed to parse test cases: {str(e)}"
                    }]
                
            except Exception as e:
                logger.error(f"Error generating test cases for scenario: {e}")
                results[scenario_text] = [{
                    "error": f"Failed to generate test cases: {str(e)}"
                }]
        
        # Format the final response with test cases grouped by scenario
        formatted_results = []
        for scenario, cases in results.items():
            formatted_results.append({
                "scenario": scenario,
                "test_cases": cases
            })
            
        return {"results": formatted_results}
        
    except Exception as e:
        logger.error(f"Error in generate_test_cases: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail={"error": "Failed to generate test cases", "details": str(e)}
        )