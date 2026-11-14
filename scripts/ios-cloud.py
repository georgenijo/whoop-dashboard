#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyjwt[crypto]"]
# ///
"""Validate and reconcile the source-controlled Xcode Cloud Beta and Verify workflows.

uv run --env-file <credentials.env> scripts/ios-cloud.py doctor
uv run --env-file <credentials.env> scripts/ios-cloud.py plan
uv run --env-file <credentials.env> scripts/ios-cloud.py apply

Only `apply` writes. It validates ownership and catalog availability first,
PATCHes drifted fields only, then independently reads back the workflow.
Credentials: ASC_KEY_ID, ASC_ISSUER_ID, optional ASC_KEY_PATH. No build is started.
"""

import argparse
import copy
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

BASE = "https://api.appstoreconnect.apple.com"
DEFAULT_MANIFEST = Path(__file__).resolve().parents[1] / "apps/ios/ci/workflows.json"


class CloudError(Exception):
    """An actionable configuration or API error, safe to show without credentials."""


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # urllib otherwise forwards Authorization to a redirected origin.
        fp.close()
        raise CloudError("App Store Connect redirect refused")


class API:
    def __init__(self):
        # Lazy import keeps offline tests dependency-free.
        import jwt

        try:
            key_id = os.environ["ASC_KEY_ID"]
            issuer = os.environ["ASC_ISSUER_ID"]
            key_path = Path(os.environ.get(
                "ASC_KEY_PATH", str(Path.home() / ".appstoreconnect/private_keys" / f"AuthKey_{key_id}.p8")
            )).expanduser()
            now = int(time.time())
            self.token = jwt.encode(
                {"iss": issuer, "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"},
                key_path.read_text(), algorithm="ES256", headers={"kid": key_id, "typ": "JWT"},
            )
        except (KeyError, OSError, ValueError) as error:
            raise CloudError("Set valid ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH credentials") from error

    def request(self, method, path, body=None):
        # Pagination URLs come from Apple; never send a bearer token off-origin.
        url = path if path.startswith("https://") else BASE + path
        parsed = urlsplit(url)
        if (parsed.scheme, parsed.netloc) != ("https", "api.appstoreconnect.apple.com"):
            raise CloudError("Refusing an App Store Connect request to another origin")
        req = Request(url, data=json.dumps(body).encode() if body else None, method=method,
                      headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        try:
            with build_opener(NoRedirects()).open(req, timeout=45) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except HTTPError as error:
            # API responses may include private account details; only print status/path.
            raise CloudError(f"App Store Connect {method} {parsed.path}: HTTP {error.code}") from error
        except (URLError, TimeoutError, ValueError) as error:
            raise CloudError(f"App Store Connect {method} {parsed.path}: request failed") from error

    def collection(self, path):
        items = []
        seen = set()
        while path:
            if path in seen:
                raise CloudError("App Store Connect returned a pagination cycle")
            seen.add(path)
            response = self.request("GET", path)
            items.extend(response["data"])
            path = response.get("links", {}).get("next")
        return items


def relation(item, name):
    return item.get("relationships", {}).get(name, {}).get("data")


def merged(current, desired):
    """Overlay managed keys, retaining unrecognized nested Apple settings."""
    if isinstance(desired, dict):
        result = copy.deepcopy(current) if isinstance(current, dict) else {}
        for key, value in desired.items():
            result[key] = merged(result.get(key), value)
        return result
    if isinstance(desired, list):
        # Retain extra Apple fields on corresponding managed pattern/matcher entries.
        old = current if isinstance(current, list) else []
        return [merged(old[i] if i < len(old) else None, value) for i, value in enumerate(desired)]
    return desired


def check_manifest(manifest):
    if manifest.get("schemaVersion") != 1:
        raise CloudError("Unsupported workflow manifest schema")
    beta = manifest["beta"]
    action = beta["archiveAction"]
    if (action.get("actionType") != "ARCHIVE" or action.get("isRequiredToPass") is not True
            or action.get("buildDistributionAudience") != "INTERNAL_ONLY"
            or beta["attributes"].get("isEnabled") is not True):
        raise CloudError("Manifest must retain the required internal Beta archive and enabled workflow")
    verify = manifest["verify"]
    test = verify["testAction"]
    if (test.get("actionType") != "TEST" or test.get("isRequiredToPass") is not True
            or verify["attributes"].get("isEnabled") is not True):
        raise CloudError("Manifest must retain the required enabled native Verify tests")
    destinations = test.get("testConfiguration", {}).get("testDestinations", [])
    if (len(destinations) != 1 or any(destinations[0].get(key) != manifest["xcode"][key]
                                     for key in ("deviceTypeIdentifier", "runtimeName", "runtimeIdentifier"))
            or test.get("scheme") != action.get("scheme") or test.get("platform") != "IOS"
            or verify["attributes"].get("containerFilePath") != beta["attributes"].get("containerFilePath")):
        raise CloudError("Verify must test the pinned Duo runtime and Beta app scheme/container")
    for key in ("xcode", "macOs"):
        if any(word in manifest[key]["name"].lower() for word in ("latest", "beta", "release candidate")):
            raise CloudError(f"Manifest {key} must pin a concrete stable release")


def snapshot(api, manifest):
    """Read and validate immutable ownership and desired catalog pins before planning."""
    check_manifest(manifest)
    product_id = manifest["productId"]
    product = api.request("GET", f"/v1/ciProducts/{product_id}?include=app")["data"]
    if product.get("id") != product_id or relation(product, "app") != {"type": "apps", "id": manifest["appId"]}:
        raise CloudError("Product does not belong to the manifest app; refusing changes")
    workflow_id = manifest["beta"]["id"]
    workflows = api.collection(f"/v1/ciProducts/{product_id}/workflows?limit=200")
    if not any(item["id"] == workflow_id for item in workflows):
        raise CloudError("Workflow does not belong to the manifest product; refusing changes")
    workflow = read_workflow(api, manifest, workflow_id)
    xcode = manifest["xcode"]
    versions = api.collection("/v1/ciXcodeVersions?limit=200")
    selected = next((item for item in versions if item["id"] == xcode["id"]), None)
    if not selected or any(selected["attributes"].get(k) != xcode[k] for k in ("name", "version")):
        raise CloudError("Pinned Xcode is unavailable or changed; explicitly select a supported stable pin")
    destinations = selected["attributes"].get("testDestinations", [])
    if not any(item.get("deviceTypeIdentifier") == xcode["deviceTypeIdentifier"]
               and any(runtime.get("runtimeName") == xcode["runtimeName"]
                       and runtime.get("runtimeIdentifier") == xcode["runtimeIdentifier"]
                       for runtime in item.get("availableRuntimes", [])) for item in destinations):
        raise CloudError("Pinned Xcode does not provide the required Duo runtime")
    mac = manifest["macOs"]
    compatible = api.collection(f"/v1/ciXcodeVersions/{xcode['id']}/macOsVersions?limit=200")
    selected_mac = next((item for item in compatible if item["id"] == mac["id"]), None)
    if not selected_mac or any(selected_mac["attributes"].get(k) != mac[k] for k in ("name", "version")):
        raise CloudError("Pinned macOS is unavailable or incompatible with pinned Xcode")
    return workflow


def read_workflow(api, manifest, workflow_id):
    response = api.request("GET", f"/v1/ciWorkflows/{workflow_id}?include=repository,xcodeVersion,macOsVersion")
    workflow = response["data"]
    if workflow.get("id") != workflow_id or workflow.get("type") != "ciWorkflows":
        raise CloudError("Unexpected workflow identity")
    repository = manifest["repository"]
    if relation(workflow, "repository") != {"type": "scmRepositories", "id": repository["id"]}:
        raise CloudError("Workflow repository differs from the manifest; refusing changes")
    repo = next((item for item in response.get("included", [])
                 if item["type"] == "scmRepositories" and item["id"] == repository["id"]), None)
    if not repo or repo["attributes"].get("httpCloneUrl") != repository["httpCloneUrl"]:
        raise CloudError("Repository URL differs from the manifest; refusing changes")
    if workflow["attributes"].get("isLockedForEditing"):
        raise CloudError("Workflow is locked for editing")
    return workflow


def find_verify(api, manifest):
    name = manifest["verify"]["attributes"]["name"]
    workflows = api.collection(f"/v1/ciProducts/{manifest['productId']}/workflows?limit=200")
    matches = [item for item in workflows if item.get("attributes", {}).get("name") == name]
    if len(matches) > 1:
        raise CloudError("Multiple Verify workflows found; refusing ambiguous changes")
    return read_workflow(api, manifest, matches[0]["id"]) if matches else None


def create_verify(manifest):
    spec = manifest["verify"]
    attributes = copy.deepcopy(spec["attributes"])
    attributes["actions"] = [copy.deepcopy(spec["testAction"])]
    return {"data": {"type": "ciWorkflows", "attributes": attributes, "relationships": {
        "product": {"data": {"type": "ciProducts", "id": manifest["productId"]}},
        "repository": {"data": {"type": "scmRepositories", "id": manifest["repository"]["id"]}},
        "xcodeVersion": {"data": {"type": "ciXcodeVersions", "id": manifest["xcode"]["id"]}},
        "macOsVersion": {"data": {"type": "ciMacOsVersions", "id": manifest["macOs"]["id"]}},
    }}}


def plan(workflow, manifest, spec=None):
    spec = spec or manifest["beta"]
    attributes = workflow["attributes"]
    updates = {}
    for key, value in spec["attributes"].items():
        desired = merged(attributes.get(key), value)
        if desired != attributes.get(key):
            updates[key] = desired
    desired_action = spec.get("archiveAction", spec.get("testAction"))
    actions = copy.deepcopy(attributes.get("actions", []))
    matches = [i for i, action in enumerate(actions) if action.get("name") == desired_action["name"]]
    if len(matches) != 1 or actions[matches[0]].get("actionType") != desired_action["actionType"]:
        raise CloudError("Expected one designated archive/test action; reconcile ambiguous/missing actions manually")
    index = matches[0]
    action = merged(actions[index], desired_action)
    if action != actions[index]:
        actions[index] = action
        updates["actions"] = actions
    relationships = {}
    for key, manifest_key, resource_type in (("xcodeVersion", "xcode", "ciXcodeVersions"),
                                              ("macOsVersion", "macOs", "ciMacOsVersions")):
        desired = {"type": resource_type, "id": manifest[manifest_key]["id"]}
        if relation(workflow, key) != desired:
            relationships[key] = {"data": desired}
    if not updates and not relationships:
        return None
    data = {"type": "ciWorkflows", "id": workflow["id"]}
    if updates:
        data["attributes"] = updates
    if relationships:
        data["relationships"] = relationships
    return {"data": data}


def run(api, manifest, command):
    workflow = snapshot(api, manifest)
    patch = plan(workflow, manifest)
    verify = find_verify(api, manifest)
    verify_patch = plan(verify, manifest, manifest["verify"]) if verify else None
    create = create_verify(manifest) if verify is None else None
    drift = bool(patch or verify_patch or create)
    if command == "apply" and drift:
        # Validate and plan both workflows before making the first mutation.
        if patch:
            api.request("PATCH", f"/v1/ciWorkflows/{manifest['beta']['id']}", patch)
        if create:
            api.request("POST", "/v1/ciWorkflows", create)
        elif verify_patch:
            api.request("PATCH", f"/v1/ciWorkflows/{verify['id']}", verify_patch)
        # Successful writes are insufficient: independently re-read both workflows.
        if plan(snapshot(api, manifest), manifest):
            raise CloudError("Beta workflow still differs after PATCH; apply was not verified")
        verified = find_verify(api, manifest)
        if verified is None or plan(verified, manifest, manifest["verify"]):
            raise CloudError("Verify workflow still differs after write; apply was not verified")
        return {"status": "applied", "workflowId": manifest["beta"]["id"],
                "verifyWorkflowId": verified["id"], "verified": True}, 0
    result = {"status": "drift" if drift else "healthy", "workflowId": manifest["beta"]["id"],
              "patch": patch, "verify": {"workflowId": verify["id"] if verify else None,
                                          "patch": verify_patch, "create": create}}
    return result, 1 if command == "doctor" and drift else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("doctor", "plan", "apply"))
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    args = parser.parse_args()
    try:
        manifest = json.loads(args.manifest.read_text())
        result, code = run(API(), manifest, args.command)
        print(json.dumps(result, indent=2))
        return code
    except (CloudError, KeyError, TypeError, OSError, ValueError) as error:
        # KeyError/TypeError indicate incomplete Apple response/manifest, never success.
        message = str(error) if isinstance(error, CloudError) else "Invalid manifest, credentials, or App Store Connect response"
        print(json.dumps({"status": "error", "message": message}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
