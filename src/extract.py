from __future__ import annotations


def normalize_phone(phone_raw: str | None = '') -> str | None:
    s = str(phone_raw or '').strip()
    has_plus = s.startswith('+')
    digits = ''.join(ch for ch in s if ch.isdigit())
    if not digits:
        return None
    return f'+{digits}' if has_plus else digits
