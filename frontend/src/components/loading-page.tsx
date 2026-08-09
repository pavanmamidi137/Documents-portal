import { Handshake } from "lucide-react";

export function LoadingPage() {
  return (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <span className="absolute inset-0 -m-2 animate-ping rounded-3xl bg-primary/20" />
          <div className="relative flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-lg shadow-primary/30">
            <Handshake className="size-8 animate-bounce text-primary-foreground" />
          </div>
        </div>
        <p className="text-sm font-semibold text-foreground">PlaceMate</p>
        <p className="text-xs text-muted-foreground">Loading…</p>
      </div>
    </div>
  );
}
