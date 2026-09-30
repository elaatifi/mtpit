import * as React from "react";
import { cn } from "../../lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("flex min-h-40 w-full resize-y rounded-lg border border-border bg-white p-3 text-sm leading-6 text-foreground shadow-sm outline-none placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50", className)} {...props} />
));
Textarea.displayName = "Textarea";
