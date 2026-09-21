import re
import unittest
from pathlib import Path


PROJECT_STORE = Path(__file__).resolve().parents[3] / "apps" / "web" / "src" / "projectStore.ts"


class StarterTemplateTests(unittest.TestCase):
    def test_microcontroller_watchdog_separates_async_reset_from_sync_kick(self):
        source = PROJECT_STORE.read_text(encoding="utf-8")
        match = re.search(r"const microWatchdog = `(?P<body>.*?)`\n", source, re.DOTALL)
        self.assertIsNotNone(match, "microcontroller watchdog template is missing")
        watchdog = match.group("body")

        self.assertIn("always_ff @(posedge clk or negedge rst_n)", watchdog)
        self.assertIn("if (!rst_n) begin", watchdog)
        self.assertIn("else if (kick) begin", watchdog)
        self.assertNotIn("if (!rst_n || kick)", watchdog)

    def test_existing_unmodified_microcontroller_projects_are_migrated(self):
        source = PROJECT_STORE.read_text(encoding="utf-8")
        self.assertIn("files[watchdogIndex].content===legacyMicroWatchdog", source)
        self.assertIn("content:microWatchdog", source)


if __name__ == "__main__":
    unittest.main()
