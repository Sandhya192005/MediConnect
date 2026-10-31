"""
The chat loop:
  1. Send the conversation + the list of tools to OpenAI.
  2. If the model asks for tools, run them and send the results back.
  3. Repeat (max MAX_TOOL_ROUNDS) until the model writes a normal answer.
Every message is saved so the next turn has the full context.
"""

from django.conf import settings
from django.utils import timezone
from openai import OpenAI

from .models import ChatMessage, ChatSession
from .tools import TOOL_SPECS, ToolContext, run_tool

MAX_TOOL_ROUNDS = 5
HISTORY_LIMIT = 30


class ChatNotConfigured(Exception):
    pass


def get_client() -> OpenAI:
    if not settings.OPENAI_API_KEY:
        raise ChatNotConfigured()
    return OpenAI(api_key=settings.OPENAI_API_KEY, timeout=30, max_retries=2)


def system_prompt(user, has_location: bool) -> str:
    now = timezone.localtime()
    return f"""You are MediConnect's assistant. You help people find doctors and hospitals and book appointments.

Today is {now:%A %d %B %Y}, current time {now:%I:%M %p} (India Standard Time).
The user is {user.first_name or "a user"}, logged in as a {user.role}.
{"The user has shared their location, so find_hospitals can search near them." if has_location else "The user has not shared their location. To search nearby, ask for a city or suggest tapping 'Share my location'."}

Rules:
- Only state doctors, hospitals, fees and times that came from a tool result. Never invent them.
- To book: find the doctor, get free slots, let the user pick, then call propose_booking. Tell the user to press Confirm on the card. Never say an appointment is booked: only the Confirm button books.
- You are not a doctor. Do not diagnose or recommend medicines or doses. You may suggest which kind of specialist fits the symptoms.
- If anything sounds like an emergency (chest pain, trouble breathing, stroke signs, heavy bleeding, thoughts of self-harm), first tell them to call 112 or 108 or go to the nearest emergency department.
- Keep answers short and friendly. Use plain text with short lists. Show times like "Mon 03 Nov, 10:30 AM".
- Politely decline topics unrelated to healthcare appointments."""


def load_history(session: ChatSession) -> list[dict]:
    msgs = list(session.messages.order_by("-id")[:HISTORY_LIMIT])[::-1]
    # Never start mid-way through a tool exchange: the API needs each tool result
    # to follow the assistant message that asked for it.
    while msgs and msgs[0].role != ChatMessage.Role.USER:
        msgs.pop(0)
    return [m.to_openai() for m in msgs]


def chat(user, session: ChatSession, text: str, location: dict | None = None, client=None) -> dict:
    client = client or get_client()
    ctx = ToolContext(user, location)

    ChatMessage.objects.create(session=session, role="user", content=text)
    messages = [{"role": "system", "content": system_prompt(user, bool(location))}, *load_history(session)]

    reply = ""
    for _ in range(MAX_TOOL_ROUNDS + 1):
        resp = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=messages,
            tools=TOOL_SPECS,
            temperature=0.3,
            max_tokens=700,
        )
        msg = resp.choices[0].message
        if not msg.tool_calls:
            reply = (msg.content or "").strip()
            break

        calls = [
            {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}}
            for c in msg.tool_calls
        ]
        ChatMessage.objects.create(session=session, role="assistant", content=msg.content or "", tool_calls=calls)
        messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": calls})

        for c in calls:
            result = run_tool(ctx, c["function"]["name"], c["function"]["arguments"])
            ChatMessage.objects.create(session=session, role="tool", content=result, tool_call_id=c["id"])
            messages.append({"role": "tool", "tool_call_id": c["id"], "content": result})
    else:
        reply = "Sorry, I couldn't finish that. Could you rephrase or ask one thing at a time?"

    if not reply:
        reply = "Sorry, I didn't catch that. Could you try again?"
    ChatMessage.objects.create(session=session, role="assistant", content=reply, proposals=ctx.proposals or None)
    session.save(update_fields=["updated_at"])
    return {"reply": reply, "proposals": ctx.proposals}
