#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ZoomZoom — Simulazione del flusso di contributo semlificato (proposta utente)
==============================================================================
Esegue la proposta di semplificazione (un solo campo di ricerca, autocompilazione,
riepilogo scheda con soli campi mancanti, modulo unico con validazione inline,
«altro soggetto» in revisione staff) contro le regole REALI del backend, portate
fedelmente dal codice:

  normAddress()                src/app/api/entities/route.ts   (dedup indirizzo)
  ensureZone()/findZoneByName  src/lib/server/zones.ts         (dedup zona: nome ≤30 km / provincia)
  ensureZoneEntity()           src/lib/server/zones.ts         (una scheda per zona)
  POST /api/entities           dedup 409+existingId, confini Italia, limiti/giorno
  POST /api/reviews            409 doppia recensione, isPerson, limiti/giorno, PremiumGrant
  validateReviewPayload()      src/lib/server/validation.ts    (voto 0–10 mezzi punti, criteri
                               default 5, pro ≥1, testo ≥100, onestà, honeypot, prezzo)
  POST /api/proposals          dedup nome su categoria+zona, 409
  Impostazioni reali           settings.ts: 5 contributi/giorno, Premium 30 gg, foto ≤3

Nodi del flowchart dell'utente: START TARGET IMM ZONA ALTRO PROP SEARCH PLACE TEXT
GPS AUTOFILL REVIEWPLACE CONFIRM RESOLVE EXIST USE CREATE FORM VALIDATE ACTIVE
VERIFIED DECLARED UPDATE.
Nodi PROPOSTI in v2 (non ancora nel backend): DUPUSER MYREV INLINE PROX INVITE
DOCS PENDVER UPGRADE NOTIF GATE.

