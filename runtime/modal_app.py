import json
import os
import time
import urllib.error
import urllib.request
import uuid

import modal
from fastapi import Request
from fastapi.responses import JSONResponse

from bridge_protocol import fixed_result, sign_headers, verify_headers


APP_NAME = "jarvis-runtime"
SECRET_NAME = "jarvis-runtime-secrets"
app = modal.App(APP_NAME)
image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi==0.141.1")
runtime_secret = modal.Secret.from_name(SECRET_NAME)


class WorkerRequestError(RuntimeError):
    def __init__(self, status: int):
        self.status = status
        super().__init__(f"WORKER_HTTP_{status}")


def worker_request(path: str, payload: dict, timeout_seconds: int = 8) -> dict:
    from urllib.parse import urlsplit

    callback_url = os.environ.get("JARVIS_CALLBACK_URL", "").rstrip("/")
    secret = os.environ.get("JARVIS_INTERNAL_SECRET", "")
    parsed = urlsplit(callback_url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or
            parsed.path not in ("", "/") or parsed.query or parsed.fragment or not secret):
        raise RuntimeError("WORKER_CALLBACK_NOT_CONFIGURED")
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    headers = {"content-type": "application/json", **sign_headers(secret, path, body)}
    request = urllib.request.Request(callback_url + path, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            raw = response.read(16 * 1024 + 1)
            if len(raw) > 16 * 1024:
                raise RuntimeError("WORKER_RESPONSE_TOO_LARGE")
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as error:
        raise WorkerRequestError(error.code) from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise WorkerRequestError(503) from None


@app.function(
    image=image,
    secrets=[runtime_secret],
    min_containers=0,
    max_containers=1,
    timeout=300,
    retries=1,
)
def run_job(event_id: str, run_id: str) -> dict:
    claim = None
    try:
        try:
            claim = worker_request("/internal/claim", {"event_id": event_id, "run_id": run_id})
        except WorkerRequestError as error:
            if error.status == 409:
                return {"accepted": True, "skipped": True}
            raise

        if claim.get("already_succeeded"):
            result = claim.get("result")
        else:
            result = fixed_result(claim.get("command", ""))
        if not isinstance(result, str) or len(result) > 1900:
            raise RuntimeError("INVALID_FIXED_RESULT")
        response = worker_request(
            "/internal/complete",
            {"event_id": event_id, "run_id": run_id, "result": result},
        )
        if response.get("ok") is not True:
            raise RuntimeError("WORKER_COMPLETION_REJECTED")
        return {"accepted": True, "reply_state": response.get("reply_state", "UNKNOWN")}
    except Exception:
        if claim is not None:
            try:
                worker_request(
                    "/internal/fail",
                    {"event_id": event_id, "run_id": run_id, "error_code": "RUNNER_CALLBACK_FAILED"},
                )
            except Exception:
                pass
        raise RuntimeError("P04_RUNNER_FAILED") from None


@app.function(
    image=image,
    secrets=[runtime_secret],
    min_containers=0,
    max_containers=1,
    timeout=25,
)
@modal.fastapi_endpoint(method="POST", label="dispatch")
async def dispatch(request: Request) -> dict:
    raw_body = await request.body()
    if len(raw_body) > 16 * 1024:
        return JSONResponse({"error": "request_too_large"}, status_code=413)
    secret = os.environ.get("JARVIS_INTERNAL_SECRET", "")
    headers = {key.lower(): value for key, value in request.headers.items()}
    if not verify_headers(secret, request.url.path, raw_body, headers):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return JSONResponse({"error": "invalid_json"}, status_code=400)
    if not isinstance(payload, dict):
        return JSONResponse({"error": "invalid_job"}, status_code=400)
    event_id = payload.get("event_id")
    if payload.get("schema_version") != 1 or not isinstance(event_id, str) or not event_id.isdigit() or not 17 <= len(event_id) <= 20:
        return JSONResponse({"error": "invalid_job"}, status_code=400)
    run_id = str(uuid.uuid4())
    try:
        call = await run_job.spawn.aio(event_id, run_id)
    except Exception:
        return JSONResponse({"error": "spawn_unavailable"}, status_code=503)
    return {"call_id": call.object_id}
