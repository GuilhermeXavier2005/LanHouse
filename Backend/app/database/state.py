from typing import Dict

# Estado de simulação de queda dos bancos (para demonstração do Teorema CAP)
_simulated_down: Dict[str, bool] = {
    "postgres": False,
    "mongodb": False,
    "cassandra": False,
}

def is_simulated_down(service: str) -> bool:
    return _simulated_down.get(service.lower(), False)

def set_simulated_down(service: str, down: bool) -> None:
    svc = service.lower()
    if svc in _simulated_down:
        _simulated_down[svc] = down

def get_simulated_state() -> Dict[str, bool]:
    return dict(_simulated_down)
