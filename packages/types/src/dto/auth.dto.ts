export interface SendOtpRequest {
  phone: string;   // 10-digit Indian mobile number
}

export interface SendOtpResponse {
  message: string;
  expiresInSeconds: number;
}

export interface VerifyOtpRequest {
  phone: string;
  otp: string;
  referralCode?: string;   // Only on first signup
}

export interface AuthTokens {
  accessToken: string;    // Short-lived JWT (15 min)
  refreshToken: string;   // Opaque token (7 days)
  expiresIn: number;      // Seconds until access token expires
}

export interface VerifyOtpResponse {
  tokens: AuthTokens;
  isNewUser: boolean;
  requiresPin: boolean;   // Seller/Rider must set PIN
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  tokens: AuthTokens;
}

export interface SetPinRequest {
  pin: string;  // 4-digit numeric
}