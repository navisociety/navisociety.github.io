import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/**
 * NAVI — AI companion for NAVISOCIETY.
 *
 * Static SPA deployed to GitHub Pages. Data layer is Supabase
 * (supabase.auth + supabase.from). The chat reply is currently STUBBED:
 * there is no Supabase table or Edge Function backing the LLM yet, so we
 * render a graceful placeholder response instead of crashing. Wire a Supabase
 * Edge Function (or a `messages` table + function) to make NAVI talk for real.
 */

interface ChatMessage {
  id: string;
  role: "user" | "navi";
  text: string;
}

const STUB_REPLY =
  "I'm NAVI. I'm online and connected, but my voice isn't wired up yet — " +
  "the team still needs to connect a Supabase function for live replies. " +
  "Everything else is running. ✦";

export default function App() {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [supabaseOk, setSupabaseOk] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Verify Supabase connectivity on mount (auth.getSession resolves without a
  // backend table; this proves the client + env vars are wired correctly).
  useEffect(() => {
    let active = true;
    (async () => {
      if (!isSupabaseConfigured) {
        if (active) setSupabaseOk(false);
        return;
      }
      try {
        const { error } = await supabase.auth.getSession();
        if (active) setSupabaseOk(!error);
      } catch {
        if (active) setSupabaseOk(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setIsLoading(true);

    // Stubbed reply — replace with a Supabase Edge Function call when ready.
    await new Promise((r) => setTimeout(r, 600));
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "navi", text: STUB_REPLY },
    ]);
    setIsLoading(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col px-4 py-6 md:py-10">
      {/* Header */}
      <header className="w-full max-w-2xl mx-auto mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-navi-cyan" />
          <span className="font-fredoka font-semibold tracking-wide text-navi-cyan uppercase text-sm md:text-base">
            NAVISOCIETY
          </span>
        </div>
        <ConnectionPill ok={supabaseOk} />
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center w-full max-w-2xl mx-auto">
        <NaviAvatar />
        <h1 className="mt-6 text-3xl md:text-5xl font-fredoka font-bold text-white text-center">
          Meet <span className="text-navi-cyan">NAVI</span>
        </h1>
        <p className="mt-2 text-center text-gray-400 text-sm md:text-base">
          Your AI companion. Ask anything.
        </p>

        {/* Conversation */}
        <div className="w-full mt-8 space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              } animate-fade-in`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm md:text-base leading-relaxed ${
                  msg.role === "user"
                    ? "bg-navi-cyan text-black font-medium"
                    : "bg-[#0A0A0A] border border-navi-cyan/30 text-white"
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start animate-fade-in">
              <div className="flex items-center gap-2 text-navi-cyan bg-[#0A0A0A] border border-navi-cyan/30 rounded-2xl px-4 py-3">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">NAVI is thinking…</span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </main>

      {/* Input */}
      <footer className="w-full max-w-2xl mx-auto mt-8">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            placeholder="Talk to NAVI"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            className="w-full bg-[#0A0A0A] border border-navi-cyan/30 text-white placeholder-gray-600 rounded-xl pl-5 pr-14 py-4 text-base focus:border-navi-cyan focus:outline-none focus:ring-2 focus:ring-navi-cyan/20 transition-all disabled:opacity-50"
            style={{ boxShadow: "0 0 24px rgba(0, 247, 255, 0.08)" }}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            aria-label="Send"
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-navi-cyan hover:brightness-110 text-black rounded-lg px-3 py-2.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <p className="text-center text-gray-600 text-xs mt-3">
          Press Enter to send · navisociety.github.io
        </p>
      </footer>
    </div>
  );
}

function ConnectionPill({ ok }: { ok: boolean | null }) {
  const label =
    ok === null ? "Connecting…" : ok ? "Supabase connected" : "Offline";
  const color =
    ok === null
      ? "text-gray-400 border-gray-600"
      : ok
        ? "text-navi-lime border-navi-lime/40"
        : "text-navi-magenta border-navi-magenta/40";
  return (
    <span
      className={`text-[10px] md:text-xs font-medium uppercase tracking-wider px-2.5 py-1 rounded-full border ${color}`}
    >
      {label}
    </span>
  );
}

function NaviAvatar() {
  return (
    <div className="relative mt-2">
      <div
        className="absolute inset-0 rounded-full blur-2xl animate-pulse-glow"
        style={{ background: "radial-gradient(circle, rgba(0,247,255,0.35), transparent 70%)" }}
      />
      <svg
        viewBox="0 0 120 120"
        className="relative w-32 h-32 md:w-44 md:h-44"
        role="img"
        aria-label="NAVI"
      >
        <defs>
          <linearGradient id="naviGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#00F7FF" />
            <stop offset="100%" stopColor="#FF00E5" />
          </linearGradient>
        </defs>
        <circle
          cx="60"
          cy="60"
          r="46"
          fill="none"
          stroke="url(#naviGrad)"
          strokeWidth="3"
        />
        <circle cx="60" cy="60" r="30" fill="#0A0A0A" stroke="#00F7FF" strokeWidth="1.5" />
        <circle cx="50" cy="56" r="5" fill="#00F7FF" />
        <circle cx="70" cy="56" r="5" fill="#00F7FF" />
        <path
          d="M48 72 Q60 80 72 72"
          fill="none"
          stroke="#B6FF00"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
