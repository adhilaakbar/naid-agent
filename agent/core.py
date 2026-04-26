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
import time
import base64
import hashlib
from pathlib import Path
from anthropic import Anthropic
from agent.system_prompt import SYSTEM_PROMPT

PROJECT_ROOT = Path(__file__).parent.parent
FILE_IDS_PATH = PROJECT_ROOT / "data" / "file_ids.json"

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 4000


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
        self.last_response = {"text": "", "images": []}

        # Pre-populate _fetched_file_ids with every file that already exists
        # in the account at startup. This prevents the first code-execution
        # turn from downloading every leftover PNG from previous sessions.
        try:
            t = time.time()
            existing = self.client.beta.files.list()
            for f in existing.data:
                self._fetched_file_ids.add(f.id)
            print(f"[init] pre-loaded {len(self._fetched_file_ids)} existing file IDs in {time.time()-t:.1f}s")
        except Exception as e:
            print(f"[init] could not pre-load existing file IDs: {e}")

    def _build_request_kwargs(self):
        # Cache_control markers turn repeat input into ~10%-weighted cached reads,
        # which keeps us under the 30k-input-tokens/min rate limit on long sessions.
        kwargs = {
            "model": MODEL,
            "max_tokens": MAX_TOKENS,
            "system": [
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            "tools": [
                {"type": "code_execution_20250825", "name": "code_execution"},
                {
                    "type": "web_search_20250305",
                    "name": "web_search",
                    "max_uses": 2,
                    "cache_control": {"type": "ephemeral"},
                },
            ],
            "betas": ["code-execution-2025-08-25", "files-api-2025-04-14"],
            "messages": self.messages,
        }
        if self.container_id is not None:
            kwargs["container"] = self.container_id
        return kwargs

    def chat_stream(self, user_message):
        """Stream a turn. Yields text chunks; populates self.last_response when done."""
        t_turn = time.time()
        print(f"\n[timing] === new turn started ===")

        # First user turn: attach all files. Later turns: just text.
        # The first message gets a cache breakpoint so subsequent turns can
        # cache-read the file-upload list instead of re-sending it as fresh input.
        if not self.messages:
            user_content = [
                {"type": "container_upload", "file_id": fid}
                for fid in self.file_ids.values()
            ]
            user_content.append({
                "type": "text",
                "text": user_message,
                "cache_control": {"type": "ephemeral"},
            })
        else:
            user_content = user_message

        self.messages.append({"role": "user", "content": user_content})

        text_parts = []
        inline_images = []
        code_exec_happened = False
        turn_count = 0

        while True:
            turn_count += 1
            t_stream = time.time()
            request_kwargs = self._build_request_kwargs()

            with self.client.beta.messages.stream(**request_kwargs) as stream:
                for event in stream:
                    etype = getattr(event, "type", "")
                    if etype == "content_block_delta":
                        delta = getattr(event, "delta", None)
                        if delta and getattr(delta, "type", "") == "text_delta":
                            chunk = getattr(delta, "text", "")
                            if chunk:
                                yield chunk
                    elif etype == "content_block_start":
                        block = getattr(event, "content_block", None)
                        btype = getattr(block, "type", "") if block else ""
                        if btype == "server_tool_use":
                            name = getattr(block, "name", "")
                            if name == "code_execution":
                                yield "\n\n_Running code…_\n\n"
                            elif name == "web_search":
                                yield "\n\n_Searching the web…_\n\n"
                response = stream.get_final_message()

            print(f"[timing] round {turn_count}: stream took {time.time()-t_stream:.1f}s, stop_reason={response.stop_reason}")

            if self.container_id is None and getattr(response, "container", None):
                self.container_id = response.container.id

            self.messages.append({"role": "assistant", "content": response.content})

            for block in response.content:
                if hasattr(block, "text") and block.text:
                    text_parts.append(block.text)
                btype = getattr(block, "type", "") or ""
                if btype.endswith("code_execution_tool_result"):
                    code_exec_happened = True
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

            if response.stop_reason == "tool_use":
                yield "\n_Processing results…_\n"
                continue
            break

        print(f"[timing] total model rounds: {turn_count}, inline images captured: {len(inline_images)}")

        # Only scan generated files when code execution actually ran this turn.
        # Because we pre-populated _fetched_file_ids at startup, this loop
        # will only download files genuinely created by this session.
        saved_images = []
        seen_hashes = set()

        if code_exec_happened:
            try:
                t_list = time.time()
                files_list = self.client.beta.files.list()
                all_files = list(files_list.data)
                print(f"[timing] files.list() took {time.time()-t_list:.1f}s, returned {len(all_files)} files")

                try:
                    all_files.sort(key=lambda f: getattr(f, "created_at", "") or "")
                except Exception:
                    pass

                download_count = 0
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

                    t_dl = time.time()
                    file_bytes = self.client.beta.files.download(file_id=f.id).read()
                    print(f"[timing] downloaded {f.id} ({len(file_bytes)} bytes) in {time.time()-t_dl:.1f}s")
                    download_count += 1

                    h = hashlib.sha256(file_bytes).hexdigest()
                    if h in seen_hashes:
                        continue
                    seen_hashes.add(h)
                    self._fetched_file_ids.add(h)

                    saved_images.append({
                        "data": base64.b64encode(file_bytes).decode(),
                        "media_type": "image/png",
                    })

                print(f"[timing] downloaded {download_count} new image files this turn")

                for f in all_files:
                    self._fetched_file_ids.add(f.id)
            except Exception as e:
                print(f"Note: could not fetch generated files: {e}")

        unique_inline = []
        for img in inline_images:
            try:
                img_bytes = base64.b64decode(img["data"])
                h = hashlib.sha256(img_bytes).hexdigest()
                if h in seen_hashes:
                    continue
                seen_hashes.add(h)
                unique_inline.append(img)
            except Exception:
                unique_inline.append(img)

        all_images = unique_inline + saved_images
        final_images = all_images[-1:] if all_images else []

        self.last_response = {
            "text": "\n".join(text_parts),
            "images": final_images,
        }

        print(f"[timing] === turn complete in {time.time()-t_turn:.1f}s total ===\n")

    def chat(self, user_message):
        """Non-streaming wrapper for CLI / scripted use."""
        for _ in self.chat_stream(user_message):
            pass
        return self.last_response


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
            print("\nAgent: ", end="", flush=True)
            for chunk in agent.chat_stream(user):
                print(chunk, end="", flush=True)
            print("\n")
        except Exception as e:
            print(f"\nError: {e}\n")