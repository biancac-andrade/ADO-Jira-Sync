/**
 * Tipos do payload Azure DevOps Service Hooks e do contexto HTTP da Function.
 * O Azure envia formatos distintos por evento (PR, push, pipeline); por isso muitos campos são opcionais.
 */
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
    pipeline?: { name?: string };
    resources?: { repositories?: Array<{ refName?: string; name?: string }> };
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
  refUpdates?: Array<{ name?: string; oldObjectId?: string; newObjectId?: string }>;
  status?: string;
  isDraft?: boolean;
  reviewers?: Array<{
    id?: string;
    displayName?: string;
    uniqueName?: string;
    vote?: number;
  }>;
  pullRequest?: AzureResource;
  [key: string]: unknown;
}

export interface WebhookPayload {
  eventType?: string;
  resource?: AzureResource;
  [key: string]: unknown;
}

export interface HttpRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: WebhookPayload;
  rawBody?: WebhookPayload;
}

export interface HttpResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface InvocationContext {
  log: (...args: unknown[]) => void;
  res?: HttpResponse;
}
