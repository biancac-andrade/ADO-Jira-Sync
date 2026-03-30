/**
 * Tipos compartilhados: payload Azure DevOps, contexto da Function e recursos.
 */

/** Recurso genérico do payload (pull request, run, build, etc.). */
export interface AzureResource {
  title?: string;
  sourceBranch?: string;
  sourceRefName?: string;
  state?: string;
  runState?: string;
  run?: {
    id?: number;
    state?: string;
    runState?: string;
    createdDate?: string;
    finishTime?: string;
    result?: string;
    sourceBranch?: string;
    _links?: { web?: { href?: string } };
  };
  id?: number;
  runId?: number;
  buildId?: number;
  startTime?: string;
  createdDate?: string;
  queuedTime?: string;
  finishTime?: string;
  result?: string;
  name?: string;
  pipeline?: { name?: string };
  sourceVersion?: string;
  lastMergeCommit?: { commitId?: string };
  repository?: {
    name?: string;
    url?: string;
  };
  _links?: {
    web?: { href?: string };
  };
  url?: string;
  [key: string]: unknown;
}

/** Payload completo do webhook Azure DevOps (Service Hooks). */
export interface WebhookPayload {
  eventType?: string;
  resource?: AzureResource;
  [key: string]: unknown;
}

/** Request HTTP recebida pela Azure Function. */
export interface HttpRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: WebhookPayload;
  rawBody?: WebhookPayload;
}

/** Resposta HTTP que a Function envia. */
export interface HttpResponse {
  status: number;
  body: Record<string, unknown>;
}

/** Contexto da Azure Function (v3/v4). */
export interface InvocationContext {
  log: (...args: unknown[]) => void;
  res?: HttpResponse;
}
