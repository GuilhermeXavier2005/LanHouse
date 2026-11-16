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

_PT_MESSAGES = {
    "missing": "Campo obrigatório.",
    "string_too_short": "Preencha este campo.",
    "string_too_long": "Texto muito longo (máximo de {max_length} caracteres).",
    "literal_error": "Valor inválido. Opções aceitas: {expected}.",
    "greater_than": "O valor deve ser maior que {gt}.",
    "greater_than_equal": "O valor deve ser maior ou igual a {ge}.",
    "less_than": "O valor deve ser menor que {lt}.",
    "less_than_equal": "O valor deve ser menor ou igual a {le}.",
    "int_parsing": "Informe um número inteiro.",
    "int_from_float": "Informe um número inteiro.",
    "int_type": "Informe um número inteiro.",
    "float_parsing": "Informe um número.",
    "float_type": "Informe um número.",
    "bool_parsing": "Informe verdadeiro ou falso.",
    "date_from_datetime_parsing": "Data inválida (use AAAA-MM-DD).",
    "date_parsing": "Data inválida (use AAAA-MM-DD).",
    "date_type": "Data inválida (use AAAA-MM-DD).",
    "datetime_parsing": "Data/hora inválida (use o formato ISO 8601).",
    "datetime_from_date_parsing": "Data/hora inválida (use o formato ISO 8601).",
    "json_invalid": "JSON inválido no corpo da requisição.",
    "model_attributes_type": "Corpo da requisição inválido.",
    "dict_type": "Corpo da requisição inválido.",
    "list_type": "Informe uma lista.",
    "string_type": "Informe um texto.",
}


def _translate(err: dict) -> str:
    template = _PT_MESSAGES.get(err.get("type", ""))
    if template is None:
        msg = str(err.get("msg", "Campo inválido."))
        # Mensagens de validadores próprios chegam como "Value error, <mensagem>"
        return msg.split("Value error, ", 1)[-1]
    ctx = {}
    for key, val in (err.get("ctx") or {}).items():
        if isinstance(val, float) and val.is_integer():
            val = int(val)
        ctx[key] = str(val).replace(" or ", " ou ")
    try:
        return template.format(**ctx)
    except (KeyError, IndexError):
        return template.split(" (")[0].split(" Opções")[0]


async def validation_error_handler(request: Request, exc: RequestValidationError):
    details = {}
    for err in exc.errors():
        loc = [str(part) for part in err.get("loc", []) if part not in ("body", "query", "path")]
        field = loc[0] if loc and err.get("type") != "json_invalid" else "general"
        details.setdefault(field, _translate(err))
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


def _error_body(code: str, message: str, source: Optional[str] = None, details: Optional[Dict[str, Any]] = None):
    return {"error": {"code": code, "message": message, "source": source, "details": details}}


async def postgres_error_handler(request: Request, exc: Exception):
    """Rede de segurança: erros de integridade/dados do PostgreSQL viram 409/422, nunca 500."""
    import psycopg2
    from psycopg2 import errorcodes

    pgcode = getattr(exc, "pgcode", None)
    diag = getattr(exc, "diag", None)
    constraint = getattr(diag, "constraint_name", None) if diag else None
    column = getattr(diag, "column_name", None) if diag else None

    if pgcode == errorcodes.UNIQUE_VIOLATION:
        return JSONResponse(status_code=409, content=_error_body(
            "CONFLICT", "Já existe um registro com esses dados.", details={"constraint": constraint} if constraint else None))
    if pgcode == errorcodes.FOREIGN_KEY_VIOLATION:
        msg = ("O registro está vinculado a outros dados e não pode ser removido."
               if request.method == "DELETE" else "Registro relacionado inexistente.")
        return JSONResponse(status_code=409 if request.method == "DELETE" else 422, content=_error_body(
            "CONFLICT" if request.method == "DELETE" else "VALIDATION_ERROR", msg))
    if isinstance(exc, (psycopg2.IntegrityError, psycopg2.DataError)):
        details = {column: "Valor inválido."} if column else None
        return JSONResponse(status_code=422, content=_error_body(
            "VALIDATION_ERROR", "Valores inválidos para o banco de dados. Verifique os campos.", details=details))
    if isinstance(exc, (psycopg2.OperationalError, psycopg2.InterfaceError)):
        return JSONResponse(status_code=503, content=_error_body(
            "DB_UNAVAILABLE", "Não foi possível consultar o PostgreSQL. Tente novamente em instantes.", source="postgres"))
    print(f"[ERRO] {request.method} {request.url.path}: {exc!r}")
    return JSONResponse(status_code=500, content=_error_body("INTERNAL_ERROR", "Erro inesperado no PostgreSQL.", source="postgres"))


async def mongo_error_handler(request: Request, exc: Exception):
    """Falhas do MongoDB no meio de uma requisição (ex.: troca de primário) viram 503."""
    return JSONResponse(status_code=503, content=_error_body(
        "DB_UNAVAILABLE", "Não foi possível consultar o MongoDB. Tente novamente em instantes.", source="mongodb"))


async def unhandled_error_handler(request: Request, exc: Exception):
    """Último recurso: registra no console e devolve o erro no formato padrão da API."""
    import traceback
    traceback.print_exception(exc)
    return JSONResponse(status_code=500, content=_error_body(
        "INTERNAL_ERROR", "Erro inesperado no servidor. Veja o console do back-end para detalhes."))
