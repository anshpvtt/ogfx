"""Logger setup for MT5 bridge — file + console output."""

import logging
import os
from logging.handlers import RotatingFileHandler


def setup_logger(log_dir: str = "logs", log_level: str = "INFO") -> None:
    os.makedirs(log_dir, exist_ok=True)
    level = getattr(logging, log_level.upper(), logging.INFO)

    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)-8s] %(name)s — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    root = logging.getLogger()
    root.setLevel(level)

    # Console handler
    console = logging.StreamHandler()
    console.setFormatter(fmt)
    console.setLevel(level)
    root.addHandler(console)

    # Rotating file handler — 5 MB × 3 backups
    file_handler = RotatingFileHandler(
        os.path.join(log_dir, "bridge.log"),
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(fmt)
    file_handler.setLevel(level)
    root.addHandler(file_handler)
