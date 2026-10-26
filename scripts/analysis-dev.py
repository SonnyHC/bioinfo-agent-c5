"""Local adapter for the exact same stateless handler deployed on Vercel."""
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api.analysis import handler

ThreadingHTTPServer(("127.0.0.1", 4319), handler).serve_forever()
