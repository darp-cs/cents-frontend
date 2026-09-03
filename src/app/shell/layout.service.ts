import { Injectable, WritableSignal, effect, signal } from '@angular/core';

const STORAGE_PREFIX = 'cents.layout.';

function readStored<T extends number | boolean>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (raw === null) {
      return fallback;
    }

    if (typeof fallback === 'boolean') {
      return (raw === 'true') as T;
    }

    const parsed = Number(raw);
    return (Number.isFinite(parsed) ? parsed : fallback) as T;
  } catch {
    return fallback;
  }
}

@Injectable({ providedIn: 'root' })
export class LayoutService {
  readonly navCollapsed = this.persisted<boolean>('nav.collapsed', false);
  readonly navWidth = this.persisted<number>('nav.width', 236);

  readonly chatCollapsed = this.persisted<boolean>('chat.collapsed', false);
  readonly chatWidth = this.persisted<number>('chat.width', 420);

  readonly conversationsVisible = this.persisted<boolean>('conversations.visible', false);
  readonly conversationsWidth = this.persisted<number>('conversations.width', 220);

  private persisted<T extends number | boolean>(key: string, fallback: T): WritableSignal<T> {
    const state = signal(readStored(key, fallback));

    effect(() => {
      const value = state();
      try {
        localStorage.setItem(STORAGE_PREFIX + key, String(value));
      } catch {
        // Storage can be unavailable (private mode); layout still works for this session.
      }
    });

    return state;
  }
}
