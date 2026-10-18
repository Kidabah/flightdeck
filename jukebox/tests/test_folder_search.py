from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch


JUKEBOX = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(JUKEBOX))

from app import folder_albums


class FolderSearchTests(unittest.TestCase):
    def test_searches_display_names_case_insensitively_and_honors_limit(self):
        sleeves = {
            "b": {"id": "b", "name": "Hit Zone 28"},
            "a": {"id": "a", "name": "Hit Zone 12"},
            "x": {"id": "x", "name": "Quiet Collection"},
        }
        with patch.object(folder_albums, "_merge_maps", return_value=({}, {}, sleeves)):
            matches = folder_albums.search_folder_sleeves("ZONE hit", limit=1)
        self.assertEqual(matches, [{"id": "a", "name": "Hit Zone 12"}])

    def test_blank_queries_and_nonpositive_limits_do_not_scan(self):
        with patch.object(folder_albums, "_merge_maps") as merge:
            self.assertEqual(folder_albums.search_folder_sleeves("   "), [])
            self.assertEqual(folder_albums.search_folder_sleeves("hit", limit=0), [])
        merge.assert_not_called()


if __name__ == "__main__":
    unittest.main()
