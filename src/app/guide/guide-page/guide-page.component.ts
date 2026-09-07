import { Component } from '@angular/core';

@Component({
  selector: 'app-guide-page',
  templateUrl: './guide-page.component.html',
  styleUrl: './guide-page.component.css',
})
export class GuidePageComponent {
  readonly workflowAuthoringExample = [
    'Credit Recommendations',
    '',
    '@listen for account ID, requested amount, and authentication status',
    '@if {{ state.parsed_data.authenticated }}',
    '  @call use tool credit_profile with account_id {{ state.parsed_data.account_id }} and amount {{ state.parsed_data.requested_amount }}',
    '  @on_failure',
    '    @interrupt Ask the user for the missing account information',
    '  @think about the best recommendation and store it as recommendation',
    '  @reply {{ state.parsed_data.recommendation }}',
    '@else',
    '  @reply Ask the user to sign in',
  ].join('\n');

  readonly stateReferenceExample = '{{ state... }}';
}
