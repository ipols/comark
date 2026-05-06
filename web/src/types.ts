// Wire types shared between the SPA and the local comark server.

export type TextQuoteSelector = {
  type: 'TextQuoteSelector';
  exact: string;
  prefix?: string;
  suffix?: string;
};

export type TextPositionSelector = {
  type: 'TextPositionSelector';
  start: number;
  end: number;
};

export type Selector = TextQuoteSelector | TextPositionSelector;

export type ThreadTurnRole = 'user' | 'assistant';

export type ThreadTurn = {
  role: ThreadTurnRole;
  text: string;
  state?: 'complete' | 'incomplete';
  kind?: 'selection-anchored' | 'follow-up' | 'quick-action';
};

export type AnchorState = 'anchored' | 'approximate' | 'orphaned';

export type CommentLifecycleState = 'open' | 'resolved' | 'dismissed';

export type CommentUiState =
  | 'idle'
  | 'pending'
  | 'answering'
  | 'answer-ready'
  | 'error'
  | 'resolved'
  | 'dismissed';

export type Comment = {
  id: string;
  createdAt: string;
  updatedAt: string;
  state: CommentLifecycleState;
  uiState?: CommentUiState;
  anchorState: AnchorState;
  thread: ThreadTurn[];
  target: {
    selectors: Selector[];
    docHash?: string;
    docLength?: number;
  };
  lastResolvedAt?: string;
  lastResolvedScore?: number;
  resolvedRange?: { start: number; end: number };
  lastError?: string;
};

export type DocPayload = {
  docId: string;
  filePath: string;
  content: string;
  contextSummary: string | null;
  model: string | null;
  comments: Comment[];
  persistenceWarning?: string;
};
