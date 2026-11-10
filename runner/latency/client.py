"""Tiny HTTP client for the warm server (no curl in the image).

Run with `python3 -S -I client.py URL [CODE]`: -S skips site imports so
startup stays ~20 ms. With no CODE it does a GET (readiness probe).
"""

import http.client
import sys
from urllib.parse import urlsplit

url = urlsplit(sys.argv[1])
conn = http.client.HTTPConnection(url.hostname, url.port, timeout=10)
if len(sys.argv) > 2:
    conn.request("POST", url.path or "/", body=sys.argv[2].encode("utf-8"), headers={"Content-Type": "text/plain"})
else:
    conn.request("GET", url.path or "/")
resp = conn.getresponse()
sys.stdout.write(resp.read().decode("utf-8"))
sys.exit(0 if resp.status == 200 else 1)
