// ZoomZoom — QR code di registrazione TOTP (solo server-side).
// Genera il PNG (data URL) dell'URI otpauth da mostrare UNA sola volta:
// al primo accesso con 2FA mai completata oppure durante l'attivazione
// nel profilo. Il segreto non viene mai scritto nei log.
import QRCode from "qrcode";
import { otpauthUri } from "./totp";

export type TotpEnrollment = {
  otpauth: string; // URI otpauth:// (inserimento manuale/testo)
  qr: string;      // PNG data URL del QR
  secret: string;  // chiave Base32 (fallback inserimento manuale)
};

export async function totpEnrollment(secret: string, email: string, issuer: string): Promise<TotpEnrollment> {
  const otpauth = otpauthUri(secret, email, issuer);
  const qr = await QRCode.toDataURL(otpauth, { errorCorrectionLevel: "M", margin: 2, width: 220 });
  return { otpauth, qr, secret };
}
