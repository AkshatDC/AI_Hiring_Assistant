import os
from contextvars import ContextVar
from typing import Any, Dict, Optional

_current_session_id: ContextVar[Optional[str]] = ContextVar("current_session_id", default=None)
_current_session_config: ContextVar[Dict[str, Any]] = ContextVar("current_session_config", default={})


def set_current_session(session_id: Optional[str], config: Optional[Dict[str, Any]] = None) -> None:
    _current_session_id.set(session_id)
    _current_session_config.set(config or {})


def get_current_session_id() -> Optional[str]:
    return _current_session_id.get()


def get_current_session_config() -> Dict[str, Any]:
    return _current_session_config.get()


def get_credential(name: str, default: str = "") -> str:
    config = get_current_session_config()
    value = config.get(name)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return os.getenv(name, default)
