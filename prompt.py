import os
from groq import Groq
from config import GROQ_API_KEY, MODEL_NAME
from dotenv import load_dotenv
import json
import re

# Load environment variables
load_dotenv()

# Initialize Groq client
try:
    groq_client = Groq(api_key=GROQ_API_KEY)
except Exception as e:
    print(f"Error initializing Groq client: {e}")
    groq_client = None

# Test case template as a string constant
TEST_CASE_TEMPLATE = """
You are an expert test case generator. Generate test cases based on the following requirements:

### Input:
{input_text}

### Requirements:
- Generate comprehensive test cases covering positive, negative, and edge cases
- Include test steps, expected results, and test data
- Format the output as a JSON array of test cases
- Each test case should have a clear description and purpose

### Output Format:
[
    {
        "test_case_id": "TC001",
        "description": "Test case description",
        "steps": ["Step 1", "Step 2", "Step 3"],
        "expected_result": "Expected outcome",
        "priority": "High/Medium/Low",
        "tags": ["tag1", "tag2"]
    }
]
"""

async def generate_test_cases(input_text: str):
    """
    Generate test cases based on the input text using Groq API
    
    Args:
        input_text (str): The input text describing the feature or requirement
        
    Returns:
        dict: Generated test cases in JSON format
    """
    if not groq_client:
        return {"error": "Groq client not initialized"}
    
    try:
        # Format the prompt using the template
        prompt = TEST_CASE_TEMPLATE.format(input_text=input_text)
        
        # Call Groq API
        completion = groq_client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You are a helpful test case generator."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=2000,
        )
        
        # Extract the response
        response_text = completion.choices[0].message.content
        
        # Clean and parse the response
        test_cases = clean_response(response_text)
        
        return {"test_cases": test_cases}
        
    except Exception as e:
        return {"error": f"Error generating test cases: {str(e)}"}

def clean_response(response: str):
    """
    Clean and parse the response from Groq API to extract JSON
    
    Args:
        response (str): The raw response from Groq API
        
    Returns:
        list: Parsed test cases as a list of dictionaries
    """
    try:
        # Try to find JSON content in the response
        json_match = re.search(r'\[.*\]', response, re.DOTALL)
        if json_match:
            json_str = json_match.group(0)
            return json.loads(json_str)
        
        # If no JSON array found, try to find code blocks
        code_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', response, re.DOTALL)
        if code_match:
            return json.loads(code_match.group(1))
            
        # If all else fails, return the raw response
        return response.strip()
        
    except (json.JSONDecodeError, Exception) as e:
        return f"Error parsing response: {str(e)}\n\nRaw response:\n{response}"