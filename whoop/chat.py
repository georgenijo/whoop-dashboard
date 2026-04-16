import os
import subprocess

from whoop.insights import _build_context

CHAT_SYSTEM_PROMPT = """You are a personal health coach with access to the user's Whoop biometric data.
Answer questions conversationally. Reference specific data points. Be direct.
If asked to compare periods, do the math. If asked for recommendations, be specific.
Keep responses concise (under 200 words unless the question warrants more)."""


def run_chat(messages: list[dict], days: int = 30) -> str:
    """
    messages: [{"role": "user"|"assistant", "content": "..."}]
    Returns assistant response string.
    """
    context = _build_context(days)

    prompt = f"{CHAT_SYSTEM_PROMPT}\n\n{context}\n\n"
    for msg in messages:
        role_label = "User" if msg["role"] == "user" else "Assistant"
        prompt += f"{role_label}: {msg['content']}\n\n"
    prompt += "Assistant:"

    env = dict(os.environ)
    env["HOME"] = os.path.expanduser("~")

    result = subprocess.run(
        ["claude", "-p", prompt, "--dangerously-skip-permissions", "--model", "sonnet"],
        capture_output=True,
        text=True,
        timeout=120,
        env=env,
    )
    if result.returncode == 0:
        return result.stdout.strip()
    return f"Error: {result.stderr[:500]}"
