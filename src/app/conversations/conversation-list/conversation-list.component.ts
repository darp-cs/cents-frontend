import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ConversationService } from '../conversation.service';

@Component({
  selector: 'app-conversation-list',
  imports: [DatePipe],
  templateUrl: './conversation-list.component.html',
  styleUrl: './conversation-list.component.css',
})
export class ConversationListComponent {
  private readonly conversationService = inject(ConversationService);

  readonly conversations = this.conversationService.conversations;
  readonly activeConversationId = this.conversationService.activeConversationId;
  readonly isLoading = this.conversationService.isLoading;
  readonly isMutating = this.conversationService.isMutating;
  readonly error = this.conversationService.error;

  createConversation() {
    this.conversationService.createConversation('New conversation').subscribe();
  }

  selectConversation(conversationId: string) {
    this.conversationService.setActiveConversation(conversationId);
  }

  renameConversation(conversationId: string, currentTitle: string) {
    const title = window.prompt('Rename conversation', currentTitle)?.trim();
    if (!title) {
      return;
    }

    this.conversationService.renameConversation(conversationId, title).subscribe();
  }

  deleteConversation(conversationId: string) {
    const shouldDelete = window.confirm('Delete this conversation?');
    if (!shouldDelete) {
      return;
    }

    this.conversationService.deleteConversation(conversationId).subscribe();
  }
}
