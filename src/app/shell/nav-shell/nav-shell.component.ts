import { Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { ChatPanelComponent } from '../../chat/chat-panel/chat-panel.component';
import { LayoutService } from '../layout.service';
import { ResizeHandleDirective } from '../resize-handle.directive';

interface NavItem {
  label: string;
  route: string;
  icon: string;
}

const AUTH_ROUTES = ['/login', '/register'];

@Component({
  selector: 'app-nav-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ChatPanelComponent, ResizeHandleDirective],
  templateUrl: './nav-shell.component.html',
  styleUrl: './nav-shell.component.css',
})
export class NavShellComponent {
  private readonly authService = inject(AuthService);
  private readonly layout = inject(LayoutService);
  private readonly router = inject(Router);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  readonly navItems: readonly NavItem[] = [
    { label: 'Guide', route: '/guide', icon: 'M4 4h6a3 3 0 0 1 3 3v13H7a3 3 0 0 0-3 3zM20 4h-6a3 3 0 0 0-3 3v13h6a3 3 0 0 1 3 3z' },
    { label: 'Documents', route: '/documents', icon: 'M6 2h7l5 5v15H6zM13 2v6h5' },
    { label: 'Tools', route: '/tools', icon: 'M14 3a5 5 0 0 0-4.6 7l-6.4 6.4 2.6 2.6 6.4-6.4A5 5 0 1 0 14 3z' },
    { label: 'Agents', route: '/agents', icon: 'M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0z' },
    { label: 'Knowledge Base', route: '/knowledge-base', icon: 'M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4zM20 4h-6a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h6z' },
    { label: 'Configuration', route: '/configuration', icon: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2' },
    { label: 'Metrics', route: '/metrics', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  ];

  readonly isNavCollapsed = this.layout.navCollapsed;
  readonly navWidth = this.layout.navWidth;
  readonly isChatCollapsed = this.layout.chatCollapsed;
  readonly chatWidth = this.layout.chatWidth;

  readonly isChromeVisible = computed(
    () => this.authService.isAuthenticated() && !AUTH_ROUTES.some((route) => this.currentUrl().startsWith(route))
  );

  toggleNav() {
    this.isNavCollapsed.update((collapsed) => !collapsed);
  }
}
