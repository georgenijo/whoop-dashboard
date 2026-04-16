import json
import logging
import os
import subprocess
import time

from whoop.insights import _build_context

LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    filename=os.path.join(LOG_DIR, "chat.log"),
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("whoop.chat")

CHAT_SYSTEM_PROMPT = """You are a personal health analyst having a conversation about the user's Whoop biometric data.

You have access to their recent Whoop data below. Use it to answer questions with specific numbers and dates.

Rules:
- Reference actual data points, don't generalize
- Compare to the user's own baseline, not population averages
- Be concise and direct
- If the data doesn't contain enough info to answer, say so
- Give actionable advice when relevant

Formatting:
- Use markdown for readability: **bold** for key metrics, headers (##) for sections
- Use bullet points for lists of findings
- Use a short summary line at the top (1 sentence, bolded)
- End with a clear "What to do" section if advice applies
- Keep total response under 250 words

"""


def send_chat_message(user_message: str, history: list[dict], days: int = 30) -> str:
    logger.info("USER_MESSAGE | history_len=%d | days=%d | message=%s",
                len(history), days, user_message[:200])

    t0 = time.time()
    context = _build_context(days)
    context_time = time.time() - t0
    logger.info("CONTEXT_BUILT | %.2fs | context_len=%d chars", context_time, len(context))

    parts = [CHAT_SYSTEM_PROMPT, context, "\n\n=== CONVERSATION ===\n"]

    for msg in history:
        role = "User" if msg["role"] == "user" else "Assistant"
        parts.append(f"{role}: {msg['content']}\n")

    parts.append(f"User: {user_message}\nAssistant:")

    prompt = "\n".join(parts)
    logger.info("PROMPT_BUILT | total_len=%d chars", len(prompt))

    env = dict(os.environ)
    env["HOME"] = os.path.expanduser("~")

    t0 = time.time()
    result = subprocess.run(
        [
            "claude",
            "-p",
            prompt,
            "--dangerously-skip-permissions",
            "--model", "sonnet",
        ],
        capture_output=True,
        text=True,
        timeout=120,
        env=env,
    )
    claude_time = time.time() - t0

    if result.returncode != 0:
        logger.error("CLAUDE_ERROR | %.2fs | returncode=%d | stderr=%s",
                      claude_time, result.returncode, result.stderr[:500])
        return f"Error: {result.stderr[:500]}"

    response = result.stdout.strip()
    logger.info("CLAUDE_RESPONSE | %.2fs | response_len=%d chars", claude_time, len(response))
    return response
