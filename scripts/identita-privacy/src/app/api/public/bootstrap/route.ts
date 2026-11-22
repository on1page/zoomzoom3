// GET /api/public/bootstrap — configurazione pubblica per il client:
// nome sito, categorie, zone, impostazioni pubbliche, flag funzionalità.
import { NextResponse } from "next/server";
import { publicCategoriesPayload, publicZones } from "@/lib/server/public-data";
import { getSettings } from "@/lib/server/settings";
import { getCurrentUser } from "@/lib/server/auth";
import { premiumStateOf } from "@/lib/server/premium";
import { photoAccessOf } from "@/lib/server/review-access";
import { smtpConfigured } from "@/lib/server/mailer";
import { db } from "@/lib/db";

export async function GET() {
  const [cats, zones, settings, user] = await Promise.all([
    publicCategoriesPayload(),
    publicZones(),
    getSettings(),
    getCurrentUser(),
  ]);
  const demoMode = process.env.DEMO_MODE === "true";
  const googleOAuthEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const adsClient = settings.adsEnabled ? settings.adsClient : "";
  const totalReviews = await db.review.count({ where: { status: "published" } });
  const totalEntities = await db.entity.count({ where: { status: "published" } });
  const photoAccess = user ? await photoAccessOf(user, settings) : { canView: false, viaContribution: false };
  return NextResponse.json({
    ok: true,
    site: {
      name: settings.siteName,
      tagline: settings.heroTitle,
      demoMode,
      emailDelivery: smtpConfigured() ? "smtp" : demoMode ? "demo" : "disabled",
      googleOAuthEnabled,
      adsEnabled: settings.adsEnabled && !!settings.adsClient,
      adsClient,
      premiumEnabled: settings.premiumEnabled,
      openReviewsEnabled: settings.openReviewsEnabled,
      photosEnabled: settings.photosEnabled,
      votesEnabled: settings.votesEnabled,
    },
    categories: cats,
    zones: zones.map(z => ({
      id: z.id, name: z.name,
      province: z.province, region: z.region,
      lat: z.gpsLat, lng: z.gpsLng,
    })),
    settings: {
      minReviews: settings.minReviews,
      rettificaDays: settings.rettificaDays,
      inviteExpiryDays: settings.inviteExpiryDays,
      heroTitle: settings.heroTitle,
      heroSub: settings.heroSub,
      globalNotice: demoMode ? settings.globalNotice : "",
      premiumDaysPerReview: settings.premiumDaysPerReview,
    },
    stats: { reviews: totalReviews, entities: totalEntities },
    user: user ? {
      id: user.id, email: user.email, nickname: user.nickname, role: user.role,
      emailVerified: user.emailVerified, subjectEntityId: user.subjectEntityId,
      categoryId: user.categoryId, hasAvatar: user.hasAvatar,
      totpEnabled: user.totpEnabled, isDemo: user.isDemo,
      createdAt: user.createdAt.toISOString(),
      premium: {
        active: premiumStateOf(user).active,
        until: premiumStateOf(user).until ? premiumStateOf(user).until!.toISOString() : null,
      },
      photoAccess: photoAccess.canView,
      photoViaContribution: photoAccess.viaContribution,
    } : null,
  });
}
