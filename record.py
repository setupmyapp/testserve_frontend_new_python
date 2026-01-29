from fastapi import FastAPI, Body
from typing import Dict
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
import time

app = FastAPI()

@app.post("/playback")
def playback(payload: Dict = Body(...)):

    steps = payload["steps"]

    options = webdriver.ChromeOptions()
    options.add_argument("--start-maximized")

    driver = webdriver.Chrome(
        service=Service(ChromeDriverManager().install()),
        options=options
    )

    driver.get(steps[0]["url"])
    time.sleep(4)

    for step in steps:
        try:
            element = driver.find_element(By.XPATH, step["xpath"])

            if step["action"] == "click":
                element.click()

            elif step["action"] == "fill":
                element.clear()
                element.send_keys(step["value"])

            time.sleep(1)

        except Exception as e:
            print("Playback error:", e)

    return {"status": "Playback completed"}
