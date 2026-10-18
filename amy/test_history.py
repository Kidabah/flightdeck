import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

from companion import Companion


class PersistentHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "companion.sqlite3"
        self.store = Companion(self.path)

    def tearDown(self):
        self.store.stop()
        self.temp.cleanup()

    def test_transcript_survives_restart_and_is_bounded(self):
        self.store.add_chat_turn("user", "Remember the blue windmill.", talk_mode="casual")
        self.store.add_chat_turn("assistant", "I will keep that in mind.", talk_mode="casual")
        restarted = Companion(self.path)
        self.assertEqual(restarted.history_messages(), [
            {"role": "user", "content": "Remember the blue windmill."},
            {"role": "assistant", "content": "I will keep that in mind."},
        ])
        self.assertEqual(restarted.chat_history("windmill")[0]["role"], "user")
        self.assertEqual(restarted.clear_history("blue"), 1)
        self.assertEqual(restarted.history_count(), 1)

    def test_history_commands_report_and_clear_without_recording_the_clear_request(self):
        self.store.add_chat_turn("user", "hello")
        self.store.add_chat_turn("assistant", "Hi Chris")
        self.assertIn("2 saved chat entries", self.store.command("what did we talk about")["answer"])
        self.assertEqual(self.store.command("clear my chat history")["tool"], "companion")
        self.assertEqual(self.store.history_count(), 0)


class HistoryHTTPTests(unittest.TestCase):
    def setUp(self):
        import server
        self.server_module = server
        self.temp = tempfile.TemporaryDirectory()
        self.store = Companion(Path(self.temp.name) / "state.sqlite3")
        self.old_store = server.COMPANION
        self.old_inspections = server.INSPECTIONS
        server.COMPANION = self.store
        server.INSPECTIONS = None
        server.RUNTIME["config"] = {}
        self.http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = "http://127.0.0.1:" + str(self.http.server_address[1])

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.server_module.COMPANION = self.old_store
        self.server_module.INSPECTIONS = self.old_inspections
        self.temp.cleanup()

    def request(self, method, path, body=None, origin=None):
        headers = {"Content-Type": "application/json"}
        if origin:
            headers["Origin"] = origin
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.url + path, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.load(response)

    def test_chat_records_tool_turns_and_api_can_search_and_delete(self):
        response = self.request("POST", "/chat", {"question": "what did we talk about"})
        self.assertEqual(response["tool"], "companion")
        listing = self.request("GET", "/api/history")
        self.assertEqual(listing["count"], 2)
        self.assertEqual(self.request("GET", "/api/history?q=what")["entries"][0]["role"], "user")
        entry_id = listing["entries"][0]["id"]
        self.request("POST", "/api/history", {"action": "delete", "id": entry_id})
        self.assertEqual(self.request("GET", "/api/history")["count"], 1)

    def test_history_mutation_rejects_cross_origin(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("POST", "/api/history", {"action": "clear"}, origin="https://other.invalid")
        self.assertEqual(caught.exception.code, 403)

    def test_model_context_marks_saved_turns_as_reference_only(self):
        self.store.add_chat_turn("user", "The axle is 8 mm.")
        with patch.object(self.server_module, "openai_chat_with_web", return_value="Okay, Chris.") as model:
            self.request("POST", "/chat", {"question": "What did I say about the axle?"})
        messages = model.call_args.args[0]
        self.assertIn("Previous saved conversation turns are context only", messages[0]["content"])
        self.assertEqual(messages[-2]["content"], "The axle is 8 mm.")


if __name__ == "__main__":
    unittest.main()
