"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Bot, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { http } from "@/lib/api";
import { cn, getErrorMessage } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  text: string;
}

const QUICK_PROMPTS = [
  "Which open drives am I eligible for?",
  "What is the latest drive about?",
  "I have 7.5 CGPA — which drives can I apply to?",
];

export function DriveAssistant() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);

  const ask = async (raw?: string) => {
    const text = (raw ?? question).trim();
    if (!text || asking) return;
    setQuestion("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setAsking(true);
    try {
      const data = await http.post<{ answer: string }>("/drives/ai_chat/", {
        question: text,
      });
      setMessages((prev) => [...prev, { role: "assistant", text: data.answer }]);
    } catch (error) {
      toast.error(getErrorMessage(error));
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Sorry, I couldn't answer that right now." },
      ]);
    } finally {
      setAsking(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="mt-8 overflow-hidden rounded-2xl border bg-card shadow-sm"
    >
      <div className="flex items-center gap-3 border-b bg-primary/5 px-5 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-sm shadow-primary/20">
          <Bot className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-semibold">
            <Sparkles className="size-4 text-primary" /> Ask the Placement AI
          </p>
          <p className="text-xs text-muted-foreground">
            {user?.is_student
              ? `I know you're ${user.full_name} (${user.roll_number}) · ${user.branch_name ?? "—"} — ask anything about eligibility.`
              : "Ask about any open drive — eligibility, deadlines, details."}
          </p>
        </div>
      </div>

      <div className="space-y-3 px-5 py-4">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => ask(prompt)}
                disabled={asking}
                className="rounded-full border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                m.role === "user"
                  ? "rounded-br-sm bg-primary text-primary-foreground"
                  : "rounded-bl-sm border bg-muted/40"
              )}
            >
              {m.text}
            </div>
          </motion.div>
        ))}

        {asking && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" /> Thinking…
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t p-3">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="e.g. Am I eligible for the TCS drive?"
          disabled={asking}
        />
        <Button size="icon" onClick={() => ask()} disabled={asking} aria-label="Ask">
          <Send className="size-4" />
        </Button>
      </div>
    </motion.div>
  );
}
