import { Component, inject } from '@angular/core';
import { DocumentService } from '../document.service';

@Component({
  selector: 'app-document-upload',
  templateUrl: './document-upload.component.html',
  styleUrl: './document-upload.component.css',
})
export class DocumentUploadComponent {
  private readonly documentService = inject(DocumentService);

  readonly isUploading = this.documentService.isUploading;
  readonly uploadProgress = this.documentService.uploadProgress;
  readonly uploadError = this.documentService.uploadError;

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.documentService.uploadDocument(file).subscribe();
  }
}
