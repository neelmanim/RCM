"""
Local CORS proxy for Alternate Messenger API testing.
Serves dialer-test.html and proxies /api/* to Alternate Messenger QA.
"""
import http.server
import json
import os
import urllib.request
import urllib.error

MESSENGER_BASE = "https://qa-app.alternatecrm.com/contact-center/v1"
PORT = 8899
DIR = os.path.dirname(os.path.abspath(__file__))


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            self._proxy("GET")
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self._proxy("POST")
        else:
            self.send_error(404)

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")

    def _proxy(self, method):
        # /api/calls/initiate -> /calls/initiate
        path = self.path[4:]  # strip /api
        url = f"{MESSENGER_BASE}{path}"

        # Forward headers
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        auth = self.headers.get("Authorization")
        if auth:
            headers["Authorization"] = auth

        # Read body for POST
        body = None
        if method == "POST":
            length = int(self.headers.get("Content-Length", 0))
            if length:
                body = self.rfile.read(length)

        try:
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp_body = resp.read()
                self.send_response(resp.status)
                self._cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(resp_body)
        except urllib.error.HTTPError as e:
            err_body = e.read()
            self.send_response(e.code)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(err_body)
        except Exception as e:
            self.send_response(502)
            self._cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())


if __name__ == "__main__":
    print(f"🚀 Proxy server on http://localhost:{PORT}")
    print(f"   Proxying /api/* → {MESSENGER_BASE}")
    print(f"   Open http://localhost:{PORT}/dialer-test.html")
    server = http.server.HTTPServer(("", PORT), ProxyHandler)
    server.serve_forever()
