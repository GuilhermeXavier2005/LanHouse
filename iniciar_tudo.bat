@echo off
chcp 65001 > nul
rem ============================================================
rem  LanHouse Monitor - inicia TUDO (bancos + back-end + front-end)
rem  Pre-requisitos: Docker Desktop aberto e Python 3.10+ instalado.
rem ============================================================
cd /d "%~dp0"

echo [1/3] Verificando o Docker...
docker info >nul 2>nul
if errorlevel 1 (
    echo [ERRO] O Docker nao esta rodando. Abra o Docker Desktop, espere ele ficar "running" e execute este arquivo de novo.
    pause
    exit /b 1
)

echo [2/3] Subindo os bancos (PostgreSQL, MongoDB x3, Cassandra x3)...
echo       Na primeira vez o Docker baixa as imagens e o Cassandra leva de 2 a 4 minutos para formar o cluster.
docker compose up -d --wait postgres mongo1 mongo2 mongo3 cassandra1 cassandra2 cassandra3
if errorlevel 1 (
    echo [ERRO] Falha ao subir os containers. Veja as mensagens acima ou rode: docker compose logs
    pause
    exit /b 1
)
rem Os inicializadores (replica set do MongoDB e schema do Cassandra) rodam uma vez e encerram.
docker compose up -d mongo-init-replica cassandra-init

echo [3/3] Abrindo o back-end e o front-end em novas janelas...
start "LanHouse - Back-end (FastAPI :8000)" cmd /k "%~dp0iniciar_backend.bat"
call "%~dp0Frontend\iniciar.bat"

echo.
echo Pronto! Painel: http://localhost:5173   API: http://localhost:8000/docs
echo Se o painel mostrar "API indisponivel", aguarde o back-end terminar de instalar as dependencias e aperte F5.
pause
