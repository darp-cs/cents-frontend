import { inject, Injectable, signal } from '@angular/core';
import { HttpClient, HttpEventType, HttpProgressEvent, HttpResponse } from '@angular/common/http';
import { catchError, finalize, tap, throwError } from 'rxjs';
import { API_BASE_URL } from '../core/api-config';

export interface UploadedDocument {
  id: string;
  name: string;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class DocumentService {
  private readonly http = inject(HttpClient);

  readonly documents = signal<UploadedDocument[]>([]);
  readonly isListing = signal(false);
  readonly listError = signal<string | null>(null);

  readonly isUploading = signal(false);
  readonly uploadProgress = signal(0);
  readonly uploadError = signal<string | null>(null);

  listDocuments() {
    this.listError.set(null);
    this.isListing.set(true);

    return this.http.get<UploadedDocument[]>(`${API_BASE_URL}/documents`).pipe(
      tap((documents) => this.documents.set(documents)),
      catchError((error) => {
        this.listError.set(this.toErrorMessage(error, 'Failed to load documents.'));
        return throwError(() => error);
      }),
      finalize(() => this.isListing.set(false))
    );
  }

  uploadDocument(file: File) {
    this.uploadError.set(null);
    this.isUploading.set(true);
    this.uploadProgress.set(0);

    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<UploadedDocument>(`${API_BASE_URL}/documents/upload`, formData, {
      observe: 'events',
      reportProgress: true,
    }).pipe(
      tap((event) => {
        if (event.type === HttpEventType.UploadProgress) {
          const progress = this.toProgressPercent(event);
          this.uploadProgress.set(progress);
        }

        if (event.type === HttpEventType.Response) {
          const response = event as HttpResponse<UploadedDocument>;
          if (response.body) {
            this.documents.update((documents) => [response.body as UploadedDocument, ...documents]);
          }
        }
      }),
      catchError((error) => {
        this.uploadError.set(this.toErrorMessage(error, 'Upload failed.'));
        return throwError(() => error);
      }),
      finalize(() => {
        this.isUploading.set(false);
      })
    );
  }

  private toProgressPercent(event: HttpProgressEvent) {
    if (!event.total || event.total <= 0) {
      return 0;
    }

    return Math.round((event.loaded / event.total) * 100);
  }

  private toErrorMessage(error: unknown, fallback: string) {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const payload = (error as { error?: { message?: string } }).error;
      if (payload?.message) {
        return payload.message;
      }
    }

    return fallback;
  }
}
