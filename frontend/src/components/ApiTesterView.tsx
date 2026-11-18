import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CyberIcon } from './CyberIcon';
import { MarkdownRenderer } from './MarkdownRenderer';
import type {
  ApiAiChatMessage,
  ApiAiChatRequest,
  ApiAiChatResult,
  ApiAiStreamChunkEvent,
  ApiAuthConfig,
  ApiDecodedPayload,
  ApiEnvironment,
  ApiExecuteRequest,
  ApiIdentityOption,
  ApiKeyValue,
  ApiReplayBatchRequest,
  ApiReplayBatchResult,
  ApiRequestItem,
  ApiResponse,
  ApiResponseDiff,
  ApiRouteOption,
} from '../types/apitester';
import type { CredentialEntry } from '../types/pentest';

interface WailsApiTesterBindings {
  ListApiRoutes?: () => Promise<ApiRouteOption[]>;
  ExecuteApiRequest?: (req: ApiExecuteRequest) => Promise<ApiResponse>;
  ExecuteApiParameterReplay?: (req: ApiReplayBatchRequest) => Promise<ApiReplayBatchResult>;
  CancelApiExecution?: (executionId: string) => Promise<boolean>;
  ResetApiCookieJar?: (sessionId: string) => Promise<void>;
  ExecuteApiAiChat?: (req: ApiAiChatRequest) => Promise<ApiAiChatResult>;
  InspectApiPayload?: (input: string, format: string) => Promise<ApiDecodedPayload>;
  ParseApiCurl?: (curlCmd: string) => Promise<ApiRequestItem>;
  GenerateApiCodeSnippet?: (req: ApiRequestItem, lang: string, resolveSecrets: boolean) => Promise<string>;
  ImportOpenAPISpec?: (specJson: string, engagementId: string, collectionName: string) => Promise<ApiRequestItem[]>;
  DiffApiResponses?: (left: ApiResponse, right: ApiResponse) => Promise<ApiResponseDiff>;
  ListApiRequests?: (engagementId: string) => Promise<ApiRequestItem[]>;
  SaveApiRequest?: (req: ApiRequestItem) => Promise<ApiRequestItem>;
  DeleteApiRequest?: (id: string) => Promise<void>;
  ListApiEnvironments?: (engagementId: string) => Promise<ApiEnvironment[]>;
  SaveApiEnvironment?: (env: ApiEnvironment) => Promise<ApiEnvironment>;
  DeleteApiEnvironment?: (id: string) => Promise<void>;
  ListCredentials?: (engagementId: string, hostId: string) => Promise<CredentialEntry[]>;
}

function getApiBindings(): WailsApiTesterBindings | undefined {
  const w = window as unknown as { go?: { main?: { App?: WailsApiTesterBindings } } };
  return w.go?.main?.App;
}

export interface ApiHistoryEntry {
  id: string;
  timestamp: string;
  request: ApiRequestItem;
  response: ApiResponse;
}

export interface ApiTesterViewProps {
  activeEngagementId: string | null;
  activeEngagementName: string | null;
  identities: ApiIdentityOption[];
  externalDraft?: ApiRequestItem | null;
  onExternalDraftConsumed?: () => void;
  eventsOn?: (eventName: string, callback: (...data: unknown[]) => void) => () => void;
  onSaveToEvidence?: (title: string, category: string, content: string) => Promise<void>;
  onSaveToNotes?: (title: string, content: string) => Promise<void>;
  onClose?: () => void;
}

type TesterMode = 'repeater' | 'replay' | 'diff' | 'ai-chat';
type ReqSubTab = 'params' | 'headers' | 'auth' | 'body';
type RespSubTab = 'pretty' | 'raw' | 'headers' | 'tls' | 'cookies' | 'inspector';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

const AI_PRESETS: Record<
  'openai' | 'anthropic' | 'ollama' | 'custom',
  { label: string; endpointUrl: string; defaultModel: string; authType: ApiAuthConfig['type']; headerName?: string }
> = {
  openai: {
    label: 'OpenAI-Compatible',
    endpointUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    authType: 'bearer',
  },
  anthropic: {
    label: 'Anthropic Messages',
    endpointUrl: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-20250514',
    authType: 'header',
    headerName: 'x-api-key',
  },
  ollama: {
    label: 'Ollama Local / Pivot',
    endpointUrl: 'http://127.0.0.1:11434/api/chat',
    defaultModel: 'llama3.1',
    authType: 'none',
  },
  custom: {
    label: 'Custom JSON Endpoint',
    endpointUrl: 'http://127.0.0.1:8080/v1/chat/completions',
    defaultModel: 'local-model',
    authType: 'bearer',
  },
};

function createBlankRequest(engagementId: string | null): ApiRequestItem {
  return {
    id: `req-${Date.now()}`,
    engagementId: engagementId || undefined,
    collectionName: 'Default Collection',
    name: 'Untitled Request',
    method: 'GET',
    url: 'https://httpbin.org/anything',
    params: [],
    headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
    auth: { type: 'none' },
    bodyType: 'none',
    body: '',
    rawMode: false,
    rawRequest: '',
    routeId: '',
    timeoutSec: 20,
    followRedirects: true,
    useCookieJar: true,
    tlsSkipVerify: false,
  };
}

