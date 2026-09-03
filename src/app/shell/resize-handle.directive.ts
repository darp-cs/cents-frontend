import { Directive, ElementRef, inject, input, output } from '@angular/core';

@Directive({
  selector: '[appResizeHandle]',
  host: {
    class: 'resize-handle',
    role: 'separator',
    'aria-orientation': 'vertical',
    tabindex: '0',
    '(pointerdown)': 'onPointerDown($event)',
    '(keydown)': 'onKeyDown($event)',
  },
})
export class ResizeHandleDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly width = input.required<number>({ alias: 'appResizeHandle' });
  readonly minWidth = input(180);
  readonly maxWidth = input(720);
  /** Set when the handle sits on the left edge of the panel, so dragging left grows it. */
  readonly invert = input(false);

  readonly widthChange = output<number>();

  onPointerDown(event: PointerEvent) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    const element = this.host.nativeElement;
    const startX = event.clientX;
    const startWidth = this.width();

    const onMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) * (this.invert() ? -1 : 1);
      this.widthChange.emit(this.clamp(startWidth + delta));
    };

    const onEnd = () => {
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onEnd);
      element.removeEventListener('pointercancel', onEnd);
      document.body.classList.remove('is-resizing');
    };

    element.setPointerCapture(event.pointerId);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onEnd);
    element.addEventListener('pointercancel', onEnd);
    document.body.classList.add('is-resizing');
  }

  onKeyDown(event: KeyboardEvent) {
    const step = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0;
    if (!step) {
      return;
    }

    event.preventDefault();
    this.widthChange.emit(this.clamp(this.width() + step * (this.invert() ? -1 : 1)));
  }

  private clamp(width: number): number {
    return Math.min(Math.max(Math.round(width), this.minWidth()), this.maxWidth());
  }
}
