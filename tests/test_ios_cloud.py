"""Offline regression checks for Xcode Cloud release configuration reconciliation."""

import copy
import importlib.util
from io import BytesIO
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.request import BaseHandler, build_opener
from urllib.response import addinfourl
from email.message import Message

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("ios_cloud", ROOT / "scripts/ios-cloud.py")
cloud = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cloud)
MANIFEST = json.loads((ROOT / "apps/ios/ci/workflows.json").read_text())


class CredentialBoundaryTests(unittest.TestCase):
    def test_redirects_never_forward_authorization(self):
        class RedirectResponse(BaseHandler):
            handler_order = 100

            def __init__(self, target):
                self.target = target
                self.seen = []

            def https_open(self, req):
                self.seen.append(req.full_url)
                headers = Message()
                headers["Location"] = self.target
                response = addinfourl(BytesIO(), headers, req.full_url, 302)
                response.msg = "Found"
                return response

            http_open = https_open

        for target in ("https://another.invalid/path", "http://api.appstoreconnect.apple.com/path"):
            with self.subTest(target=target):
                transport = RedirectResponse(target)
                opener = build_opener(cloud.NoRedirects(), transport)
                api = cloud.API.__new__(cloud.API)
                api.token = "offline-test-token"
                with patch.object(cloud, "build_opener", return_value=opener) as factory:
                    with self.assertRaisesRegex(cloud.CloudError, "redirect refused"):
                        api.request("GET", "/v1/ciProducts")
                self.assertIsInstance(factory.call_args.args[0], cloud.NoRedirects)
                self.assertEqual(transport.seen, [cloud.BASE + "/v1/ciProducts"])


