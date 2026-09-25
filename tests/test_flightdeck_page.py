import importlib.util
import unittest
from pathlib import Path


def _actions():
    path = Path(__file__).resolve().parents[1] / "jarvis" / "workshop_actions.py"
    spec = importlib.util.spec_from_file_location("workshop_actions_page", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FlightdeckPageTests(unittest.TestCase):
    def test_open_the_queue(self) -> None:
        actions = _actions()
        page = actions.parse_flightdeck_page("Amy open the queue in Flightdeck")
        self.assertEqual(page["hash"], "#/queue")
        self.assertEqual(page["label"], "Queue")

    def test_other_pages_and_a_printer(self) -> None:
        actions = _actions()
        self.assertEqual(actions.parse_flightdeck_page("show me the spools")["hash"], "#/spools")
        self.assertEqual(actions.parse_flightdeck_page("go to flight tower")["hash"], "#/mission")
        self.assertEqual(actions.parse_flightdeck_page("open BigBoy")["hash"], "#/printer/h2d")

    def test_plain_open_and_pause_are_not_pages(self) -> None:
        actions = _actions()
        self.assertIsNone(actions.parse_flightdeck_page("open Flightdeck"))
        self.assertIsNone(actions.parse_flightdeck_page("pause the print on BigBoy"))

    def test_any_folder_they_name(self) -> None:
        actions = _actions()
        self.assertEqual(actions.parse_open_folder("open the downloads folder"), "downloads")
        self.assertEqual(actions.parse_open_folder("open folder Projects"), "projects")
        self.assertEqual(actions.parse_open_folder(r"open D:\prints\cow"), r"D:\prints\cow")
        self.assertIsNone(actions.parse_open_folder("open the queue"))
        self.assertIsNone(actions.parse_open_folder("open BigBoy"))

    def test_queue_a_named_file_on_a_printer(self) -> None:
        actions = _actions()
        parsed = actions.parse_queue_local_file(
            "Amy open desktop 3mf bedscraper_pla and que it in flightdeck on big boy printer"
        )
        self.assertEqual(parsed["folders"], ["desktop", "3mf"])
        self.assertEqual(parsed["file"], "bedscraper_pla")
        self.assertEqual(parsed["printer_id"], "h2d")
        short = actions.parse_queue_local_file("queue the pla box on BigBoy")
        self.assertEqual(short["file"], "pla box")
        self.assertEqual(short["folders"], [])
        self.assertEqual(short["printer_id"], "h2d")
        self.assertIsNone(actions.parse_queue_local_file("open the queue"))
        hits = actions.match_named_files(
            [
                "bedscraper_PLA_44m25s.gcode.3mf",
                "bedscraper_PLA_multi_8h1m.gcode.3mf",
                "other.3mf",
            ],
            "bedscraper_pla",
        )
        self.assertEqual(len(hits), 2)
        one = actions.match_named_files(
            ["bedscraper_PLA_44m25s.gcode.3mf", "bedscraper_PLA_multi_8h1m.gcode.3mf"],
            "bedscraper_pla_44",
        )
        self.assertEqual(one, ["bedscraper_PLA_44m25s.gcode.3mf"])
