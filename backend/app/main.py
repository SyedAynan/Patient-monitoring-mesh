"""FastAPI application factory.

Start with:
    python -m uvicorn backend.app.main:create_app --factory --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .simulator_state import state
from .routes import devices, patients, alerts, network, realtime, risk
from .security import auth_mode_for_health


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the simulator on startup, stop on shutdown."""
    state.start()
    yield
    state.stop()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Patient Monitoring Mesh — Backend",
        version="0.5.0",
        lifespan=lifespan,
    )

    # Allow the Next.js dev server (localhost:3000) to call us.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(devices.router, prefix="/api/v1")
    app.include_router(patients.router, prefix="/api/v1")
    app.include_router(alerts.router, prefix="/api/v1")
    app.include_router(network.router, prefix="/api/v1")
    app.include_router(realtime.router, prefix="/api/v1")
    app.include_router(risk.router, prefix="/api/v1")

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "tick_count": state._tick_count,
            "auth_mode": auth_mode_for_health(),
        }

    return app
