from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError

from app import config
from app.errors import ApiError, api_error_handler, validation_error_handler
from app.database.postgres import ensure_schema_extension
from app.database.mongodb import seed_initial_events
from app.services.cassandra_service import (
    start_cassandra_background_worker,
    stop_cassandra_background_worker,
)

from app.routers import health, machines, sessions, resources, reports, events, metrics

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("=" * 60)
    print("Iniciando LanHouse Monitor Back-end API...")
    print(f"CORS liberado para: {config.CORS_ORIGIN}")
    # Inicializa schema complementar e seeds (PostgreSQL, MongoDB e Cassandra)
    ensure_schema_extension()
    seed_initial_events()
    start_cassandra_background_worker()
    print("Sistema pronto na porta 8000!")
    print("Swagger UI disponível em: http://localhost:8000/docs")
    print("=" * 60)
    yield
    print("Encerrando LanHouse Monitor Back-end...")
    stop_cassandra_background_worker()

app = FastAPI(
    title="LanHouse Monitor API",
    description="API REST para monitoramento poliglota (PostgreSQL + MongoDB + Cassandra)",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS liberado para o Front-end
app.add_middleware(
    CORSMiddleware,
    allow_origins=[config.CORS_ORIGIN, "http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Exception handlers padronizados conforme Frontend/API.md
app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)

# Registra todos os roteadores sob o prefixo /api (contrato oficial)
api_routers = [
    health.router,
    machines.router,
    sessions.router,
    resources.router,
    reports.router,
    events.router,
    metrics.router,
]

for r in api_routers:
    app.include_router(r, prefix="/api")
    # Também inclui na raiz para compatibilidade caso o cliente chame sem /api
    app.include_router(r)

@app.get("/")
def root():
    return {
        "message": "LanHouse Monitor API está ativa.",
        "api_prefix": "/api",
        "docs": "/docs",
    }
