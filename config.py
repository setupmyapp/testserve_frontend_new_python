"""
Config from environment. Set GROQ_API_KEY and optionally MODEL_NAME, PORT in .env
"""
import os
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
MODEL_NAME = os.environ.get("MODEL_NAME", "llama-3.1-8b-instant").strip()
PORT = int(os.environ.get("PORT", "5000"))
