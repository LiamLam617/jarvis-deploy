import hashlib
import hmac
import re
import time


MAX_CLOCK_SKEW_SECONDS = 5 * 60
_HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def signature_input(timestamp: str, path: str, body: bytes) -> bytes:
    return timestamp.encode("ascii") + b"\n" + path.encode("utf-8") + b"\n" + body


def sign_headers(secret: str, path: str, body: bytes, timestamp: int | None = None) -> dict[str, str]:
    stamp = str(int(time.time()) if timestamp is None else timestamp)
    digest = hmac.new(secret.encode("utf-8"), signature_input(stamp, path, body), hashlib.sha256).hexdigest()
    return {"x-jarvis-timestamp": stamp, "x-jarvis-signature": digest}


def verify_headers(
    secret: str,
    path: str,
    body: bytes,
    headers: dict[str, str],
    now: int | None = None,
) -> bool:
    timestamp = headers.get("x-jarvis-timestamp", "")
    signature = headers.get("x-jarvis-signature", "")
    if not secret or not re.fullmatch(r"\d{10,12}", timestamp) or not _HEX_SHA256.fullmatch(signature):
        return False
    current = int(time.time()) if now is None else now
    if abs(current - int(timestamp)) > MAX_CLOCK_SKEW_SECONDS:
        return False
    expected = hmac.new(secret.encode("utf-8"), signature_input(timestamp, path, body), hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)


def fixed_result(command: str) -> str:
    if command == "capture":
        return "P04 固定回覆：Queue 與 Modal 已處理此連結測試；尚未保存。"
    if command == "jarvis":
        return "P04 固定回覆：Queue 與 Modal 派發已完成；Hermes 尚未接入。"
    raise ValueError("UNSUPPORTED_P04_COMMAND")
