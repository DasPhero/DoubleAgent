export interface ApiIdentityOption {
  id: string;
  label: string;
  username: string;
}

export interface ApiKeyValue {
  key: string;
  value: string;
  enabled: boolean;
  isSecret?: boolean;
}

export interface ApiAuthConfig {
  type: 'none' | 'bearer' | 'basic' | 'header' | 'vault';
  token?: string;
  username?: string;
  password?: string;
  headerName?: string;
  headerValue?: string;
  credentialId?: string;
  identityId?: string;
}

export interface ApiRequestItem {
  id: string;
  engagementId?: string;
  collectionName?: string;
  name: string;
  method: string;
  url: string;
  params?: ApiKeyValue[];
  headers?: ApiKeyValue[];
  auth: ApiAuthConfig;
  bodyType: 'none' | 'json' | 'form' | 'raw' | 'hex';
  body?: string;
  rawMode?: boolean;
  rawRequest?: string;
  routeId?: string;
  timeoutSec?: number;
  followRedirects: boolean;
  useCookieJar: boolean;
  tlsSkipVerify?: boolean;
  tags?: string[];
  updatedAt?: string;
}

export interface ApiEnvironment {
  id: string;
  engagementId?: string;
  name: string;
  variables?: ApiKeyValue[];
  updatedAt?: string;
}

export interface ApiRouteOption {
  id: string;
  label: string;
  kind: string;
  endpoint?: string;
  active: boolean;
}

export interface ApiExecuteRequest {
  executionId?: string;
  sessionId?: string;
  envId?: string;
  request: ApiRequestItem;
  variables?: ApiKeyValue[];
}

export interface ApiTlsInfo {
  version?: string;
  cipherSuite?: string;
  serverName?: string;
  subject?: string;
  issuer?: string;
  dnsNames?: string[];
  notAfter?: string;
  verified: boolean;
}

export interface ApiTimingInfo {
  dialMs: number;
  tlsMs: number;
  ttfbMs: number;
  totalMs: number;
}

export interface ApiResponse {
  requestId?: string;
  statusCode: number;
  status: string;
  proto?: string;
  headers?: Record<string, string[]>;
  rawHeaders?: string;
  body: string;
  bodyBase64?: string;
  isBinary?: boolean;
  sizeBytes: number;
  truncated?: boolean;
  contentType?: string;
  effectiveUrl?: string;
  routeUsed?: string;
  tls?: ApiTlsInfo;
  timing: ApiTimingInfo;
  redirectChain?: string[];
  cookies?: string[];
  error?: string;
}

export interface ApiReplayBatchRequest {
  executionId?: string;
  sessionId?: string;
  engagementId?: string;
  envId?: string;
  request: ApiRequestItem;
  variables?: ApiKeyValue[];
  payloads: string[];
  delayMs?: number;
}

export interface ApiReplayEntryResult {
  index: number;
  payload: string;
  statusCode: number;
  status: string;
  sizeBytes: number;
  totalMs: number;
  routeUsed?: string;
  error?: string;
  response?: ApiResponse;
}

export interface ApiReplayBatchResult {
  executionId: string;
  total: number;
  completed: number;
  aborted?: boolean;
  lockoutWarning?: string;
  results: ApiReplayEntryResult[];
}

export interface ApiResponseDiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
}

export interface ApiResponseDiff {
  statusDelta: string;
  sizeDelta: number;
  timeDeltaMs: number;
  headerLines: ApiResponseDiffLine[];
  bodyLines: ApiResponseDiffLine[];
}

export interface ApiDecodedPayload {
  input: string;
  format: string;
  decoded: string;
  jwtHeader?: string;
  jwtClaims?: string;
  jwtAlg?: string;
  jwtExpired?: boolean;
  error?: string;
}

export interface ApiAiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ApiAiChatRequest {
  streamId?: string;
  provider: 'openai' | 'anthropic' | 'ollama' | 'custom';
  endpointUrl: string;
  model: string;
  auth: ApiAuthConfig;
  routeId?: string;
  tlsSkipVerify?: boolean;
  temperature?: number;
  maxTokens?: number;
  messages: ApiAiChatMessage[];
  stream: boolean;
  timeoutSec?: number;
}

export interface ApiAiChatResult {
  streamId: string;
  reply: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  rawRequestJson?: string;
  rawResponse?: string;
  statusCode: number;
  durationMs: number;
  routeUsed?: string;
  error?: string;
}

export interface ApiAiStreamChunkEvent {
  streamId: string;
  delta: string;
  done: boolean;
  error?: string;
}

export interface ApiWsConnectRequest {
  sessionId?: string;
  url: string;
  headers?: ApiKeyValue[];
  auth: ApiAuthConfig;
  subprotocols?: string[];
  routeId?: string;
  tlsSkipVerify?: boolean;
  timeoutSec?: number;
  variables?: ApiKeyValue[];
}

export interface ApiWsConnectResult {
  sessionId: string;
  effectiveUrl?: string;
  subprotocol?: string;
  statusCode: number;
  responseHeaders?: string;
  routeUsed?: string;
  durationMs: number;
  error?: string;
}

export interface ApiWsSendRequest {
  sessionId: string;
  frameType: 'text' | 'binary' | 'ping';
  payload: string;
  variables?: ApiKeyValue[];
}

export interface ApiWsFrameEvent {
  sessionId: string;
  direction: 'in' | 'out' | 'system';
  frameType: 'text' | 'binary' | 'ping' | 'pong' | 'close' | 'connected' | 'error';
  payload: string;
  payloadHexDump?: string;
  payloadAscii?: string;
  payloadBase64?: string;
  sizeBytes: number;
  isBinary?: boolean;
  timestamp: string;
  error?: string;
}
