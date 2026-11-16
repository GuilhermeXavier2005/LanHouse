"""Tipos de validação compartilhados pelos modelos Pydantic das rotas.

Os limites seguem as colunas do PostgreSQL (Banco/PostgreSql/01_ddl_lanhouse.sql e
extensões em app/database/postgres.py) e os domínios do contrato Frontend/API.md.
Assim, entradas inválidas viram 422 (VALIDATION_ERROR) em vez de erro 500 do banco.
"""
import ipaddress
from typing import Annotated, Literal, Optional

from pydantic import AfterValidator, Field, StringConstraints


def Text(max_length: int, min_length: int = 1):
    """Texto obrigatório: remove espaços das pontas e exige 1..max_length caracteres."""
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=min_length, max_length=max_length)]


def OptText(max_length: int):
    """Texto opcional (pode ser vazio ou null), limitado a max_length caracteres."""
    return Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=max_length)]]


def _check_ip(value: Optional[str]) -> Optional[str]:
    if value is None or value.strip() == "":
        return None
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        raise ValueError("Informe um endereço IP válido (ex.: 192.168.10.101).")


IpAddress = Annotated[Optional[str], AfterValidator(_check_ip)]

# Valores monetários: NUMERIC(10,2) -> máximo 99.999.999,99
Money = Annotated[float, Field(ge=0, le=99_999_999.99)]
Percent = Annotated[float, Field(ge=0, le=100)]

# Domínios (mesmos valores de Frontend/js/constants.js)
Zone = Literal["arena", "vip", "navegacao"]
MachineSettableStatus = Literal["disponivel", "manutencao", "offline"]
PlanKind = Literal["plano", "servico"]
PlanBilling = Literal["hora", "pacote", "unidade"]
ProgramCategory = Literal["jogo", "launcher", "navegador", "comunicacao", "produtividade", "utilitario"]
ProgramLicense = Literal["gratuito", "pago"]
PaymentMethod = Literal["pix", "dinheiro", "cartao_debito", "cartao_credito"]
EndPaymentStatus = Literal["pago", "pendente"]
PaymentStatus = Literal["pago", "pendente", "cancelado"]
IncidentSeverity = Literal["baixa", "media", "alta", "critica"]
IncidentStatus = Literal["aberto", "em_andamento", "resolvido"]
MaintenanceType = Literal["preventiva", "corretiva"]
MaintenanceStatus = Literal["agendada", "em_andamento", "concluida"]
