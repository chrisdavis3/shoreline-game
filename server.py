import http.server
import os
import sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def send_header(self, keyword, value):
        # Drop validators so the browser can never quietly reuse a cached copy.
        if keyword in ('Last-Modified', 'ETag'):
            return
        super().send_header(keyword, value)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
    http.server.test(HandlerClass=NoCacheHandler, port=port, bind='127.0.0.1')
