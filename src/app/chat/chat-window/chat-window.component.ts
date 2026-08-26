import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../chat.service';
import { ConversationService } from '../../conversations/conversation.service';

@Component({
  selector: 'app-chat-window',
  imports: [FormsModule],
  templateUrl: './chat-window.component.html',
  styleUrl: './chat-window.component.css',
})
export class ChatWindowComponent {
  private readonly chatService = inject(ChatService);
  private readonly conversationService = inject(ConversationService);

  draft = '';

  readonly activeConversation = this.conversationService.activeConversation;
  readonly messages = computed(() =>
    this.chatService.messagesForConversation(this.conversationService.activeConversationId())
  );

  readonly isSending = this.chatService.isSending;
  readonly isStreaming = this.chatService.isStreaming;
  readonly sendError = this.chatService.sendError;
  readonly streamError = this.chatService.streamError;
  readonly streamBuffer = this.chatService.streamBuffer;

  async sendMessage() {
    const conversation = this.activeConversation();
    if (!conversation) {
      return;
    }

    const nextDraft = this.draft;
    this.draft = '';
    await this.chatService.sendMessage(conversation.id, nextDraft);
  }

  ngOnDestroy() {
    this.chatService.closeStream();
  }
}
