import concurrent.futures
from datetime import datetime

import requests


class AuthError(Exception):
    pass


class RateLimitError(Exception):
    def __init__(self, retry_after: int = 60):
        self.retry_after = retry_after


class WhoopClient:
    BASE_URL = "https://api.prod.whoop.com/developer"

    def __init__(self, access_token: str):
        self.access_token = access_token
        self._session = requests.Session()
        self._session.headers.update(
            {"Authorization": f"Bearer {access_token}"}
        )

    def _get(self, endpoint: str, params: dict | None = None) -> dict:
        resp = self._session.get(f"{self.BASE_URL}{endpoint}", params=params)
        if resp.status_code == 401:
            raise AuthError("Token expired or invalid")
        if resp.status_code == 429:
            retry_after = int(resp.headers.get("Retry-After", 60))
            raise RateLimitError(retry_after)
        resp.raise_for_status()
        return resp.json()

    def _get_all(self, endpoint: str, params: dict | None = None) -> list:
        params = dict(params or {})
        params["limit"] = 25
        records = []
        next_token = None

        while True:
            if next_token:
                params["nextToken"] = next_token
            elif "nextToken" in params:
                del params["nextToken"]

            data = self._get(endpoint, params)
            records.extend(data.get("records", []))
            next_token = data.get("next_token")
            if not next_token:
                break

        return records

    def get_profile(self) -> dict:
        return self._get("/v2/user/profile/basic")

    def get_body_measurement(self) -> dict:
        return self._get("/v2/user/measurement/body")

    def get_cycles(self, start: str, end: str) -> list:
        return self._get_all("/v2/cycle", {"start": start, "end": end})

    def get_recovery(self, start: str, end: str) -> list:
        return self._get_all("/v2/recovery", {"start": start, "end": end})

    def get_sleep(self, start: str, end: str) -> list:
        return self._get_all("/v2/activity/sleep", {"start": start, "end": end})

    def get_workouts(self, start: str, end: str) -> list:
        return self._get_all("/v2/activity/workout", {"start": start, "end": end})


def fetch_all_parallel(
    access_token: str, start: str, end: str
) -> dict[str, list | dict]:
    client = WhoopClient(access_token)
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        futures = {
            "profile": pool.submit(client.get_profile),
            "body": pool.submit(client.get_body_measurement),
            "cycles": pool.submit(client.get_cycles, start, end),
            "recovery": pool.submit(client.get_recovery, start, end),
            "sleep": pool.submit(client.get_sleep, start, end),
            "workouts": pool.submit(client.get_workouts, start, end),
        }
        results = {}
        for key, future in futures.items():
            results[key] = future.result()
        return results
