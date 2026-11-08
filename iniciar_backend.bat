@echo off
chcp 65001 > nul
echo ========================================================
echo       LanHouse Monitor - Iniciando Back-end (FastAPI)
echo ========================================================
echo.
cd /d "%~dp0Backend"

if not exist .env (
    if exist .env.example (
        echo Criando arquivo .env a partir de .env.example...
        copy .env.example .env > nul
    )
)

if not exist .venv (
    echo Criando ambiente virtual Python...
    python -m venv .venv
)

echo Ativando ambiente virtual...
call .venv\Scripts\activate.bat

echo Verificando dependencias...
pip install -r requirements.txt --quiet

echo.
echo Iniciando servidor Uvicorn na porta 8000...
echo Swagger UI: http://localhost:8000/docs
echo API Base:   http://localhost:8000/api
echo.
python run.py
pause
