#!/usr/bin/env node
// Verifica che il premio Premium per recensione sia a 7 giorni sul sito pubblicato.
// Uso:  node scripts/verifica-premium-7gg.mjs https://iltuodominio
// Richiede Node 18+ (nessuna dipendenza). Il valore è già pubblico
// (esposto da /api/public/bootstrap): nessun segreto coinvolto.
const url = process.argv[2];
if (!url) {
  console.error("Uso: node scripts/verifica-premium-7gg.mjs https://iltuodominio");
  process.exit(2);
}
const base = url.replace(/\/+$/, "");
try {
  const res = await fetch(`${base}/api/public/bootstrap`);
  if (!res.ok) {
    console.error(`La risposta di /api/public/bootstrap è ${res.status}: controlla l'indirizzo.`);
    process.exit(1);
  }
  const j = await res.json();
  const d = j?.settings?.premiumDaysPerReview;
  console.log(`premiumDaysPerReview attivo sul sito: ${d}`);
  if (d === 7) {
    console.log("OK — il premio è calibrato a 7 giorni per recensione.");
    process.exit(0);
  }
  if (d === 30) {
    console.log("Il 30 è salvato nel database del sito e vince sul default del codice.");
    console.log("Correzione (30 secondi): back office → Impostazioni →");
    console.log("«Premium: giorni per recensione» → 7 → Salva.");
    console.log("In alternativa da Prisma Studio: tabella Setting, riga key \"app\",");
    console.log("JSON premiumDaysPerReview → 7.");
    process.exit(1);
  }
  console.log(`Valore inatteso (${d}): controlla le Impostazioni del back office.`);
  process.exit(1);
} catch (e) {
  console.error("Errore di rete:", e.message);
  process.exit(1);
}
