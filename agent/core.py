"""
NAID Agent — core conversation loop.

Reuses one container session per agent instance so files persist across turns
without re-attaching them (which would blow rate limits).
"""
import os
from dotenv import load_dotenv
load_dotenv()

# When deployed on Streamlit Cloud, the API key comes from st.secrets
# rather than .env. Fall through to that if the env var isn't set.
if not os.environ.get("ANTHROPIC_API_KEY"):
    try:
        import streamlit as st
        if "ANTHROPIC_API_KEY" in st.secrets:
            os.environ["ANTHROPIC_API_KEY"] = st.secrets["ANTHROPIC_API_KEY"]
    except Exception:
        pass

import json
import base64
from pathlib import Path
from anthropic import Anthropic
from agent.system_prompt import SYSTEM_PROMPT

PROJECT_ROOT = Path(__file__).parent.parent
FILE_IDS_PATH = PROJECT_ROOT / "data" / "file_ids.json"

MODEL = "claude-sonnet-4-5"
MAX_TOKENS = 8000


def load_file_ids():
    """Load file IDs from local JSON or Streamlit secrets."""
    if FILE_IDS_PATH.exists():
        return json.loads(FILE_IDS_PATH.read_text())
    try:
        import streamlit as st
        if "FILE_IDS" in st.secrets:
            return dict(st.secrets["FILE_IDS"])
    except Exception:
        pass
    raise FileNotFoundError(
        f"{FILE_IDS_PATH} not found and no FILE_IDS in Streamlit secrets."
    )


class NAIDAgent:
    def __init__(self):
        self.client = Anthropic()
        self.file_ids = load_file_ids()
        self.messages = []
        self.container_id = None
        self._fetched_file_ids = set()

    def chat(self, user_message):
        # First user turn: attach all files. Later turns: just text.
        if not self.messages:
            user_content = [
                {"type": "container_upload", "file_id": fid}
                for fid in self.file_ids.values()
            ]
            user_content.append({"type": "text", "text": user_message})
        else:
            user_content = user_message

        self.messages.append({"role": "user", "content": user_content})

        while True:
            request_kwargs = {
                "model": MODEL,
                "max_tokens": MAX_TOKENS,
                "system": SYSTEM_PROMPT,
                "tools": [
                    {"type": "code_execution_20250825", "name": "code_execution"},
                    {"type": "web_search_20250305", "name": "web_search", "max_uses": 5},
                ],
                "betas": ["code-execution-2025-08-25", "files-api-2025-04-14"],
                "messages": self.messages,
            }

            if self.container_id is not None:
                request_kwargs["container"] = self.container_id

            response = self.client.beta.messages.create(**request_kwargs)

            if self.container_id is None and getattr(response, "container", None):
                self.container_id = response.container.id

            self.messages.append({"role": "assistant", "content": response.content})

            if response.stop_reason == "tool_use":
                continue

            # Collect text and inline images from the final response
            text_parts = []
            inline_images = []
            for block in response.content:
                if hasattr(block, "text") and block.text:
                    text_parts.append(block.text)
                btype = getattr(block, "type", "") or ""
                if btype.endswith("code_execution_tool_result"):
                    content = getattr(block, "content", None)
                    if content and hasattr(content, "content"):
                        for item in content.content:
                            if getattr(item, "type", None) == "image":
                                source = getattr(item, "source", None)
                                if source and getattr(source, "type", None) == "base64":
                                    inline_images.append({
                                        "data": source.data,
                                        "media_type": source.media_type,
                                    })

# Fetch any image files Claude created during code execution.
            # Only PNG/JPG files NOT already seen, and not from our initial uploads.
            saved_images = []
            try:
                files_list = self.client.beta.files.list()
                # Sort by created_at so newest are last
                all_files = list(files_list.data)
                try:
                    all_files.sort(key=lambda f: getattr(f, "created_at", "") or "")
                except Exception:
                    pass

                for f in all_files:
                    fname = (getattr(f, "filename", "") or "").lower()
                    if not fname.endswith((".png", ".jpg", ".jpeg")):
                        continue
                    if f.id in self._fetched_file_ids:
                        continue
                    if f.id in self.file_ids.values():
                        self._fetched_file_ids.add(f.id)
                        continue
                    self._fetched_file_ids.add(f.id)
                    file_bytes = self.client.beta.files.download(file_id=f.id).read()
                    saved_images.append({
                        "data": base64.b64encode(file_bytes).decode(),
                        "media_type": "image/png",
                    })

                # Mark every existing file as seen so future turns only pick up
                # files that didn't exist yet
                for f in all_files:
                    self._fetched_file_ids.add(f.id)
            except Exception as e:
                print(f"Note: could not fetch generated files: {e}")

            return {
                "text": "\n".join(text_parts),
                "images": inline_images + saved_images,
            }

if __name__ == "__main__":
    agent = NAIDAgent()
    print("NAID Agent ready. Type 'exit' to quit.\n")
    while True:
        try:
            user = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if user.lower() in ("exit", "quit"):
            break
        if not user:
            continue
        try:
            answer = agent.chat(user)
            print(f"\nAgent: {answer}\n")
        except Exception as e:
            print(f"\nError: {e}\n")