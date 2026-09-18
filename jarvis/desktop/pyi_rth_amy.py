# Runtime hook: point AMY_ROOT at bundled jarvis before launch imports paths.
import os
import sys
from pathlib import Path

meipass = getattr(sys, "_MEIPASS", None)
if meipass:
    bundled = Path(meipass) / "jarvis"
    if bundled.exists():
        os.environ.setdefault("AMY_ROOT", str(bundled))
    else:
        os.environ.setdefault("AMY_ROOT", str(meipass))
