"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { LatLng } from "@/lib/types";

type Proposal = {
  doctor_id: number;
  name: string;
  specialization: string;
  hospital: string | null;
  city: string | null;
  fee: number;
  start: string;
  when: string;
  reason: string;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  proposals?: Proposal[];
  emergencyNotice?: string | null;
};

type ChatResponse = {
  session_id: number;
  reply: string;
  proposals: Proposal[];
  emergency: boolean;
  emergency_notice: string | null;
};

const STARTERS = ["Find a heart doctor in Chennai", "Hospitals near me", "Show my upcoming appointments"];

function BookingCard({ p, canBook }: { p: Proposal; canBook: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function confirm() {
    setState("busy");
    try {
      // The normal booking API: the same checks as booking from the doctor page.
      await api("/api/appointments/", {
        method: "POST",
        body: JSON.stringify({ doctor: p.doctor_id, start: p.start, reason: p.reason }),
      });
      setState("done");
    } catch (e) {
      setError(errorMessage(e));
      setState("error");
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm">
      <p className="font-semibold">{p.name}</p>
      <p className="text-slate-600">{p.specialization} · {p.hospital}{p.city ? `, ${p.city}` : ""}</p>
      <p className="mt-1">🗓️ {p.when} · ₹{p.fee.toFixed(0)}</p>
      {p.reason && <p className="text-slate-500">Reason: {p.reason}</p>}
      {state === "done" ? (
        <p className="mt-2 font-medium text-teal-800">
          ✓ Booked! <Link href="/patient/appointments" className="underline">View appointments</Link>
        </p>
      ) : canBook ? (
        <button onClick={confirm} disabled={state === "busy"} className="mt-2 w-full rounded-md bg-teal-600 py-1.5 font-medium text-white disabled:opacity-60">
          {state === "busy" ? "Booking…" : "Confirm booking"}
        </button>
      ) : (
        <p className="mt-2 text-slate-500">Only patient accounts can book.</p>
      )}
      {state === "error" && <p className="mt-1 text-red-600">{error}</p>}
    </div>
  );
}

export default function ChatWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [location, setLocation] = useState<LatLng | null>(null);
  const [loaded, setLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load the latest conversation the first time the panel opens.
  useEffect(() => {
    if (!open || loaded || !user) return;
    api<{ session_id: number | null; messages: Msg[] }>("/api/chat/history/")
      .then((h) => {
        setSessionId(h.session_id);
        setMessages(h.messages);
      })
      .catch(() => null)
      .finally(() => setLoaded(true));
  }, [open, loaded, user]);

  // Forget everything on logout.
  useEffect(() => {
    if (!user) {
      setMessages([]);
      setSessionId(null);
      setLoaded(false);
      setOpen(false);
    }
  }, [user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  if (!user) return null;

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setError("");
    setMessages((m) => [...m, { role: "user", content: message }]);
    setBusy(true);
    try {
      const r = await api<ChatResponse>("/api/chat/", {
        method: "POST",
        body: JSON.stringify({ message, session_id: sessionId, location }),
      });
      setSessionId(r.session_id);
      setMessages((m) => [...m, { role: "assistant", content: r.reply, proposals: r.proposals, emergencyNotice: r.emergency_notice }]);
    } catch (e) {
      setError(e instanceof ApiError && e.status !== 400 ? String((e.data as { detail?: string })?.detail ?? errorMessage(e)) : errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function shareLocation() {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setError("Location permission was denied. You can tell me a city instead."),
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }

  function newChat() {
    setMessages([]);
    setSessionId(null);
    setError("");
  }

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close assistant" : "Open assistant"}
        className="fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-teal-600 text-2xl text-white shadow-lg hover:bg-teal-700"
      >
        {open ? "✕" : "💬"}
      </button>

      {open && (
        <section
          aria-label="MediConnect assistant"
          className="fixed bottom-20 right-4 z-40 flex h-[min(600px,calc(100vh-7rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        >
          <header className="flex items-center justify-between bg-teal-600 px-4 py-3 text-white">
            <div>
              <p className="font-semibold">MediConnect Assistant</p>
              <p className="text-xs text-teal-100">Finds doctors & slots · not medical advice</p>
            </div>
            <button onClick={newChat} className="rounded-md bg-white/15 px-2 py-1 text-xs hover:bg-white/25">
              New chat
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3">
            {messages.length === 0 && (
              <div className="text-sm text-slate-600">
                <p>Hi {user.first_name || "there"}! I can find doctors, check free slots and help you book. Try:</p>
                <div className="mt-2 flex flex-col gap-2">
                  {STARTERS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:border-teal-400">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <div className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-teal-600 text-white" : "border border-slate-200 bg-white"}`}>
                  {m.emergencyNotice && (
                    <p role="alert" className="mb-2 rounded-md bg-red-50 p-2 font-medium text-red-700">🚨 {m.emergencyNotice}</p>
                  )}
                  {/* Plain text only: the reply is never inserted as HTML. */}
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.proposals?.map((p) => <BookingCard key={p.start + p.doctor_id} p={p} canBook={user.role === "patient"} />)}
                </div>
              </div>
            ))}

            {busy && <p className="text-sm text-slate-400">Assistant is typing…</p>}
            {error && <p role="alert" className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">{error}</p>}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="border-t border-slate-200 p-2"
          >
            <div className="mb-2 flex items-center gap-2 text-xs">
              {location ? (
                <button type="button" onClick={() => setLocation(null)} className="rounded-full bg-teal-50 px-2 py-1 text-teal-700">
                  📍 Location shared · stop
                </button>
              ) : (
                <button type="button" onClick={shareLocation} className="rounded-full border border-slate-300 px-2 py-1 text-slate-600">
                  📍 Share my location
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <input
                className="input"
                value={input}
                maxLength={1000}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about doctors, slots, hospitals…"
                aria-label="Message"
              />
              <button disabled={busy || !input.trim()} className="rounded-md bg-teal-600 px-3 text-sm font-medium text-white disabled:opacity-50">
                Send
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
