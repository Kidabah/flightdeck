import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from coding import coding_kind, link_repository, run_coding


class Store:
    def __init__(self, project=None):
        self.project = project
        self.notes = []

    def project_notes(self):
        return self.project

    def add_note(self, body, project_name=None):
        self.notes.append(body)
        return (self.project or {}).get("name", "project")


class CodingTests(unittest.TestCase):
    def test_explicit_kinds(self):
        self.assertEqual(coding_kind("plan code add a badge"), "plan")
        self.assertEqual(coding_kind("review the code"), "review")
        self.assertEqual(coding_kind("implement the badge"), "implement")
        self.assertEqual(coding_kind("code add a status badge"), "implement")
        self.assertIsNone(coding_kind("tell me a joke"))

    def test_link_repository_requires_project_and_saves_note(self):
        no_project = link_repository("link the repository to https://github.com/example/repo", store=Store())
        self.assertFalse(no_project["ok"])
        store = Store({"name": "Amy", "notes": []})
        result = link_repository("link the repository to https://github.com/example/repo", store=store)
        self.assertTrue(result["ok"])
        self.assertEqual(store.notes, ["Repository: https://github.com/example/repo"])

    def test_run_coding_is_bounded_and_records_summary(self):
        with tempfile.TemporaryDirectory() as raw:
            repo = Path(raw)
            (repo / ".git").mkdir()
            store = Store({"name": "Amy", "notes": [{"body": "Repository: " + str(repo)}]})

            def fake_run(args, **kwargs):
                output = Path(args[args.index("--output-last-message") + 1])
                output.write_text("Changed amy/server.py; tests passed.", encoding="utf-8")
                return type("Completed", (), {"returncode": 0, "stdout": ""})()

            with patch("coding.codex_executable", return_value="codex"), patch("coding.subprocess.run", side_effect=fake_run) as run:
                result = run_coding("implement add a coding route", config={"coding_root": str(repo), "model": "gpt-5.6-luna"}, store=store)

            self.assertTrue(result["ok"])
            self.assertTrue(result["saved_note"])
            self.assertIn("Changed amy/server.py", result["answer"])
            args = run.call_args.args[0]
            self.assertIn("--sandbox", args)
            self.assertIn("workspace-write", args)
            self.assertIn("--cd", args)
            self.assertIn("gpt-5.6-luna", args)
            self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", args)
            self.assertIsNotNone(run.call_args.kwargs.get("stdin"))
            self.assertTrue(store.notes)

    def test_remote_repository_link_never_falls_back_to_default_checkout(self):
        store = Store({"name": "Amy", "notes": [{"body": "Repository: https://github.com/example/repo"}]})
        result = run_coding("plan code inspect the repository", config={}, store=store)
        self.assertFalse(result["ok"])
        self.assertIn("local checkout path", result["answer"])


if __name__ == "__main__":
    unittest.main()
