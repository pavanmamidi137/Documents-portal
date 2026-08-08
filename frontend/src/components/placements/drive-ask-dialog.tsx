"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Bot, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { http } from "@/lib/api";
import type { Drive } from "@/lib/types";
import { cn, getErrorMessage } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  text: string;
}

const QUICK_PROMPTS = [
  "Am I eligible for this drive?",
  "What is the selection process?",
  "When is the last date to apply?",
  "What does this drive offer?",
];

interface Props {
  drive: Drive | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DriveAskDialog({ drive, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The chat state lives inside the unmounting dialog content, so a fresh
          conversation starts every time the dialog opens. */}
      {drive && (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
                <Bot className="size-4" />
              </span>
              Ask about {drive.company_name}
            </DialogTitle>
            <DialogDescription>
              {drive.role ? `${drive.role} · ` : ""}
              {drive.package ? `${drive.package} · ` : ""}
              Apply by {drive.last_date_to_apply}
            </DialogDescription>
          </DialogHeader>
          <DriveAskChat key={drive.id} drive={drive} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function DriveAskChat({ drive }: { drive: Drive }) {
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
      const data = await http.post<{ answer: string }>(
        `/drives/${drive.id}/ai_ask/`,
        { question: text }
      );
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
    <div className="space-y-3">
      <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
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

      <div className="flex gap-2 border-t pt-3">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder={`Ask about ${drive.company_name}…`}
          disabled={asking}
        />
        <Button size="icon" onClick={() => ask()} disabled={asking} aria-label="Ask">
          <Send className="size-4" />
        </Button>
      </div>
      {user?.is_student && (
        <p className="text-[11px] text-muted-foreground">
          The AI knows you&apos;re {user.roll_number} · {user.branch_name ?? "—"}.
        </p>
      )}
    </div>
  );
}
