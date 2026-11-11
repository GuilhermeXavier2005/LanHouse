import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

PORT = int(os.getenv("PORT", "8000"))
HOST = os.getenv("HOST", "0.0.0.0")
CORS_ORIGIN = os.getenv("CORS_ORIGIN", "http://localhost:5173")

# PostgreSQL (5433 evita conflito com serviço PostgreSQL nativo do Windows na 5432)
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "127.0.0.1")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5433"))
POSTGRES_DB = os.getenv("POSTGRES_DB", "lanhouse")
POSTGRES_USER = os.getenv("POSTGRES_USER", "lanhouse")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "lanhouse")

# MongoDB
MONGO_URI = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000")
MONGO_DB = os.getenv("MONGO_DB", "lanhouse")

# Apache Cassandra (Cluster de 3 nós mapeados nas portas 9042, 9043, 9044 do host)
CASSANDRA_HOST = os.getenv("CASSANDRA_HOST", "127.0.0.1")
CASSANDRA_PORTS = [int(p.strip()) for p in os.getenv("CASSANDRA_PORTS", "9042,9043,9044").split(",") if p.strip()]
CASSANDRA_KEYSPACE = os.getenv("CASSANDRA_KEYSPACE", "lanhouse")
