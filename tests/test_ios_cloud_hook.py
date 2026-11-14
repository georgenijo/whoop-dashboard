"""Exercise the Cloud hook without installing tools or invoking Xcode."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / "apps/ios/ci_scripts/ci_post_clone.sh"


class CloudHookTests(unittest.TestCase):
    def run_hook(self, actual_build, installed=True):
        expected = json.loads((ROOT / "apps/ios/ci/workflows.json").read_text())["xcode"]["version"]
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            tools = base / "bin"
            tools.mkdir()
            (base / "apps/ios").mkdir(parents=True)
            log = base / "calls"

            def tool(name, body):
                path = tools / name
                path.write_text("#!/bin/sh\n" + body + "\n")
                path.chmod(0o755)

            tool("plutil", f"echo '{expected}'")
            tool("xcodebuild", f"printf 'Xcode 27.2\\nBuild version {actual_build}\\n'")
            tool("brew", 'echo brew >> "$HOOK_LOG"\nexit 9')
            if installed:
                tool("xcodegen", 'echo "xcodegen:$*:$PWD" >> "$HOOK_LOG"')
            env = {**os.environ, "PATH": f"{tools}:/usr/bin:/bin",
                   "CI_PRIMARY_REPOSITORY_PATH": str(base), "HOOK_LOG": str(log)}
            result = subprocess.run(["/bin/sh", str(HOOK)], env=env, capture_output=True, text=True)
            return result, log.read_text() if log.exists() else ""

    def test_wrong_xcode_stops_before_generation_or_install(self):
        result, calls = self.run_hook("retired-build")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Xcode build mismatch", result.stderr)
        self.assertEqual(calls, "")

    def test_matching_xcode_generates_in_app_directory(self):
        expected = json.loads((ROOT / "apps/ios/ci/workflows.json").read_text())["xcode"]["version"]
        result, calls = self.run_hook(expected)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("xcodegen:generate:", calls)
        self.assertTrue(calls.strip().endswith("/apps/ios"))
        self.assertNotIn("brew", calls)

    def test_install_failure_stops_build(self):
        expected = json.loads((ROOT / "apps/ios/ci/workflows.json").read_text())["xcode"]["version"]
        result, calls = self.run_hook(expected, installed=False)
        self.assertEqual(result.returncode, 9)
        self.assertEqual(calls, "brew\n")
