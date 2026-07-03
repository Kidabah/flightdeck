from __future__ import annotations

import asyncio
import logging
import shutil
import time
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

_SEGMENT_SECONDS = 780  # recycle before H2D 15 min RTSP freeze
_RECORD_WIDTH = "960"
_RECORD_FPS = "5"
_RECORD_CRF = "26"
_STOP_TIMEOUT = 20.0


class PrintNativeRecorder:
    """Record one print job from RTSP into an MP4 under flight_recorder."""

    def __init__(
        self,
        rtsp_url: str,
        printer_id: str,
        print_id: int,
        work_dir: Path,
        output_path: Path,
    ):
        self._url = rtsp_url
        self.printer_id = printer_id
        self.print_id = print_id
        self._work_dir = work_dir
        self._output_path = output_path
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._watchdog: Optional[asyncio.Task] = None
        self._started_at = 0.0
        self._stopping = False

    @property
    def output_path(self) -> Path:
        return self._output_path

    async def start(self) -> None:
        self._work_dir.mkdir(parents=True, exist_ok=True)
        self._started_at = time.monotonic()
        await self._spawn_segment_writer(self._segment_start_number())

    def _segment_start_number(self) -> int:
        return len(list(self._work_dir.glob("seg_*.mp4")))

    async def _spawn_segment_writer(self, start_number: int) -> None:
        pattern = str(self._work_dir / "seg_%03d.mp4")
        args = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-i", self._url,
            "-vf", f"scale={_RECORD_WIDTH}:-2",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", _RECORD_CRF,
            "-r", _RECORD_FPS,
            "-an",
            "-f", "segment",
            "-segment_time", str(_SEGMENT_SECONDS),
            "-reset_timestamps", "1",
            "-segment_format", "mp4",
            "-segment_start_number", str(start_number),
            pattern,
        ]
        self._proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        if not self._watchdog or self._watchdog.done():
            self._watchdog = asyncio.create_task(self._watchdog_loop())
        log.info(
            "native recorder ffmpeg started: %s print_id=%s (segment %03d)",
            self.printer_id,
            self.print_id,
            start_number,
        )

    async def _watchdog_loop(self) -> None:
        """Recycle ffmpeg if the RTSP session dies while recording."""
        while not self._stopping:
            await asyncio.sleep(10)
            if self._stopping:
                break
            proc = self._proc
            if proc and proc.returncode is not None:
                log.warning(
                    "native recorder ffmpeg exited (%s), restarting: %s print_id=%s",
                    proc.returncode,
                    self.printer_id,
                    self.print_id,
                )
                await self._restart_after_exit()

    async def _restart_after_exit(self) -> None:
        if self._stopping:
            return
        await self._spawn_segment_writer(self._segment_start_number())

    async def stop(self) -> Optional[Path]:
        self._stopping = True
        if self._watchdog:
            self._watchdog.cancel()
            try:
                await self._watchdog
            except asyncio.CancelledError:
                pass
            self._watchdog = None
        await self._stop_proc()
        segments = sorted(
            p for p in self._work_dir.glob("seg_*.mp4")
            if p.is_file() and p.stat().st_size > 0
        )
        if not segments:
            log.info(
                "native recorder produced no segments: %s print_id=%s",
                self.printer_id,
                self.print_id,
            )
            shutil.rmtree(self._work_dir, ignore_errors=True)
            return None
        self._output_path.parent.mkdir(parents=True, exist_ok=True)
        ok = await self._concat_segments(segments, self._output_path)
        shutil.rmtree(self._work_dir, ignore_errors=True)
        if not ok or not self._output_path.exists() or self._output_path.stat().st_size == 0:
            log.warning(
                "native recorder finalize failed: %s print_id=%s",
                self.printer_id,
                self.print_id,
            )
            return None
        elapsed = time.monotonic() - self._started_at
        log.info(
            "native recorder saved %s (%.1fs, %d segments): %s",
            self._output_path.name,
            elapsed,
            len(segments),
            self.printer_id,
        )
        return self._output_path

    async def _stop_proc(self) -> None:
        proc = self._proc
        self._proc = None
        if not proc or proc.returncode is not None:
            return
        try:
            if proc.stdin:
                proc.stdin.write(b"q")
                await proc.stdin.drain()
        except Exception:
            pass
        try:
            await asyncio.wait_for(proc.wait(), timeout=_STOP_TIMEOUT)
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            try:
                await proc.wait()
            except Exception:
                pass

    async def _concat_segments(self, segments: list[Path], output: Path) -> bool:
        if len(segments) == 1:
            try:
                shutil.move(str(segments[0]), str(output))
                return True
            except Exception as exc:
                log.warning("native recorder move failed: %s", exc)
                return False
        list_file = self._work_dir / "concat.txt"
        lines = []
        for seg in segments:
            path = seg.resolve().as_posix().replace("'", "'\\''")
            lines.append(f"file '{path}'")
        list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "error",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_file),
            "-c", "copy",
            "-movflags", "+faststart",
            str(output),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            detail = (stderr or b"").decode("utf-8", "ignore").strip()
            log.warning("native recorder concat failed (%s): %s", proc.returncode, detail)
            return False
        return True
