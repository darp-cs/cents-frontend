import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { API_BASE_URL } from '../core/api-config';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface ChatRequest {
  conversation_id: string;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly authService = inject(AuthService);

  private readonly messagesByConversationSignal = signal<Record<string, ChatMessage[]>>({});
  private readonly streamAbortControllerSignal = signal<AbortController | null>(null);

  readonly streamBuffer = signal('');
  readonly isSending = signal(false);
  readonly isStreaming = signal(false);
  readonly sendError = signal<string | null>(null);
  readonly streamError = signal<string | null>(null);

  messagesForConversation(conversationId: string | null) {
    if (!conversationId) {
      return [];
    }

    return this.messagesByConversationSignal()[conversationId] ?? [];
  }

  async sendMessage(conversationId: string, message: string) {
    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    this.sendError.set(null);
    this.streamError.set(null);
    this.isSending.set(true);
    this.streamBuffer.set('');

    this.appendMessage(conversationId, {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
    });

    const request: ChatRequest = {
      conversation_id: conversationId,
      message: trimmed,
    };

    try {
      await this.openChatStream(request, 1);
    } catch (error) {
      this.sendError.set(this.toErrorMessage(error, 'Failed to send message.'));
    } finally {
      this.isSending.set(false);
    }
  }

  closeStream() {
    const controller = this.streamAbortControllerSignal();
    if (controller) {
      controller.abort();
      this.streamAbortControllerSignal.set(null);
    }
    this.isStreaming.set(false);
  }

  private async openChatStream(request: ChatRequest, retriesLeft: number): Promise<void> {
    this.closeStream();

    const controller = new AbortController();
    this.streamAbortControllerSignal.set(controller);

    this.isStreaming.set(true);

    try {
      const token = this.authService.getToken();
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Chat request failed with status ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Chat stream response body is empty.');
      }

      await this.consumeSseStream(response.body.getReader(), request.conversation_id);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      if (retriesLeft > 0) {
        await this.openChatStream(request, retriesLeft - 1);
        return;
      }

      this.streamError.set(this.toErrorMessage(error, 'Streaming connection failed.'));
      this.finalizeStreamedAssistantMessage(request.conversation_id);
      throw error;
    } finally {
      if (this.streamAbortControllerSignal() === controller) {
        this.streamAbortControllerSignal.set(null);
      }
      this.isStreaming.set(false);
    }
  }

  private async consumeSseStream(reader: ReadableStreamDefaultReader<Uint8Array>, conversationId: string) {
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';

      for (const chunk of chunks) {
        this.processSseChunk(chunk, conversationId);
      }
    }

    if (buffer.trim().length > 0) {
      this.processSseChunk(buffer, conversationId);
    }

    this.finalizeStreamedAssistantMessage(conversationId);
  }

  private processSseChunk(chunk: string, conversationId: string) {
    const dataLines = chunk
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());

    for (const payload of dataLines) {
      if (!payload || payload === '[DONE]') {
        this.finalizeStreamedAssistantMessage(conversationId);
        continue;
      }

      try {
        const parsed = JSON.parse(payload) as {
          token?: string;
          message?: string;
          error?: string;
          done?: boolean;
        };

        if (parsed.error) {
          this.streamError.set(parsed.error);
          this.finalizeStreamedAssistantMessage(conversationId);
          continue;
        }

        if (typeof parsed.token === 'string') {
          this.streamBuffer.update((current) => current + parsed.token);
        }

        if (typeof parsed.message === 'string') {
          this.streamBuffer.update((current) => current + parsed.message);
        }

        if (parsed.done) {
          this.finalizeStreamedAssistantMessage(conversationId);
        }
      } catch {
        this.streamBuffer.update((current) => current + payload);
      }
    }
  }

  private finalizeStreamedAssistantMessage(conversationId: string) {
    const content = this.streamBuffer().trim();
    if (!content) {
      return;
    }

    this.appendMessage(conversationId, {
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      created_at: new Date().toISOString(),
    });

    this.streamBuffer.set('');
  }

  private appendMessage(conversationId: string, message: ChatMessage) {
    this.messagesByConversationSignal.update((state) => {
      const currentMessages = state[conversationId] ?? [];
      return {
        ...state,
        [conversationId]: [...currentMessages, message],
      };
    });
  }

  private toErrorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return fallback;
  }
}
