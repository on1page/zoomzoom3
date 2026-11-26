"use client";
// ZoomZoom — applicazione a route unica: tutte le viste sono gestite via hash
// routing nel client, MA ogni operazione sensibile passa dalle API server-side
// con autorizzazione per ruolo. Nessuna sessione o segreto nel client.
import { AppProvider, useApp } from "@/lib/client/store";
import { useHashRoute } from "@/lib/client/router";
import { CookieBanner, DemoBar, Footer, Header, Toasts } from "@/components/chrome";
import { HomeView } from "@/components/views/home";
import { SearchView } from "@/components/views/search";
import { CategoryView, MapView, RankingsView } from "@/components/views/map-rankings-category";
import { EntityView, ZoneView } from "@/components/views/entity-zone";
import { ContactsView, CookieView, HowItWorksView, MailboxView, ModerationView, NotFoundView, PremiumView, PrivacyView, ReviewRulesView, TermsView } from "@/components/views/info-pages";
import { LoginView, RegisterView, VerifyEmailView } from "@/components/views/auth";
import { ProfileInvitesView, ProfileSettingsView, ProfileView } from "@/components/views/profile";
import { InviteView, ProposeView, SubjectAreaView, UpdateReviewView, VerifyExperienceView, WriteReviewView } from "@/components/views/review-flows";
import { WriteReviewOpenView } from "@/components/views/write-review-open";
import { ConsulenteView, ConsulenteRequestFormView, ConsulenteRequestsView, IndagineProView } from "@/components/views/consulente";
import { SubscriptionView } from "@/components/views/abbonamento";
import { AdminView } from "@/components/admin/admin";

function Router() {
  const route = useHashRoute();
  const { boot } = useApp();
  const segs = route.segs;

  if (!boot) {
    return <main id="main" tabIndex={-1}><div className="container section"><p className="muted">Caricamento della piattaforma…</p></div></main>;
  }

  const view = (() => {
    switch (segs[0]) {
      case undefined: return <HomeView />;
      case "cerca": return <SearchView />;
      case "mappa": return <MapView />;
      case "classifiche": return <RankingsView />;
      case "categoria": return <CategoryView catId={segs[1] || ""} />;
      case "scheda": return segs[1] ? <EntityView id={segs[1]} /> : <NotFoundView />;
      case "zona": return segs[1] ? <ZoneView entityId={segs[1]} /> : <NotFoundView />;
      case "come-funziona": return <HowItWorksView />;
      case "privacy": return <PrivacyView />;
      case "cookie": return <CookieView />;
      case "termini": return <TermsView />;
      case "regole-recensioni": return <ReviewRulesView />;
      case "premium": return <PremiumView />;
      case "abbonamento": return <SubscriptionView />;
      case "moderazione": return <ModerationView />;
      case "contatti": return <ContactsView />;
      case "casella-demo": return <MailboxView />;
      case "accedi": return <LoginView />;
      case "registrati": return <RegisterView />;
      case "verifica-email": return segs[1] ? <VerifyEmailView token={segs[1]} /> : <NotFoundView />;
      case "profilo": return <ProfileView />;
      case "profilo-inviti": return <ProfileInvitesView />;
      case "profilo-impostazioni": return <ProfileSettingsView />;
      case "invito": return segs[1] ? <InviteView token={segs[1]} /> : <NotFoundView />;
      case "scrivi": return segs[1] ? <WriteReviewView expId={segs[1]} /> : <NotFoundView />;
      case "recensione": return <WriteReviewOpenView presetEntityId={route.params.entity} />;
      case "rettifica": return segs[1] ? <UpdateReviewView reviewId={segs[1]} /> : <NotFoundView />;
      case "verifica-esperienza": return <VerifyExperienceView />;
      case "area-soggetto": return <SubjectAreaView />;
      case "proponi-soggetto": return <ProposeView />;
      case "consulente": return <ConsulenteView />;
      case "consulente-richieste": return <ConsulenteRequestsView />;
      case "consulente-richiesta": return <ConsulenteRequestFormView entityId={route.params.to} />;
      case "indagine": return <IndagineProView prefill={route.params.addr} />;
      case "admin": return <AdminView section={segs[1] || "login"} />;
      default: return <NotFoundView />;
    }
  })();

  return <main id="main" tabIndex={-1}>{view}</main>;
}

function Shell() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <DemoBar />
      <Header />
      <div style={{ flex: 1 }}>
        <Router />
      </div>
      <Footer />
      <CookieBanner />
      <Toasts />
    </div>
  );
}

export default function Home() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
