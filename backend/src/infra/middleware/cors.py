from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.infra.middleware.config import MiddlewareSettings


class CORSMiddlewareConfigurator:
    """Applies CORS middleware to a FastAPI app from configuration."""

    def __init__(self, settings: MiddlewareSettings) -> None:
        self.allow_origins = settings.cors_allow_origins

    def apply(self, app: FastAPI) -> None:
        if not self.allow_origins:
            return
        app.add_middleware(
            CORSMiddleware,
            allow_origins=self.allow_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
