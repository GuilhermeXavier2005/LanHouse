@echo off
rem Inicia o LanHouse Monitor: sobe o servidor local e abre o navegador.
rem Deixe a janela do servidor aberta enquanto usa o painel.
cd /d "%~dp0"

set PY=py
where py >nul 2>nul || set PY=python
where %PY% >nul 2>nul || (
  echo Python nao encontrado. Instale em https://www.python.org/downloads/
  pause
  exit /b 1
)

start "LanHouse Monitor - servidor (feche para parar)" %PY% serve.py 5173
timeout /t 2 /nobreak >nul
start "" http://localhost:5173
