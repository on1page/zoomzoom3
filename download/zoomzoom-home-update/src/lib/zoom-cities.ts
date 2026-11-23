// ZoomZoom — le 10 città Zoom con la gerarchia editoriale concordata.
// La gerarchia (rank 1-10) decide l'ordine di presentazione sulla home
// (card grandi per le prime tre, chip per le altre); l'ordine alfabetico
// è disponibile con ZOOM_CITIES_ALPHA per gli elenchi di selezione
// (es. pagina «Cerca casa»).
// slug = id della zona nel database, dove presente (Catania è in arrivo).
export type ZoomCity = {
  slug: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  /** 1 = città più importante della gerarchia editoriale */
  rank: number;
};

export const ZOOM_CITIES: ZoomCity[] = [
  { slug: "roma", name: "Roma", region: "Lazio", lat: 41.9028, lng: 12.4964, rank: 1 },
  { slug: "milano", name: "Milano", region: "Lombardia", lat: 45.4642, lng: 9.19, rank: 2 },
  { slug: "napoli", name: "Napoli", region: "Campania", lat: 40.8518, lng: 14.2681, rank: 3 },
  { slug: "torino", name: "Torino", region: "Piemonte", lat: 45.0703, lng: 7.6869, rank: 4 },
  { slug: "bologna", name: "Bologna", region: "Emilia-Romagna", lat: 44.4949, lng: 11.3426, rank: 5 },
  { slug: "firenze", name: "Firenze", region: "Toscana", lat: 43.7696, lng: 11.2558, rank: 6 },
  { slug: "genova", name: "Genova", region: "Liguria", lat: 44.4056, lng: 8.9463, rank: 7 },
  { slug: "bari", name: "Bari", region: "Puglia", lat: 41.1171, lng: 16.8719, rank: 8 },
  { slug: "cagliari", name: "Cagliari", region: "Sardegna", lat: 39.2238, lng: 9.1217, rank: 9 },
  { slug: "catania", name: "Catania", region: "Sicilia", lat: 37.5027, lng: 15.0873, rank: 10 },
];

/** Le stesse città in ordine alfabetico (Bari, Bologna, Cagliari, Catania, …). */
export const ZOOM_CITIES_ALPHA: ZoomCity[] = [...ZOOM_CITIES].sort((a, b) =>
  a.name.localeCompare(b.name, "it")
);

/** Le prime tre della gerarchia: card grandi sulla home. */
export const ZOOM_CITIES_TOP: ZoomCity[] = ZOOM_CITIES.filter(c => c.rank <= 3);
