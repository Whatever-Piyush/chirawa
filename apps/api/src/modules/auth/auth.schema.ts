import { z } from 'zod';

// Indian mobile: 10 digits, starts with 6/7/8/9
export const indianPhoneSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Valid 10-digit Indian mobile number required');

export const otpSchema = z
  .coerce.string()
  .trim()
  .regex(/^\d{6}$/, '6-digit OTP required');

export const pinSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, '4-digit PIN required');

export const sendOtpSchema = z.object({
  phone: indianPhoneSchema,
});

export const verifyOtpSchema = z.object({
  phone: indianPhoneSchema,
  otp: otpSchema,
  referralCode: z.string().trim().max(10).optional(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(64).max(64),
});

export const setPinSchema = z.object({
  pin: pinSchema,
  confirmPin: pinSchema,
}).refine((data) => data.pin === data.confirmPin, {
  message: 'PINs do not match',
  path: ['confirmPin'],
});

export type SendOtpInput     = z.infer<typeof sendOtpSchema>;
export type VerifyOtpInput   = z.infer<typeof verifyOtpSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type SetPinInput      = z.infer<typeof setPinSchema>;