class FakeAPI:
    def __init__(self):
        self.manifest = copy.deepcopy(MANIFEST)
        m = self.manifest
        self.workflow = {
            "type": "ciWorkflows", "id": m["beta"]["id"],
            "attributes": dict(copy.deepcopy(m["beta"]["attributes"]),
                               actions=[copy.deepcopy(m["beta"]["archiveAction"])],
                               isLockedForEditing=False),
            "relationships": {
                "repository": {"data": {"type": "scmRepositories", "id": m["repository"]["id"]}},
                "xcodeVersion": {"data": {"type": "ciXcodeVersions", "id": m["xcode"]["id"]}},
                "macOsVersion": {"data": {"type": "ciMacOsVersions", "id": m["macOs"]["id"]}},
            },
        }
        self.verify_workflow = copy.deepcopy(self.workflow)
        self.verify_workflow["id"] = "verify-workflow-id"
        self.verify_workflow["attributes"] = dict(copy.deepcopy(m["verify"]["attributes"]),
                                                  actions=[copy.deepcopy(m["verify"]["testAction"])])
        self.app_id = m["appId"]
        self.repo_url = m["repository"]["httpCloneUrl"]
        self.workflows = [{"id": m["beta"]["id"]}]
        self.xcodes = [{"id": m["xcode"]["id"], "attributes": {
            "name": m["xcode"]["name"], "version": m["xcode"]["version"],
            "testDestinations": [{"deviceTypeIdentifier": m["xcode"]["deviceTypeIdentifier"],
                                  "availableRuntimes": [{"runtimeName": m["xcode"]["runtimeName"],
                                                         "runtimeIdentifier": m["xcode"]["runtimeIdentifier"]}]}],
        }}]
        self.mac_versions = [{"id": m["macOs"]["id"], "attributes": copy.deepcopy(m["macOs"])}]
        self.writes = []
        self.ignore_patch = False
        self.patch_error = False

    def collection(self, path):
        if "/workflows?" in path:
            return self.workflows + ([copy.deepcopy(self.verify_workflow)] if self.verify_workflow else [])
        if "/macOsVersions?" in path:
            return self.mac_versions
        if path.startswith("/v1/ciXcodeVersions?"):
            return self.xcodes
        raise AssertionError(path)

    def request(self, method, path, body=None):
        if method == "POST":
            self.writes.append(copy.deepcopy(body))
            if not self.ignore_patch:
                self.verify_workflow = dict(copy.deepcopy(body["data"]), id="created-verify-id")
            return {"data": copy.deepcopy(self.verify_workflow)}
        if method == "PATCH":
            self.writes.append(copy.deepcopy(body))
            if self.patch_error:
                raise cloud.CloudError("Simulated HTTP failure")
            if not self.ignore_patch:
                workflow = self.workflow if body["data"]["id"] == self.workflow["id"] else self.verify_workflow
                for group in ("attributes", "relationships"):
                    workflow[group].update(copy.deepcopy(body["data"].get(group, {})))
            return {"data": copy.deepcopy(self.workflow)}
        if path.startswith("/v1/ciProducts/"):
            assert "include=app" in path, "app relationship data needs include=app"
            return {"data": {"id": self.manifest["productId"], "relationships": {
                "app": {"data": {"type": "apps", "id": self.app_id}},
            }}}
        if path.startswith("/v1/ciWorkflows/"):
            workflow = self.workflow if f"/{self.workflow['id']}?" in path else self.verify_workflow
            return {"data": copy.deepcopy(workflow), "included": [{
                "type": "scmRepositories", "id": self.manifest["repository"]["id"],
                "attributes": {"httpCloneUrl": self.repo_url},
            }]}
        raise AssertionError(path)


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.api = FakeAPI()
        self.manifest = copy.deepcopy(MANIFEST)

    def run_command(self, command):
        return cloud.run(self.api, self.manifest, command)

    def test_healthy_doctor_is_read_only(self):
        result, status = self.run_command("doctor")
        self.assertEqual((result["status"], status, self.api.writes), ("healthy", 0, []))

    def test_dangling_xcode_reference_detected_and_minimal_plan(self):
        self.api.workflow["relationships"]["xcodeVersion"]["data"] = None
        result, status = self.run_command("doctor")
        self.assertEqual((result["status"], status), ("drift", 1))
        patch = result["patch"]["data"]
        self.assertNotIn("attributes", patch)
        self.assertEqual(list(patch["relationships"]), ["xcodeVersion"])
        self.assertEqual(self.api.writes, [])

    def test_plan_never_writes_even_when_workflow_disabled(self):
        self.api.workflow["attributes"]["isEnabled"] = False
        result, status = self.run_command("plan")
        self.assertEqual(status, 0)
        self.assertEqual(result["patch"]["data"]["attributes"], {"isEnabled": True})
        self.assertEqual(self.api.writes, [])

    def test_wrong_app_cannot_write(self):
        self.api.app_id = "unrelated-app"
        with self.assertRaisesRegex(cloud.CloudError, "manifest app"):
            self.run_command("apply")
        self.assertEqual(self.api.writes, [])

    def test_wrong_product_cannot_write(self):
        self.api.workflows = []
        with self.assertRaisesRegex(cloud.CloudError, "manifest product"):
            self.run_command("apply")
        self.assertEqual(self.api.writes, [])

    def test_wrong_repo_cannot_write(self):
        self.api.workflow["relationships"]["repository"]["data"]["id"] = "other"
        with self.assertRaisesRegex(cloud.CloudError, "repository differs"):
            self.run_command("apply")
        self.assertEqual(self.api.writes, [])

    def test_repository_url_is_checked(self):
        self.api.repo_url = "https://github.com/someone/another-repo.git"
        with self.assertRaisesRegex(cloud.CloudError, "Repository URL"):
            self.run_command("apply")

    def test_retired_desired_xcode_fails_closed(self):
        self.api.xcodes = []
        with self.assertRaisesRegex(cloud.CloudError, "Pinned Xcode is unavailable"):
            self.run_command("apply")
        self.assertEqual(self.api.writes, [])

    def test_duo_runtime_is_required(self):
        self.api.xcodes[0]["attributes"]["testDestinations"][0]["availableRuntimes"] = []
        with self.assertRaisesRegex(cloud.CloudError, "Duo runtime"):
            self.run_command("apply")

    def test_incompatible_macos_fails_closed(self):
        self.api.mac_versions = []
        with self.assertRaisesRegex(cloud.CloudError, "incompatible"):
            self.run_command("apply")
        self.assertEqual(self.api.writes, [])

    def test_unknown_settings_actions_and_conditions_survive(self):
        attrs = self.api.workflow["attributes"]
        attrs["branchStartCondition"]["source"]["appleFutureFlag"] = True
        attrs["branchStartCondition"]["source"]["patterns"][0]["futurePatternFlag"] = True
        attrs["branchStartCondition"]["autoCancel"] = False
        attrs["manualBranchStartCondition"] = {"retained": "manual"}
        attrs["actions"][0]["appleFutureSetting"] = {"retained": True}
        attrs["actions"][0]["isRequiredToPass"] = False
        attrs["actions"].append({"name": "Existing tests", "actionType": "TEST", "isRequiredToPass": True})
        result, _ = self.run_command("plan")
        updates = result["patch"]["data"]["attributes"]
        self.assertTrue(updates["branchStartCondition"]["source"]["appleFutureFlag"])
        self.assertTrue(updates["branchStartCondition"]["source"]["patterns"][0]["futurePatternFlag"])
        self.assertEqual(updates["actions"][0]["appleFutureSetting"], {"retained": True})
        self.assertEqual(updates["actions"][1], attrs["actions"][1])
        self.assertNotIn("manualBranchStartCondition", updates)
        self.assertTrue(updates["actions"][0]["isRequiredToPass"])

    def test_missing_or_ambiguous_archive_never_replaces_actions(self):
        original = copy.deepcopy(self.api.workflow["attributes"]["actions"])
        for actions in ([], original + original):
            self.api.workflow["attributes"]["actions"] = actions
            with self.assertRaisesRegex(cloud.CloudError, "designated archive/test"):
                self.run_command("apply")
        self.assertEqual(self.api.writes, [])

    def test_apply_verifies_and_is_idempotent(self):
        self.api.workflow["relationships"]["xcodeVersion"]["data"] = None
        result, status = self.run_command("apply")
        self.assertEqual((result["status"], result["verified"], status), ("applied", True, 0))
        result, status = self.run_command("apply")
        self.assertEqual((result["status"], status, len(self.api.writes)), ("healthy", 0, 1))

    def test_successful_patch_without_changed_readback_is_failure(self):
        self.api.workflow["relationships"]["xcodeVersion"]["data"] = None
        self.api.ignore_patch = True
        with self.assertRaisesRegex(cloud.CloudError, "not verified"):
            self.run_command("apply")

    def test_api_failure_never_claims_success(self):
        self.api.workflow["relationships"]["xcodeVersion"]["data"] = None
        self.api.patch_error = True
        with self.assertRaisesRegex(cloud.CloudError, "HTTP failure"):
            self.run_command("apply")

    def test_beta_alias_manifest_is_rejected(self):
        self.manifest["xcode"]["name"] = "Latest Release"
        with self.assertRaisesRegex(cloud.CloudError, "concrete stable"):
            self.run_command("apply")
        self.assertEqual(self.api.writes, [])

    def test_weakened_manifest_archive_gate_is_rejected(self):
        self.manifest["beta"]["archiveAction"]["isRequiredToPass"] = False
        with self.assertRaisesRegex(cloud.CloudError, "required internal"):
            self.run_command("apply")
        self.assertEqual(self.api.writes, [])

    def test_missing_verify_plan_creates_without_writes(self):
        self.api.verify_workflow = None
        result, status = self.run_command("plan")
        create = result["verify"]["create"]["data"]
        self.assertEqual(status, 0)
        self.assertEqual(self.api.writes, [])
        self.assertEqual(create["relationships"]["product"]["data"]["id"], self.manifest["productId"])
        attrs = create["attributes"]
        self.assertEqual(attrs["scheduledStartCondition"]["schedule"],
                         {"frequency": "DAILY", "hour": 7, "minute": 0, "timezone": "UTC"})
        self.assertEqual(attrs["pullRequestStartCondition"]["destination"]["patterns"],
                         [{"pattern": "main", "isPrefix": False}])
        self.assertEqual(attrs["actions"][0]["testConfiguration"]["testDestinations"][0]["deviceTypeName"],
                         "iPhone Duo")

    def test_verify_create_and_reapply_are_idempotent(self):
        self.api.verify_workflow = None
        result, _ = self.run_command("apply")
        self.assertEqual((result["status"], result["verified"]), ("applied", True))
        result, _ = self.run_command("apply")
        self.assertEqual((result["status"], len(self.api.writes)), ("healthy", 1))

    def test_verify_duplicate_name_refuses_all_writes(self):
        self.api.workflows.append(copy.deepcopy(self.api.verify_workflow))
        self.api.workflow["relationships"]["xcodeVersion"]["data"] = None
        with self.assertRaisesRegex(cloud.CloudError, "Multiple Verify"):
            self.run_command("apply")
        self.assertEqual(self.api.writes, [])

    def test_verify_wrong_repository_refuses_all_writes(self):
        self.api.verify_workflow["relationships"]["repository"]["data"]["id"] = "wrong"
        self.api.workflow["relationships"]["xcodeVersion"]["data"] = None
        with self.assertRaisesRegex(cloud.CloudError, "repository differs"):
            self.run_command("apply")
        self.assertEqual(self.api.writes, [])

    def test_verify_patch_preserves_extra_test_actions(self):
        attrs = self.api.verify_workflow["attributes"]
        attrs["scheduledStartCondition"]["schedule"]["hour"] = 8
        attrs["actions"].append({"name": "More tests", "actionType": "TEST", "isRequiredToPass": True})
        result, _ = self.run_command("plan")
        patch = result["verify"]["patch"]["data"]
        self.assertEqual(list(patch["attributes"]), ["scheduledStartCondition"])
        self.assertNotIn("relationships", patch)
        self.run_command("apply")
        self.assertEqual(len(self.api.verify_workflow["attributes"]["actions"]), 2)

    def test_verify_create_must_appear_in_readback(self):
        self.api.verify_workflow = None
        self.api.ignore_patch = True
        with self.assertRaisesRegex(cloud.CloudError, "Verify workflow still differs"):
            self.run_command("apply")


    def test_verify_runtime_must_match_xcode_pin(self):
        self.manifest["verify"]["testAction"]["testConfiguration"]["testDestinations"][0]["runtimeName"] = "iOS 26.1"
        with self.assertRaisesRegex(cloud.CloudError, "pinned Duo runtime"):
            self.run_command("apply")
        self.assertEqual(self.api.writes, [])



if __name__ == "__main__":
    unittest.main()
