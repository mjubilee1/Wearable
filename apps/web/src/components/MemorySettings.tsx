"use client";

import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FREE_MEMORY_RETENTION_DAYS,
  hasProAccess,
  type AgentMemoryItem,
} from "@nearby/shared";
import { useAuth } from "@/lib/auth-context";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function MemorySettings() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const pro = profile ? hasProAccess(profile) : false;

  const memories = useQuery({
    queryKey: ["memories", search],
    enabled: Boolean(user),
    queryFn: async () => {
      if (!user) return [] as AgentMemoryItem[];
      const token = await user.getIdToken();
      const response = await fetch(
        `${API_URL}/v1/agent/memories?q=${encodeURIComponent(search)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const body = (await response.json().catch(() => ({}))) as {
        memories?: AgentMemoryItem[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Could not load memories.");
      return body.memories ?? [];
    },
  });

  async function remove(path: string) {
    if (!user) return;
    setDeleting(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`${API_URL}${path}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not delete memory.");
      }
      await queryClient.invalidateQueries({ queryKey: ["memories"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete memory.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="rounded-3xl border border-black/5 bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-ink">Memory</h2>
          <p className="mt-1 text-sm text-muted">
            {pro
              ? "Pro keeps your memories without a time limit."
              : `Free keeps the last ${FREE_MEMORY_RETENTION_DAYS} days.`}
          </p>
        </div>
        <button
          type="button"
          disabled={deleting || !memories.data?.length}
          onClick={() => {
            if (window.confirm("Delete all memories? This cannot be undone.")) {
              void remove("/v1/agent/memories");
            }
          }}
          className="shrink-0 text-xs font-semibold text-coral disabled:opacity-40"
        >
          Delete all
        </button>
      </div>

      <form
        className="mt-5 flex gap-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          setSearch(searchInput.trim());
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search memories</span>
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search people, promises, or dates"
            className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none ring-teal/30 focus:ring-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white"
        >
          Search
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-coral">{error}</p>}
      {memories.isError && (
        <p className="mt-3 text-sm text-coral">
          {memories.error instanceof Error ? memories.error.message : "Could not load memories."}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {memories.isLoading && <p className="text-sm text-muted">Loading memories…</p>}
        {!memories.isLoading && memories.data?.length === 0 && (
          <p className="rounded-2xl bg-surface px-4 py-5 text-sm text-muted">
            {search ? "No matching memories." : "Your voice memos and commands will appear here."}
          </p>
        )}
        {memories.data?.map((memory) => (
          <article key={memory.id} className="rounded-2xl bg-surface px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold leading-relaxed text-ink">
                  {memory.summary}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {memory.source === "voice_memo" ? "Voice memo" : "Command"}
                  {" · "}
                  {new Date(memory.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
                {memory.people.length > 0 && (
                  <p className="mt-2 text-xs text-muted">
                    People: {memory.people.join(", ")}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void remove(`/v1/agent/memories/${memory.id}`)}
                className="text-xs font-semibold text-coral disabled:opacity-40"
                aria-label={`Delete memory: ${memory.summary}`}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
