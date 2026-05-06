/*
 * Comment thread UI state machine.
 *
 *   idle ─submit─> pending ─stream-start─> answering ─stream-complete─> answer-ready
 *                                                                       │ ├─ accept ──> resolved
 *                                                                       │ ├─ refuse ──> dismissed
 *                                                                       │ └─ continue ─> pending (new turn)
 *                                                                       │
 *   pending|answering ─api-error──> error
 *   error ─retry──> pending
 *   error ─edit│dismiss──> idle│dismissed
 *
 * Persisted to the sidecar so a refresh shows the correct state.
 */

import type { CommentUiState } from '../types';

export type StateEvent =
  | { type: 'submit' }
  | { type: 'stream-start' }
  | { type: 'stream-complete' }
  | { type: 'stream-error' }
  | { type: 'accept' }
  | { type: 'refuse' }
  | { type: 'continue' }
  | { type: 'retry' }
  | { type: 'edit' }
  | { type: 'dismiss' };

export function nextState(current: CommentUiState, event: StateEvent): CommentUiState {
  switch (event.type) {
    case 'submit':
      return 'pending';
    case 'stream-start':
      return current === 'pending' ? 'answering' : current;
    case 'stream-complete':
      return 'answer-ready';
    case 'stream-error':
      return 'error';
    case 'accept':
      return 'resolved';
    case 'refuse':
      return 'dismissed';
    case 'continue':
      return 'pending';
    case 'retry':
      return 'pending';
    case 'edit':
      return 'idle';
    case 'dismiss':
      return 'dismissed';
    default:
      return current;
  }
}

export const TERMINAL_STATES: ReadonlySet<CommentUiState> = new Set(['resolved', 'dismissed']);

export function isThreadActive(state: CommentUiState | undefined): boolean {
  if (!state) return false;
  return state === 'pending' || state === 'answering' || state === 'answer-ready' || state === 'error';
}
