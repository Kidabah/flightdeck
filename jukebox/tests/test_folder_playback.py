from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


DESKTOP = Path(__file__).resolve().parents[1] / "desktop"
sys.path.insert(0, str(DESKTOP))

from folder_playback import FolderPlayback, byte_range, find_audio, forward_folder


class ByteRangeTests(unittest.TestCase):
    def test_full_and_partial_ranges(self):
        self.assertEqual(byte_range(None, 10), (0, 9, False))
        self.assertEqual(byte_range("bytes=2-5", 10), (2, 5, True))
        self.assertEqual(byte_range("bytes=7-", 10), (7, 9, True))
        self.assertEqual(byte_range("bytes=-3", 10), (7, 9, True))

    def test_invalid_ranges_are_rejected(self):
        for header in ("bytes=", "items=1-2", "bytes=10-11", "bytes=5-2"):
            with self.subTest(header=header), self.assertRaises(ValueError):
                byte_range(header, 10)


class FolderDiscoveryTests(unittest.TestCase):
    def test_audio_is_naturally_sorted_and_recycle_folders_are_ignored(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            (root / "Disc 1").mkdir()
            (root / "Disc 1" / "track10.mp3").write_bytes(b"ten")
            (root / "Disc 1" / "track2.flac").write_bytes(b"two")
            (root / "#recycle").mkdir()
            (root / "#recycle" / "deleted.mp3").write_bytes(b"no")
            found_root, tracks = find_audio(root)
            self.assertEqual(found_root, root)
            self.assertEqual(
                [track.name for track in tracks],
                ["track2.flac", "track10.mp3"],
            )


class LoopbackPlaybackTests(unittest.TestCase):
    def test_forwarding_streaming_ranges_and_origin_protection(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            album = root / "Album"
            album.mkdir()
            payload = b"0123456789"
            (album / "01 Song.mp3").write_bytes(payload)
            info = root / "runtime" / "folder-player.json"
            player = FolderPlayback(info, "http://flightdeck-nas:4541")
            try:
                self.assertTrue(forward_folder(info, str(album)))
                request = player.take()
                self.assertEqual(request["album"]["name"], "Album")
                url = request["album"]["song"][0]["localUrl"]

                ranged = Request(
                    url,
                    headers={
                        "Origin": "http://flightdeck-nas:4541",
                        "Range": "bytes=2-5",
                    },
                )
                with urlopen(ranged, timeout=3) as response:
                    self.assertEqual(response.status, 206)
                    self.assertEqual(response.read(), b"2345")
                    self.assertEqual(response.headers["Content-Range"], "bytes 2-5/10")

                blocked = Request(url, headers={"Origin": "https://example.invalid"})
                with self.assertRaises(HTTPError) as raised:
                    urlopen(blocked, timeout=3)
                self.assertEqual(raised.exception.code, 403)
            finally:
                player.close()


if __name__ == "__main__":
    unittest.main()
