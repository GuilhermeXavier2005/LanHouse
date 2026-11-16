@echo off
chcp 65001 > nul
echo ========================================================
echo       LanHouse Monitor - Iniciando Back-end (FastAPI)
echo ========================================================
echo.
cd /d "%~dp0Backend"

rem Localiza um Python compativel (3.10 a 3.14). O driver do Cassandra ainda nao tem
rem pacote pronto para versoes mais novas, entao, havendo varias instaladas, escolhe a
rem mais nova dentro da faixa suportada (via launcher "py" do instalador oficial).
set "PY="
for %%V in (3.14 3.13 3.12 3.11 3.10) do (
    if not defined PY (
        py -%%V -c "import sys" >nul 2>nul && set "PY=py -%%V"
    )
)
if not defined PY (
    python -c "import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 14) else 1)" >nul 2>nul && set "PY=python"
)
if not defined PY (
    echo [ERRO] Nenhum Python compativel encontrado. O back-end precisa do Python 3.10 a 3.14.
    echo        Instale o Python 3.13 ou 3.14 em https://www.python.org/downloads/
    echo        e marque a opcao "Add python.exe to PATH" durante a instalacao.
    pause
    exit /b 1
)
echo Usando: %PY%

if not exist .env (
    if exist .env.example (
        echo Criando arquivo .env a partir de .env.example...
        copy .env.example .env > nul
    )
)

if not exist .venv\Scripts\python.exe (
    echo Criando ambiente virtual Python em Backend\.venv ...
    %PY% -m venv .venv
    if errorlevel 1 (
        echo [ERRO] Nao foi possivel criar o ambiente virtual.
        pause
        exit /b 1
    )
)

echo Instalando/verificando dependencias (a primeira vez pode levar alguns minutos)...
.venv\Scripts\python.exe -m pip install --disable-pip-version-check -q -r requirements.txt
if errorlevel 1 (
    echo [ERRO] Falha ao instalar as dependencias. Verifique sua conexao com a internet.
    echo        Se o ambiente foi criado com uma versao de Python incompativel, apague a pasta
    echo        Backend\.venv e execute este arquivo novamente.
    pause
    exit /b 1
)

echo.
echo Iniciando servidor Uvicorn na porta 8000...
echo Swagger UI: http://localhost:8000/docs
echo API Base:   http://localhost:8000/api
echo Health:     http://localhost:8000/api/health
echo (Feche esta janela ou pressione Ctrl+C para parar o back-end.)
echo.
.venv\Scripts\python.exe run.py
pause
