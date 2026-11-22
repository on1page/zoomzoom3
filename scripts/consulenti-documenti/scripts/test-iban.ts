// sanity check del modulo IBAN (bun scripts/test-iban.ts)
import { validateIban, normalizeIban, formatIban } from "../src/lib/iban";

const cases: Array<[string, boolean, string]> = [
  ["IT60X0542811101000000123456", true, "IBAN italiano di esempio"],
  ["it60 x054 2811 1010 0000 0123 456", true, "lo stesso IBAN maiuscolo/minuscolo con spazi"],
  ["IT61X0542811101000000123456", false, "codice di controllo sbagliato (60→61)"],
  ["IT60X054281110100000012345", false, "lunghezza italiana sbagliata (26)"],
  ["IT60X05428111010000001234567", false, "lunghezza italiana sbagliata (28)"],
  ["GB29NWBK60161331926819", true, "IBAN britannico valido"],
  ["GB29NWBK60161331926820", false, "britannico con checksum alterato"],
  ["DE89370400440532013000", true, "IBAN tedesco valido"],
  ["XX89370400440532013000", false, "paese inesistente"],
  ["IT60x05428111010000001234ab", false, "BBAN italiano con struttura impossibile (mod-97)"],
  ["", false, "vuoto"],
];

let pass = 0, fail = 0;
for (const [input, expected, label] of cases) {
  const r = validateIban(input);
  const ok = r.ok === expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "[OK ]" : "[NO ]"} ${label} → ${r.ok ? "valido" : `invalido: ${r.error.slice(0, 70)}`}`);
}
console.log(`\nnormalizza: "${normalizeIban(" it60 x054 2811 1010 0000 1234 56 ")}"`);
console.log(`formatta:   "${formatIban("IT60X0542811101000000123456")}"`);
console.log(`\nRisultato: ${pass} ok, ${fail} falliti`);
process.exit(fail ? 1 : 0);
