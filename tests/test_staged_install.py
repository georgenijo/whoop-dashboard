"""Staged dependency install for scripts/deploy (issue #524).

Drives scripts/lib/staged-install.sh, and the install/build launcher heredocs
embedded in scripts/deploy, against temp directories with a fake `npm`. Nothing
here talks to Fleet, runs a real install, or touches a service.
"""

import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "scripts/lib/staged-install.sh"
DEPLOY = ROOT / "scripts/deploy"

# Fake npm. `npm ci` records what it saw (cwd, whether the live tree was still
# the old one, any stale staging leftovers), writes a tree into ./node_modules,
# and exits with $FAKE_NPM_CI_RC. `npm run build` exits $FAKE_NPM_BUILD_RC.
FAKE_NPM = r"""#!/usr/bin/env bash
set -u
case "$1" in
  ci)
    {
      echo "cwd=$PWD"
      echo "live_sentinel=$(cat "$FAKE_LIVE/node_modules/sentinel" 2>/dev/null || echo none)"
      echo "stale_present=$([ -e node_modules/stale ] && echo yes || echo no)"
    } >> "$FAKE_NPM_LOG"
    mkdir -p node_modules/pkg
    echo "${FAKE_NPM_VERSION:-new}" > node_modules/sentinel
    echo "module.exports = 1" > node_modules/pkg/index.js
    exit "${FAKE_NPM_CI_RC:-0}"
    ;;
  run)
    echo "build" >> "$FAKE_NPM_LOG"
    mkdir -p .next && echo new > .next/BUILD_ID
    exit "${FAKE_NPM_BUILD_RC:-0}"
    ;;
esac
echo "fake npm: unexpected args $*" >&2
exit 99
"""


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Sandbox:
    """A temp repo root with apps/web and a fake npm on PATH."""

    def __init__(self, base):
        self.base = base
        self.root = base / "repo"
        self.web = self.root / "apps/web"
        self.state = self.root / ".deploy-state"
        self.web.mkdir(parents=True)
        (self.web / "package.json").write_text('{"name":"web"}\n')
        (self.web / "package-lock.json").write_text('{"lockfileVersion":3}\n')
        (self.web / ".npmrc").write_text("engine-strict=true\n")
        self.bin = base / "bin"
        self.bin.mkdir()
        npm = self.bin / "npm"
        npm.write_text(FAKE_NPM)
        npm.chmod(0o755)
        self.npm_log = base / "npm.log"

    def live(self, version="old"):
        nm = self.web / "node_modules"
        nm.mkdir()
        (nm / "sentinel").write_text(version + "\n")
        (nm / ".deploy-lockfile-sha").write_text("oldsha\n")
        return nm

    def env(self, **extra):
        env = dict(os.environ)
        env["PATH"] = f"{self.bin}:{env['PATH']}"
        env["FAKE_LIVE"] = str(self.web)
        env["FAKE_NPM_LOG"] = str(self.npm_log)
        env.update({k: str(v) for k, v in extra.items()})
        return env

    def helper(self, mode, **extra):
        return subprocess.run(
            ["bash", str(HELPER), mode, str(self.web), str(self.state)],
            env=self.env(**extra), capture_output=True, text=True, timeout=60,
        )

    def npm_calls(self):
        if not self.npm_log.exists():
            return []
        calls, cur = [], {}
        for line in self.npm_log.read_text().splitlines():
            if line == "build":
                calls.append({"build": True})
                continue
            k, v = line.split("=", 1)
            cur[k] = v
            if k == "stale_present":
                calls.append(cur)
                cur = {}
        return calls

    def sentinel(self, path):
        return (path / "sentinel").read_text().strip()


def swap_modes():
    modes = [("two-renames", {"STAGED_INSTALL_NO_EXCHANGE": 1})]
    if "--exchange" in subprocess.run(["mv", "--help"], capture_output=True, text=True).stdout:
        modes.append(("exchange", {}))
    return modes


class StagedInstallHelperTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.sb = Sandbox(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_installs_in_staging_then_swaps(self):
        for name, extra in swap_modes():
            with self.subTest(swap=name):
                shutil.rmtree(self.sb.web / "node_modules", ignore_errors=True)
                shutil.rmtree(self.sb.state, ignore_errors=True)
                self.sb.npm_log.unlink(missing_ok=True)
                self.sb.live("old")

                r = self.sb.helper("install", **extra)
                self.assertEqual(r.returncode, 0, r.stderr)

                [call] = self.sb.npm_calls()
                # npm ran in the staging tree, while live was still the old one.
                self.assertEqual(call["cwd"], str(self.sb.state / "install-staging"))
                self.assertEqual(call["live_sentinel"], "old")
                # After the swap: live is the new tree, with a marker for the
                # lockfile that was installed.
                live = self.sb.web / "node_modules"
                self.assertEqual(self.sb.sentinel(live), "new")
                self.assertTrue((live / "pkg/index.js").exists())
                self.assertEqual(
                    (live / ".deploy-lockfile-sha").read_text().strip(),
                    sha256(self.sb.web / "package-lock.json"),
                )
                self.assertEqual(self.sb.sentinel(self.sb.state / "node_modules.prev"), "old")
                self.assertFalse((self.sb.state / "install-staging").exists())
                self.assertIn("atomic exchange" if name == "exchange" else "two renames", r.stdout)

    def test_staging_gets_package_files_including_npmrc(self):
        self.sb.live()
        # Make npm fail so the staging tree is left in place to inspect.
        r = self.sb.helper("install", FAKE_NPM_CI_RC=1)
        self.assertEqual(r.returncode, 1)
        stage = self.sb.state / "install-staging"
        for f in ("package.json", "package-lock.json", ".npmrc"):
            self.assertEqual((stage / f).read_text(), (self.sb.web / f).read_text(), f)

    def test_failed_install_leaves_live_tree_intact(self):
        live = self.sb.live("old")
        before = sorted(p.relative_to(live) for p in live.rglob("*"))
        r = self.sb.helper("install", FAKE_NPM_CI_RC=3)
        self.assertEqual(r.returncode, 3)
        self.assertIn("was not touched", r.stderr)
        self.assertEqual(sorted(p.relative_to(live) for p in live.rglob("*")), before)
        self.assertEqual(self.sb.sentinel(live), "old")
        self.assertEqual((live / ".deploy-lockfile-sha").read_text(), "oldsha\n")
        self.assertFalse((self.sb.state / "node_modules.prev").exists())
        # The half-built staging tree is left for inspection and has no marker.
        staged = self.sb.state / "install-staging/node_modules"
        self.assertTrue(staged.exists())
        self.assertFalse((staged / ".deploy-lockfile-sha").exists())

    def test_second_run_clears_stale_staging(self):
        self.sb.live("old")
        stale = self.sb.state / "install-staging/node_modules"
        stale.mkdir(parents=True)
        (stale / "stale").write_text("left by a killed deploy\n")
        r = self.sb.helper("install")
        self.assertEqual(r.returncode, 0, r.stderr)
        [call] = self.sb.npm_calls()
        self.assertEqual(call["stale_present"], "no")
        self.assertFalse((self.sb.web / "node_modules/stale").exists())

    def test_rotates_prev_keeping_only_the_last_tree(self):
        self.sb.live("v1")
        self.assertEqual(self.sb.helper("install", FAKE_NPM_VERSION="v2").returncode, 0)
        self.assertEqual(self.sb.helper("install", FAKE_NPM_VERSION="v3").returncode, 0)
        self.assertEqual(self.sb.sentinel(self.sb.web / "node_modules"), "v3")
        self.assertEqual(self.sb.sentinel(self.sb.state / "node_modules.prev"), "v2")
        self.assertEqual(
            sorted(p.name for p in self.sb.state.iterdir()), ["node_modules.prev"]
        )

    def test_first_install_with_no_live_tree(self):
        r = self.sb.helper("install")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.sb.sentinel(self.sb.web / "node_modules"), "new")
        self.assertFalse((self.sb.state / "node_modules.prev").exists())

    def test_restore_swaps_prev_back(self):
        for name, extra in swap_modes():
            with self.subTest(swap=name):
                shutil.rmtree(self.sb.web / "node_modules", ignore_errors=True)
                shutil.rmtree(self.sb.state, ignore_errors=True)
                self.sb.live("old")
                self.assertEqual(self.sb.helper("install", **extra).returncode, 0)
                r = self.sb.helper("restore", **extra)
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertEqual(self.sb.sentinel(self.sb.web / "node_modules"), "old")
                self.assertEqual(list(self.sb.state.iterdir()), [])

    def test_restore_without_prev_refuses_and_leaves_live(self):
        self.sb.live("old")
        r = self.sb.helper("restore")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no ", r.stderr)
        self.assertEqual(self.sb.sentinel(self.sb.web / "node_modules"), "old")

    def test_refuses_state_dir_inside_web_dir(self):
        self.sb.live("old")
        r = subprocess.run(
            ["bash", str(HELPER), "install", str(self.sb.web), str(self.sb.web / "state")],
            env=self.sb.env(), capture_output=True, text=True,
        )
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("must not be inside", r.stderr)
        self.assertEqual(self.sb.npm_calls(), [])

    def test_refuses_relative_or_unsafe_paths(self):
        for web, state in (("apps/web", "/tmp/x"), (str(self.sb.web), "/tmp/a b")):
            r = subprocess.run(["bash", str(HELPER), "install", web, state],
                               env=self.sb.env(), capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("safe absolute path", r.stderr)


def heredoc(name):
    """Body of the `<<'NAME'` heredoc in scripts/deploy."""
    text = DEPLOY.read_text()
    # The opening line may end in `\` and continue (`|| die ...`); the body
    # starts after the logical line, as bash reads it.
    m = re.search(rf"<<'{name}'(?:[^\n]*\\\n)*[^\n]*\n(.*?)\n{name}\n", text, re.S)
    assert m, name
    return m.group(1)


class DeployLauncherTests(unittest.TestCase):
    """Runs the install and build launchers scripts/deploy sends to the node."""

    NODE_VERSION = "20.20.2"

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        base = Path(self._tmp.name)
        self.sb = Sandbox(base)
        # The launchers look for npm under $HOME/.nvm/versions/node/v<ver>/bin.
        self.home = base / "home"
        nvm_bin = self.home / f".nvm/versions/node/v{self.NODE_VERSION}/bin"
        nvm_bin.mkdir(parents=True)
        shutil.copy(self.sb.bin / "npm", nvm_bin / "npm")
        (scripts := self.sb.root / "scripts/lib").mkdir(parents=True)
        shutil.copy(HELPER, scripts / "staged-install.sh")
        self.helper = scripts / "staged-install.sh"
        self.tmp = base / "t"
        self.tmp.mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def launch(self, name, args, **extra):
        env = self.sb.env(HOME=self.home, **extra)
        r = subprocess.run(["bash", "-s", "--", *map(str, args)], input=heredoc(name),
                           env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)

    def wait_exit(self, path):
        deadline = time.time() + 30
        while time.time() < deadline:
            if path.exists() and path.read_text().strip():
                return path.read_text().strip()
            time.sleep(0.1)
        self.fail(f"{path} never written")

    def install(self, staged, **extra):
        exit_file = self.tmp / "install.exit"
        exit_file.unlink(missing_ok=True)
        self.launch("REMOTE_INSTALL_LAUNCH", [
            self.sb.web, self.NODE_VERSION, self.tmp / "install.sh", self.tmp / "install.log",
            exit_file, staged, self.helper, self.sb.state,
        ], **extra)
        return self.wait_exit(exit_file)

    def test_staged_launcher_swaps_and_marks(self):
        self.sb.live("old")
        self.assertEqual(self.install(1), "0")
        live = self.sb.web / "node_modules"
        self.assertEqual(self.sb.sentinel(live), "new")
        self.assertEqual((live / ".deploy-lockfile-sha").read_text().strip(),
                         sha256(self.sb.web / "package-lock.json"))
        [call] = self.sb.npm_calls()
        self.assertEqual(call["cwd"], str(self.sb.state / "install-staging"))
        self.assertEqual(call["live_sentinel"], "old")

    def test_staged_launcher_failure_leaves_live(self):
        self.sb.live("old")
        self.assertEqual(self.install(1, FAKE_NPM_CI_RC=7), "7")
        live = self.sb.web / "node_modules"
        self.assertEqual(self.sb.sentinel(live), "old")
        self.assertEqual((live / ".deploy-lockfile-sha").read_text(), "oldsha\n")

    def test_staged_launcher_refuses_ref_without_helper(self):
        self.helper.unlink()
        self.sb.live("old")
        r = subprocess.run(["bash", "-s", "--", *map(str, [
            self.sb.web, self.NODE_VERSION, self.tmp / "install.sh", self.tmp / "install.log",
            self.tmp / "install.exit", 1, self.helper, self.sb.state])],
            input=heredoc("REMOTE_INSTALL_LAUNCH"), env=self.sb.env(HOME=self.home),
            capture_output=True, text=True, timeout=60)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("not in the deployed ref", r.stderr)
        self.assertEqual(self.sb.npm_calls(), [])

    def test_default_launcher_still_installs_in_place(self):
        self.sb.live("old")
        self.assertEqual(self.install(0), "0")
        [call] = self.sb.npm_calls()
        self.assertEqual(call["cwd"], str(self.sb.web))
        self.assertFalse(self.sb.state.exists())

    def build(self, nm_swapped, **extra):
        if subprocess.run(["pgrep", "-f", "next build"], capture_output=True).returncode == 0:
            self.skipTest("a real `next build` is running; the launcher would refuse")
        exit_file = self.tmp / "build.exit"
        self.launch("REMOTE_BUILD_LAUNCH", [
            self.sb.web, self.NODE_VERSION, self.tmp / "build.sh", self.tmp / "build.log",
            exit_file, nm_swapped, self.helper, self.sb.state,
        ], **extra)
        return self.wait_exit(exit_file)

    def test_failed_build_after_swap_restores_node_modules_and_next(self):
        self.sb.live("old")
        (self.sb.web / ".next").mkdir()
        (self.sb.web / ".next/BUILD_ID").write_text("old\n")
        self.assertEqual(self.install(1), "0")
        self.assertEqual(self.build(1, FAKE_NPM_BUILD_RC=1), "1")
        self.assertEqual(self.sb.sentinel(self.sb.web / "node_modules"), "old")
        self.assertEqual((self.sb.web / ".next/BUILD_ID").read_text(), "old\n")

    def test_failed_build_without_swap_leaves_node_modules(self):
        # An older node_modules.prev from a previous deploy must not be swapped in.
        self.sb.live("current")
        self.sb.state.mkdir()
        prev = self.sb.state / "node_modules.prev"
        prev.mkdir()
        (prev / "sentinel").write_text("ancient\n")
        self.assertEqual(self.build(0, FAKE_NPM_BUILD_RC=1), "1")
        self.assertEqual(self.sb.sentinel(self.sb.web / "node_modules"), "current")
        self.assertEqual(self.sb.sentinel(prev), "ancient")

    def test_successful_build_keeps_new_node_modules(self):
        self.sb.live("old")
        self.assertEqual(self.install(1), "0")
        self.assertEqual(self.build(1), "0")
        self.assertEqual(self.sb.sentinel(self.sb.web / "node_modules"), "new")
        self.assertEqual(self.sb.sentinel(self.sb.state / "node_modules.prev"), "old")


if __name__ == "__main__":
    unittest.main()
