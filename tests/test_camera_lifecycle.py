import asyncio, importlib.util, sys, unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from app import camera
class CameraLifecycleTests(unittest.IsolatedAsyncioTestCase):
 async def test_cancel_during_start_releases_viewer(self):
  p=camera.BambuCameraProxy('unused','test');p._start=AsyncMock(side_effect=asyncio.CancelledError)
  gen=p.stream()
  with self.assertRaises(asyncio.CancelledError): await anext(gen)
  self.assertEqual(p._clients,0)
  if p._idle_task:p._idle_task.cancel()
 async def test_failure_during_start_releases_viewer(self):
  p=camera.BambuCameraProxy('unused','test');p._start=AsyncMock(side_effect=RuntimeError('connection failed'))
  with self.assertRaises(RuntimeError):await anext(p.stream())
  self.assertEqual(p._clients,0)
  if p._idle_task:p._idle_task.cancel()
 async def test_stationary_scene_keeps_fresh_stream(self):
  p=camera.BambuCameraProxy('unused','test');p._clients=1;p._proc=SimpleNamespace(returncode=None)
  p._started_at=995;p._last_frame_at=999;p._last_changed_at=900;p._restart_worker=AsyncMock()
  with patch.object(camera.time,'monotonic',return_value=1000),patch.object(camera.asyncio,'sleep',new=AsyncMock(side_effect=[None,asyncio.CancelledError])):
   with self.assertRaises(asyncio.CancelledError):await p._watchdog()
  p._restart_worker.assert_not_awaited()
 async def test_missing_frames_still_restart(self):
  p=camera.BambuCameraProxy('unused','test');p._clients=1;p._proc=SimpleNamespace(returncode=None)
  p._started_at=995;p._last_frame_at=980;p._last_changed_at=900;p._restart_worker=AsyncMock()
  with patch.object(camera.time,'monotonic',return_value=1000),patch.object(camera.asyncio,'sleep',new=AsyncMock(side_effect=[None,asyncio.CancelledError])):
   with self.assertRaises(asyncio.CancelledError):await p._watchdog()
  p._restart_worker.assert_awaited_once()
 async def test_content_change_inside_same_sized_jpeg_is_detected(self):
  a=b'\xff\xd8'+b'A'*100+b'X'*100+b'Z'*100+b'\xff\xd9';b=a[:102]+b'Y'*100+a[202:]
  p=camera.BambuCameraProxy('unused','test');proc=SimpleNamespace(returncode=None,stdout=SimpleNamespace(read=AsyncMock(side_effect=[a,b,b''])))
  await p._read_frames(proc)
  self.assertEqual(p._frame_seq,2);self.assertEqual(p._changed_seq,2)
if __name__=='__main__':unittest.main()
