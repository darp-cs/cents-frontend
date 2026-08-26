import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConversationListComponent } from '../../conversations/conversation-list/conversation-list.component';
import { ChatWindowComponent } from '../chat-window/chat-window.component';

@Component({
  selector: 'app-chat-page',
  imports: [ConversationListComponent, ChatWindowComponent, RouterLink],
  templateUrl: './chat-page.component.html',
  styleUrl: './chat-page.component.css',
})
export class ChatPageComponent {}
