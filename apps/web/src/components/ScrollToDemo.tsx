"use client";

import type { ReactNode } from "react";

/** Scrolls to the homepage demo and focuses its task field. */
export function ScrollToDemo({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <a
      href="#live-demo"
      className={className}
      onClick={(event) => {
        const section = document.getElementById("live-demo");
        if (!section) return;
        event.preventDefault();
        section.scrollIntoView({ block: "start" });
        const input = document.getElementById("demo-task");
        if (input instanceof HTMLInputElement) {
          input.focus({ preventScroll: true });
        }
      }}
    >
      {children}
    </a>
  );
}
