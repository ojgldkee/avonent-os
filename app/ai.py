import json
import httpx
from .config import settings

SYSTEM_PROMPT = """You are the Avonent OS Creative Strategist for e-commerce brands.
Create original direct-response concepts. Never invent competitor performance, supplier prices, scientific proof, or sales volume.
For supplements, avoid diagnosing, treating, curing, or preventing disease and flag claims that require substantiation.
Return concise JSON only with keys: title, angle, hook, script, primary_text, headline.
"""

def generate_creative(product_name: str, category: str, notes: str) -> dict:
    if not (settings.ai_base_url and settings.ai_model):
        return {
            "title": f"{product_name}: Why This Product?",
            "angle": "education + product curiosity",
            "hook": f"Most people never ask what makes one {product_name} different from another.",
            "script": f"Open with the hook. Show the product. Explain what it is, what a buyer should look for, and why the brand chose its formulation. End with a clear, non-medical call to action. Product notes: {notes[:300]}",
            "primary_text": f"A simpler way to understand {product_name}. See what is inside, why it matters, and decide if it fits your routine.",
            "headline": f"Meet {product_name}",
        }

    headers = {"Content-Type": "application/json"}
    if settings.ai_api_key:
        headers["Authorization"] = f"Bearer {settings.ai_api_key}"
    payload = {
        "model": settings.ai_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Product: {product_name}\nCategory: {category}\nNotes: {notes}"},
        ],
        "temperature": 0.7,
        "response_format": {"type": "json_object"},
    }
    with httpx.Client(timeout=60) as client:
        r = client.post(settings.ai_base_url.rstrip("/") + "/v1/chat/completions", headers=headers, json=payload)
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
        return json.loads(content)
