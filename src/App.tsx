import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Loader2, LogOut, Send, ShieldAlert, Sparkles } from "lucide-react";
import {
  ALLOWED_EMAIL,
  isSupabaseConfigured,
  SITE_URL,
  supabase,
} from "@/lib/supabase";

/**
 * NAVI — AI companion for NAVISOCIETY, created by Prophet Dian.
 *
 * Static SPA deployed to GitHub Pages. Access is gated to a single account
 * (prophetdian@gmail.com) at three layers: this UI, RLS on the messages table,
 * and a check inside the `chat` Edge Function. Chat replies come from Claude
 * via supabase.functions.invoke('chat'); messages persist in the `messages`
 * table and the last 20 are restored on load.
 */

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

type AuthState = "loading" | "signed-out" | "denied" | "ready";

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [session, setSession] = useState<Session | null>(null);

  // Resolve auth on mount and subscribe to changes.
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setAuthState("signed-out");
      return;
    }

    let active = true;

    const resolve = (s: Session | null) => {
      if (!active) return;
      if (!s) {
        setSession(null);
        setAuthState("signed-out");
        return;
      }
      const email = s.user.email?.toLowerCase() ?? "";
      if (email !== ALLOWED_EMAIL) {
        setSession(s);
        setAuthState("denied");
        // Sign the unauthorized user out; UI already shows Access Denied.
        void supabase.auth.signOut();
        return;
      }
      setSession(s);
      setAuthState("ready");
    };

    supabase.auth.getSession().then(({ data }) => resolve(data.session));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      resolve(s);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (authState === "loading") return <SplashScreen />;
  if (authState === "denied") return <AccessDeniedScreen />;
  if (authState === "signed-out" || !session) return <LoginScreen />;
  return <ChatScreen session={session} />;
}

/* ------------------------------------------------------------------ */
/* Screens                                                            */
/* ------------------------------------------------------------------ */

function SplashScreen() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-4">
      <NaviAvatar size="lg" />
      <div className="flex items-center gap-2 text-navi-cyan">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="font-fredoka text-sm uppercase tracking-widest">
          Waking NAVI…
        </span>
      </div>
    </div>
  );
}

function LoginScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInWithGoogle = async () => {
    if (!isSupabaseConfigured) {
      setError("NAVI is not configured yet. Backend setup is required.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: SITE_URL },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md flex flex-col items-center text-center animate-fade-in">
        <NaviAvatar size="lg" />
        <h1 className="mt-8 text-4xl md:text-5xl font-fredoka font-bold text-white">
          Meet <span className="text-navi-cyan">NAVI</span>
        </h1>
        <p className="mt-3 text-gray-400 font-fredoka">
          Your intelligent companion from{" "}
          <span className="text-navi-magenta font-semibold">NAVISOCIETY</span>.
        </p>

        <button
          onClick={signInWithGoogle}
          disabled={busy}
          className="mt-10 w-full flex items-center justify-center gap-3 bg-navi-cyan hover:brightness-110 text-black font-fredoka font-semibold rounded-xl px-6 py-4 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ boxShadow: "0 0 32px rgba(0, 247, 255, 0.25)" }}
        >
          {busy ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <GoogleGlyph />
          )}
          {busy ? "Connecting…" : "Continue with Google"}
        </button>

        {error && (
          <p className="mt-4 text-navi-magenta text-sm font-fredoka">{error}</p>
        )}

        <p className="mt-8 text-gray-600 text-xs font-fredoka">
          Access is restricted to authorized members.
        </p>
      </div>
    </div>
  );
}

function AccessDeniedScreen() {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md flex flex-col items-center text-center animate-fade-in">
        <div className="relative">
          <div
            className="absolute inset-0 rounded-full blur-2xl"
            style={{
              background:
                "radial-gradient(circle, rgba(255,0,229,0.4), transparent 70%)",
            }}
          />
          <ShieldAlert className="relative w-20 h-20 text-navi-magenta" />
        </div>
        <h1 className="mt-8 text-3xl md:text-4xl font-fredoka font-bold text-white">
          Access Denied
        </h1>
        <p className="mt-3 text-gray-400 font-fredoka">
          This account is not authorized for NAVI. Only the owner of
          NAVISOCIETY may enter.
        </p>
        <button
          onClick={() => {
            void supabase.auth.signOut();
            window.location.reload();
          }}
          className="mt-10 flex items-center gap-2 border border-navi-cyan/40 text-navi-cyan font-fredoka rounded-xl px-6 py-3 hover:bg-navi-cyan/10 transition-all"
        >
          <LogOut className="w-4 h-4" />
          Back to sign in
        </button>
      </div>
    </div>
  );
}

