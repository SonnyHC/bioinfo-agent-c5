"""Stateless Vercel handler. Each request owns a temporary workspace."""
from __future__ import annotations

import base64
import binascii
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import zipfile
from http.server import BaseHTTPRequestHandler

os.environ.setdefault("MPLBACKEND", "Agg")
os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "bioinfobuddy-mpl"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from engine import DataError, doctor, inspect_table, prepare, read_table, render

MAX_FILE = 2 * 1024 * 1024
MAX_REQUEST = 3 * 1024 * 1024
MAX_RESPONSE = 4 * 1024 * 1024
PLOT_LOCK = threading.Lock()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")


def analyze(body):
    if not isinstance(body, dict):
        raise DataError("请求必须是 JSON 对象。")
    action = body.get("action")
    if action == "status":
        doctor()
        return "application/json", json_bytes({"version": "0.2.0", "pythonReady": True,
            "mode": "browser", "maxUploadMB": 2})
    if action not in {"inspect", "preview", "render"}:
        raise DataError("未知的分析操作。")
    name = body.get("name", "")
    if not isinstance(name, str) or len(name) > 250:
        raise DataError("文件名无效。")
    suffix = Path(name).suffix.lower()
    if suffix not in {".csv", ".tsv", ".xlsx"}:
        raise DataError("请选择 CSV、TSV 或 XLSX 文件。")
    try:
        encoded = body.get("file", "")
        if not isinstance(encoded, str) or len(encoded) > (MAX_FILE * 4 // 3 + 8):
            raise DataError("文件超过 2 MB，请选择需要分析的表格。")
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise DataError("文件编码无效。") from exc
    if not raw or len(raw) > MAX_FILE:
        raise DataError("请选择非空且不超过 2 MB 的文件。")
    config = body.get("config", {})
    if not isinstance(config, dict) or len(json_bytes(config)) > 64000:
        raise DataError("绘图参数无效或过大。")
    # No caller-controlled paths, saved state, shell commands or generated code.
    with tempfile.TemporaryDirectory(prefix="bioinfobuddy-") as temp:
        source = Path(temp) / ("input" + suffix)
        source.write_bytes(raw)
        table = read_table(source)
        if action == "inspect":
            return "application/json", json_bytes(inspect_table(table))
        if action == "preview":
            result = prepare(table, config)
            keys = ("preview", "outputColumns", "inputRows", "outputRows", "droppedRows", "steps", "warnings")
            return "application/json", json_bytes({key: result[key] for key in keys})
        output = Path(temp) / "result"
        # Matplotlib uses process-global state; Fluid Compute may overlap requests.
        with PLOT_LOCK:
            summary = render(table, config, output)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for file in sorted(output.iterdir()):
                bundle.write(file, file.name)
            bundle.writestr("summary.json", json_bytes(summary))
        content = archive.getvalue()
        if len(content) > MAX_RESPONSE:
            raise DataError("结果文件超过 4 MB，请减少绘图数据后重试。")
        return "application/zip", content


class handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Never log uploaded tables, credentials, or request bodies.

    def respond(self, status, content_type, content):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def do_POST(self):
        try:
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                self.respond(415, "application/json", json_bytes({"error": "需要 JSON 请求。"}))
                return
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_REQUEST:
                self.respond(413, "application/json", json_bytes({"error": "请求过大，请上传不超过 2 MB 的文件。"}))
                return
            body = json.loads(self.rfile.read(length))
            content_type, content = analyze(body)
            if len(content) > MAX_RESPONSE:
                raise DataError("返回内容过大，请缩小数据后重试。")
            self.respond(200, content_type, content)
        except (DataError, ValueError, TypeError) as exc:
            self.respond(422, "application/json", json_bytes({"error": str(exc)}))
        except Exception:
            self.respond(500, "application/json", json_bytes({"error": "绘图服务暂时不可用，请稍后重试。"}))

    def do_GET(self):
        self.respond(405, "application/json", json_bytes({"error": "请使用 POST 请求。"}))
