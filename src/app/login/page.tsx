"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function Login() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
    if (r.ok) { router.push("/"); router.refresh(); return; }
    setErr(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Accesso non riuscito."); setBusy(false);
  };
  return (
    <form className="card login" onSubmit={submit}>
      <h1>Accesso</h1>
      <p className="muted">Trading Advisor — conto demo eToro</p>
      <input type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
      {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
      <p><button className="primary" disabled={busy || !pw} type="submit">Entra</button></p>
    </form>
  );
}