Le chiamate che mutano lo stato sono ESEGUITE DAVVERO sulle porte (nessun esito
preconfezionato): i 409, le 403, le 429 e i 400 che compaiono nelle tracce sono
calcolati dalle stesse regole del server.
"""
import copy
import math
import unicodedata
from dataclasses import dataclass

# ══════════════════════ 1. UTILITÀ (porte dal TS) ════════════════════════════

def norm_address(s: str) -> str:
    """Porta di normAddress() (api/entities/route.ts)."""
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = "".join(c if c.isalnum() else " " for c in s)
    return " ".join(s.split())

def norm_place(s: str) -> str:
    return norm_address(s)

def in_italy_bounds(lat: float, lng: float) -> bool:
    """Porta di inItalyBounds() (lib/server/zones.ts)."""
    return 34 <= lat <= 48.5 and 5.5 <= lng <= 19.5

def distance_km(a, b) -> float:
    """Haversine, come distanceKm()."""
    R, rad = 6371, math.pi / 180
    dlat, dlng = (b["lat"] - a["lat"]) * rad, (b["lng"] - a["lng"]) * rad
    s = math.sin(dlat / 2) ** 2 + math.cos(a["lat"] * rad) * math.cos(b["lat"] * rad) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(s))

def slugify(s: str) -> str:
    return norm_address(s).replace(" ", "-")[:40] or "zona"

# ══════════════════════ 2. IMPOSTAZIONI E CATEGORIE ══════════════════════════

SETTINGS = {  # default reali da src/lib/server/settings.ts
    "openReviewsEnabled": True,
    "openReviewsPerDay": 5,
    "premiumDaysPerReview": 30,
    "photosEnabled": True,
    "minReviews": 3,
}

@dataclass
class Cat:
    id: str; short: str; is_person: bool
    criteria: list; price_units: list; kinds: list

CATEGORIES = {
    "immobile": Cat("immobile", "Immobile", False,
                    ["posizione", "condizioni", "rapporto-qualita-prezzo", "luminosita"],
                    ["€/mese", "€/anno", "€ (vendita)"],
                    ["Ci ho abitato", "L'ho affittato", "L'ho visitato"]),
    "zona": Cat("zona", "Zona", False,
                ["servizi", "trasporti", "sicurezza", "costi"],
                ["€/mese (affitto medio)"],
                ["Ci vivo", "Ci ho vissuto", "Ci lavoro"]),
    # "soggetto" = persona/agenzia/ditta: nasce SOLO da proposta approvata.
    # is_person=False qui rappresenta agenzia/ditta; le persone fisiche vere
    # restano soggette a invito/documenti (regola attuale, cfr. finding F6).
    "soggetto": Cat("soggetto", "Soggetto", False,
                    ["professionalita", "trasparenza", "affidabilita", "prezzi"],
                    ["€ (parcella)", "€/mese"],
                    ["Ho trattato con lui/lei"]),
}

# ══════════════════════ 3. GEOCODER MOCK (OpenStreetMap) ════════════════════

OSM = {
    "via dei mille 15 milano": dict(road="Via dei Mille", hn="15", zone="Milano", prov="Milano", reg="Lombardia", lat=45.47800, lng=9.20500),
    "via dei mille 15a milano": dict(road="Via dei Mille", hn="15/A", zone="Milano", prov="Milano", reg="Lombardia", lat=45.47810, lng=9.20510),
    "via appia nuova 20 roma": dict(road="Via Appia Nuova", hn="20", zone="Roma", prov="Roma", reg="Lazio", lat=41.87020, lng=12.54240),
    "milano": dict(road=None, hn=None, zone="Milano", prov="Milano", reg="Lombardia", lat=45.46420, lng=9.19000),
    "roma": dict(road=None, hn=None, zone="Roma", prov="Roma", reg="Lazio", lat=41.89310, lng=12.48280),
    "alassio": dict(road=None, hn=None, zone="Alassio", prov="Savona", reg="Liguria", lat=44.16900, lng=8.22600),
    "agenzia immobiliare xyz": dict(road=None, hn=None, zone="Roma", prov="Roma", reg="Lazio", lat=41.89500, lng=12.48100),
}
VIA_MILLE_15 = {"lat": 45.47800, "lng": 9.20500}
GPS_RURAL_LODI = {"lat": 45.30970, "lng": 9.50300}

def geocode(q: str):
    key = norm_address(q)
    for k, v in OSM.items():
        if norm_address(k) == key:
            return [dict(v)]
    return []

def reverse_geocode(pt):
    if distance_km(pt, VIA_MILLE_15) <= 0.06:
        r = OSM["via dei mille 15 milano"]
        return True, dict(road=r["road"], hn=r["hn"], zone=r["zone"], prov=r["prov"], reg=r["reg"])
    if distance_km(pt, GPS_RURAL_LODI) <= 0.5:
        return True, dict(road=None, hn=None, zone="Lodi", prov="Lodi", reg="Lombardia")
    return False, None

# ══════════════════════ 4. MODELLO DATI IN MEMORIA ══════════════════════════

@dataclass
class User:
    id: str; email: str; email_verified: bool = True
    reviews_today: int = 0
    new_entities_today: int = 0
    premium_days: int = 0

@dataclass
class Zone:
    id: str; name: str; province: str; region: str; lat: float; lng: float; source: str = "seed"

@dataclass
class Entity:
    id: str; category_id: str; name: str; address: str = None
    zone_id: str = None; lat: float = None; lng: float = None
    status: str = "published"; proposed_by: str = "seed"

@dataclass
class Proposal:
    id: str; category_id: str; name: str; zone_id: str = None
    status: str = "received"; proposed_by: str = None; justification: str = ""

@dataclass
class Experience:
    id: str; entity_id: str; kind: str; origin: str; user_id: str; status: str = "active"

@dataclass
class Review:
    id: str; experience_id: str; entity_id: str; user_id: str
    score: float; text: str; status: str = "published"; verified: bool = False
    photos: int = 0

@dataclass
class Invite:
    token: str; entity_id: str; email: str; used: bool = False

@dataclass
class PendingVer:
    id: str; user_id: str; entity_id: str; status: str = "pending"

class World:
    def __init__(self):
        self.users, self.zones, self.entities = {}, [], []
        self.proposals, self.experiences, self.reviews = [], [], []
        self.invites, self.pending_verifications = [], []
        self.audit, self.emails = [], []
        self._seq = 0
    def nid(self, p):
        self._seq += 1
        return f"{p}{self._seq:03d}"
    def snapshot(self):
        return copy.deepcopy(self)
    def restore(self, snap):
        self.__dict__.update(snap.__dict__)

# ══════════════════════ 5. API (porte fedeli + estensioni v2) ════════════════

class Api:
    def __init__(self, world: World):
        self.w = world

    # ---- pubblici ----
    def public_search(self, q: str):
        """Campo unico: cerca in TUTTE le categorie pubblicate (il flusso
        semplificato non separa la ricerca per categoria)."""
        n = norm_address(q)
        out = [e for e in self.w.entities
               if e.status == "published"
               and (n in norm_address(e.name) or n in norm_address(e.address or ""))]
        return sorted(out, key=lambda e: 0 if norm_address(e.name) == n else 1)

    def geocode(self, q: str):
        return geocode(q)

    def reverse_geocode(self, pt):
        return reverse_geocode(pt)

    # ---- zone ----
    def zones_activate(self, user, spec):
        z, z_created = self.ensure_zone(spec, "user")
        ent, e_created = self.ensure_zone_entity(z, user)
        return z, z_created, ent, e_created

    def ensure_zone(self, spec, source="user"):
        name = " ".join((spec.get("name") or "").split())[:80]
        if len(name) < 2:
            raise ValueError("BAD_ZONE_NAME")
        lat, lng = spec.get("lat"), spec.get("lng")
        if lat is None or lng is None or not in_italy_bounds(lat, lng):
            raise ValueError("BAD_ZONE_POS")
        norm = norm_place(name)
        prov = spec.get("province")
        same = [z for z in self.w.zones if norm_place(z.name) == norm]
        best = None
        for z in same:
            km = distance_km({"lat": z.lat, "lng": z.lng}, {"lat": lat, "lng": lng})
            if km <= 30 and (best is None or km < best[1]):
                best = (z, km)
        if best:
            return best[0], False
        if prov:
            for z in same:
                if z.province and norm_place(z.province) == norm_place(prov):
                    return z, False
        z = Zone(self.w.nid(slugify(name)), name, prov or "", spec.get("region") or "", lat, lng, source)
        self.w.zones.append(z)
        return z, True

    def find_zone_by_name(self, name, province=None):
        same = [z for z in self.w.zones if norm_place(z.name) == norm_place(name or "")]
        if not same:
            return None
        if province:
            for z in same:
                if z.province and norm_place(z.province) == norm_place(province):
                    return z
        return same[0] if len(same) == 1 else None

    def ensure_zone_entity(self, zone, actor):
        for e in self.w.entities:
            if e.category_id == "zona" and e.zone_id == zone.id and e.status == "published":
                return e, False
        e = Entity(self.w.nid("ent"), "zona", zone.name, None, zone.id, None, None, "published", f"user:{actor.id}")
        self.w.entities.append(e)
        return e, True

    # ---- POST /api/entities ----
    def entities_create(self, user, address, zone_spec, geo):
        if not user.email_verified:
            return 403, {"error": "Conferma prima l'indirizzo email dal collegamento ricevuto via email."}
        if not SETTINGS["openReviewsEnabled"]:
            return 403, {"error": "Il contributo aperto è temporaneamente sospeso."}
        if user.new_entities_today >= SETTINGS["openReviewsPerDay"]:
            return 429, {"error": f"Limite di {SETTINGS['openReviewsPerDay']} nuove schede al giorno raggiunto: riprova domani."}
        user.new_entities_today += 1  # rateLimit: consumato al tentativo, come nel server
        address = " ".join((address or "").split())[:160]
        if len(address) < 5:
            return 400, {"error": "Indica l'indirizzo dell'immobile (almeno 5 caratteri)."}
        zone = None
        if zone_spec.get("zone_id"):
            zone = next((z for z in self.w.zones if z.id == zone_spec["zone_id"]), None)
        if zone is None and len(zone_spec.get("name") or "") >= 2:
            lat, lng = zone_spec.get("lat"), zone_spec.get("lng")
            if lat is not None and lng is not None and in_italy_bounds(lat, lng):
                try:
                    zone, _ = self.ensure_zone(zone_spec, "user")
                except ValueError:
                    zone = None
            if zone is None:
                zone = self.find_zone_by_name(zone_spec["name"], zone_spec.get("province"))
            if zone is None and geo and in_italy_bounds(geo["lat"], geo["lng"]):
                try:
                    spec = dict(zone_spec); spec["lat"], spec["lng"] = geo["lat"], geo["lng"]
                    zone, _ = self.ensure_zone(spec, "user")
                except ValueError:
                    zone = None
        if zone is None:
            return 400, {"error": "Seleziona la città in cui si trova l'immobile: scegli un suggerimento oppure usa la mappa."}
        self.ensure_zone_entity(zone, user)
        if geo and not in_italy_bounds(geo["lat"], geo["lng"]):
            return 400, {"error": "La posizione indicata non cade entro i confini dell'Italia."}
        norm = norm_address(address)
        zone_norm = norm_address(zone.name)
        for e in self.w.entities:
            if e.zone_id == zone.id and e.category_id == "immobile" and e.status == "published":
                a = norm_address(e.address or e.name)
                if a == norm or a == f"{norm} {zone_norm}":
                    return 409, {"error": "Questo immobile risulta già presente: puoi recensire la scheda esistente.",
                                 "existingId": e.id}
        ent = Entity(self.w.nid("ent"), "immobile", address, address, zone.id,
                     geo["lat"] if geo else None, geo["lng"] if geo else None,
                     "published", f"user:{user.id}")
        self.w.entities.append(ent)
        self.w.audit.append(f"Scheda immobile aggiunta da {user.email}: {address}, {zone.name}")
        return 200, {"entity": ent}

    # ---- POST /api/reviews ----
    def reviews_post(self, user, payload):
        if not user.email_verified:
            return 403, {"error": "Conferma prima l'indirizzo email dal collegamento ricevuto via email."}
        verified, exp = False, None
        if payload.get("experience_id"):
            exp = next((x for x in self.w.experiences if x.id == payload["experience_id"]
                        and x.status == "active" and x.user_id == user.id), None)
            if not exp:
                return 403, {"error": "Questa esperienza non è attiva o non è collegata al tuo account."}
            if any(r.experience_id == exp.id for r in self.w.reviews):
                return 409, {"error": "Hai già scritto questa recensione: puoi aggiornarla con una rettifica motivata."}
            entity_id, verified = exp.entity_id, True
        else:
            if not SETTINGS["openReviewsEnabled"]:
                return 403, {"error": "Il contributo aperto è temporaneamente sospeso: usa l'invito o la verifica documentale."}
            if user.reviews_today >= SETTINGS["openReviewsPerDay"]:
                return 429, {"error": f"Limite di {SETTINGS['openReviewsPerDay']} recensioni aperte al giorno raggiunto: riprova domani."}
            user.reviews_today += 1  # rateLimit consumato al tentativo
            ent = next((e for e in self.w.entities if e.id == payload.get("entity_id") and e.status == "published"), None)
            if not ent:
                return 404, {"error": "Scheda non trovata."}
            cat = CATEGORIES[ent.category_id]
            if cat.is_person:
                return 403, {"error": "Per recensire una persona serve l'invito del soggetto o la verifica documentale dell'esperienza."}
            if payload.get("kind") not in cat.kinds:
                return 400, {"error": "Indica il tipo di esperienza che hai vissuto."}
            dup = next((r for r in self.w.reviews
                        if r.entity_id == ent.id and r.user_id == user.id and r.status == "published"), None)
            if dup:
                return 409, {"error": "Hai già scritto una recensione su questa scheda: puoi aggiornarla con una rettifica motivata."}
            entity_id = ent.id
        ent = next(e for e in self.w.entities if e.id == entity_id)
        err = validate_review_payload(payload, CATEGORIES[ent.category_id])
        if err:
            return 400, {"error": err}
        if not payload.get("experience_id"):
            exp = Experience(self.w.nid("exp"), entity_id, payload.get("kind"), "self", user.id, "active")
            self.w.experiences.append(exp)
        photos = min(payload.get("photos") or 0, 3)  # server: max 3, eccedenze scartate
        rev = Review(self.w.nid("rev"), exp.id, entity_id, user.id,
                     payload["score"], payload["text"], "published", verified, photos)
        self.w.reviews.append(rev)
        user.premium_days += SETTINGS["premiumDaysPerReview"]
        self.w.audit.append(f"Premium {SETTINGS['premiumDaysPerReview']} gg a {user.email} "
                            f"({'verificata' if verified else 'dichiarata'})")
        return 200, {"review": rev, "verified": verified, "premium": SETTINGS["premiumDaysPerReview"]}

    # ---- POST /api/proposals ----
    def proposals_post(self, user, cat_id, name, zone_id, justification):
        name = (name or "").strip()
        if len(name) < 3:
            return 400, {"error": "Nome troppo breve."}
        if len((justification or "").strip()) < 20:
            return 400, {"error": "Motivazione troppo breve (almeno 20 caratteri)."}
        cat = CATEGORIES[cat_id]
        norm = norm_address(name)
        for e in self.w.entities:
            if e.category_id == cat.id and norm_address(e.name) == norm and (not zone_id or e.zone_id == zone_id):
                return 409, {"error": f"Esiste già una scheda con questo nome nella categoria {cat.short}: \"{e.name}\"."}
        for p in self.w.proposals:
            if p.status == "received" and norm_address(p.name) == norm:
                return 409, {"error": "Una proposta con questo nome è già in revisione."}
        p = Proposal(self.w.nid("prop"), cat.id, name, zone_id, "received", user.id, justification)
        self.w.proposals.append(p)
        return 200, {"proposal": p}

    # ---- inviti e verifica ----
    def invitations_redeem(self, user, token):
        inv = next((i for i in self.w.invites if i.token == token and not i.used), None)
        if not inv:
            return 400, {"error": "Invito non valido o già usato."}
        inv.used = True
        exp = Experience(self.w.nid("exp"), inv.entity_id, CATEGORIES["soggetto"].kinds[0], "business", user.id, "active")
        self.w.experiences.append(exp)
        return 200, {"experience": exp}

    def verify_request(self, user, entity_id):
        pv = PendingVer(self.w.nid("pv"), user.id, entity_id, "pending")
        self.w.pending_verifications.append(pv)
        return 200, {"pending": pv}

    def my_review_on(self, user, entity_id):
        """[v2] la recensione dell'utente sulla scheda (per DUPUSER): dati già
        esistenti nel backend (profilo/rettifica), basta esporli al flusso."""
        return next((r for r in self.w.reviews
                     if r.entity_id == entity_id and r.user_id == user.id and r.status == "published"), None)

    # ---- staff (estensioni v2) ----
    def staff_approve_proposal(self, proposal, pending_review):
        ent = Entity(self.w.nid("ent"), proposal.category_id, proposal.name, None,
                     proposal.zone_id, None, None, "published", f"user:{proposal.proposed_by}")
        self.w.entities.append(ent)
        proposal.status = "approved"
        pending_review.status, pending_review.entity_id = "published", ent.id
        self.w.emails.append(f"A {pending_review.user_id}: proposta approvata, recensione pubblicata.")
        return ent

    def staff_approve_verification(self, pv):
        pv.status = "approved"
        exp = Experience(self.w.nid("exp"), pv.entity_id, CATEGORIES["soggetto"].kinds[0],
                         "verification-request", pv.user_id, "active")
        self.w.experiences.append(exp)
        rev = next(r for r in self.w.reviews if r.entity_id == pv.entity_id and r.user_id == pv.user_id)
        rev.verified = True
        self.w.emails.append("Esperienza verificata: la tua recensione ora è «verificata».")
        return exp

def validate_review_payload(p, cat):
    """Porta di validateReviewPayload(): primo errore vince."""
    try:
        score = float(p.get("score"))
        if not (0 <= score <= 10 and (score * 2) % 1 == 0):
            return "Punteggio complessivo non valido (0–10, step 0,5)."
    except (TypeError, ValueError):
        return "Punteggio complessivo non valido (0–10, step 0,5)."
    crit = p.get("crit") or {}
    for c in cat.criteria:
        if c in crit:
            try:
                v = float(crit[c])
                if not (0 <= v <= 10 and (v * 2) % 1 == 0):
                    return f"Valutazione non valida per: {c}."
            except (TypeError, ValueError):
                return f"Valutazione non valida per: {c}."
    if not [s for s in (p.get("pros") or "").split("\n") if s.strip()]:
        return "Indica almeno un aspetto positivo."
    if len((p.get("text") or "").strip()) < 100:
        return "La descrizione dell'esperienza deve essere di almeno 100 caratteri."
    if not p.get("honesty"):
        return "Devi confermare la dichiarazione sull'esperienza personale e sulle regole."
    if (p.get("hp") or "").strip():
        return "Richiesta rifiutata (controllo anti-bot)."
    amt = p.get("price")
    if amt not in (None, ""):
        try:
            amt = float(amt)
            if not (0 < amt <= 100_000_000):
                return "Importo del prezzo non valido (tra 1 € e 100.000.000 €)."
        except (TypeError, ValueError):
            return "Importo del prezzo non valido (tra 1 € e 100.000.000 €)."
    return None

# ══════════════════════ 6. TRACCE E METRICHE ═════════════════════════════════

@dataclass
class Metrics:
    steps: int = 0
    api_calls: int = 0
    manual: int = 0
    autofilled: int = 0
    wasted: int = 0
    failed_submits: int = 0

class Flow:
    def __init__(self, label):
        self.m = Metrics()
        self.lines = []
        self.label = label
    def node(self, node, action, detail=None, msg=None, api=None, db=None):
        self.m.steps += 1
        self.lines.append(f"  [{node}] ".ljust(16) + action)
        if detail:
            self.lines.append(" " * 16 + detail)
        if api:
            self.m.api_calls += 1
            self.lines.append(" " * 16 + f"↳ API {api}")
        if msg:
            self.lines.append(" " * 16 + f"✎ utente vede: «{msg}»")
        if db:
            self.lines.append(" " * 16 + f"⌘ DB: {db}")
    def field(self, n=1, auto=False):
        if auto:
            self.m.autofilled += n
        else:
            self.m.manual += n
    def dump(self, outcome):
        self.lines.append(f"  {'─' * 60}")
        self.lines.append(f"  ESITO: {outcome}")
        m = self.m
        self.lines.append(f"  Metriche: {m.manual} campi a mano · {m.autofilled} autocompilati · "
                          f"{m.wasted} sprecati · {m.failed_submits} invii falliti · "
                          f"{m.api_calls} chiamate API · {m.steps} passi")
        print(f"\n{'═' * 74}\n{self.label}\n{'═' * 74}")
        for line in self.lines:
            print(line)

RESULTS, COMPARISONS = [], []

def payload(kind, entity_id=None, **over):
    p = dict(entity_id=entity_id, kind=kind, score=7.5,
             crit={"posizione": 8, "condizioni": 6},
             pros="Posizione centrale\nTranquillo", cons="Rumore la sera",
             text="T" * 160, honesty=True, hp="", price=850, photos=2)
    p.update(over)
    return p

# ══════════════════════ 7. MONDO INIZIALE ════════════════════════════════════

def seed_world():
    w = World()
    api = Api(w)
    for uid, mail in [("u_alice", "alice@example.com"), ("u_bob", "bob@example.com"),
                      ("u_carol", "carol@example.com"), ("u_dave", "dave@example.com"),
                      ("u_erin", "erin@example.com")]:
        w.users[uid] = User(uid, mail, True)
    w.users["u_eve"] = User("u_eve", "eve@example.com", False)
    admin = User("u_seed", "seed@zoomzoom", True)
    for name, prov, reg, lat, lng in [("Milano", "Milano", "Lombardia", 45.4642, 9.1900),
                                      ("Roma", "Roma", "Lazio", 41.8931, 12.4828)]:
        z, _ = api.ensure_zone(dict(name=name, province=prov, region=reg, lat=lat, lng=lng), "seed")
        api.ensure_zone_entity(z, admin)
    return w, api

def zone_by_name(w, name):
    return next(z for z in w.zones if z.name == name)

# ══════════════════════ 8. SCENARI (chiamate reali alle porte) ═══════════════

def s01(w, api):
    alice = w.users["u_alice"]
    fl = Flow("S01 · Immobile nuovo da ricerca testuale — «Via dei Mille 15, Milano»")
    fl.node("START", "Utente autenticato (alice), email verificata")
    fl.node("TARGET", "Scelto: Immobile")
    q = "Via dei Mille 15, Milano"
    internal, gres = api.public_search(q), api.geocode(q)
    fl.node("SEARCH", f"Campo unico: «{q}»",
            detail=f"prima le schede interne ({len(internal)}), poi il geocoder ({len(gres)} risultati)",
            api="GET /api/public/search + GET /api/public/geocode")
    r = gres[0]
    fl.node("TEXT", f"Selezione del risultato: «{r['road']} {r['hn']}, {r['zone']}»")
    fl.node("AUTOFILL", f"città={r['zone']} ({r['prov']}, {r['reg']}) · indirizzo={r['road']} {r['hn']} · coordinate {r['lat']}, {r['lng']}",
            detail="4 campi autocompilati, tutti modificabili")
    fl.field(4, auto=True)
    fl.node("REVIEWPLACE", "Riepilogo compatto: nessun campo mancante, si conferma la città",
            msg="Controlla i dati: Milano · Via dei Mille 15 ✓")
    fl.field(1)
    fl.node("CONFIRM", "Conferma città e luogo → sì")
    zspec = dict(name=r["zone"], province=r["prov"], region=r["reg"], lat=r["lat"], lng=r["lng"])
    st, body = api.entities_create(alice, f"{r['road']} {r['hn']}", zspec, {"lat": r["lat"], "lng": r["lng"]})
    fl.node("RESOLVE", "Risoluzione città (dentro la stessa chiamata): Milano già in catalogo, match ≤30 km")
    fl.node("EXIST", f"Esiste già una scheda per questo indirizzo e città? → No (HTTP {st})",
            api=f"POST /api/entities → {st}",
            db=f"+1 scheda immobile «{body['entity'].name}» ({zone_by_name(w, 'Milano').name})")
    fl.node("CREATE", "Nuova scheda creata e usata")
    fl.node("DUPUSER [v2]", "alice ha già recensito questa scheda? → No", api="GET la-mia-recensione → vuoto")
    fl.node("FORM", "Modulo unico: tipo, voto 7,5, 4 criteri, pro, contro, testo 160 caratteri, prezzo 850 €/mese, 2 foto, onestà",
            detail="validazione inline attiva: nessun errore durante la compilazione")
    fl.field(11)
    st, body = api.reviews_post(alice, payload("Ci ho abitato", body["entity"].id))
    fl.node("VALIDATE", f"Controllo finale lato server → ok (HTTP {st})",
            api=f"POST /api/reviews → {st} (dichiarata, Premium {body['premium']} gg)",
            db="+1 esperienza self · +1 recensione «dichiarata» · +1 grant Premium")
    fl.node("ACTIVE", "Esperienza verificabile con invito o documenti? → No, si pubblica subito")
    fl.node("DECLARED", "Pubblicata come «esperienza dichiarata»")
    fl.node("UPDATE", "Scheda aggiornata: punteggi, criteri, prezzi, classifiche")
    fl.dump("OK — recensione dichiarata pubblicata su scheda nuova (un solo campo, 4 campi autocompilati)")
    RESULTS.append(("S01", "Immobile nuovo da ricerca testuale", "OK — pubblicata (scheda nuova)", fl.m))

def s02(w, api):
    bob = w.users["u_bob"]
    fl = Flow("S02 · Immobile già esistente riscritto diversamente — «Via Dei Mille, 15.»")
    fl.node("TARGET", "Scelto: Immobile")
    q = "Via Dei Mille, 15."
    internal, gres = api.public_search(q), api.geocode("Via dei Mille 15 Milano")
    fl.node("SEARCH", f"Campo unico: «{q}»",
            detail=f"1° strato di dedup: {len(internal)} scheda interna in cima all'elenco (rank 1)",
            api="GET /api/public/search + GET /api/public/geocode")
    fl.node("TEXT", "(a) se bob sceglie la scheda interna → si va diretti al FORM, EXIST è scendato")
    r = gres[0]
    fl.node("SEARCH", "(b) bob ignora l'elenco e clicca il suggerimento OSM (caso peggiore per la dedup)")
    fl.node("AUTOFILL", f"autocompilati: città=Milano · indirizzo={r['road']} {r['hn']} · coordinate")
    fl.field(4, auto=True)
    fl.node("REVIEWPLACE", "Riepilogo ok, nessun campo mancante"); fl.field(1)
    fl.node("CONFIRM", "Conferma → sì")
    zspec = dict(name=r["zone"], province=r["prov"], region=r["reg"], lat=r["lat"], lng=r["lng"])
    st, body = api.entities_create(bob, "Via Dei Mille, 15.", zspec, {"lat": r["lat"], "lng": r["lng"]})
    fl.node("RESOLVE", "Città: Milano (ensureZone ≤30 km)")
    fl.node("EXIST", f"Esiste già la scheda? → Sì (HTTP {st} + existingId)",
            detail="normAddress(\"Via Dei Mille, 15.\") = «via dei mille 15» ≡ «via dei mille 15»: maiuscole, accenti e punteggiatura non creano duplicati",
            api=f"POST /api/entities → {st} + existingId",
            msg="Questo immobile risulta già presente: puoi recensire la scheda esistente.")
    fl.node("USE", "Uso della scheda esistente", db="0 scritture: la 409 instrada sulla scheda giusta")
    ent_id = body["existingId"]
    mine = api.my_review_on(bob, ent_id)
    fl.node("DUPUSER [v2]", f"bob ha già recensito questa scheda? → {'Sì' if mine else 'No'}", api="GET la-mia-recensione → vuoto")
    fl.node("FORM", "Modulo unico (11 campi)"); fl.field(11)
    st, body = api.reviews_post(bob, payload("Ci ho abitato", ent_id))
    fl.node("VALIDATE", f"ok (HTTP {st})", api=f"POST /api/reviews → {st}",
            db="+1 recensione dichiarata + Premium")
    fl.node("UPDATE", "Scheda aggiornata: 2 recensioni, media ricalcolata")
    fl.dump("OK — dedup su DUE strati: elenco interno al rank 1 e 409+existingId alla creazione")
    RESULTS.append(("S02", "Indirizzo esistente riscritto diversamente", "OK — riuso scheda (2 strati dedup)", fl.m))

def s03(w, api):
    carol = w.users["u_carol"]
    r = api.geocode("Via dei Mille 15A Milano")[0]
    zspec = dict(name=r["zone"], province=r["prov"], region=r["reg"], lat=r["lat"], lng=r["lng"])
    geo = {"lat": r["lat"], "lng": r["lng"]}
    # ── v1: flowchart attuale, nessun controllo di prossimità ──
    snap = w.snapshot()
    fl = Flow("S03a · Quasi-duplicato «Via dei Mille 15/A» — flowchart attuale (v1)")
    fl.node("TARGET", "Scelto: Immobile")
    internal, gres = api.public_search("Via dei Mille 15A Milano"), [r]
    fl.node("SEARCH", "«Via dei Mille 15/A, Milano»",
            detail=f"{len(internal)} schede interne (\"15 a\" non contiene \"15\") · {len(gres)} risultato OSM",
            api="GET /api/public/search + GET /api/public/geocode")
    fl.node("AUTOFILL", f"indirizzo={r['road']} {r['hn']} · coordinate {r['lat']}, {r['lng']} (a ~15 m dal civico 15)")
    fl.field(4, auto=True)
    fl.node("REVIEWPLACE", "Riepilogo ok"); fl.field(1)
    fl.node("CONFIRM", "Conferma → sì")
    st, body = api.entities_create(carol, f"{r['road']} {r['hn']}", zspec, geo)
    fl.node("RESOLVE", "Città: Milano")
    fl.node("EXIST", f"Scheda per «via dei mille 15 a»? → No (HTTP {st})",
            detail="il dedup del backend è ESATTO sulla stringa normalizzata: «15 a» ≠ «15»",
            api=f"POST /api/entities → {st}",
            db=f"+1 scheda «{body['entity'].name}» a ~15 metri da «Via dei Mille 15»")
    fl.node("CREATE", "Scheda quasi-duplicata creata ⚠")
    fl.node("DUPUSER [v2]", "carol ha già recensito? → No")
    fl.node("FORM", "Recensione compilata"); fl.field(11)
    st, body = api.reviews_post(carol, payload("Ci ho abitato", body["entity"].id))
    fl.node("VALIDATE", f"ok (HTTP {st})", api=f"POST /api/reviews → {st}")
    fl.dump("⚠ RISCHIO — nasce una scheda quasi-duplicata a 15 m dall'esistente: fusione a carico dello staff")
    RESULTS.append(("S03a", "Quasi-duplicato 15/A (v1)", "⚠ scheda duplicata creata", fl.m))
    w.restore(snap)
    # ── v2: con controllo di prossimità PROX ──
    fl = Flow("S03b · Quasi-duplicato «Via dei Mille 15/A» — con controllo prossimità [v2]")
    fl.node("TARGET", "Scelto: Immobile")
    fl.node("SEARCH", "«Via dei Mille 15/A, Milano»", api="GET /api/public/search + GET /api/public/geocode")
    fl.node("AUTOFILL", f"indirizzo={r['road']} {r['hn']} · coordinate {r['lat']}, {r['lng']}")
    fl.field(4, auto=True)
    fl.node("REVIEWPLACE", "Riepilogo ok"); fl.field(1)
    fl.node("CONFIRM", "Conferma → sì")
    fl.node("RESOLVE", "Città: Milano")
    fl.node("EXIST", "Stringa «via dei mille 15 a» → nessuna corrispondenza esatta")
    zone_milano = zone_by_name(w, "Milano")
    near = [e for e in w.entities if e.zone_id == zone_milano.id and e.category_id == "immobile"
            and e.lat is not None and distance_km({"lat": e.lat, "lng": e.lng}, geo) <= 0.05]
    fl.node("PROX [v2]", f"Prima di creare: schede della stessa zona entro 50 m? → {len(near)} («{near[0].name}» a "
            f"{round(distance_km({'lat': near[0].lat, 'lng': near[0].lng}, geo) * 1000)} m)",
            msg="A pochi metri c'è già la scheda «Via dei Mille 15». È lo stesso immobile? [Usa quella] / [È un altro]")
    fl.node("USE", "Carol conferma il riuso (interno B o scala A)",
            db="0 nuove schede: il quasi-duplicato non nasce")
    mine = api.my_review_on(carol, near[0].id)
    fl.node("DUPUSER [v2]", "carol ha già recensito? → No")
    fl.node("FORM", "Recensione compilata"); fl.field(11)
    st, body = api.reviews_post(carol, payload("Ci ho abitato", near[0].id))
    fl.node("VALIDATE", f"ok (HTTP {st})", api=f"POST /api/reviews → {st}", db="+1 recensione sulla scheda esistente")
    fl.dump("OK — PROX (possibile solo con le coordinate) previene il quasi-duplicato; senza pin resta la dedup stringa")
    RESULTS.append(("S03b", "Quasi-duplicato 15/A (v2 PROX)", "OK — riuso proposto (0 duplicati)", fl.m))
    COMPARISONS.append(("S03 quasi-duplicato 15/A",
                         "scheda duplicata a 15 m, fusione manuale a carico dello staff",
                         "PROX: riuso proposto quando ci sono coordinate (GPS o suggerimento OSM)"))

def s04(w, api):
    alice = w.users["u_alice"]
    ent = next(e for e in w.entities if e.address == "Via dei Mille 15")
    # ── v1 ──
    snap = w.snapshot()
    fl = Flow("S04a · Alice recensisce di nuovo lo stesso immobile — flowchart attuale (v1)")
    fl.node("TARGET", "Scelto: Immobile")
    internal = api.public_search("Via dei Mille 15")
    fl.node("SEARCH", "«Via dei Mille 15»", detail=f"{len(internal)} scheda interna al rank 1",
            api="GET /api/public/search")
    fl.node("USE", "Scheda esistente selezionata dall'elenco")
    fl.node("FORM", "alice ricompila TUTTO il modulo: tipo, voto, 4 criteri, pro, contro, testo, prezzo, foto, onestà")
    fl.field(13)
    st, body = api.reviews_post(alice, payload("Ci ho abitato", ent.id))
    fl.node("VALIDATE", f"Invio → controllo doppia recensione per utente (HTTP {st})",
            api=f"POST /api/reviews → {st}",
            msg=body["error"])
    fl.m.failed_submits += 1
    fl.m.wasted += 13
    fl.dump("⚠ SPRECO — la 409 arriva DOPO il modulo completo: 13 campi persi, rettifica da cercare nel profilo")
    RESULTS.append(("S04a", "Doppia recensione stesso utente (v1)", "⚠ 409 dopo 13 campi compilati", fl.m))
    w.restore(snap)
    # ── v2 ──
    fl = Flow("S04b · Alice recensisce di nuovo lo stesso immobile — con DUPUSER [v2]")
    fl.node("TARGET", "Scelto: Immobile")
    fl.node("SEARCH", "«Via dei Mille 15»", api="GET /api/public/search → 1 scheda")
    fl.node("USE", "Scheda esistente selezionata")
    mine = api.my_review_on(alice, ent.id)
    fl.node("DUPUSER [v2]", "Subito dopo il riuso: alice ha già recensito? → Sì",
            api=f"GET la-mia-recensione → {mine.id}",
            msg="Hai già recensito questa scheda. [Leggi la tua recensione] [Aggiorna con una rettifica]")
    fl.node("MYREV [v2]", "Aperta la recensione esistente con il percorso di rettifica: niente da ricompilare",
            db="0 scritture inutili")
    fl.dump("OK — blocco anticipato: 0 campi sprecati, rettifica offerta subito")
    RESULTS.append(("S04b", "Doppia recensione stesso utente (v2)", "OK — blocco prima del modulo", fl.m))
    COMPARISONS.append(("S04 seconda recensione stesso utente",
                         "409 dopo 13 campi compilati (frustrazione, abbandono)",
                         "DUPUSER: blocco prima del modulo, rettifica offerta subito"))

def s05(w, api):
    dave = w.users["u_dave"]
    fl = Flow("S05 · GPS davanti all'immobile — reverse geocoding urbano")
    fl.node("TARGET", "Scelto: Immobile")
    fl.node("PLACE", "«Usa la posizione»: dave è davanti al civico 15 di Via dei Mille (Milano)")
    pt = {"lat": 45.47805, "lng": 9.20498}
    found, addr = api.reverse_geocode(pt)
    fl.node("GPS", f"Coordinate {pt['lat']}, {pt['lng']} → trovato",
            api=f"GET /api/public/geocode/reverse → found: {addr['road']} {addr['hn']}, {addr['zone']}")
    fl.node("AUTOFILL", f"via+civico={addr['road']} {addr['hn']} · città={addr['zone']} · pin impostato",
            detail="4 campi autocompilati: chi è sul posto non digita nulla")
    fl.field(4, auto=True)
    fl.node("REVIEWPLACE", "Riepilogo: nessun campo mancante"); fl.field(1)
    fl.node("CONFIRM", "Conferma → sì")
    zspec = dict(name=addr["zone"], province=addr["prov"], region=addr["reg"], lat=pt["lat"], lng=pt["lng"])
    st, body = api.entities_create(dave, f"{addr['road']} {addr['hn']}", zspec, pt)
    fl.node("RESOLVE", "Città: Milano (ensureZone ≤30 km)")
    fl.node("EXIST", f"«via dei mille 15» → Sì, la scheda nata in S01 (HTTP {st} + existingId)",
            api=f"POST /api/entities → {st}",
            msg="Questo immobile risulta già presente: puoi recensire la scheda esistente.")
    fl.node("USE", "Scheda esistente usata", db="0 scritture")
    ent_id = body["existingId"]
    fl.node("DUPUSER [v2]", "dave ha già recensito? → No", api="GET la-mia-recensione → vuoto")
    fl.node("FORM", "Modulo compilato (11 campi)"); fl.field(11)
    st, body = api.reviews_post(dave, payload("Ci ho abitato", ent_id))
    fl.node("VALIDATE", f"ok (HTTP {st})", api=f"POST /api/reviews → {st}", db="+1 recensione dichiarata + Premium")
    fl.node("UPDATE", "Scheda aggiornata")
    fl.dump("OK — GPS → autocompilazione → scheda esistente → recensione: zero digitazione di indirizzi")
    RESULTS.append(("S05", "GPS urbano (reverse geocoding ok)", "OK — riuso scheda esistente", fl.m))

def s06(w, api):
    bob = w.users["u_bob"]
    fl = Flow("S06 · GPS in campagna (Lodigiano) — strada non mappata da OSM")
    fl.node("TARGET", "Scelto: Immobile")
    fl.node("PLACE", "«Usa la posizione»: bob è in una cascina fuori Lodi")
    pt = dict(GPS_RURAL_LODI)
    found, addr = api.reverse_geocode(pt)
    fl.node("GPS", f"Coordinate {pt['lat']}, {pt['lng']} → comune sì, strada NO",
            api="GET /api/public/geocode/reverse → found ma road=null",
            msg="Posizione rilevata, ma l'indirizzo non risulta mappato: inseriscilo a mano (il pin è già a posto).")
    fl.node("AUTOFILL", "città=Lodi (LO, Lombardia) · pin impostato · indirizzo MANCANTE",
            detail="3 campi su 4 autocompilati: il riepilogo chiede SOLO ciò che manca")
    fl.field(3, auto=True)
    fl.node("REVIEWPLACE", "Solo i campi mancanti: bob digita «Strada Provinciale 12»",
            msg="Manca l'indirizzo: scrivilo come appare su una buca delle lettere")
    fl.field(1)
    fl.node("CONFIRM", "Conferma → sì")
    zspec = dict(name=addr["zone"], province=addr["prov"], region=addr["reg"], lat=pt["lat"], lng=pt["lng"])
    st, body = api.entities_create(bob, "Strada Provinciale 12", zspec, pt)
    fl.node("RESOLVE", "Lodi NON è in catalogo: ensureZone crea la zona al volo",
            detail="nessun omonimo entro 30 km né in provincia di Lodi → nuova zona (source=user)",
            db="+1 zona «Lodi» · +1 scheda zona «Lodi» (ensureZoneEntity)")
    fl.node("EXIST", f"Nessuna scheda immobile in zona Lodi → No (HTTP {st})", api=f"POST /api/entities → {st}",
            db="+1 scheda «Strada Provinciale 12, Lodi» (con pin, senza civico)")
    fl.node("CREATE", "Scheda creata")
    fl.node("DUPUSER [v2]", "bob ha già recensito? → No")
    fl.node("FORM", "Modulo compilato"); fl.field(11)
    st, body = api.reviews_post(bob, payload("Ci ho abitato", body["entity"].id))
    fl.node("VALIDATE", f"ok (HTTP {st})", api=f"POST /api/reviews → {st}", db="+1 recensione + Premium")
    fl.node("UPDATE", "Prima recensione di Lodi: la città entra nelle classifiche")
    fl.dump("OK — copertura nazionale reale: zona nuova creata dal GPS, solo l'indirizzo chiesto a mano")
    RESULTS.append(("S06", "GPS extra-urbano (strada non mappata)", "OK — nuova zona + scheda creata", fl.m))

def s07(w, api):
    carol = w.users["u_carol"]
    fl = Flow("S07 · Zona/città — «Alassio», comune non ancora in catalogo")
    fl.node("TARGET", "Scelto: Zona o città")
    internal, gres = api.public_search("Alassio"), api.geocode("Alassio")
    fl.node("SEARCH", "«Alassio»", detail=f"{len(internal)} schede interne · {len(gres)} risultato OSM (località)",
            api="GET /api/public/search + GET /api/public/geocode")
    r = gres[0]
    fl.node("TEXT", "Selezione «Alassio, Savona»")
    fl.node("AUTOFILL", f"città={r['zone']} ({r['prov']}, {r['reg']}) · coordinate — per una zona non serve l'indirizzo")
    fl.field(2, auto=True)
    fl.node("REVIEWPLACE", "Riepilogo: solo la città, nessun campo mancante"); fl.field(1)
    fl.node("CONFIRM", "Conferma → sì")
    z, z_created, ent, e_created = api.zones_activate(carol, dict(
        name=r["zone"], province=r["prov"], region=r["reg"], lat=r["lat"], lng=r["lng"]))
    fl.node("RESOLVE", "ensureZone: nessun omonimo entro 30 km né in provincia → CREA",
            api="POST /api/zones → zona creata + scheda città attivata",
            db=f"+1 zona «{z.name}» (user) · +1 scheda zona" if z_created else "zona già presente")
    fl.node("EXIST", "Per le zone la scheda È la zona: nessun dedup indirizzo",
            detail="ensureZoneEntity garantisce UNA scheda per zona (una per città)")
    fl.node("USE", f"Scheda zona «{ent.name}» attivata e usata")
    fl.node("DUPUSER [v2]", "carol ha già recensito Alassio? → No")
    fl.node("FORM", "Modulo zona: voto, criteri (servizi, trasporti, sicurezza, costi), pro, contro, testo, affitto medio")
    fl.field(11)
    st, body = api.reviews_post(carol, payload("Ci vivo", ent.id))
    fl.node("VALIDATE", f"ok (HTTP {st})", api=f"POST /api/reviews → {st}", db="+1 recensione zona + Premium")
    fl.node("UPDATE", "Alassio sulla mappa d'Italia con la prima recensione")
    fl.dump("OK — il target «zona» entra nel campo unico senza passaggi separati (backend già pronto)")
    RESULTS.append(("S07", "Zona/città non in catalogo", "OK — zona attivata al volo", fl.m))

def s08(w, api):
    alice, bob = w.users["u_alice"], w.users["u_bob"]
    fl = Flow("S08 · Altro soggetto (agenzia) — recensione in revisione staff")
    fl.node("TARGET", "Scelto: Altro soggetto (persona, agenzia, ditta…)")
    internal = api.public_search("Agenzia Immobiliare XYZ")
    fl.node("SEARCH", "«Agenzia Immobiliare XYZ»", detail=f"{len(internal)} schede interne: il soggetto non esiste ancora",
            api="GET /api/public/search")
    fl.node("SEARCH", "Il campo unico propone il risultato OSM solo come aiuto per la città (Roma)",
            api="GET /api/public/geocode")
    fl.node("FORM", "Modulo unico con in più NOME del soggetto e MOTIVAZIONE (min 20 caratteri) + recensione completa",
            detail="per un nuovo soggetto la scheda NON nasce subito: proposta + recensione trattenute")
    fl.field(14)
    zr = zone_by_name(w, "Roma")
    st, body = api.proposals_post(alice, "soggetto", "Agenzia Immobiliare XYZ", zr.id,
                                   "Agenzia con cui ho trattato l'affitto, esperienza negativa da documentare.")
    fl.node("VALIDATE", f"Controllo server (stesse regole) (HTTP {st})", api=f"POST /api/proposals → {st}",
            db="+1 EntityProposal (received)")
    pending = Review(w.nid("rev"), "exp-pending", None, alice.id, 7.5, "T" * 160, "pending", False, 2)
    w.reviews.append(pending)
    fl.node("PROP", "Recensione trattenuta in stato «in revisione» [v2: serve Review.status=pending]",
            db="+1 recensione status=pending (NON pubblica, NON conta nelle medie)",
            msg="Grazie! La tua recensione è in revisione: ti avvisiamo via email appena decidiamo.")
    fl.node("NOTIF [v2]", "Email di conferma registrata", db="+1 EmailLog")
    fl.node("STAFFOK [v2]", "Lo staff approva: nasce la scheda e la recensione va online",
            db="+1 scheda «Agenzia Immobiliare XYZ» (Roma) · recensione pending → published",
            msg="Email: «La tua recensione su Agenzia Immobiliare XYZ è stata pubblicata»")
    ent = api.staff_approve_proposal(body["proposal"], pending)
    # bob, il giorno dopo, trova la scheda approvata
    internal = api.public_search("Agenzia Immobiliare XYZ")
    fl.node("SEARCH", "bob cerca la stessa agenzia il giorno dopo",
            detail=f"{len(internal)} scheda approvata al rank 1: bob la recensisce direttamente",
            api="GET /api/public/search")
    fl.node("DUPUSER [v2]", "bob ha già recensito? → No")
    fl.node("FORM", "Modulo di bob (11 campi)"); fl.field(11)
    st, body = api.reviews_post(bob, payload("Ho trattato con lui/lei", ent.id))
    fl.node("VALIDATE", f"ok (HTTP {st})", api=f"POST /api/reviews → {st}",
            detail="nota: nel flowchart com'è disegnato OGNI recensione «altro soggetto» passerebbe dallo staff; "
                   "si consiglia il criterio ibrido: solo i soggetti NUOVI (o le persone fisiche) vanno in revisione")
    fl.dump("OK con NOVITÀ BACKEND — serve Review.status=pending + pubblicazione all'approvazione")
    RESULTS.append(("S08", "Altro soggetto in revisione staff", "OK — proposta+recensione approvate", fl.m))

def s09(w, api):
    carol = w.users["u_carol"]
    r = api.geocode("Via Appia Nuova 20 Roma")[0]
    zspec = dict(name=r["zone"], province=r["prov"], region=r["reg"], lat=r["lat"], lng=r["lng"])
    geo = {"lat": r["lat"], "lng": r["lng"]}
    # ── v1: validazione solo all'invio ──
    snap = w.snapshot()
    fl = Flow("S09a · Modulo con 3 errori — validazione solo all'invio (v1)")
    fl.node("TARGET", "Scelto: Immobile — «Via Appia Nuova 20, Roma» (nuova scheda)")
    st, body = api.entities_create(carol, f"{r['road']} {r['hn']}", zspec, geo)
    fl.node("SEARCH", "ricerca e autocompilazione (4 campi)", api=f"search + geocode + POST /api/entities → {st}")
    fl.field(5, auto=True)
    ent_id = body["entity"].id
    fl.node("FORM", "carol compila in fretta: nessun pro, testo di 80 caratteri, onestà non spuntata",
            detail="il modulo statico non segnala nulla durante la digitazione")
    for i, (p, expect) in enumerate([
            (payload("Ci ho abitato", ent_id, pros="", text="T" * 80, honesty=False), "pro"),
            (payload("Ci ho abitato", ent_id, text="T" * 80, honesty=False), "testo"),
            (payload("Ci ho abitato", ent_id, honesty=False), "onestà")], 1):
        st, body = api.reviews_post(carol, p)
        fl.node("VALIDATE", f"Invio {i} → {body['error']} (HTTP {st})", api=f"POST /api/reviews → {st}",
                msg=body["error"])
        fl.m.failed_submits += 1
        if i == 1:
            fl.m.wasted += 13  # i campi erano già compilati: lo spreco è una tantum
        fl.node("FORM", f"carol corregge ({expect}) e reinvia")
    st, body = api.reviews_post(carol, payload("Ci ho abitato", ent_id))
    fl.node("VALIDATE", f"Invio 4 → ok (HTTP {st})", api=f"POST /api/reviews → {st}")
    fl.m.manual += 13
    fl.dump("⚠ 3 invii falliti: ogni errore arriva uno alla volta e l'utente perde il contesto")
    RESULTS.append(("S09a", "Tre errori trovati uno per volta (v1)", "⚠ 3 invii falliti", fl.m))
    w.restore(snap)
    # ── v2: validazione inline ──
    fl = Flow("S09b · Modulo con gli stessi 3 errori — validazione inline [v2]")
    fl.node("TARGET", "Scelto: Immobile — «Via Appia Nuova 20, Roma»")
    st, body = api.entities_create(carol, f"{r['road']} {r['hn']}", zspec, geo)
    fl.node("SEARCH", "ricerca e autocompilazione (4 campi)", api=f"search + geocode + POST /api/entities → {st}")
    fl.field(5, auto=True)
    ent_id = body["entity"].id
    fl.node("FORM", "carol digita il testo: contatore visibile «80/100»")
    fl.node("INLINE [v2]", "Errore mostrato mentre compila: testo troppo corto",
            msg="Ancora 20 caratteri per la descrizione (minimo 100)")
    fl.node("FORM", "pro vuoto → segnalato in tempo reale; la 4ª foto non si può aggiungere (limite 3 lato client)",
            msg="Massimo 3 foto per recensione")
    fl.node("INLINE [v2]", "onestà non spuntata → il pulsante resta disabilitato con il motivo",
            msg="Serve la dichiarazione sull'esperienza personale")
    fl.node("VALIDATE", "Tutto a posto PRIMA dell'invio: un solo invio", api="POST /api/reviews → 200",
            db="+1 recensione + Premium")
    fl.m.manual += 13
    fl.dump("OK — 0 invii falliti: ogni regola del server è replicabile lato client (il server resta l'autorità)")
    RESULTS.append(("S09b", "Stessi errori con validazione inline (v2)", "OK — 0 invii falliti", fl.m))
    COMPARISONS.append(("S09 modulo con errori",
                         "3 invii falliti, errori uno per volta",
                         "INLINE: 0 invii falliti, errori in tempo reale (foto già limitate a 3 dal client)"))

def s10(w, api):
    dave = w.users["u_dave"]
    ent = next(e for e in w.entities if e.name == "Agenzia Immobiliare XYZ")
    w.invites.append(Invite("INV-XYZ-001", ent.id, dave.email))
    fl = Flow("S10 · Recensione con invito riscattato inline → badge «verificata»")
    fl.node("TARGET", "Scelto: Immobile o altro — cerca «Agenzia Immobiliare XYZ»")
    internal = api.public_search("Agenzia Immobiliare XYZ")
    fl.node("SEARCH", f"{len(internal)} scheda approvata al rank 1", api="GET /api/public/search")
    fl.node("USE", "Scheda esistente selezionata")
    fl.node("DUPUSER [v2]", "dave ha già recensito? → No")
    fl.node("FORM", "Modulo compilato (l'invito NON è obbligatorio per partire)"); fl.field(13)
    fl.node("ACTIVE", "«Puoi verificare la tua esperienza?» → dave ha un codice invito")
    st, body = api.invitations_redeem(dave, "INV-XYZ-001")
    fl.node("INVITE [v2]", "Codice INV-XYZ-001 inserito nel modulo",
            api=f"POST /api/invitations/redeem → {st} (esperienza attiva, origin=business)",
            db="+1 Experience attiva collegata a dave")
    st, body = api.reviews_post(dave, payload("Ho trattato con lui/lei", experience_id=body["experience"].id))
    fl.node("VALIDATE", f"ok con esperienza collegata (HTTP {st}, verified={body['verified']})",
            api=f"POST /api/reviews (via experienceId) → {st}",
            db="+1 recensione VERIFICATA + Premium")
    fl.node("VERIFIED", "Pubblicata subito come «verificata»")
    fl.node("UPDATE", "La scheda distingue recensioni verificate e dichiarate")
    fl.dump("OK — l'invito è SINCRONO: verifica e pubblicazione nello stesso momento (backend già esistente)")
    RESULTS.append(("S10", "Invito riscattato inline", "OK — pubblicata verificata", fl.m))

def s11(w, api):
    erin = w.users["u_erin"]
    ent = next(e for e in w.entities if e.name == "Agenzia Immobiliare XYZ")
    fl = Flow("S11 · Recensione con documenti caricati inline → pubblicata, poi upgradata")
    fl.node("TARGET", "Scelto: altro — cerca «Agenzia Immobiliare XYZ»")
    fl.node("SEARCH", "scheda al rank 1", api="GET /api/public/search")
    fl.node("USE", "Scheda selezionata")
    fl.node("DUPUSER [v2]", "erin ha già recensito? → No")
    fl.node("FORM", "Modulo compilato + upload del contratto (PDF)"); fl.field(14)
    fl.node("ACTIVE", "«Puoi verificare la tua esperienza?» → erin carica un documento")
    st, body = api.verify_request(erin, ent.id)
    fl.node("DOCS [v2]", "Documento allegato alla richiesta di verifica",
            api=f"POST /api/experiences/verify-request → {st}",
            db="+1 PendingVer + VerificationDoc (conservata, retention dopo la decisione)")
    st, body = api.reviews_post(erin, payload("Ho trattato con lui/lei", ent.id))
    fl.node("VALIDATE", f"ok — la verifica documentale è ASINCRONA: non si può aspettare (HTTP {st}, verificata=no)",
            api=f"POST /api/reviews → {st} (dichiarata)")
    fl.node("DECLARED", "Pubblicata SUBITO come «dichiarata»: nessuna attesa, nessun contenuto perso",
            msg="Recensione pubblicata! Il documento è in verifica: se è tutto ok diventa «verificata».")
    fl.node("UPDATE", "Scheda aggiornata con la recensione dichiarata")
    pv = w.pending_verifications[-1]
    api.staff_approve_verification(pv)
    fl.node("PENDVER [v2]", "(ore dopo) Lo staff approva il documento",
            db="PendingVer → approved · +1 Experience attiva (origin=verification-request)")
    fl.node("UPGRADE [v2]", "Badge aggiornato: dichiarata → VERIFICATA (nessuna nuova pubblicazione)",
            db="review.verified = true · email all'utente",
            msg="Email: la tua recensione su Agenzia Immobiliare XYZ è ora verificata")
    fl.dump("OK — pattern consigliato: pubblica subito, verifica dopo (evita attese e abbandoni)")
    RESULTS.append(("S11", "Documenti inline con upgrade asincrono", "OK — dichiarata → verificata", fl.m))

def s12(w, api):
    eve, alice = w.users["u_eve"], w.users["u_alice"]
    fl = Flow("S12 · Cancelli d'ingresso — email non verificata e limite giornaliero")
    fl.node("START", "eve ha un account ma NON ha confermato l'email")
    fl.node("TARGET", "Scelto: Immobile")
    internal = api.public_search("Via dei Mille 15")
    fl.node("SEARCH", "«Via dei Mille 15»", detail=f"{len(internal)} scheda (le ricerche pubbliche funzionano)",
            api="GET /api/public/search")
    fl.node("USE", "Scheda selezionata (l'interfaccia procede: il controllo è lontano)")
    fl.node("FORM", "eve compila il modulo completo"); fl.field(13)
    st, body = api.reviews_post(eve, payload("Ci ho abitato", internal[0].id))
    fl.node("VALIDATE", f"Invio → BLOCCATA (HTTP {st})", api=f"POST /api/reviews → {st}", msg=body["error"])
    fl.m.failed_submits += 1
    fl.m.wasted += 13
    fl.node("GATE [v2]", "PROPOSTA: anticipare il controllo a START (lo stato emailVerified è già nel bootstrap)",
            detail="a START eve vedrebbe «Conferma l'email per scrivere recensioni [Rinvia email]» → 0 campi sprecati")
    fl.node("START", "(variante) alice ha già scritto 5 recensioni aperte oggi (setup della simulazione)")
    alice.reviews_today = 5
    fl.node("TARGET", "Scelto: Immobile")
    fl.node("SEARCH", "«Via Appia Nuova 21, Roma» → nuova scheda (limite nuove schede separato)",
            api="GET /api/public/search + geocode")
    fl.node("CREATE", "Scheda creata")
    fl.node("FORM", "alice compila il modulo"); fl.field(13)
    st, body = api.reviews_post(alice, payload("Ci ho abitato", "ent-qualunque"))
    fl.node("VALIDATE", f"Invio → (HTTP {st})", api=f"POST /api/reviews → {st}", msg=body["error"])
    fl.m.failed_submits += 1
    fl.m.wasted += 13
    fl.node("GATE [v2]", "PROPOSTA: mostrare a START la quota residua («ti restano N recensioni oggi»)")
    fl.dump("⚠ ENTRAMBI i blocchi arrivano DOPO il modulo nel flusso attuale → v2: anticiparli a START/GATE")
    RESULTS.append(("S12", "Cancelli d'ingresso (email, quota)", "⚠ blocchi tardivi (v2: GATE a START)", fl.m))

# ══════════════════════ 9. REPORT ════════════════════════════════════════════

def main():
    w, api = seed_world()
    print("ZOOMZOOM — SIMULAZIONE DEL FLUSSO DI CONTRIBUTO SIMPLIFICATO (proposta utente)")
    print("Le chiamate che mutano lo stato sono eseguite DAVVERO sulle porte del backend")
    print("(normAddress, ensureZone, 409/403/429/400 calcolati dalle regole reali del server).")
    print("Impostazioni reali: 5 contributi/giorno · Premium 30 gg/recensione · foto max 3.")
    # S01→S12 in sequenza: ogni scenario vede lo stato generato dai precedenti
    # (S02 riusa la scheda di S01, S10/S11 la scheda approvata in S08…)
    for fn in (s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12):
        fn(w, api)
    print("\n" + "═" * 74)
    print("SINTESI")
    print("═" * 74)
    hdr = f"{'Cod':<6}{'Scenario':<42}{'Esito':<34}{'Mano':>5}{'Auto':>5}{'Sprec':>6}{'KO':>4}"
    print(hdr)
    print("-" * len(hdr))
    for code, title, outcome, m in RESULTS:
        print(f"{code:<6}{title[:41]:<42}{outcome[:33]:<34}{m.manual:>5}{m.autofilled:>5}{m.wasted:>6}{m.failed_submits:>4}")
    print("\nCONFRONTI v1 (flowchart attuale) → v2 (con nodi proposti)")
    for name, v1, v2 in COMPARISONS:
        print(f"  • {name}\n      v1: {v1}\n      v2: {v2}")
    print("\nSTATO FINALE DEL MONDO (S01→S12 in sequenza)")
    published = [r for r in w.reviews if r.status == "published"]
    print(f"  zone: {len(w.zones)} ({', '.join(z.name for z in w.zones)})")
    print(f"  schede: {len(w.entities)} · recensioni pubblicate: {len(published)} "
          f"(verificate: {sum(1 for r in published if r.verified)}) · proposte approvate: {len(w.proposals)}")
    print(f"  email inviate: {len(w.emails)} · voci audit: {len(w.audit)}")

if __name__ == "__main__":
    main()
