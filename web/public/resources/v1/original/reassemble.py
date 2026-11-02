#!/usr/bin/env python3
"""Put this script, archive-manifest.json and all .bin parts in one directory.
Run: python reassemble.py. Validates every part and the completed archive.
"""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
manifest = json.loads((root / "archive-manifest.json").read_text(encoding="utf-8"))
dest = root / "V1.0-original.zip"
temporary = root / "V1.0-original.zip.partial"
if dest.exists() or temporary.exists():
    raise SystemExit("Output already exists; move it aside before retrying.")
whole = hashlib.sha256()
try:
    with temporary.open("xb") as output:
        for item in manifest["parts"]:
            source = root / Path(item["url"]).name
            data = source.read_bytes()
            if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise ValueError("Invalid or incomplete part: " + source.name)
            whole.update(data)
            output.write(data)
    if whole.hexdigest() != manifest["sha256"] or temporary.stat().st_size != manifest["bytes"]:
        raise ValueError("Archive checksum mismatch")
    temporary.rename(dest)
    print("Verified:", dest)
except BaseException:
    temporary.unlink(missing_ok=True)
    raise