function formatJsonIfPossible(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function buildRawWireFromRequest(req: ApiRequestItem): string {
  const method = (req.method || 'GET').toUpperCase();
  let path = '/';
  let host = 'target.local';
  try {
    const raw = req.url.includes('://') ? req.url : `http://${req.url}`;
    const u = new URL(raw);
    host = u.host || host;
    path = (u.pathname || '/') + (u.search || '');
  } catch {
    path = req.url || '/';
  }
  const lines = [`${method} ${path} HTTP/1.1`, `Host: ${host}`];
  for (const h of req.headers || []) {
    if (h.enabled && h.key.trim()) {
      lines.push(`${h.key.trim()}: ${h.value}`);
    }
  }
  if (req.bodyType === 'json' && !(req.headers || []).some((h) => h.enabled && h.key.toLowerCase() === 'content-type')) {
    lines.push('Content-Type: application/json');
  } else if (req.bodyType === 'hex' && !(req.headers || []).some((h) => h.enabled && h.key.toLowerCase() === 'content-type')) {
    lines.push('Content-Type: application/octet-stream');
  }
  lines.push('');
  if (req.bodyType !== 'none' && req.body) {
    lines.push(req.body);
  } else {
    lines.push('');
  }
  return lines.join('\n');
}

function statusBadgeColor(code: number): string {
  if (code >= 200 && code < 300) return '#34d399';
  if (code >= 300 && code < 400) return '#38bdf8';
  if (code >= 400 && code < 500) return '#fbbf24';
  if (code >= 500 || code === 0) return '#f87171';
  return '#94a3b8';
}

export function ApiTesterView({
  activeEngagementId,
  activeEngagementName,
  identities,
  externalDraft,
  onExternalDraftConsumed,
  eventsOn,
  onSaveToEvidence,
  onSaveToNotes,
  onClose,
}: ApiTesterViewProps): React.JSX.Element {
  const [mode, setMode] = useState<TesterMode>('repeater');
  const [sidebarFilter, setSidebarFilter] = useState<string>('');
  const [sidebarTab, setSidebarTab] = useState<'collections' | 'history'>('collections');

  // Collections & Environments backed by Vault
  const [savedRequests, setSavedRequests] = useState<ApiRequestItem[]>([]);
  const [environments, setEnvironments] = useState<ApiEnvironment[]>([]);
  const [credentials, setCredentials] = useState<CredentialEntry[]>([]);
  const [routes, setRoutes] = useState<ApiRouteOption[]>([
    { id: '', label: 'Direct (No Proxy)', kind: 'direct', active: true },
  ]);
  const [activeEnvId, setActiveEnvId] = useState<string>('');
  const [showEnvEditor, setShowEnvEditor] = useState<boolean>(false);
  const [editingEnv, setEditingEnv] = useState<ApiEnvironment | null>(null);

  // Repeater workspace state
  const [reqTabs, setReqTabs] = useState<ApiRequestItem[]>(() => [createBlankRequest(activeEngagementId)]);
  const [activeTabIdx, setActiveTabIdx] = useState<number>(0);
  const activeReq = reqTabs[activeTabIdx] || reqTabs[0];

  const [reqSubTab, setReqSubTab] = useState<ReqSubTab>('headers');
  const [respSubTab, setRespSubTab] = useState<RespSubTab>('pretty');
  const [history, setHistory] = useState<ApiHistoryEntry[]>([]);
  const [currentResponse, setCurrentResponse] = useState<ApiResponse | null>(null);
  const [isSending, setIsSending] = useState<boolean>(false);
  const activeExecIdRef = useRef<string>('');

  // Status / notifications + code/import overlays
  const [statusBanner, setStatusBanner] = useState<string>('');
  const [errorBanner, setErrorBanner] = useState<string>('');
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importKind, setImportKind] = useState<'curl' | 'openapi'>('curl');
  const [importText, setImportText] = useState<string>('');
  const [importCollectionName, setImportCollectionName] = useState<string>('Imported API');
  const [snippetPreview, setSnippetPreview] = useState<{ lang: string; code: string } | null>(null);
  const [extractVarName, setExtractVarName] = useState<string>('');
  const [extractJsonKey, setExtractJsonKey] = useState<string>('');

  // Inspector / Decoder state
  const [inspectorInput, setInspectorInput] = useState<string>('');
  const [inspectorFormat, setInspectorFormat] = useState<string>('auto');
  const [inspectorResult, setInspectorResult] = useState<ApiDecodedPayload | null>(null);

  // Parameterized Replay (Intruder-Lite) state
  const [replayPayloadsText, setReplayPayloadsText] = useState<string>('1\n2\n3\nadmin');
  const [replayDelayMs, setReplayDelayMs] = useState<number>(150);
  const [replayRunning, setReplayRunning] = useState<boolean>(false);
  const [replayResult, setReplayResult] = useState<ApiReplayBatchResult | null>(null);

  // Response Diff state
  const [diffLeftId, setDiffLeftId] = useState<string>('');
  const [diffRightId, setDiffRightId] = useState<string>('');
  const [diffResult, setDiffResult] = useState<ApiResponseDiff | null>(null);

  // AI Chat Mode state
  const [aiProvider, setAiProvider] = useState<'openai' | 'anthropic' | 'ollama' | 'custom'>('ollama');
  const [aiEndpoint, setAiEndpoint] = useState<string>(AI_PRESETS.ollama.endpointUrl);
  const [aiModel, setAiModel] = useState<string>(AI_PRESETS.ollama.defaultModel);
  const [aiRouteId, setAiRouteId] = useState<string>('');
  const [aiTlsSkip, setAiTlsSkip] = useState<boolean>(false);
  const [aiAuthType, setAiAuthType] = useState<ApiAuthConfig['type']>('none');
  const [aiBearerToken, setAiBearerToken] = useState<string>('');
  const [aiHeaderName, setAiHeaderName] = useState<string>('x-api-key');
  const [aiSystemPrompt, setAiSystemPrompt] = useState<string>('You are a concise security engineering assistant.');
  const [aiTemperature, setAiTemperature] = useState<number>(0.2);
  const [aiStreamEnabled, setAiStreamEnabled] = useState<boolean>(true);
  const [aiPromptInput, setAiPromptInput] = useState<string>('');
  const [aiMessages, setAiMessages] = useState<ApiAiChatMessage[]>([]);
  const [aiStreamingText, setAiStreamingText] = useState<string>('');
  const [aiStreamingId, setAiStreamingId] = useState<string>('');
  const [aiLastResult, setAiLastResult] = useState<ApiAiChatResult | null>(null);

  const loadWorkspaceData = useCallback(async () => {
    const api = getApiBindings();
    if (!api) return;
    try {
      const [reqs, envs, rts, creds] = await Promise.all([
        api.ListApiRequests?.(activeEngagementId || '') ?? Promise.resolve([]),
        api.ListApiEnvironments?.(activeEngagementId || '') ?? Promise.resolve([]),
        api.ListApiRoutes?.() ?? Promise.resolve([{ id: '', label: 'Direct (No Proxy)', kind: 'direct', active: true }]),
        api.ListCredentials?.(activeEngagementId || '', '') ?? Promise.resolve([]),
      ]);
      setSavedRequests(reqs || []);
      setEnvironments(envs || []);
      setRoutes(rts && rts.length > 0 ? rts : [{ id: '', label: 'Direct (No Proxy)', kind: 'direct', active: true }]);
      setCredentials(creds || []);
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  }, [activeEngagementId]);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  // Open incoming draft from external tools such as the Binary / Hex Payload Runner (F-43 -> F-42)
  const consumedDraftIdRef = useRef<string>('');
  useEffect(() => {
    if (!externalDraft || externalDraft.id === consumedDraftIdRef.current) return;
    consumedDraftIdRef.current = externalDraft.id;
    setMode('repeater');
    setReqSubTab('body');
    setReqTabs((prev) => {
      const next = [...prev, externalDraft];
      setActiveTabIdx(next.length - 1);
      return next;
    });
    setCurrentResponse(null);
    setStatusBanner(`Loaded "${externalDraft.name}" (${externalDraft.bodyType}) from Hex Runner.`);
    onExternalDraftConsumed?.();
  }, [externalDraft, onExternalDraftConsumed]);

  // Listen to real-time AI SSE/NDJSON streaming chunks emitted by Go
  useEffect(() => {
    if (!eventsOn) return;
    const unsubChunk = eventsOn('api:ai-chunk', (rawEv: unknown) => {
      const ev = rawEv as ApiAiStreamChunkEvent;
      if (!ev || ev.streamId !== aiStreamingId) return;
      if (ev.delta) {
        setAiStreamingText((prev) => prev + ev.delta);
      }
      if (ev.error) {
        setErrorBanner(ev.error);
      }
    });
    return () => {
      unsubChunk?.();
    };
  }, [eventsOn, aiStreamingId]);

  const updateActiveReq = (partial: Partial<ApiRequestItem>) => {
    setReqTabs((prev) =>
      prev.map((tab, idx) => (idx === activeTabIdx ? { ...tab, ...partial } : tab))
    );
  };

  const activeEnv = useMemo(
    () => environments.find((e) => e.id === activeEnvId) || null,
    [environments, activeEnvId]
  );

  const handleSendRequest = async () => {
    const api = getApiBindings();
    if (!api?.ExecuteApiRequest) {
      setErrorBanner('API execution backend unavailable.');
      return;
    }
    setErrorBanner('');
    setStatusBanner('');
    setIsSending(true);
    const execId = `exec-${Date.now()}`;
    activeExecIdRef.current = execId;
    try {
      const resp = await api.ExecuteApiRequest({
        executionId: execId,
        sessionId: activeEngagementId || 'global',
        envId: activeEnvId,
        request: activeReq,
        variables: activeEnv?.variables || [],
      });
      setCurrentResponse(resp);
      const entry: ApiHistoryEntry = {
        id: `hist-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString(),
        request: { ...activeReq },
        response: resp,
      };
      setHistory((prev) => [entry, ...prev].slice(0, 60));
      if (!diffLeftId) {
        setDiffLeftId(entry.id);
      } else if (!diffRightId) {
        setDiffRightId(entry.id);
      }
      if (resp.error) {
        setErrorBanner(resp.error);
      }
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSending(false);
      activeExecIdRef.current = '';
    }
  };

  const handleCancelActive = async () => {
    const api = getApiBindings();
    if (activeExecIdRef.current && api?.CancelApiExecution) {
      await api.CancelApiExecution(activeExecIdRef.current);
    }
    setIsSending(false);
    setReplayRunning(false);
  };

  const handleSaveRequestToVault = async () => {
    const api = getApiBindings();
    if (!api?.SaveApiRequest) return;
    setErrorBanner('');
    try {
      const saved = await api.SaveApiRequest({
        ...activeReq,
        engagementId: activeReq.engagementId ?? (activeEngagementId || ''),
        name: activeReq.name.trim() || `${activeReq.method} ${activeReq.url}`,
      });
      updateActiveReq(saved);
      setStatusBanner(`Saved "${saved.name}" to Encrypted Vault.`);
      await loadWorkspaceData();
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeleteSavedRequest = async (id: string) => {
    const api = getApiBindings();
    if (!api?.DeleteApiRequest) return;
    try {
      await api.DeleteApiRequest(id);
      setStatusBanner('Deleted request from collection.');
      await loadWorkspaceData();
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleImportSubmit = async () => {
    const api = getApiBindings();
    if (!api) return;
    setErrorBanner('');
    try {
      if (importKind === 'curl' && api.ParseApiCurl) {
        const parsed = await api.ParseApiCurl(importText);
        const withId = { ...parsed, id: `req-${Date.now()}`, engagementId: activeEngagementId || '' };
        setReqTabs((prev) => [...prev, withId]);
        setActiveTabIdx(reqTabs.length);
        setShowImportModal(false);
        setImportText('');
        setMode('repeater');
        setStatusBanner(`Imported "${withId.name}" into new Repeater tab.`);
      } else if (importKind === 'openapi' && api.ImportOpenAPISpec) {
        const items = await api.ImportOpenAPISpec(importText, activeEngagementId || '', importCollectionName);
        if (api.SaveApiRequest) {
          for (const item of items) {
            await api.SaveApiRequest(item);
          }
        }
        setShowImportModal(false);
        setImportText('');
        setSidebarTab('collections');
        await loadWorkspaceData();
        setStatusBanner(`Imported ${items.length} endpoint(s) from OpenAPI specification.`);
      }
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleGenerateSnippet = async (lang: 'curl' | 'powershell' | 'python') => {
    const api = getApiBindings();
    if (!api?.GenerateApiCodeSnippet) return;
    try {
      const code = await api.GenerateApiCodeSnippet(activeReq, lang, false);
      setSnippetPreview({ lang, code });
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRunInspector = async (inputVal?: string, fmt?: string) => {
    const api = getApiBindings();
    if (!api?.InspectApiPayload) return;
    const text = inputVal ?? inspectorInput;
    const modeFmt = fmt ?? inspectorFormat;
    try {
      const res = await api.InspectApiPayload(text, modeFmt);
      setInspectorResult(res);
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExtractJsonVar = async () => {
    if (!currentResponse || !extractVarName.trim() || !extractJsonKey.trim()) return;
    try {
      const parsed = JSON.parse(currentResponse.body) as Record<string, unknown>;
      const parts = extractJsonKey.trim().split('.');
      let cur: unknown = parsed;
      for (const p of parts) {
        if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[p];
        } else {
          cur = undefined;
          break;
        }
      }
      if (cur === undefined) {
        setErrorBanner(`JSON key path "${extractJsonKey}" not found in response.`);
        return;
      }
      const valStr = typeof cur === 'string' ? cur : JSON.stringify(cur);
      const api = getApiBindings();
      const targetEnv: ApiEnvironment = activeEnv
        ? { ...activeEnv }
        : {
            id: `api-env-${Date.now()}`,
            engagementId: activeEngagementId || '',
            name: activeEngagementName ? `${activeEngagementName} Env` : 'Engagement Env',
            variables: [],
          };
      const existingVars = [...(targetEnv.variables || [])];
      const idx = existingVars.findIndex((v) => v.key === extractVarName.trim());
      if (idx >= 0) {
        existingVars[idx] = { ...existingVars[idx], value: valStr, enabled: true };
      } else {
        existingVars.push({ key: extractVarName.trim(), value: valStr, enabled: true });
      }
      targetEnv.variables = existingVars;
      if (api?.SaveApiEnvironment) {
        const saved = await api.SaveApiEnvironment(targetEnv);
        setActiveEnvId(saved.id);
        await loadWorkspaceData();
      }
      setStatusBanner(`Extracted {{${extractVarName.trim()}}} into environment "${targetEnv.name}".`);
      setExtractVarName('');
      setExtractJsonKey('');
    } catch {
      setErrorBanner('Response body is not valid JSON for extraction.');
    }
  };

  const handleRunReplay = async () => {
    const api = getApiBindings();
    if (!api?.ExecuteApiParameterReplay) return;
    const payloads = replayPayloadsText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (payloads.length === 0) {
      setErrorBanner('Enter at least one payload line.');
      return;
    }
    setErrorBanner('');
    setReplayRunning(true);
    const execId = `replay-${Date.now()}`;
    activeExecIdRef.current = execId;
    try {
      const res = await api.ExecuteApiParameterReplay({
        executionId: execId,
        sessionId: activeEngagementId || 'global',
        engagementId: activeEngagementId || '',
        envId: activeEnvId,
        request: activeReq,
        variables: activeEnv?.variables || [],
        payloads,
        delayMs: replayDelayMs,
      });
      setReplayResult(res);
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setReplayRunning(false);
      activeExecIdRef.current = '';
    }
  };

  const handleComputeDiff = async () => {
    const api = getApiBindings();
    const left = history.find((h) => h.id === diffLeftId);
    const right = history.find((h) => h.id === diffRightId);
    if (!left || !right || !api?.DiffApiResponses) return;
    try {
      const d = await api.DiffApiResponses(left.response, right.response);
      setDiffResult(d);
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSendAiPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    const api = getApiBindings();
    if (!api?.ExecuteApiAiChat || !aiPromptInput.trim()) return;

    const userMsg: ApiAiChatMessage = { role: 'user', content: aiPromptInput.trim() };
    const nextHistory = [...aiMessages, userMsg];
    const reqMessages: ApiAiChatMessage[] = aiSystemPrompt.trim()
      ? [{ role: 'system', content: aiSystemPrompt.trim() }, ...nextHistory]
      : nextHistory;

    const streamId = `ai-${Date.now()}`;
    activeExecIdRef.current = streamId;
    setAiStreamingId(streamId);
    setAiStreamingText('');
    setAiMessages(nextHistory);
    setAiPromptInput('');
    setErrorBanner('');
    setIsSending(true);

    try {
      const auth: ApiAuthConfig = {
        type: aiAuthType,
        token: aiAuthType === 'bearer' ? aiBearerToken : undefined,
        headerName: aiAuthType === 'header' ? aiHeaderName : undefined,
        headerValue: aiAuthType === 'header' ? aiBearerToken : undefined,
      };
      const res = await api.ExecuteApiAiChat({
        streamId,
        provider: aiProvider,
        endpointUrl: aiEndpoint.trim(),
        model: aiModel.trim(),
        auth,
        routeId: aiRouteId,
        tlsSkipVerify: aiTlsSkip,
        temperature: aiTemperature,
        messages: reqMessages,
        stream: aiStreamEnabled,
        timeoutSec: 90,
      });
      setAiLastResult(res);
      if (res.error) {
        setErrorBanner(res.error);
      } else if (res.reply) {
        setAiMessages((prev) => [...prev, { role: 'assistant', content: res.reply }]);
      }
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSending(false);
      setAiStreamingId('');
      setAiStreamingText('');
      activeExecIdRef.current = '';
    }
  };

  const handleOpenAiInRepeater = () => {
    if (!aiLastResult?.rawRequestJson) return;
    const importedReq: ApiRequestItem = {
      ...createBlankRequest(activeEngagementId),
      id: `req-${Date.now()}`,
      name: `AI (${aiProvider})`,
      method: 'POST',
      url: aiEndpoint,
      headers: [
        { key: 'Content-Type', value: 'application/json', enabled: true },
        ...(aiProvider === 'anthropic' ? [{ key: 'anthropic-version', value: '2023-06-01', enabled: true }] : []),
      ],
      auth: {
        type: aiAuthType,
        token: aiAuthType === 'bearer' ? aiBearerToken : undefined,
        headerName: aiAuthType === 'header' ? aiHeaderName : undefined,
        headerValue: aiAuthType === 'header' ? aiBearerToken : undefined,
      },
      bodyType: 'json',
      body: aiLastResult.rawRequestJson,
      routeId: aiRouteId,
      tlsSkipVerify: aiTlsSkip,
    };
    setReqTabs((prev) => [...prev, importedReq]);
    setActiveTabIdx(reqTabs.length);
    setReqSubTab('body');
    setMode('repeater');
  };

  const handleSaveEvidence = async () => {
    if (!onSaveToEvidence) return;
    if (mode === 'ai-chat' && aiMessages.length > 0) {
      const md = aiMessages
        .map((m) => `### ${m.role.toUpperCase()}\n${m.content}`)
        .join('\n\n');
      await onSaveToEvidence(`AI Endpoint Probe (${aiEndpoint})`, 'Web', md);
      setStatusBanner('Saved AI exchange to Evidence Vault.');
      return;
    }
    if (!currentResponse) return;
    const reqBlock = activeReq.rawMode
      ? activeReq.rawRequest || ''
      : buildRawWireFromRequest(activeReq);
    const md = [
      `**Target:** \`${activeReq.method} ${currentResponse.effectiveUrl || activeReq.url}\``,
      `**Route:** \`${currentResponse.routeUsed || 'Direct'}\` · **Status:** \`${currentResponse.status}\` · **Size:** \`${currentResponse.sizeBytes} B\``,
      '',
      '#### Request',
      '```http',
      reqBlock,
      '```',
      '',
      '#### Response',
      '```http',
      `${currentResponse.proto || 'HTTP/1.1'} ${currentResponse.status}\n${currentResponse.rawHeaders || ''}\n\n${currentResponse.body.slice(0, 8000)}`,
      '```',
    ].join('\n');
    await onSaveToEvidence(`API ${activeReq.method} ${activeReq.url}`, 'Web', md);
    setStatusBanner('Saved HTTP exchange to Evidence Vault.');
  };

  const handleSaveNotes = async () => {
    if (!onSaveToNotes || !currentResponse) return;
    const md = `## ${activeReq.method} ${currentResponse.effectiveUrl || activeReq.url}\n- **Status:** ${currentResponse.status}\n- **Time:** ${currentResponse.timing.totalMs}ms\n\n\`\`\`json\n${currentResponse.body.slice(0, 6000)}\n\`\`\``;
    await onSaveToNotes(`API: ${activeReq.name}`, md);
    setStatusBanner('Saved HTTP response to Host Notes.');
  };

  const filteredSaved = useMemo(() => {
    const q = sidebarFilter.trim().toLowerCase();
    if (!q) return savedRequests;
    return savedRequests.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.url.toLowerCase().includes(q) ||
        (r.collectionName || '').toLowerCase().includes(q)
    );
  }, [savedRequests, sidebarFilter]);

  return (
    <div
      className="api-tester-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        background: 'var(--bg-main)',
        color: 'var(--text-main)',
        overflow: 'hidden',
      }}
    >
      {/* Top HUD Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.6rem',
          padding: '0.5rem 0.85rem',
          borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 28%, transparent)',
          background: 'rgba(6, 12, 22, 0.92)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-bright)', fontWeight: 700, fontSize: '0.88rem', fontFamily: 'JetBrains Mono, monospace' }}>
            <CyberIcon name="globe" size={15} />
            <span>API TESTER &amp; REPEATER</span>
          </span>

          <div style={{ display: 'flex', gap: '0.25rem' }} role="tablist" aria-label="API Tester Mode">
            {(
              [
                { id: 'repeater', label: 'HTTP Repeater', icon: 'bolt' },
                { id: 'replay', label: 'Param Replay', icon: 'refresh' },
                { id: 'diff', label: 'Response Diff', icon: 'compare' },
                { id: 'ai-chat', label: 'AI Chat Mode', icon: 'rocket' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                className={`cyber-hud-btn btn-sm ${mode === m.id ? 'btn-primary' : ''}`}
                onClick={() => setMode(m.id)}
              >
                <CyberIcon name={m.icon === 'compare' ? 'arrow-left-right' : m.icon} size={12} />
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          <select
            aria-label="Active Environment"
            className="cyber-input"
            style={{ fontSize: '0.74rem', padding: '0.25rem 0.5rem', width: 'auto' }}
            value={activeEnvId}
            onChange={(e) => setActiveEnvId(e.target.value)}
          >
            <option value="">Env: None</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                Env: {env.name} ({env.variables?.length || 0})
              </option>
            ))}
          </select>

          <button
            type="button"
            className="cyber-hud-btn btn-sm"
            onClick={() => {
              setEditingEnv(
                activeEnv
                  ? { ...activeEnv }
                  : {
                      id: '',
                      engagementId: activeEngagementId || '',
                      name: activeEngagementName ? `${activeEngagementName} Env` : 'Engagement Env',
                      variables: [{ key: 'BASE_URL', value: 'https://target.local', enabled: true }],
                    }
              );
              setShowEnvEditor(true);
            }}
          >
            <CyberIcon name="gear" size={12} />
            <span>Env Vars</span>
          </button>

          <button
            type="button"
            className="cyber-hud-btn btn-sm"
            onClick={() => setShowImportModal(true)}
          >
            <CyberIcon name="upload" size={12} />
            <span>Import cURL / OpenAPI</span>
          </button>

          {onSaveToEvidence && (
            <button type="button" className="cyber-hud-btn btn-sm" onClick={() => void handleSaveEvidence()}>
              <CyberIcon name="shield" size={12} />
              <span>Save Evidence</span>
            </button>
          )}

          {onClose && (
            <button type="button" className="cyber-hud-btn btn-sm btn-danger" onClick={onClose} aria-label="Close API Tester">
              Close
            </button>
          )}
        </div>
      </div>

      {/* Banners */}
      {(statusBanner || errorBanner) && (
        <div
          style={{
            padding: '0.35rem 0.85rem',
            fontSize: '0.75rem',
            fontFamily: 'JetBrains Mono, monospace',
            background: errorBanner ? 'rgba(239, 68, 68, 0.12)' : 'color-mix(in srgb, var(--accent-bright) 12%, transparent)',
            borderBottom: `1px solid ${errorBanner ? 'rgba(239, 68, 68, 0.4)' : 'color-mix(in srgb, var(--accent-bright) 30%, transparent)'}`,
            color: errorBanner ? '#fca5a5' : 'var(--accent-bright)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{errorBanner || statusBanner}</span>
          <button
            type="button"
            className="cyber-btn-secondary"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'inherit' }}
            onClick={() => {
              setStatusBanner('');
              setErrorBanner('');
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Body Layout: Collections/History Sidebar + Mode Workspace */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* Left Collections & History Drawer */}
        <aside
          style={{
            width: '260px',
            flexShrink: 0,
            borderRight: '1px solid color-mix(in srgb, var(--accent-bright) 22%, transparent)',
            display: 'flex',
            flexDirection: 'column',
            background: 'rgba(4, 9, 18, 0.88)',
          }}
        >
          <div style={{ display: 'flex', borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 18%, transparent)' }}>
            <button
              type="button"
              className={`settings-tab-btn ${sidebarTab === 'collections' ? 'active' : ''}`}
              style={{ flex: 1, fontSize: '0.74rem' }}
              onClick={() => setSidebarTab('collections')}
            >
              Saved ({savedRequests.length})
            </button>
            <button
              type="button"
              className={`settings-tab-btn ${sidebarTab === 'history' ? 'active' : ''}`}
              style={{ flex: 1, fontSize: '0.74rem' }}
              onClick={() => setSidebarTab('history')}
            >
              History ({history.length})
            </button>
          </div>

          <div style={{ padding: '0.45rem', display: 'flex', gap: '0.35rem' }}>
            <input
              type="text"
              className="cyber-input"
              style={{ fontSize: '0.74rem', padding: '0.28rem 0.45rem', flex: 1 }}
              placeholder={sidebarTab === 'collections' ? 'Filter saved requests...' : 'Filter history...'}
              value={sidebarFilter}
              onChange={(e) => setSidebarFilter(e.target.value)}
            />
            <button
              type="button"
              className="cyber-hud-btn btn-sm"
              title="New Repeater Tab"
              onClick={() => {
                setReqTabs((prev) => [...prev, createBlankRequest(activeEngagementId)]);
                setActiveTabIdx(reqTabs.length);
                setMode('repeater');
              }}
            >
              <CyberIcon name="plus" size={12} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0 0.45rem 0.5rem' }}>
            {sidebarTab === 'collections' ? (
              filteredSaved.length === 0 ? (
                <div style={{ padding: '0.75rem', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  No saved requests yet. Configure a request and click Save, or import OpenAPI/cURL.
                </div>
              ) : (
                filteredSaved.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.35rem',
                      padding: '0.38rem 0.45rem',
                      marginBottom: '0.25rem',
                      border: '1px solid color-mix(in srgb, var(--accent-bright) 16%, transparent)',
                      background: activeReq.id === item.id ? 'color-mix(in srgb, var(--accent-bright) 12%, transparent)' : 'rgba(8, 14, 26, 0.7)',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      updateActiveReq({ ...item });
                      setMode('repeater');
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-bright)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ color: 'var(--accent-bright)', marginRight: '0.35rem', fontFamily: 'JetBrains Mono, monospace' }}>
                          {item.method}
                        </span>
                        {item.name}
                      </div>
                      <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.collectionName || 'General'} · {item.url}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="cyber-hud-btn btn-sm btn-danger"
                      title="Delete saved request"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        void handleDeleteSavedRequest(item.id);
                      }}
                    >
                      <CyberIcon name="trash" size={11} />
                    </button>
                  </div>
                ))
              )
            ) : history.length === 0 ? (
              <div style={{ padding: '0.75rem', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                Sent requests will appear here for replay and response comparison.
              </div>
            ) : (
              history
                .filter(
                  (h) =>
                    !sidebarFilter.trim() ||
                    h.request.url.toLowerCase().includes(sidebarFilter.toLowerCase()) ||
                    String(h.response.statusCode).includes(sidebarFilter)
                )
                .map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      padding: '0.38rem 0.45rem',
                      marginBottom: '0.25rem',
                      border: '1px solid color-mix(in srgb, var(--accent-bright) 16%, transparent)',
                      background: 'rgba(8, 14, 26, 0.7)',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      updateActiveReq({ ...entry.request });
                      setCurrentResponse(entry.response);
                      setMode('repeater');
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', fontFamily: 'JetBrains Mono, monospace' }}>
                      <span style={{ color: statusBadgeColor(entry.response.statusCode), fontWeight: 700 }}>
                        {entry.response.statusCode || 'ERR'} {entry.request.method}
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>{entry.response.timing.totalMs}ms</span>
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {entry.request.url}
                    </div>
                    <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.25rem' }}>
                      <button
                        type="button"
                        className="cyber-hud-btn btn-sm"
                        style={{ fontSize: '0.62rem', padding: '1px 5px' }}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setDiffLeftId(entry.id);
                          setStatusBanner(`Pinned "${entry.request.method} ${entry.request.url}" as Diff A.`);
                        }}
                      >
                        Diff A
                      </button>
                      <button
                        type="button"
                        className="cyber-hud-btn btn-sm"
                        style={{ fontSize: '0.62rem', padding: '1px 5px' }}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setDiffRightId(entry.id);
                          setMode('diff');
                        }}
                      >
                        Diff B
                      </button>
                    </div>
                  </div>
                ))
            )}
          </div>
        </aside>

        {/* Main Active Mode Workspace */}
        <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Mode 1: HTTP Repeater */}
          {mode === 'repeater' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {/* Inner Repeater Tab Strip */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.35rem 0.65rem', borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 15%, transparent)', overflowX: 'auto' }}>
                {reqTabs.map((t, idx) => (
                  <button
                    key={`${t.id}-${idx}`}
                    type="button"
                    className={`cyber-hud-btn btn-sm ${idx === activeTabIdx ? 'btn-primary' : ''}`}
                    onClick={() => setActiveTabIdx(idx)}
                  >
                    <span>{t.method} · {t.name || t.url}</span>
                    {reqTabs.length > 1 && (
                      <span
                        style={{ marginLeft: '0.35rem' }}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          const next = reqTabs.filter((_, i) => i !== idx);
                          setReqTabs(next);
                          setActiveTabIdx(Math.max(0, Math.min(activeTabIdx, next.length - 1)));
                        }}
                      >
                        ×
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* URL / Method / Route Action Bar */}
              <div style={{ display: 'flex', gap: '0.45rem', padding: '0.55rem 0.75rem', alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 15%, transparent)' }}>
                <select
                  aria-label="HTTP Method"
                  className="cyber-input"
                  style={{ width: '105px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}
                  value={activeReq.method}
                  onChange={(e) => updateActiveReq({ method: e.target.value })}
                >
                  {HTTP_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>

                <input
                  aria-label="Request URL"
                  type="text"
                  className="cyber-input"
                  style={{ flex: 1, minWidth: '220px', fontFamily: 'JetBrains Mono, monospace' }}
                  placeholder="https://api.target.local/v1/users/{{USER_ID}}"
                  value={activeReq.url}
                  onChange={(e) => updateActiveReq({ url: e.target.value })}
                />

                <select
                  aria-label="Outbound Route or Pivot"
                  className="cyber-input"
                  style={{ width: '210px', fontSize: '0.74rem' }}
                  value={activeReq.routeId || ''}
                  onChange={(e) => updateActiveReq({ routeId: e.target.value })}
                >
                  {routes.map((rt) => (
                    <option key={rt.id || 'direct'} value={rt.id}>
                      {rt.label}
                    </option>
                  ))}
                </select>

                {isSending ? (
                  <button type="button" className="cyber-hud-btn btn-danger" onClick={() => void handleCancelActive()}>
                    Cancel
                  </button>
                ) : (
                  <button type="button" className="cyber-btn cyber-btn-primary" onClick={() => void handleSendRequest()}>
                    <CyberIcon name="bolt" size={13} />
                    <span>Send</span>
                  </button>
                )}

                <button type="button" className="cyber-hud-btn" onClick={() => void handleSaveRequestToVault()}>
                  <CyberIcon name="check" size={13} />
                  <span>Save</span>
                </button>
              </div>

              {/* Secondary Controls Row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.35rem 0.75rem', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.73rem', borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 14%, transparent)', background: 'rgba(5, 10, 18, 0.7)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <input
                    aria-label="Request Name"
                    type="text"
                    className="cyber-input"
                    style={{ width: '170px', fontSize: '0.72rem', padding: '0.2rem 0.45rem' }}
                    value={activeReq.name}
                    onChange={(e) => updateActiveReq({ name: e.target.value })}
                    placeholder="Request Name"
                  />

                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(activeReq.rawMode)}
                      onChange={(e) => {
                        const nextRaw = e.target.checked;
                        updateActiveReq({
                          rawMode: nextRaw,
                          rawRequest: nextRaw && !activeReq.rawRequest ? buildRawWireFromRequest(activeReq) : activeReq.rawRequest,
                        });
                      }}
                    />
                    <span>Raw HTTP Mode</span>
                  </label>

                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(activeReq.tlsSkipVerify)}
                      onChange={(e) => updateActiveReq({ tlsSkipVerify: e.target.checked })}
                    />
                    <span>Skip TLS Verify</span>
                  </label>

                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={activeReq.followRedirects}
                      onChange={(e) => updateActiveReq({ followRedirects: e.target.checked })}
                    />
                    <span>Follow Redirects</span>
                  </label>

                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={activeReq.useCookieJar}
                      onChange={(e) => updateActiveReq({ useCookieJar: e.target.checked })}
                    />
                    <span>Cookie Jar</span>
                  </label>
                </div>

                <div style={{ display: 'flex', gap: '0.3rem' }}>
                  <button type="button" className="cyber-hud-btn btn-sm" onClick={() => void handleGenerateSnippet('curl')}>
                    cURL
                  </button>
                  <button type="button" className="cyber-hud-btn btn-sm" onClick={() => void handleGenerateSnippet('powershell')}>
                    PowerShell
                  </button>
                  <button type="button" className="cyber-hud-btn btn-sm" onClick={() => void handleGenerateSnippet('python')}>
                    Python
                  </button>
                </div>
              </div>

              {/* Split Request / Response Area */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {/* Left: Request Builder or Raw HTTP */}
                <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid color-mix(in srgb, var(--accent-bright) 18%, transparent)', minHeight: 0, overflow: 'hidden' }}>
                  {activeReq.rawMode ? (
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '0.55rem' }}>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Raw HTTP/1.1 Wire Request (supports &#123;&#123;VAR&#125;&#125; &amp; &#123;&#123;SECRET:id&#125;&#125;)</span>
                        <button
                          type="button"
                          className="cyber-hud-btn btn-sm"
                          onClick={() => updateActiveReq({ rawRequest: buildRawWireFromRequest(activeReq) })}
                        >
                          Sync from Structured
                        </button>
                      </div>
                      <textarea
                        aria-label="Raw HTTP Request"
                        className="cyber-textarea font-mono"
                        style={{ flex: 1, minHeight: 0, fontSize: '0.76rem' }}
                        value={activeReq.rawRequest || ''}
                        onChange={(e) => updateActiveReq({ rawRequest: e.target.value })}
                      />
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 15%, transparent)' }}>
                        {(['params', 'headers', 'auth', 'body'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            className={`settings-tab-btn ${reqSubTab === t ? 'active' : ''}`}
                            style={{ fontSize: '0.73rem', textTransform: 'capitalize' }}
                            onClick={() => setReqSubTab(t)}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                      <div style={{ flex: 1, overflowY: 'auto', padding: '0.6rem' }}>
                        {reqSubTab === 'params' && (
                          <KeyValueEditor
                            items={activeReq.params || []}
                            keyPlaceholder="Query key"
                            valuePlaceholder="Value or {{VAR}}"
                            onChange={(params) => updateActiveReq({ params })}
                          />
                        )}
                        {reqSubTab === 'headers' && (
                          <KeyValueEditor
                            items={activeReq.headers || []}
                            keyPlaceholder="Header name"
                            valuePlaceholder="Header value"
                            onChange={(headers) => updateActiveReq({ headers })}
                          />
                        )}
                        {reqSubTab === 'auth' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', fontSize: '0.76rem' }}>
                            <select
                              aria-label="Auth Type"
                              className="cyber-input"
                              value={activeReq.auth.type}
                              onChange={(e) =>
                                updateActiveReq({
                                  auth: { ...activeReq.auth, type: e.target.value as ApiAuthConfig['type'] },
                                })
                              }
                            >
                              <option value="none">No Auth</option>
                              <option value="bearer">Bearer Token (supports &#123;&#123;SECRET:id&#125;&#125;)</option>
                              <option value="basic">Basic Auth</option>
                              <option value="header">Custom Auth Header</option>
                              <option value="vault">Vault Credential / Identity</option>
                            </select>

                            {activeReq.auth.type === 'bearer' && (
                              <input
                                type="text"
                                className="cyber-input"
                                placeholder="Token or {{SECRET:api-key}}"
                                value={activeReq.auth.token || ''}
                                onChange={(e) =>
                                  updateActiveReq({ auth: { ...activeReq.auth, token: e.target.value } })
                                }
                              />
                            )}
                            {activeReq.auth.type === 'basic' && (
                              <>
                                <input
                                  type="text"
                                  className="cyber-input"
                                  placeholder="Username"
                                  value={activeReq.auth.username || ''}
                                  onChange={(e) =>
                                    updateActiveReq({ auth: { ...activeReq.auth, username: e.target.value } })
                                  }
                                />
                                <input
                                  type="password"
                                  className="cyber-input"
                                  placeholder="Password or {{SECRET:id}}"
                                  value={activeReq.auth.password || ''}
                                  onChange={(e) =>
                                    updateActiveReq({ auth: { ...activeReq.auth, password: e.target.value } })
                                  }
                                />
                              </>
                            )}
                            {activeReq.auth.type === 'header' && (
                              <>
                                <input
                                  type="text"
                                  className="cyber-input"
                                  placeholder="Header Name (e.g. X-API-Key)"
                                  value={activeReq.auth.headerName || ''}
                                  onChange={(e) =>
                                    updateActiveReq({ auth: { ...activeReq.auth, headerName: e.target.value } })
                                  }
                                />
                                <input
                                  type="text"
                                  className="cyber-input"
                                  placeholder="Header Value or {{SECRET:id}}"
                                  value={activeReq.auth.headerValue || ''}
                                  onChange={(e) =>
                                    updateActiveReq({ auth: { ...activeReq.auth, headerValue: e.target.value } })
                                  }
                                />
                              </>
                            )}
                            {activeReq.auth.type === 'vault' && (
                              <>
                                <select
                                  aria-label="Vault Credential"
                                  className="cyber-input"
                                  value={activeReq.auth.credentialId || ''}
                                  onChange={(e) =>
                                    updateActiveReq({
                                      auth: { ...activeReq.auth, credentialId: e.target.value, identityId: '' },
                                    })
                                  }
                                >
                                  <option value="">-- Select Credential Pool Entry --</option>
                                  {credentials.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.label} ({c.username || c.category})
                                    </option>
                                  ))}
                                </select>
                                <select
                                  aria-label="Vault Identity"
                                  className="cyber-input"
                                  value={activeReq.auth.identityId || ''}
                                  onChange={(e) =>
                                    updateActiveReq({
                                      auth: { ...activeReq.auth, identityId: e.target.value, credentialId: '' },
                                    })
                                  }
                                >
                                  <option value="">-- Or Select SSH Identity --</option>
                                  {identities.map((id) => (
                                    <option key={id.id} value={id.id}>
                                      {id.label} ({id.username})
                                    </option>
                                  ))}
                                </select>
                              </>
                            )}
                          </div>
                        )}
                        {reqSubTab === 'body' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', height: '100%' }}>
                            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                              <select
                                aria-label="Body Type"
                                className="cyber-input"
                                style={{ width: '160px', fontSize: '0.73rem' }}
                                value={activeReq.bodyType}
                                onChange={(e) =>
                                  updateActiveReq({ bodyType: e.target.value as ApiRequestItem['bodyType'] })
                                }
                              >
                                <option value="none">none</option>
                                <option value="json">application/json</option>
                                <option value="form">x-www-form-urlencoded</option>
                                <option value="raw">raw text</option>
                                <option value="hex">hex / binary (raw bytes)</option>
                              </select>
                              {activeReq.bodyType === 'json' && (
                                <button
                                  type="button"
                                  className="cyber-hud-btn btn-sm"
                                  onClick={() => updateActiveReq({ body: formatJsonIfPossible(activeReq.body || '') })}
                                >
                                  Pretty JSON
                                </button>
                              )}
                              {activeReq.bodyType === 'hex' && (
                                <span style={{ fontSize: '0.68rem', color: 'var(--accent-soft)' }}>
                                  Exact binary bytes sent (supports 41 00 ff, \x90, u32le(...), A*32)
                                </span>
                              )}
                            </div>
                            {activeReq.bodyType !== 'none' && (
                              <textarea
                                aria-label="Request Body"
                                className="cyber-textarea font-mono"
                                style={{ flex: 1, minHeight: '180px', fontSize: '0.76rem' }}
                                placeholder={
                                  activeReq.bodyType === 'hex'
                                    ? 'e.g. 41 42 00 ff \\x90*16 u32le(0xdeadbeef)'
                                    : '{"query":"{{VAR}}"}'
                                }
                                value={activeReq.body || ''}
                                onChange={(e) => updateActiveReq({ body: e.target.value })}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Right: Response Viewer + Inspector */}
                <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0.6rem', borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 15%, transparent)', flexWrap: 'wrap', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', gap: '0.2rem' }}>
                      {(['pretty', 'raw', 'headers', 'tls', 'cookies', 'inspector'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={`settings-tab-btn ${respSubTab === t ? 'active' : ''}`}
                          style={{ fontSize: '0.71rem', padding: '0.22rem 0.5rem', textTransform: 'uppercase' }}
                          onClick={() => setRespSubTab(t)}
                        >
                          {t}
                        </button>
                      ))}
                    </div>

                    {currentResponse && (
                      <div style={{ display: 'flex', gap: '0.55rem', fontSize: '0.72rem', fontFamily: 'JetBrains Mono, monospace', alignItems: 'center' }}>
                        <span style={{ color: statusBadgeColor(currentResponse.statusCode), fontWeight: 700 }}>
                          {currentResponse.status || (currentResponse.statusCode ? `${currentResponse.statusCode}` : 'ERR')}
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>{currentResponse.timing.totalMs}ms</span>
                        <span style={{ color: 'var(--text-muted)' }}>{currentResponse.sizeBytes} B</span>
                        {currentResponse.truncated && <span style={{ color: '#fbbf24' }}>TRUNCATED</span>}
                      </div>
                    )}
                  </div>

                  <div style={{ flex: 1, overflowY: 'auto', padding: '0.6rem' }}>
                    {respSubTab === 'inspector' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <select
                            aria-label="Inspector Format"
                            className="cyber-input"
                            style={{ width: '160px', fontSize: '0.74rem' }}
                            value={inspectorFormat}
                            onChange={(e) => setInspectorFormat(e.target.value)}
                          >
                            <option value="auto">Auto-Detect (JWT/URL/B64)</option>
                            <option value="jwt">JWT Decode</option>
                            <option value="base64">Base64 Decode</option>
                            <option value="base64-encode">Base64 Encode</option>
                            <option value="url">URL Decode</option>
                            <option value="url-encode">URL Encode</option>
                            <option value="hex">Hex Decode</option>
                            <option value="html">HTML Unescape</option>
                          </select>
                          <button type="button" className="cyber-hud-btn btn-sm btn-primary" onClick={() => void handleRunInspector()}>
                            Decode / Inspect
                          </button>
                        </div>
                        <textarea
                          aria-label="Inspector Input"
                          className="cyber-textarea font-mono"
                          rows={4}
                          placeholder="Paste JWT, Base64, URL-encoded token, or Hex string..."
                          value={inspectorInput}
                          onChange={(e) => setInspectorInput(e.target.value)}
                        />
                        {inspectorResult && (
                          <pre
                            className="font-mono"
                            style={{
                              margin: 0,
                              padding: '0.6rem',
                              background: 'rgba(2, 6, 14, 0.9)',
                              border: '1px solid color-mix(in srgb, var(--accent-bright) 22%, transparent)',
                              fontSize: '0.74rem',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {inspectorResult.error
                              ? `Error: ${inspectorResult.error}`
                              : `${inspectorResult.jwtAlg ? `[JWT alg=${inspectorResult.jwtAlg} expired=${String(inspectorResult.jwtExpired)}]\n` : ''}${inspectorResult.decoded}`}
                          </pre>
                        )}
                      </div>
                    ) : !currentResponse ? (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                        Hit <strong>Send</strong> to execute the request through the Go engine and inspect headers, JSON body, TLS certificates, or JWT tokens.
                      </div>
                    ) : (
                      <>
                        {respSubTab === 'pretty' && (
                          <pre
                            className="font-mono"
                            style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                          >
                            {formatJsonIfPossible(currentResponse.body)}
                          </pre>
                        )}
                        {respSubTab === 'raw' && (
                          <pre
                            className="font-mono"
                            style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                          >
                            {currentResponse.body}
                          </pre>
                        )}
                        {respSubTab === 'headers' && (
                          <pre className="font-mono" style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                            {currentResponse.rawHeaders || '(no headers)'}
                          </pre>
                        )}
                        {respSubTab === 'tls' && (
                          <div className="font-mono" style={{ fontSize: '0.74rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <div>Route: {currentResponse.routeUsed || 'Direct'}</div>
                            <div>
                              Timings: Dial {currentResponse.timing.dialMs}ms · TLS {currentResponse.timing.tlsMs}ms · TTFB{' '}
                              {currentResponse.timing.ttfbMs}ms · Total {currentResponse.timing.totalMs}ms
                            </div>
                            {currentResponse.tls ? (
                              <>
                                <div>TLS Version: {currentResponse.tls.version} ({currentResponse.tls.cipherSuite})</div>
                                <div>Subject: {currentResponse.tls.subject}</div>
                                <div>Issuer: {currentResponse.tls.issuer}</div>
                                <div>SANs: {(currentResponse.tls.dnsNames || []).join(', ') || '(none)'}</div>
                                <div>Expires: {currentResponse.tls.notAfter}</div>
                                <div>Verified: {currentResponse.tls.verified ? 'Yes' : 'Skipped (InsecureSkipVerify)'}</div>
                              </>
                            ) : (
                              <div style={{ color: 'var(--text-muted)' }}>No TLS session on this request.</div>
                            )}
                          </div>
                        )}
                        {respSubTab === 'cookies' && (
                          <pre className="font-mono" style={{ margin: 0, fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                            {(currentResponse.cookies || []).length > 0
                              ? (currentResponse.cookies || []).join('\n')
                              : '(no Set-Cookie headers returned)'}
                          </pre>
                        )}
                      </>
                    )}
                  </div>

                  {/* Quick Engagement Actions Footer */}
                  {currentResponse && (
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.4rem',
                        padding: '0.4rem 0.6rem',
                        borderTop: '1px solid color-mix(in srgb, var(--accent-bright) 15%, transparent)',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        fontSize: '0.72rem',
                      }}
                    >
                      <input
                        type="text"
                        className="cyber-input"
                        style={{ width: '110px', fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
                        placeholder="JSON key (e.g. token)"
                        value={extractJsonKey}
                        onChange={(e) => setExtractJsonKey(e.target.value)}
                      />
                      <input
                        type="text"
                        className="cyber-input"
                        style={{ width: '95px', fontSize: '0.7rem', padding: '0.2rem 0.4rem' }}
                        placeholder="Var name"
                        value={extractVarName}
                        onChange={(e) => setExtractVarName(e.target.value)}
                      />
                      <button type="button" className="cyber-hud-btn btn-sm" onClick={() => void handleExtractJsonVar()}>
                        Extract Var
                      </button>
                      {onSaveToNotes && (
                        <button type="button" className="cyber-hud-btn btn-sm" onClick={() => void handleSaveNotes()}>
                          Save to Notes
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Mode 2: Throttled Parameter Replay (Intruder-Lite) */}
          {mode === 'replay' && (
            <div style={{ padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', overflowY: 'auto', flex: 1 }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Replays the active request (<code>{activeReq.method} {activeReq.url}</code>) replacing <code>&#123;&#123;PAYLOAD&#125;&#125;</code> sequentially with OPSEC throttling &amp; Engagement Lockout Guard (F-40).
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <textarea
                  aria-label="Replay Payloads"
                  className="cyber-textarea font-mono"
                  rows={5}
                  style={{ flex: 1, minWidth: '240px', fontSize: '0.75rem' }}
                  value={replayPayloadsText}
                  onChange={(e) => setReplayPayloadsText(e.target.value)}
                  placeholder="One {{PAYLOAD}} value per line..."
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', minWidth: '210px' }}>
                  <label style={{ fontSize: '0.74rem' }}>
                    Delay between requests (ms, min 50):
                    <input
                      type="number"
                      className="cyber-input"
                      min={50}
                      value={replayDelayMs}
                      onChange={(e) => setReplayDelayMs(Math.max(50, Number(e.target.value) || 50))}
                    />
                  </label>
                  {replayRunning ? (
                    <button type="button" className="cyber-hud-btn btn-danger" onClick={() => void handleCancelActive()}>
                      Abort Replay
                    </button>
                  ) : (
                    <button type="button" className="cyber-btn cyber-btn-primary" onClick={() => void handleRunReplay()}>
                      <CyberIcon name="bolt" size={13} />
                      <span>Run Throttled Replay</span>
                    </button>
                  )}
                </div>
              </div>

              {replayResult?.lockoutWarning && (
                <div style={{ padding: '0.5rem 0.75rem', border: '1px solid rgba(245, 158, 11, 0.5)', background: 'rgba(245, 158, 11, 0.1)', color: '#fbbf24', fontSize: '0.76rem' }}>
                  {replayResult.lockoutWarning}
                </div>
              )}

              {replayResult && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', fontFamily: 'JetBrains Mono, monospace' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid color-mix(in srgb, var(--accent-bright) 30%, transparent)' }}>
                      <th style={{ padding: '0.35rem' }}>#</th>
                      <th style={{ padding: '0.35rem' }}>Payload</th>
                      <th style={{ padding: '0.35rem' }}>Status</th>
                      <th style={{ padding: '0.35rem' }}>Size</th>
                      <th style={{ padding: '0.35rem' }}>Time</th>
                      <th style={{ padding: '0.35rem' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {replayResult.results.map((r) => (
                      <tr key={r.index} style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.15)' }}>
                        <td style={{ padding: '0.35rem' }}>{r.index + 1}</td>
                        <td style={{ padding: '0.35rem' }}>{r.payload}</td>
                        <td style={{ padding: '0.35rem', color: statusBadgeColor(r.statusCode) }}>{r.status || r.error}</td>
                        <td style={{ padding: '0.35rem' }}>{r.sizeBytes} B</td>
                        <td style={{ padding: '0.35rem' }}>{r.totalMs}ms</td>
                        <td style={{ padding: '0.35rem' }}>
                          {r.response && (
                            <button
                              type="button"
                              className="cyber-hud-btn btn-sm"
                              onClick={() => {
                                setCurrentResponse(r.response || null);
                                setMode('repeater');
                              }}
                            >
                              Inspect
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Mode 3: Response Diff */}
          {mode === 'diff' && (
            <div style={{ padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.65rem', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  aria-label="Diff Left Response"
                  className="cyber-input"
                  style={{ flex: 1, minWidth: '180px', fontSize: '0.74rem' }}
                  value={diffLeftId}
                  onChange={(e) => setDiffLeftId(e.target.value)}
                >
                  <option value="">-- Select Response A --</option>
                  {history.map((h) => (
                    <option key={h.id} value={h.id}>
                      [{h.timestamp}] {h.response.statusCode} {h.request.method} {h.request.url}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Diff Right Response"
                  className="cyber-input"
                  style={{ flex: 1, minWidth: '180px', fontSize: '0.74rem' }}
                  value={diffRightId}
                  onChange={(e) => setDiffRightId(e.target.value)}
                >
                  <option value="">-- Select Response B --</option>
                  {history.map((h) => (
                    <option key={h.id} value={h.id}>
                      [{h.timestamp}] {h.response.statusCode} {h.request.method} {h.request.url}
                    </option>
                  ))}
                </select>
                <button type="button" className="cyber-btn cyber-btn-primary" onClick={() => void handleComputeDiff()}>
                  Compare
                </button>
              </div>

              {diffResult && (
                <>
                  <div className="font-mono" style={{ fontSize: '0.74rem', color: 'var(--accent-bright)' }}>
                    Status: {diffResult.statusDelta} · Size Delta: {diffResult.sizeDelta >= 0 ? `+${diffResult.sizeDelta}` : diffResult.sizeDelta} B · Time Delta: {diffResult.timeDeltaMs >= 0 ? `+${diffResult.timeDeltaMs}` : diffResult.timeDeltaMs}ms
                  </div>
                  <div className="font-mono" style={{ fontSize: '0.73rem', background: 'rgba(2, 6, 14, 0.9)', border: '1px solid color-mix(in srgb, var(--accent-bright) 20%, transparent)', padding: '0.5rem', overflowY: 'auto', flex: 1 }}>
                    {diffResult.bodyLines.map((ln, i) => (
                      <div
                        key={i}
                        style={{
                          whiteSpace: 'pre-wrap',
                          color: ln.kind === 'add' ? '#4ade80' : ln.kind === 'del' ? '#f87171' : '#94a3b8',
                          background: ln.kind === 'add' ? 'rgba(34, 197, 94, 0.08)' : ln.kind === 'del' ? 'rgba(239, 68, 68, 0.08)' : 'transparent',
                        }}
                      >
                        {ln.kind === 'add' ? '+ ' : ln.kind === 'del' ? '- ' : '  '}
                        {ln.text}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Mode 4: Bonus AI Chat Mode */}
          {mode === 'ai-chat' && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden', padding: '0.75rem', gap: '0.6rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '0.45rem', alignItems: 'center' }}>
                <select
                  aria-label="AI Provider"
                  className="cyber-input"
                  style={{ fontSize: '0.74rem' }}
                  value={aiProvider}
                  onChange={(e) => {
                    const p = e.target.value as 'openai' | 'anthropic' | 'ollama' | 'custom';
                    setAiProvider(p);
                    setAiEndpoint(AI_PRESETS[p].endpointUrl);
                    setAiModel(AI_PRESETS[p].defaultModel);
                    setAiAuthType(AI_PRESETS[p].authType);
                    if (AI_PRESETS[p].headerName) setAiHeaderName(AI_PRESETS[p].headerName || 'x-api-key');
                  }}
                >
                  {(Object.keys(AI_PRESETS) as Array<keyof typeof AI_PRESETS>).map((k) => (
                    <option key={k} value={k}>
                      {AI_PRESETS[k].label}
                    </option>
                  ))}
                </select>

                <input
                  aria-label="AI Endpoint URL"
                  type="text"
                  className="cyber-input font-mono"
                  style={{ fontSize: '0.73rem' }}
                  value={aiEndpoint}
                  onChange={(e) => setAiEndpoint(e.target.value)}
                  placeholder="https://.../v1/chat/completions"
                />

                <input
                  aria-label="AI Model"
                  type="text"
                  className="cyber-input font-mono"
                  style={{ fontSize: '0.73rem' }}
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  placeholder="Model (e.g. gpt-4o-mini / llama3.1)"
                />

                <input
                  aria-label="AI API Key or Secret Ref"
                  type="password"
                  className="cyber-input font-mono"
                  style={{ fontSize: '0.73rem' }}
                  value={aiBearerToken}
                  onChange={(e) => setAiBearerToken(e.target.value)}
                  placeholder="API Key or {{SECRET:id}}"
                />

                <select
                  aria-label="AI Route"
                  className="cyber-input"
                  style={{ fontSize: '0.73rem' }}
                  value={aiRouteId}
                  onChange={(e) => setAiRouteId(e.target.value)}
                >
                  {routes.map((rt) => (
                    <option key={rt.id || 'direct'} value={rt.id}>
                      {rt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.72rem', flexWrap: 'wrap' }}>
                <input
                  aria-label="AI System Prompt"
                  type="text"
                  className="cyber-input"
                  style={{ flex: 1, minWidth: '200px', fontSize: '0.72rem' }}
                  value={aiSystemPrompt}
                  onChange={(e) => setAiSystemPrompt(e.target.value)}
                  placeholder="Optional system prompt..."
                />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  Temp:
                  <input
                    type="number"
                    className="cyber-input"
                    style={{ width: '60px', fontSize: '0.72rem' }}
                    min={0}
                    max={2}
                    step={0.1}
                    value={aiTemperature}
                    onChange={(e) => setAiTemperature(Number(e.target.value) || 0)}
                  />
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={aiStreamEnabled} onChange={(e) => setAiStreamEnabled(e.target.checked)} />
                  <span>Stream</span>
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={aiTlsSkip} onChange={(e) => setAiTlsSkip(e.target.checked)} />
                  <span>Skip TLS Verify</span>
                </label>
                {aiLastResult?.rawRequestJson && (
                  <button type="button" className="cyber-hud-btn btn-sm" onClick={handleOpenAiInRepeater}>
                    Open in HTTP Repeater
                  </button>
                )}
                <button type="button" className="cyber-hud-btn btn-sm btn-danger" onClick={() => setAiMessages([])}>
                  Clear Chat
                </button>
              </div>

              {/* Conversation Transcript (rendered safely via MarkdownRenderer) */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowY: 'auto',
                  border: '1px solid color-mix(in srgb, var(--accent-bright) 22%, transparent)',
                  background: 'rgba(4, 8, 16, 0.85)',
                  padding: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem',
                }}
              >
                {aiMessages.length === 0 && !aiStreamingText && (
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                    Chat directly with OpenAI-compatible, Anthropic, Ollama, or custom internal LLM endpoints (optionally routed over SSH tunnels/pivots). Responses render safely with zero raw HTML.
                  </div>
                )}
                {aiMessages.map((msg, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '0.55rem 0.75rem',
                      borderLeft: `3px solid ${msg.role === 'user' ? 'var(--accent-bright)' : '#10b981'}`,
                      background: msg.role === 'user' ? 'color-mix(in srgb, var(--accent-bright) 7%, transparent)' : 'rgba(16, 185, 129, 0.06)',
                    }}
                  >
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: msg.role === 'user' ? 'var(--accent-bright)' : '#34d399', marginBottom: '0.25rem', fontFamily: 'JetBrains Mono, monospace' }}>
                      {msg.role.toUpperCase()}
                    </div>
                    {msg.role === 'assistant' ? (
                      <MarkdownRenderer content={msg.content} />
                    ) : (
                      <div style={{ fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                    )}
                  </div>
                ))}
                {aiStreamingText && (
                  <div style={{ padding: '0.55rem 0.75rem', borderLeft: '3px solid #10b981', background: 'rgba(16, 185, 129, 0.06)' }}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#34d399', marginBottom: '0.25rem', fontFamily: 'JetBrains Mono, monospace' }}>
                      ASSISTANT (STREAMING)
                    </div>
                    <MarkdownRenderer content={aiStreamingText} />
                  </div>
                )}
              </div>

              <form onSubmit={(e) => void handleSendAiPrompt(e)} style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  aria-label="AI Prompt Input"
                  type="text"
                  className="cyber-input"
                  style={{ flex: 1 }}
                  value={aiPromptInput}
                  onChange={(e) => setAiPromptInput(e.target.value)}
                  placeholder="Send a prompt to the AI endpoint..."
                />
                {isSending ? (
                  <button type="button" className="cyber-hud-btn btn-danger" onClick={() => void handleCancelActive()}>
                    Stop
                  </button>
                ) : (
                  <button type="submit" className="cyber-btn cyber-btn-primary">
                    <CyberIcon name="rocket" size={13} />
                    <span>Send Prompt</span>
                  </button>
                )}
              </form>
            </div>
          )}
        </main>
      </div>

      {/* Import cURL / OpenAPI Modal */}
      {showImportModal && (
        <div className="modal-backdrop cyber-modal-overlay" role="dialog" aria-label="Import cURL or OpenAPI">
          <div className="cyber-dialog-card" style={{ padding: '1rem', width: '600px' }}>
            <div className="dialog-header">
              <h3 style={{ margin: 0, color: 'var(--accent-bright)' }}>Import cURL / OpenAPI Spec</h3>
            </div>
            <div style={{ display: 'flex', gap: '0.45rem', margin: '0.65rem 0' }}>
              <button type="button" className={`cyber-hud-btn btn-sm ${importKind === 'curl' ? 'btn-primary' : ''}`} onClick={() => setImportKind('curl')}>
                cURL / Raw HTTP
              </button>
              <button type="button" className={`cyber-hud-btn btn-sm ${importKind === 'openapi' ? 'btn-primary' : ''}`} onClick={() => setImportKind('openapi')}>
                OpenAPI / Swagger JSON
              </button>
            </div>
            {importKind === 'openapi' && (
              <input
                type="text"
                className="cyber-input"
                style={{ marginBottom: '0.5rem' }}
                placeholder="Collection Name"
                value={importCollectionName}
                onChange={(e) => setImportCollectionName(e.target.value)}
              />
            )}
            <textarea
              aria-label="Import Content"
              className="cyber-textarea font-mono"
              rows={8}
              placeholder={importKind === 'curl' ? "curl -X POST https://api.target/login -d '{\"u\":\"admin\"}'" : '{"openapi":"3.0.0","paths":{...}}'}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="dialog-footer" style={{ marginTop: '0.75rem' }}>
              <button type="button" className="cyber-hud-btn btn-danger" onClick={() => setShowImportModal(false)}>
                Cancel
              </button>
              <button type="button" className="cyber-btn cyber-btn-primary" onClick={() => void handleImportSubmit()}>
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Environment Editor Modal */}
      {showEnvEditor && editingEnv && (
        <div className="modal-backdrop cyber-modal-overlay" role="dialog" aria-label="API Environment Editor">
          <div className="cyber-dialog-card" style={{ padding: '1rem', width: '580px' }}>
            <h3 style={{ margin: '0 0 0.65rem', color: 'var(--accent-bright)' }}>Environment Variables</h3>
            <input
              aria-label="Environment Name"
              type="text"
              className="cyber-input"
              style={{ marginBottom: '0.65rem' }}
              value={editingEnv.name}
              onChange={(e) => setEditingEnv({ ...editingEnv, name: e.target.value })}
            />
            <KeyValueEditor
              items={editingEnv.variables || []}
              keyPlaceholder="Variable (e.g. BASE_URL)"
              valuePlaceholder="Value"
              onChange={(variables) => setEditingEnv({ ...editingEnv, variables })}
            />
            <div className="dialog-footer" style={{ marginTop: '0.75rem' }}>
              <button type="button" className="cyber-hud-btn btn-danger" onClick={() => setShowEnvEditor(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="cyber-btn cyber-btn-primary"
                onClick={async () => {
                  const api = getApiBindings();
                  if (api?.SaveApiEnvironment) {
                    const saved = await api.SaveApiEnvironment(editingEnv);
                    setActiveEnvId(saved.id);
                    await loadWorkspaceData();
                  }
                  setShowEnvEditor(false);
                }}
              >
                Save Environment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Code Snippet Modal */}
      {snippetPreview && (
        <div className="modal-backdrop cyber-modal-overlay" role="dialog" aria-label="Generated Code Snippet">
          <div className="cyber-dialog-card" style={{ padding: '1rem', width: '600px' }}>
            <h3 style={{ margin: '0 0 0.65rem', color: 'var(--accent-bright)', textTransform: 'uppercase' }}>
              {snippetPreview.lang} Snippet
            </h3>
            <pre className="font-mono" style={{ margin: 0, padding: '0.65rem', background: 'rgba(2,6,14,0.9)', fontSize: '0.75rem', whiteSpace: 'pre-wrap', maxHeight: '300px', overflowY: 'auto' }}>
              {snippetPreview.code}
            </pre>
            <div className="dialog-footer" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="cyber-hud-btn"
                onClick={() => {
                  void navigator.clipboard?.writeText(snippetPreview.code);
                  setStatusBanner(`Copied ${snippetPreview.lang} snippet to clipboard.`);
                }}
              >
                Copy
              </button>
              <button type="button" className="cyber-btn cyber-btn-primary" onClick={() => setSnippetPreview(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KeyValueEditor({
  items,
  keyPlaceholder,
  valuePlaceholder,
  onChange,
}: {
  items: ApiKeyValue[];
  keyPlaceholder: string;
  valuePlaceholder: string;
  onChange: (next: ApiKeyValue[]) => void;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.38rem' }}>
      {items.map((row, idx) => (
        <div key={idx} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => {
              const next = items.map((it, i) => (i === idx ? { ...it, enabled: e.target.checked } : it));
              onChange(next);
            }}
          />
          <input
            type="text"
            className="cyber-input font-mono"
            style={{ flex: 1, fontSize: '0.74rem' }}
            placeholder={keyPlaceholder}
            value={row.key}
            onChange={(e) => {
              const next = items.map((it, i) => (i === idx ? { ...it, key: e.target.value } : it));
              onChange(next);
            }}
          />
          <input
            type="text"
            className="cyber-input font-mono"
            style={{ flex: 1.4, fontSize: '0.74rem' }}
            placeholder={valuePlaceholder}
            value={row.value}
            onChange={(e) => {
              const next = items.map((it, i) => (i === idx ? { ...it, value: e.target.value } : it));
              onChange(next);
            }}
          />
          <button
            type="button"
            className="cyber-hud-btn btn-sm btn-danger"
            onClick={() => onChange(items.filter((_, i) => i !== idx))}
          >
            <CyberIcon name="trash" size={11} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="cyber-hud-btn btn-sm"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => onChange([...items, { key: '', value: '', enabled: true }])}
      >
        <CyberIcon name="plus" size={11} />
        <span>Add Row</span>
      </button>
    </div>
  );
}
