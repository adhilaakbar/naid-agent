"""
NAID Agent — Streamlit chat UI.

Run with:
    streamlit run app.py
"""
import base64
import streamlit as st
from agent.core import NAIDAgent

st.set_page_config(
    page_title="NAID Agent",
    page_icon="🇲🇽",
    layout="wide",
)

# --- Custom CSS for styling ---
st.markdown("""
<style>
    /* Force light backgrounds */
    .stApp { background-color: #FFFFFF !important; }
    [data-testid="stSidebar"] {
        background-color: #F4F6F9 !important;
        border-right: 1px solid #E0E4EA;
    }
    .stApp p, .stApp li, .stApp span { color: #1A1A1A; }
    .stApp [data-testid="stChatMessageContent"] { color: #1A1A1A !important; }

    /* Hide Streamlit's default top padding so our header sits flush */
    .block-container {
        padding-top: 0 !important;
        max-width: 900px;
    }

    /* Sidebar headings */
    [data-testid="stSidebar"] h1,
    [data-testid="stSidebar"] h2,
    [data-testid="stSidebar"] h3 {
        color: #1B3A5E !important;
        font-family: Georgia, 'Times New Roman', serif;
    }
    [data-testid="stSidebar"] h1 {
        font-size: 20px;
        border-bottom: 2px solid #C9A14A;
        padding-bottom: 8px;
    }
    [data-testid="stSidebar"] h3 {
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 1.2px;
        margin-top: 1.2rem;
    }

    /* Chat */
    [data-testid="stChatMessageContent"] {
        font-size: 15px;
        line-height: 1.65;
    }

    /* Sidebar buttons */
    [data-testid="stSidebar"] .stButton > button {
        background-color: #FFFFFF;
        color: #1B3A5E !important;
        border: 1px solid #1B3A5E;
        font-size: 13px;
        text-align: left;
        font-weight: 500;
        white-space: normal;
        line-height: 1.3;
        padding: 8px 12px;
    }
    [data-testid="stSidebar"] .stButton > button:hover {
        background-color: #1B3A5E;
        color: #FFFFFF !important;
    }
</style>
""", unsafe_allow_html=True)

# --- Header bar ---
st.markdown(
    '<div style="background-color:#1B3A5E; padding:24px 32px; '
    'margin:-1rem -2rem 1.5rem -2rem; border-bottom:3px solid #C9A14A;">'
    '<h1 style="color:#FFFFFF !important; font-family:Georgia, serif; '
    'font-size:26px; font-weight:600; line-height:1.2; margin:0; '
    'padding:0; background:transparent; border:none;">'
    'NAID Research Agent</h1>'
    '<div style="color:#C9A14A; font-family:Helvetica, sans-serif; '
    'font-size:11px; letter-spacing:2.5px; text-transform:uppercase; '
    'margin-top:5px; font-weight:500;">'
    'North American Integration &amp; Development Center · UCLA</div>'
    '</div>',
    unsafe_allow_html=True
)

# --- Sidebar ---
with st.sidebar:
    st.title("About")
    st.markdown(
        "Research assistant for US–Mexico economic integration, "
        "Mexican-origin and Latino economic contributions, and the "
        "labor and trade impacts of immigration and trade policy."
    )

    st.markdown("---")
    st.markdown("### Datasets")
    st.markdown(
        "**GTAP Labor Database**  \n"
        "County-level employment, baseline + 5 simulation scenarios "
        "(deportation, USMCA)\n\n"
        "**Diaspora GDP**  \n"
        "Mexican-origin & Latino economic contribution by state, 2023\n\n"
        "**Mexico Export Jobs**  \n"
        "Jobs in Mexico tied to US-bound exports\n\n"
        "**Remittances**  \n"
        "Quarterly & annual flows by US state of origin"
    )

    st.markdown("---")
    st.markdown("### Try asking")
    if st.button("📊 Compare TX vs CA on deportation impact", use_container_width=True):
        st.session_state.queued_prompt = "Compare Texas and California on Latino GDP, Mexican-origin share of state GDP, and projected employment loss under JPM_sim03."
    if st.button("💸 Top 10 states by remittances", use_container_width=True):
        st.session_state.queued_prompt = "Make a bar chart of the top 10 US states by remittances to Mexico in 2023."
    if st.button("🏗️ Most exposed sectors", use_container_width=True):
        st.session_state.queued_prompt = "Which US industries have the highest share of unauthorized foreign-born workers, and how do they fare under JPM_sim03?"
    if st.button("📚 What's the methodology?", use_container_width=True):
        st.session_state.queued_prompt = "Explain how the GTAP labor database was built — sources, location quotients, and the simulation logic."

    st.markdown("---")
    if st.button("Reset conversation", use_container_width=True):
        keep = {"queued_prompt"}
        for k in list(st.session_state.keys()):
            if k not in keep:
                del st.session_state[k]
        st.rerun()

    st.markdown("---")
    st.caption(
        "Every answer is sourced. Numerical claims cite the dataset, "
        "vintage, and known caveats. The agent uses code execution "
        "for analysis and web search for current events."
    )

# --- Initialize agent and message history once per session ---
if "agent" not in st.session_state:
    st.session_state.agent = NAIDAgent()
    st.session_state.messages = []

# --- Render chat history ---
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        if msg["role"] == "assistant":
            safe_text = msg["content"].replace("$", "\\$")
        else:
            safe_text = msg["content"]
        st.markdown(safe_text)
        for img in msg.get("images", []):
            st.image(base64.b64decode(img["data"]))

# --- Handle new input ---
# If a sidebar button queued a prompt, use it; otherwise wait for chat input
prompt = st.session_state.pop("queued_prompt", None)
if not prompt:
    prompt = st.chat_input("Ask a question about US–Mexico economic integration...")

if prompt:
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
            st.image(base64.b64decode(img["data"]))

    st.session_state.messages.append({
        "role": "assistant",
        "content": response["text"],
        "images": response["images"],
    })