// Canonical phone form across the API is a bare 10-digit Indian mobile number.
// Seeds / imports / future inputs may carry a +91 / 91 / leading-0 prefix, so we
// normalize at the auth boundary to keep OTP Redis keys and user lookups aligned.
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');                       // drop +, spaces, dashes
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0'))  return digits.slice(1);
  return digits;
}
