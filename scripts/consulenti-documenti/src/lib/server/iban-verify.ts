// ZoomZoom — verifica dell'INTESTATARIO di un IBAN (opzionale).
// Accertare che un IBAN sia intestato a una persona richiede un servizio
// bancario autorizzato (open banking / verifica del beneficiario): NON è
// possibile farlo offline. Questo hook chiama un servizio esterno SOLO se
// configurato con le variabili d'ambiente:
//
//   IBAN_VERIFY_URL    endpoint https del servizio (POST { iban, holderName })
//   IBAN_VERIFY_TOKEN  chiave inviata come "Authorization: Bearer <token>"
//
// Il servizio deve rispondere JSON { result: "match" | "mismatch" | "unknown" }
// (accettati anche { match: true/false }). Servizi reali a cui collegarsi:
// TrueLayer Bank Account Verification, Tink, Klarna Kosma, GoCardless Bank
// Account Verification e gli hub open banking italiani (es. Fabrick, CBI).
//
// Se il servizio non è configurato, non raggiungibile o risponde "unknown",
// la domanda prosegue con l'autocertificazione dell'iscritto e la verifica
// manuale dello staff (campo ibanCheck: self | confirmed | mismatch).

export type IbanOwnerCheck = { result: "match" | "mismatch" | "unknown" };

export function ibanVerifyConfigured(): boolean {
  return Boolean(process.env.IBAN_VERIFY_URL && process.env.IBAN_VERIFY_TOKEN);
}

/** Chiama il servizio di verifica, se configurato. Mai lento né bloccante:
 *  massimo 6 secondi, qualsiasi problema diventa "unknown". */
export async function verifyIbanOwner(iban: string, holderName: string): Promise<IbanOwnerCheck | null> {
  const url = process.env.IBAN_VERIFY_URL;
  const token = process.env.IBAN_VERIFY_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ iban, holderName }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { result: "unknown" };
    const data = await res.json() as { result?: unknown; match?: unknown } | null;
    const raw = String(data?.result ?? (typeof data?.match === "boolean" ? (data.match ? "match" : "mismatch") : "unknown")).toLowerCase();
    if (["match", "verified", "ok", "true", "confirmed"].includes(raw)) return { result: "match" };
    if (["mismatch", "no_match", "false", "no-match", "different"].includes(raw)) return { result: "mismatch" };
    return { result: "unknown" };
  } catch {
    return { result: "unknown" };
  }
}
