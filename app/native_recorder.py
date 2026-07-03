from __future__ import annotations

import asyncio
import logging
import shutil
import time
from pathlib import Path
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    from .camera import BambuCameraProxy

log = logging.getLogger(__name__)

_SEGMENT_SECONDS = 780
_RECORD_WIDTH = "960"
_RECORD_FPS = "5"
_RECORD_CRF = "26"
_FRAME_INTERVAL = 1.0 / float(_RECORD_FPS)
_STOP_TIMEOUT = 20.0


async def _mp4_playable(path: Path) -> bool:
    if not path.is_file() or path.stat().st_size < 1024:
        return False
    proc = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    stdout, _ = await proc.communicate()
    if proc.returncode != 0:
        return False
    try:
        return float(stdout.decode().strip()) > 0
    except ValueError:
        return False


class PrintNativeRecorder:
    """Record one print job from the shared camera proxy into flight_recorder."""

    def __init__(
        self,
        proxy: BambuCameraProxy,
        printer_id: str,
        print_id: int,
        work_dir: Path,
        output_path: Path,
    ):
        self._proxy = proxy
        self.printer_id = printer_id
        self.print_id = print_id
        self._work_dir = work_dir
        self._output_path = output_path
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._writer: Optional[asyncio.Task] = None
        self._watchdog: Optional[asyncio.Task] = None
        self._started_at = 0.0
        self._stopping = False
        self._held_proxy = False

    @property
    def output_path(self) -> Path:
        return self._output_path

    async def start(self) -> None:
        self._work_dir.mkdir(parents=True, exist_ok=True)
        self._started_at = time.monotonic()
        await self._proxy.hold_for_recorder()
        self._held_proxy = True
        await self._spawn_segment_writer(self._segment_start_number())
        log.info(
            "native recorder started from camera proxy: %s print_id=%s → %s",
            self.printer_id,
            self.print_id,
            self._output_path,
        )

    def _segment_start_number(self) -> int:
        return len(list(self._work_dir.glob("seg_*.mp4")))

    async def _spawn_segment_writer(self, start_number: int) -> None:
        pattern = str(self._work_dir / "seg_%03d.mp4")
        self._proc = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "error",
            "-f", "image2pipe",
            "-vcodec", "mjpeg",
            "-i", "pipe:0",
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
            "-segment_format_options", "movflags=+frag_keyframe+empty_moov+default_base_moof",
            "-segment_start_number", str(start_number),
            pattern,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        if self._writer and not self._writer.done():
            self._writer.cancel()
        self._writer = asyncio.create_task(self._write_frames(self._proc))
        if not self._watchdog or self._watchdog.done():
            self._watchdog = asyncio.create_task(self._watchdog_loop())

    async def _write_frames(self, proc: asyncio.subprocess.Process) -> None:
        last_sent = None
        while not self._stopping and proc.returncode is None:
            frame = self._proxy.latest_frame()
            if frame and frame is not last_sent and proc.stdin:
                try:
                    proc.stdin.write(frame)
                    await proc.stdin.drain()
                    last_sent = frame
                except (BrokenPipeError, ConnectionResetError):
                    break
                except Exception:
                    break
            await asyncio.sleep(_FRAME_INTERVAL)

    async def _watchdog_loop(self) -> None:
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
        if self._writer:
            self._writer.cancel()
            try:
                await self._writer
            except asyncio.CancelledError:
                pass
            self._writer = None
        await self._stop_proc()
        if self._held_proxy:
            self._proxy.release_recorder_hold()
            self._held_proxy = False
        segments = []
        for path in sorted(self._work_dir.glob("seg_*.mp4")):
            if not path.is_file() or path.stat().st_size <= 0:
                continue
            if await _mp4_playable(path):
                segments.append(path)
            else:
                log.warning(
                    "native recorder dropping invalid segment: %s print_id=%s",
                    path.name,
                    self.print_id,
                )
                try:
                    path.unlink(missing_ok=True)
                except Exception:
                    pass
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
        if not await _mp4_playable(self._output_path):
            log.warning(
                "native recorder output not playable: %s print_id=%s",
                self.printer_id,
                self.print_id,
            )
            try:
                self._output_path.unlink(missing_ok=True)
            except Exception:
                pass
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
                proc.stdin.close()
                await proc.stdin.wait_closed()
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
                return await _mp4_playable(output)
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
        return await _mp4_playable(output)
