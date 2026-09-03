import { Component, computed, inject } from '@angular/core';
import { ConversationListComponent } from '../../conversations/conversation-list/conversation-list.component';
import { ConversationService } from '../../conversations/conversation.service';
import { LayoutService } from '../../shell/layout.service';
import { ResizeHandleDirective } from '../../shell/resize-handle.directive';
import { ChatWindowComponent } from '../chat-window/chat-window.component';

@Component({
  selector: 'app-chat-panel',
  imports: [ConversationListComponent, ChatWindowComponent, ResizeHandleDirective],
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.css',
  host: {
    '[style.width.px]': 'panelWidth()',
  },
})
export class ChatPanelComponent {
  private readonly layout = inject(LayoutService);
  private readonly conversationService = inject(ConversationService);

  readonly isCollapsed = this.layout.chatCollapsed;
  readonly chatWidth = this.layout.chatWidth;
  readonly conversationsVisible = this.layout.conversationsVisible;
  readonly conversationsWidth = this.layout.conversationsWidth;

  readonly panelWidth = computed(() => (this.isCollapsed() ? null : this.chatWidth()));

  constructor() {
    this.conversationService.ensureConversationLoaded().subscribe();
  }

  expand() {
    this.isCollapsed.set(false);
  }

  collapse() {
    this.isCollapsed.set(true);
  }

  toggleConversations() {
    this.conversationsVisible.update((visible) => !visible);
  }
}
