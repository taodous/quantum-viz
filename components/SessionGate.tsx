"use client";

import { type FormEvent, useState } from "react";

/** Asks for the session code given out in class. Shown in the circuit panel. */
export function SessionGate({ onOpen, expired }: { onOpen: () => void; expired?: boolean }) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || sending) return;
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
      if (res.ok && body?.ok) {
        onOpen();
        return;
      }
      setMessage(body?.message ?? "Le serveur ne répond pas. Réessaie dans un instant.");
    } catch {
      setMessage("Connexion perdue. Vérifie le réseau et réessaie.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="gate-card" onSubmit={submit}>
      <h2>{expired ? "Séance expirée" : "Code de séance"}</h2>
      <p>{expired ? "Saisis à nouveau le code donné en cours. Ton code Python est conservé." : "Saisis le code donné en cours pour voir ton circuit s'exécuter."}</p>
      <div className="gate-row">
        <input
          aria-label="Code de séance"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={64}
          autoFocus
        />
        <button type="submit" disabled={sending || !code.trim()}>
          {sending ? "…" : "Entrer"}
        </button>
      </div>
      {message ? (
        <p className="gate-msg" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}
