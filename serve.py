"""Servidor estático de desenvolvimento para o front-end.

Igual ao `python -m http.server`, mas desliga o cache do navegador para que
alterações em CSS/JS apareçam com um simples F5.

Uso:  py serve.py            (porta 5173)
      py serve.py 3000       (outra porta)
"""

import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), NoCacheHandler) as httpd:
        print(f"LanHouse Monitor em http://localhost:{PORT}  (Ctrl+C para parar)")
        httpd.serve_forever()
