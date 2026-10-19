"""NoteTaker local server: serves ONE folder on 127.0.0.1 only, and tells the browser to re-check for updates on every load.
Usage: python serve.py <port> <folder>
Why: the plain `python -m http.server` sends no caching instructions, so Chrome may keep showing an old copy of the app after it is updated.
"no-cache" does not stop caching; it makes the browser ask "has this changed?" each time, and unchanged files are answered with a tiny 304."""
import functools
import http.server
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    port, folder = int(sys.argv[1]), sys.argv[2]
    handler = functools.partial(Handler, directory=folder)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
