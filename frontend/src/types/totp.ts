// Type definitions for TOTP Authenticator Generator (F-20, Golden Rule 2).

export interface TotpSummary {
  id: string;
  label: string;
  issuer?: string;
  algorithm: string;
  digits: number;
  period: number;
  hostId?: string;
  createdAt?: string;
}

export interface TotpRecord {
  id: string;
  label: string;
  issuer?: string;
  secret?: string;
  algorithm?: string;
  digits?: number;
  period?: number;
  hostId?: string;
  createdAt?: string;
}

export interface TotpCodeResponse {
  id: string;
  code: string;
  remainingSeconds: number;
  period: number;
}
