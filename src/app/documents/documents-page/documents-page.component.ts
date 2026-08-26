import { Component, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DocumentUploadComponent } from '../document-upload/document-upload.component';
import { DocumentService } from '../document.service';

@Component({
  selector: 'app-documents-page',
  imports: [DocumentUploadComponent, DatePipe, RouterLink],
  templateUrl: './documents-page.component.html',
  styleUrl: './documents-page.component.css',
})
export class DocumentsPageComponent {
  private readonly documentService = inject(DocumentService);

  readonly documents = this.documentService.documents;
  readonly isListing = this.documentService.isListing;
  readonly listError = this.documentService.listError;

  constructor() {
    this.documentService.listDocuments().subscribe();
  }
}
