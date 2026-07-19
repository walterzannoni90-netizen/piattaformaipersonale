import asyncio
import json
import os
import secrets
import sqlite3
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

try:
    from app.agent.manus import Manus
except ImportError as exc:  # pragma: no cover
    Manus = None
    OPENMANUS_IMPORT_ERROR = str(exc)
else:
    OPENMANUS_IMPORT_ERROR = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TaskRequest(BaseModel):
    prompt: str = Field(min_length=10, max_length=16000)
    metadata: dict[str, Any] = Field(default_factory=dict)


@dataclass
class TaskState:
    id: str
    prompt: str
    metadata: dict[str, Any]
    status: str = "queued"
    result: Any = None
    error: str | None = None
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)
    cancel_requested: bool = False


DB_PATH = Path(os.getenv("OPENMANUS_STATE_DB", "/var/data/openmanus-tasks.sqlite3"))
TASKS: dict[str, TaskState] = {}
RUNNING: dict[str, asyncio.Task[None]] = {}
TASK_LOCK = asyncio.Lock()


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            payload TEXT NOT NULL
        )
    """)
    return connection


def persist(task: TaskState) -> None:
    with connect() as connection:
        connection.execute(
            "INSERT INTO tasks(id, payload) VALUES(?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
            (task.id, json.dumps(asdict(task), ensure_ascii=False, default=str)),
        )


def restore() -> None:
    with connect() as connection:
        rows = connection.execute("SELECT payload FROM tasks").fetchall()
    for (payload,) in rows:
        data = json.loads(payload)
        if data.get("status") in {"queued", "running"}:
            data["status"] = "failed"
            data["error"] = "Engine restarted before the task completed"
            data["updated_at"] = utc_now()
        task = TaskState(**data)
        TASKS[task.id] = task
        persist(task)


async def authorize(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("OPENMANUS_SERVICE_TOKEN", "").strip()
    if not expected and os.getenv("ENVIRONMENT", "development") == "production":
        raise HTTPException(status_code=503, detail="OPENMANUS_SERVICE_TOKEN is required in production")
    if not expected:
        return
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


async def set_state(task: TaskState, **changes: Any) -> None:
    async with TASK_LOCK:
        for key, value in changes.items():
            setattr(task, key, value)
        task.updated_at = utc_now()
        persist(task)


async def execute_task(task_id: str) -> None:
    task = TASKS[task_id]
    agent = None
    try:
        if task.cancel_requested:
            await set_state(task, status="cancelled")
            return
        await set_state(task, status="running", error=None)
        if Manus is None:
            raise RuntimeError(f"OpenManus unavailable: {OPENMANUS_IMPORT_ERROR}")
        agent = await Manus.create()
        output = await agent.run(task.prompt)
        if task.cancel_requested:
            await set_state(task, status="cancelled")
        else:
            await set_state(task, status="completed", result=output)
    except asyncio.CancelledError:
        await set_state(task, status="cancelled")
        raise
    except Exception as exc:
        await set_state(task, status="failed", error=f"{type(exc).__name__}: {exc}")
    finally:
        RUNNING.pop(task_id, None)
        if agent is not None:
            await agent.cleanup()


@asynccontextmanager
async def lifespan(_: FastAPI):
    restore()
    yield
    running = list(RUNNING.values())
    for execution in running:
        execution.cancel()
    if running:
        await asyncio.gather(*running, return_exceptions=True)


app = FastAPI(title="WES OpenManus Engine", version="0.2.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok" if Manus is not None else "degraded",
        "engine": "openmanus",
        "version": app.version,
        "openmanus_ready": Manus is not None,
        "persisted_tasks": len(TASKS),
        "running_tasks": len(RUNNING),
        "error": OPENMANUS_IMPORT_ERROR,
    }


@app.post("/v1/tasks", status_code=202, dependencies=[Depends(authorize)])
async def create_task(request: TaskRequest) -> dict[str, Any]:
    task = TaskState(id=secrets.token_hex(16), prompt=request.prompt.strip(), metadata=request.metadata)
    async with TASK_LOCK:
        TASKS[task.id] = task
        persist(task)
        RUNNING[task.id] = asyncio.create_task(execute_task(task.id), name=f"openmanus:{task.id}")
    return asdict(task)


@app.get("/v1/tasks/{task_id}", dependencies=[Depends(authorize)])
async def get_task(task_id: str) -> dict[str, Any]:
    task = TASKS.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return asdict(task)


@app.post("/v1/tasks/{task_id}/cancel", dependencies=[Depends(authorize)])
async def cancel_task(task_id: str) -> dict[str, Any]:
    task = TASKS.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    await set_state(task, cancel_requested=True)
    execution = RUNNING.get(task_id)
    if execution and not execution.done():
        execution.cancel()
    elif task.status == "queued":
        await set_state(task, status="cancelled")
    return asdict(task)
