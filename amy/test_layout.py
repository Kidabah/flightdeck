import unittest

from layout import layout_kind, layout_response


class LayoutCommandTests(unittest.TestCase):
    def test_notebook_under_folders_variants(self):
        for phrase in (
            "move the notebook underneath the folders",
            "please put Notebook below Folders",
            "rearrange the Notebook beneath the folder cards",
        ):
            self.assertEqual(layout_kind(phrase), "notebook_under_folders")

    def test_unrelated_layout_request_is_not_claimed(self):
        self.assertIsNone(layout_kind("show all three cameras"))
        self.assertIsNone(layout_kind("move the folders underneath the notebook"))

    def test_folder_panel_commands(self):
        self.assertEqual(layout_kind("collapse the Folders panel"), "folders_collapsed")
        self.assertEqual(layout_kind("show the Folders shelf"), "folders_expanded")
        self.assertEqual(layout_kind("alphabetize the notes in the folders"), "folders_alphabetized")
        self.assertEqual(layout_kind("alphabetise the file names within the desktop folders"), "sidebar_entries_alphabetized")
        self.assertEqual(layout_kind("capitalize the file names in the desktop folders"), "sidebar_entries_capitalized")
        self.assertEqual(layout_kind("move the ticker underneath the notes"), "ticker_under_notes")
        self.assertEqual(layout_kind("move the API usage ticker from the right-hand side to the bottom of the left-hand panel"), "ticker_under_notes")
        self.assertEqual(layout_kind("move the chat below Amy"), "ui_control")
        self.assertEqual(layout_kind("hide the search panel"), "ui_control")
        self.assertEqual(layout_kind("reset the window layout"), "ui_control")

    def test_response_is_explicit(self):
        result = layout_response("move the notebook underneath the folders")
        self.assertEqual(result["tool"], "layout")
        self.assertTrue(result["ok"])
        self.assertIn("underneath Folders", result["answer"])

    def test_folder_response(self):
        result = layout_response("collapse the Folders panel")
        self.assertEqual(result["layout"], "folders_collapsed")
        self.assertIn("collapsed", result["answer"])

    def test_sidebar_entry_response(self):
        result = layout_response("alphabetise the file names within the desktop folders")
        self.assertEqual(result["layout"], "sidebar_entries_alphabetized")
        self.assertIn("Amy Desktop and Amy Files", result["answer"])
        result = layout_response("capitalize the file names in the desktop folders")
        self.assertEqual(result["layout"], "sidebar_entries_capitalized")
        self.assertIn("saved notes remain unchanged", result["answer"])
        result = layout_response("move the ticker underneath the notes")
        self.assertEqual(result["layout"], "ticker_under_notes")
        result = layout_response("move the chat below Amy")
        self.assertEqual(result["ui_action"], "move")
        self.assertEqual(result["panel"], "chat")
        self.assertEqual(result["target"], "hud")


if __name__ == "__main__":
    unittest.main()
