import asyncio
import os
import secrets
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

try:
    from app.agent.manus import Manus
except ImportError as exc:  # pragma: no cover - exercised by container health check
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


TASKS: dict[str, TaskState] = {}
TASK_LOCK = asyncio.Lock()


async def authorize(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("OPENMANUS_SERVICE_TOKEN", "").strip()
    if not expected:
        return
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


async def execute_task(task_id: str) -> None:
    async with TASK_LOCK:
        task = TASKS[task_id]
        if task.cancel_requested:
            task.status = "cancelled"
            task.updated_at = utc_now()
            return
        task.status = "running"
        task.updated_at = utc_now()

    agent = None
    try:
        if Manus is None:
            raise RuntimeError(f"OpenManus unavailable: {OPENMANUS_IMPORT_ERROR}")
        agent = await Manus.create()
        output = await agent.run(task.prompt)
        async with TASK_LOCK:
            if task.cancel_requested:
                task.status = "cancelled"
            else:
                task.status = "completed"
                task.result = output
            task.updated_at = utc_now()
    except asyncio.CancelledError:
        async with TASK_LOCK:
            task.status = "cancelled"
            task.updated_at = utc_now()
        raise
    except Exception as exc:
        async with TASK_LOCK:
            task.status = "failed"
            task.error = f"{type(exc).__name__}: {exc}"
            task.updated_at = utc_now()
    finally:
        if agent is not None:
            await agent.cleanup()


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    async with TASK_LOCK:
        for task in TASKS.values():
            if task.status in {"queued", "running"}:
                task.cancel_requested = True


app = FastAPI(title="WES OpenManus Engine", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok" if Manus is not None else "degraded",
        "engine": "openmanus",
        "openmanus_ready": Manus is not None,
        "error": OPENMANUS_IMPORT_ERROR,
    }


@app.post("/v1/tasks", status_code=202, dependencies=[Depends(authorize)])
async def create_task(request: TaskRequest, background: BackgroundTasks) -> dict[str, Any]:
    task = TaskState(id=secrets.token_hex(16), prompt=request.prompt.strip(), metadata=request.metadata)
    async with TASK_LOCK:
        TASKS[task.id] = task
    background.add_task(execute_task, task.id)
    return asdict(task)


@app.get("/v1/tasks/{task_id}", dependencies=[Depends(authorize)])
async def get_task(task_id: str) -> dict[str, Any]:
    async with TASK_LOCK:
        task = TASKS.get(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")
        return asdict(task)


@app.post("/v1/tasks/{task_id}/cancel", dependencies=[Depends(authorize)])
async def cancel_task(task_id: str) -> dict[str, Any]:
    async with TASK_LOCK:
        task = TASKS.get(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="Task not found")
        task.cancel_requested = True
        if task.status == "queued":
            task.status = "cancelled"
        task.updated_at = utc_now()
        return asdict(task)
