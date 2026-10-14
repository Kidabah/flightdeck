import unittest
from unittest.mock import patch

import server


SAMPLE = {
    "ok": True,
    "cpu_percent": 27,
    "memory": {"used_percent": 61, "available_gb": 12.5, "total_gb": 32.0},
    "disk": {"drive": "C:\\", "used_percent": 72, "free_gb": 138.4, "total_gb": 476.0},
    "display": {
        "width": 3440,
        "height": 1440,
        "refresh_hz": 165,
        "target_width": 3440,
        "target_height": 1440,
        "target_refresh_hz": 165,
    },
    "power": {"battery_present": True, "battery_percent": 84, "plugged_in": True},
    "gpu_name": "NVIDIA Test GPU",
    "gpu_temp_c": 49,
}


class SystemStatusTests(unittest.TestCase):
    def test_explicit_pc_health_phrases_use_hands(self):
        with patch.object(server, "hands_configured", return_value=True), patch.object(
            server, "hands_request", return_value=(200, SAMPLE)
        ) as request:
            for phrase in (
                "How's my PC?",
                "computer health",
                "what is my battery level?",
                "check CPU usage",
                "how much disk space is free?",
                "GPU temperature",
                "monitor refresh rate",
                "what GPU do I have?",
                "what is my processor?",
                "how much RAM do I have?",
                "what is my screen resolution?",
            ):
                result = server.try_system_status(phrase)
                self.assertIsNotNone(result, phrase)
                self.assertTrue(result["ok"], phrase)
                self.assertEqual(result["tool"], "system_status")
            request.assert_called_with("/system/status", timeout=15)

    def test_summary_is_grounded_in_returned_readings(self):
        with patch.object(server, "hands_configured", return_value=True), patch.object(
            server, "hands_request", return_value=(200, SAMPLE)
        ):
            answer = server.try_system_status("laptop status")["answer"]
        for expected in (
            "CPU is at 27 percent",
            "12.5 GB available",
            "138.4 GB free",
            "3440 by 1440 at 165 hertz, on target",
            "battery is at 84 percent",
            "49 degrees",
        ):
            self.assertIn(expected, answer)

    def test_unrelated_status_questions_are_not_claimed(self):
        for phrase in (
            "what is BigBoy printing?",
            "what is the weather?",
            "what is playing on Spotify?",
            "is Amy Hands online?",
        ):
            self.assertIsNone(server.try_system_status(phrase), phrase)

    def test_missing_hands_returns_specific_failure(self):
        with patch.object(server, "hands_configured", return_value=False):
            result = server.try_system_status("PC status")
        self.assertFalse(result["ok"])
        self.assertIn("Hands", result["answer"])


if __name__ == "__main__":
    unittest.main()
