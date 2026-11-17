"""Jarvis Python Intelligence Engine — FastAPI service on 127.0.0.1:8791
Specialized AI processing: structured outputs, typed tasks, ML-ready endpoints.
Communicates with NVIDIA OpenAI-compatible API (same key as JS side via env)."""
import os, json, time
from typing import Optional
import httpx
from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="Jarvis Intelligence Engine")
LLM_BASE = os.environ.get("JARVIS_LLM_BASE", "https://integrate.api.nvidia.com/v1")
LLM_KEY = os.environ.get("NVIDIA_API_KEY", "")
LLM_MODEL = os.environ.get("JARVIS_MODEL", "nvidia/nemotron-3-ultra-550b-a55b")
START = time.time()


class ChatReq(BaseModel):
    messages: list[dict]
    temperature: float = 0.6


class StructuredReq(BaseModel):
    prompt: str
    schema_hint: str = "Return valid JSON only."
    system: str = "You output strict JSON."


class TaskReq(BaseModel):
    goal: str
    context: str = ""


async def llm(messages, temperature=0.6, json_mode=False):
    body = {"model": LLM_MODEL, "messages": messages, "temperature": temperature}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    async with httpx.AsyncClient(timeout=90) as c:
        r = await c.post(f"{LLM_BASE}/chat/completions",
                         headers={"Authorization": f"Bearer {LLM_KEY}"},
                         json=body)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


@app.get("/health")
def health():
    return {"ok": True, "uptime_s": round(time.time() - START, 1), "model": LLM_MODEL}


@app.post("/complete")
async def complete(req: ChatReq):
    """Plain LLM completion — Python-side reasoning."""
    try:
        out = await llm(req.messages, req.temperature)
        return {"ok": True, "reply": out}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/structured")
async def structured(req: StructuredReq):
    """Schema-guided JSON output — typed agent responses."""
    try:
        msgs = [
            {"role": "system", "content": req.system + "\n" + req.schema_hint},
            {"role": "user", "content": req.prompt},
        ]
        out = await llm(msgs, 0.3, json_mode=True)
        return {"ok": True, "data": json.loads(out)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/task")
async def task(req: TaskReq):
    """Autonomous task: Python agent reasons step-by-step and returns structured plan+result."""
    try:
        msgs = [
            {"role": "system", "content": (
                "You are Jarvis's Python intelligence engine. Break the goal into steps, "
                "reason carefully, and return JSON: {\"steps\": [...], \"result\": \"...\", \"confidence\": 0-1}. "
                "If tools/data are needed, say so in steps."
            )},
            {"role": "user", "content": f"GOAL: {req.goal}\nCONTEXT: {req.context}"},
        ]
        out = await llm(msgs, 0.4, json_mode=True)
        return {"ok": True, "data": json.loads(out)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/analyze")
async def analyze(req: ChatReq):
    """Deep analysis endpoint — longer reasoning pass for complex inputs."""
    try:
        msgs = [{"role": "system", "content": "You are an expert analyst. Be thorough and precise."}] + req.messages
        out = await llm(msgs, 0.4)
        return {"ok": True, "analysis": out}
    except Exception as e:
        return {"ok": False, "error": str(e)}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8791, log_level="warning")
