import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';

export interface PlaceholderPageData {
  title: string;
  description: string;
}

@Component({
  selector: 'app-placeholder-page',
  templateUrl: './placeholder-page.component.html',
  styleUrl: './placeholder-page.component.css',
})
export class PlaceholderPageComponent {
  private readonly route = inject(ActivatedRoute);

  readonly page = toSignal(this.route.data.pipe(map((data) => data as PlaceholderPageData)), {
    initialValue: this.route.snapshot.data as PlaceholderPageData,
  });
}
