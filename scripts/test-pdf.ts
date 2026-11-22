// prova rapida del generatore PDF: relazione con accenti, €, testo lungo
import { buildPdf, type PdfBlock } from "../src/lib/server/pdf";
import { writeFileSync } from "node:fs";

const blocks: PdfBlock[] = [
  { text: "Relazione tecnica di perizia", bold: true, size: 18, gapBefore: 0 },
  { text: "ZoomZoom — Consulenti tecnici · Richiesta n. cmx_test_123", size: 9, color: 0.45, gapBefore: 2 },
  { text: "Richiedente: Mario Rossi (nickname: testuser)", size: 11, gapBefore: 14 },
  { text: "Consulente: Giorgia Bianchi — Geometra", size: 11 },
  { text: "Oggetto: Perizia tecnica", size: 11 },
  { text: "Indirizzo: Via Roma 1, Milano (Lombardia)", size: 11 },
  { text: "Tariffa: € 300,00 (trecento/00) — di cui commissione piattaforma € 30,00", size: 11 },
  { text: "1. Premessa", bold: true, size: 13, gapBefore: 16 },
  { text: "Il sottoscritto consulente, incaricato dal richiedente in data 21/11/2026, ha eseguito il sopralluogo tecnico presso l'immobile in oggetto. La presente relazione riporta l'esito delle verifiche effettuate, con particolare attenzione allo stato di manutenzione degli impianti e delle parti strutture, alla presenza di patologie da umidità e alla corrispondenza fra quanto dichiarato e quanto riscontrato sul posto.", size: 11, gapBefore: 8 },
  { text: "2. Descrizione dell'intervento", bold: true, size: 13, gapBefore: 14 },
  { text: "Lorem ipsum àèéìòù — testo lungo di prova per verificare il ritorno a capo automatico su più righe e la paginazione: questa frase viene ripetuta più volte per raggiungere un numero di righe sufficiente a provocare il passaggio alla seconda pagina del documento PDF. " + "Ripetizione a scopo di prova del testo per la lunghezza. ".repeat(40), size: 11, gapBefore: 8 },
  { text: "3. Conclusioni", bold: true, size: 13, gapBefore: 14 },
  { text: "Dalle verifiche eseguite non emergono anomalie significative. Si raccomanda la manutenzione ordinaria dell'impianto idraulico entro 12 mesi.", size: 11, gapBefore: 8 },
  { text: "Il consulente: Giorgia Bianchi — Geometra", size: 11, gapBefore: 22 },
];

const buf = buildPdf(blocks, "Relazione tecnica — ZoomZoom");
writeFileSync("/tmp/prova-relazione.pdf", buf);
console.log("byte:", buf.length, "| firma:", buf.subarray(0, 8).toString("latin1"), "| pagine:", (buf.toString("latin1").match(/\/Type \/Page[^s]/g) || []).length);
console.log("scritto /tmp/prova-relazione.pdf");
