# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Amy desktop (one-folder)."""
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

SPECDIR = Path(SPECPATH).resolve()
JARVIS = SPECDIR.parent
DESKTOP = SPECDIR

datas = [
    (str(JARVIS / "viewer"), "jarvis/viewer"),
    (str(JARVIS / "notes"), "jarvis/notes"),
    (str(JARVIS / "amy-hands"), "jarvis/amy-hands"),
    (str(JARVIS / "config.example.json"), "jarvis"),
    (str(JARVIS / "build.py"), "jarvis"),
    (str(JARVIS / "server.py"), "jarvis"),
    (str(JARVIS / "preflight.py"), "jarvis"),
    (str(DESKTOP / "paths.py"), "jarvis/desktop"),
]

graph = JARVIS / "viewer" / "graph-data.js"
if graph.exists():
    datas.append((str(graph), "jarvis/viewer"))
index = JARVIS / "notes-index.json"
if index.exists():
    datas.append((str(index), "jarvis"))

datas += collect_data_files("webview")
binaries = collect_dynamic_libs("webview")

hiddenimports = [
    "webview",
    "webview.platforms.edgechromium",
    "clr",
    "clr_loader",
    "pythonnet",
    "bottle",
    "proxy_tools",
]

a = Analysis(
    [str(DESKTOP / "launch.py")],
    pathex=[str(JARVIS), str(DESKTOP)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[str(DESKTOP / "pyi_rth_amy.py")],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Amy",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="Amy",
)
