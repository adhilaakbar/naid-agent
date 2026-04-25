"""
NAID Agent — Streamlit chat UI.

Run with:
    streamlit run app.py
"""
import streamlit as st
from agent.core import NAIDAgent

st.set_page_config(
    page_title="NAID Agent",
    page_icon="🇲🇽",
    layout="wide",
)

# Sidebar
with st.sidebar:
    st.title("NAID Agent")
    st.markdown(
        "Research assistant for US–Mexico economic integration, "
        "Mexican-origin and Latino economic contributions, and the "
        "labor and trade impacts of immigration and trade policy."
    )
    st.markdown("---")
    st.markdown("**Datasets loaded**")
    st.markdown(
        "- GTAP labor (county × sector × scenario)\n"
        "- Diaspora GDP (state, 2023)\n"
        "- Mexico Export Jobs (state × sector)\n"
        "- Remittances (US state of origin)"
    )
    st.markdown("---")
    if st.button("Reset conversation"):
        st.session_state.clear()
        st.rerun()

# Initialize agent and message history once per session
if "agent" not in st.session_state:
    st.session_state.agent = NAIDAgent()
    st.session_state.messages = []

# Render chat history
import base64
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        safe_text = msg["content"].replace("$", "\\$") if msg["role"] == "assistant" else msg["content"]
        st.markdown(safe_text)
        for img in msg.get("images", []):
            st.image(base64.b64decode(img["data"]))

# Handle new input
if prompt := st.chat_input("Ask a question about US–Mexico economic integration..."):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        with st.spinner("Thinking..."):
            try:
                response = st.session_state.agent.chat(prompt)
            except Exception as e:
                response = {"text": f"Error: {e}", "images": []}

        # Escape dollar signs so Streamlit doesn't render them as LaTeX math
        safe_text = response["text"].replace("$", "\\$")
        st.markdown(safe_text)
        for img in response["images"]:
            import base64
            st.image(base64.b64decode(img["data"]))

    st.session_state.messages.append({
        "role": "assistant",
        "content": response["text"],
        "images": response["images"],
    })