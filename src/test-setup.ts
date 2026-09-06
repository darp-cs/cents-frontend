class ResizeObserverStub {
  observe() {
    // no-op for unit tests
  }

  unobserve() {
    // no-op for unit tests
  }

  disconnect() {
    // no-op for unit tests
  }
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
