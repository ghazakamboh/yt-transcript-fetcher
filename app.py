import streamlit as st
import re
import requests
from youtube_transcript_api import YouTubeTranscriptApi as YTA
from youtube_transcript_api import (
    TranscriptsDisabled,
    NoTranscriptFound,
    VideoUnavailable,
)

st.set_page_config(page_title="YouTube Transcript Fetcher", page_icon="📝", layout="wide")

with st.sidebar:
    st.header("🔑 AI Settings")
    api_key = st.text_input(
        "OpenRouter API Key",
        type="password",
        help="Free API key from openrouter.ai/keys — no credit card needed",
    )
    if api_key:
        st.success("✅ AI ready")
    else:
        st.info("Enter an API key to unlock Summarize & Q&A features")
    st.markdown("[Get free key →](https://openrouter.ai/keys)")
    st.caption("Uses free models (Llama 3.3 70B, etc.) — $0 cost")

st.title("📝 YouTube Transcript Fetcher")
st.markdown("Paste YouTube URLs and get clean transcripts. Enable AI above for summaries & Q&A.")

urls_input = st.text_area(
    "YouTube URLs (one per line)",
    placeholder=(
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ\n"
        "https://youtu.be/abc123def45\n"
        "https://www.youtube.com/shorts/xyz789abc11"
    ),
    height=140,
)

col1, col2 = st.columns([1, 5])
with col1:
    include_ts = st.checkbox("Timestamps", value=False)
with col2:
    fetch_clicked = st.button("🚀 Fetch Transcripts", type="primary", use_container_width=True)


def extract_video_id(url):
    pattern = r'(?:v=|\/v\/|embed\/|youtu\.be\/|\/shorts\/)([^"&?\/\s]{11})'
    match = re.search(pattern, url)
    return match.group(1) if match else None


def _fmt_ts(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"[{h:02d}:{m:02d}:{s:02d}]"


def fetch_transcript(video_id, with_ts):
    snippets = list(YTA().fetch(video_id, languages=["en"]))
    if with_ts:
        return "\n".join(f"{_fmt_ts(s.start)} {s.text}" for s in snippets)
    return " ".join(s.text for s in snippets)


OR_MODEL = "openrouter/free"
OR_URL = "https://openrouter.ai/api/v1/chat/completions"


def call_or(api_key, prompt, system=None):
    body = {
        "model": OR_MODEL,
        "messages": [
            {"role": "system", "content": system or "You are a helpful assistant."},
            {"role": "user", "content": prompt},
        ],
    }
    resp = requests.post(
        OR_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=body,
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


# ---- state init ----
if "summaries" not in st.session_state:
    st.session_state.summaries = {}
if "chats" not in st.session_state:
    st.session_state.chats = {}

if fetch_clicked:
    urls = [u.strip() for u in urls_input.split("\n") if u.strip()]

    if not urls:
        st.warning("Please enter at least one YouTube URL.")
        st.stop()

    results = []
    progress = st.progress(0, text="Starting...")

    for i, url in enumerate(urls):
        vid = extract_video_id(url)
        progress.progress((i + 1) / len(urls), text=f"Processing {i + 1}/{len(urls)} ...")

        if not vid:
            results.append(("error", url, "Could not parse video ID"))
            continue

        status = st.empty()
        status.info(f"🎬 Fetching {vid} ...")

        try:
            text = fetch_transcript(vid, include_ts)
            results.append(("ok", vid, text))
            status.success(f"✅ {vid}")
        except TranscriptsDisabled:
            results.append(("error", vid, "Transcripts disabled"))
            status.error(f"❌ {vid} — Transcripts disabled")
        except NoTranscriptFound:
            results.append(("error", vid, "No transcript found"))
            status.error(f"❌ {vid} — No transcript found")
        except VideoUnavailable:
            results.append(("error", vid, "Video unavailable"))
            status.error(f"❌ {vid} — Video unavailable")
        except Exception as e:
            results.append(("error", vid, str(e)))
            status.error(f"❌ {vid} — {e}")

    st.session_state["_results"] = results

# ---- display results ----
if "_results" in st.session_state:
    results = st.session_state["_results"]

    st.divider()
    st.subheader("📄 Results")

    ok_count = sum(1 for r in results if r[0] == "ok")
    err_count = sum(1 for r in results if r[0] == "error")

    mc1, mc2, mc3 = st.columns([1, 1, 4])
    mc1.metric("✅ Succeeded", ok_count)
    mc2.metric("❌ Failed", err_count)

    for kind, ident, payload in results:
        if kind == "ok":
            with st.container():
                st.code(payload, language="text", line_numbers=True)

                if api_key:
                    vid = ident

                    # ---- Summarize ----
                    sum_key = f"sum_{vid}"
                    if sum_key not in st.session_state.summaries:
                        st.session_state.summaries[sum_key] = None

                    if st.session_state.summaries[sum_key] is None:
                        if st.button(f"📋 Summarize", key=f"btn_sum_{vid}"):
                            with st.spinner("Summarizing..."):
                                truncated = payload[:12000]
                                system = "You are a helpful assistant. Summarize the following YouTube transcript concisely in bullet points."
                                st.session_state.summaries[sum_key] = call_or(
                                    api_key, f"Summarize this transcript:\n\n{truncated}", system
                                )
                            st.rerun()
                    else:
                        st.text_area(
                            "📋 Summary",
                            value=st.session_state.summaries[sum_key],
                            height=150,
                            key=f"ta_sum_{vid}",
                        )

                    # ---- Q&A Chat ----
                    chat_key = f"chat_{vid}"
                    if chat_key not in st.session_state.chats:
                        st.session_state.chats[chat_key] = []

                    chat_msgs = st.session_state.chats[chat_key]

                    for msg in chat_msgs:
                        with st.chat_message(msg["role"]):
                            st.markdown(msg["content"])

                    if prompt := st.chat_input(f"Ask about this video...", key=f"ci_{vid}"):
                        chat_msgs.append({"role": "user", "content": prompt})
                        with st.chat_message("user"):
                            st.markdown(prompt)

                        truncated = payload[:12000]
                        system = (
                            "You are analyzing a YouTube transcript. "
                            "Answer the user's question based ONLY on this transcript.\n\n"
                            f"Transcript:\n{truncated}"
                        )
                        with st.chat_message("assistant"):
                            with st.spinner("Thinking..."):
                                try:
                                    reply = call_or(api_key, prompt, system)
                                    st.markdown(reply)
                                    chat_msgs.append({"role": "assistant", "content": reply})
                                except Exception as e:
                                    err_msg = f"Error: {e}"
                                    st.error(err_msg)
                                    chat_msgs.append({"role": "assistant", "content": err_msg})
                else:
                    st.info("🔑 Enter an OpenRouter API key in the sidebar to enable Summarize & Q&A.")

        else:
            st.error(f"❌ {ident} — {payload}")