function ChatScreen({ session }: { session: Session }) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Restore the last 20 messages on load (in-session memory).
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (!active) return;
      if (!error && data) {
        const ordered = [...data].reverse().map((m) => ({
          id: m.id as string,
          role: (m.role as "user" | "assistant") ?? "assistant",
          content: (m.content as string) ?? "",
        }));
        setMessages(ordered);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const persist = useCallback(
    async (role: "user" | "assistant", content: string) => {
      try {
        await supabase
          .from("messages")
          .insert({ user_id: session.user.id, role, content });
      } catch {
        // Persistence is best-effort; a failure shouldn't break the chat.
      }
    },
    [session.user.id]
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setIsLoading(true);
    setNotice(null);
    void persist("user", text);

    // Recent history for in-session memory (last 10 turns).
    const history = nextMessages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const { data, error } = await supabase.functions.invoke("chat", {
        body: { message: text, history },
      });

      let reply = "";
      if (error) {
        reply =
          "I couldn't reach my voice just now. Please try again in a moment.";
        setNotice(error.message);
      } else if (data?.error) {
        reply =
          data.reply ||
          "I'm online, but my connection to Claude needs configuring.";
        setNotice(data.error as string);
      } else {
        reply = (data?.reply as string) || "…";
      }

      const naviMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: reply,
      };
      setMessages((m) => [...m, naviMsg]);
      void persist("assistant", reply);
    } catch (e) {
      const reply =
        "Something interrupted me. Please try again.";
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", content: reply },
      ]);
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
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
        <button
          onClick={() => {
            void supabase.auth.signOut();
          }}
          className="flex items-center gap-1.5 text-gray-500 hover:text-navi-magenta transition-colors text-xs font-fredoka uppercase tracking-wider"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center w-full max-w-2xl mx-auto">
        <NaviAvatar size="md" />
        <h1 className="mt-5 text-3xl md:text-4xl font-fredoka font-bold text-white text-center">
          Meet <span className="text-navi-cyan">NAVI</span>
        </h1>
        <p className="mt-2 text-center text-gray-400 text-sm md:text-base font-fredoka">
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
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm md:text-base leading-relaxed whitespace-pre-wrap font-fredoka ${
                  msg.role === "user"
                    ? "bg-navi-cyan text-black font-medium"
                    : "bg-[#0A0A0A] border border-navi-cyan/30 text-white"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start animate-fade-in">
              <div className="flex items-center gap-2 text-navi-cyan bg-[#0A0A0A] border border-navi-cyan/30 rounded-2xl px-4 py-3">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm font-fredoka">NAVI is thinking…</span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </main>

      {/* Input */}
      <footer className="w-full max-w-2xl mx-auto mt-8">
        {notice && (
          <p className="text-center text-navi-magenta/80 text-xs mb-2 font-fredoka">
            {notice}
          </p>
        )}
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            placeholder="Talk to NAVI"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            className="w-full bg-[#0A0A0A] border border-navi-cyan/30 text-white placeholder-gray-600 rounded-xl pl-5 pr-14 py-4 text-base font-fredoka focus:border-navi-cyan focus:outline-none focus:ring-2 focus:ring-navi-cyan/20 transition-all disabled:opacity-50"
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
        <p className="text-center text-gray-600 text-xs mt-3 font-fredoka">
          Press Enter to send · navisociety.github.io
        </p>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                             */
/* ------------------------------------------------------------------ */

function NaviAvatar({ size = "md" }: { size?: "md" | "lg" }) {
  const dim =
    size === "lg" ? "w-40 h-40 md:w-52 md:h-52" : "w-28 h-28 md:w-36 md:h-36";
  return (
    <div className="relative">
      <div
        className="absolute inset-0 rounded-full blur-2xl animate-pulse-glow"
        style={{
          background:
            "radial-gradient(circle, rgba(0,247,255,0.35), rgba(255,0,229,0.15) 50%, transparent 72%)",
        }}
      />
      <img
        src="navi.png"
        alt="NAVI"
        className={`relative ${dim} object-contain drop-shadow-[0_0_24px_rgba(0,247,255,0.45)]`}
        draggable={false}
      />
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.24 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
