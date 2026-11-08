from typing import Optional, Dict, Any
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

class ApiError(HTTPException):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        source: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(status_code=status_code, detail=message)
        self.code = code
        self.message = message
        self.source = source
        self.details = details

    def to_dict(self):
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "source": self.source,
                "details": self.details,
            }
        }

class NotFoundError(ApiError):
    def __init__(self, resource: str = "Registro"):
        super().__init__(
            status_code=404,
            code="NOT_FOUND",
            message=f"{resource} não encontrado(a).",
        )

class ConflictError(ApiError):
    def __init__(self, message: str):
        super().__init__(
            status_code=409,
            code="CONFLICT",
            message=message,
        )

class ValidationError(ApiError):
    def __init__(self, details: Dict[str, str], message: str = "Verifique os campos destacados."):
        super().__init__(
            status_code=422,
            code="VALIDATION_ERROR",
            message=message,
            details=details,
        )

class DatabaseUnavailableError(ApiError):
    def __init__(self, source: str, message: Optional[str] = None):
        labels = {
            "postgres": "PostgreSQL",
            "mongodb": "MongoDB",
            "cassandra": "Apache Cassandra",
        }
        db_label = labels.get(source, source)
        msg = message or f"Não foi possível consultar o {db_label}. Tente novamente em instantes."
        super().__init__(
            status_code=503,
            code="DB_UNAVAILABLE",
            message=msg,
            source=source,
        )

async def api_error_handler(request: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status_code, content=exc.to_dict())

async def validation_error_handler(request: Request, exc: RequestValidationError):
    details = {}
    for err in exc.errors():
        loc = err.get("loc", [])
        field = str(loc[-1]) if loc else "general"
        details[field] = err.get("msg", "Campo inválido.")
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Verifique os campos destacados.",
                "source": None,
                "details": details,
            }
        },
    )
