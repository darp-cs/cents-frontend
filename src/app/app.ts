import { Component, inject } from '@angular/core';
import { AuthService } from './auth/auth.service';
import { NavShellComponent } from './shell/nav-shell/nav-shell.component';

@Component({
  imports: [NavShellComponent],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private readonly authService = inject(AuthService);

  constructor() {
    void this.authService.silentCheck();
  }
}
