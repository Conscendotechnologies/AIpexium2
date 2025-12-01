# Firebase Service Extension

A comprehensive Firebase service extension for VS Code that provides authentication, analytics, and data storage capabilities.

## Features

- **Authentication**: Sign in with Google, GitHub, or email/password
- **Analytics**: Track user interactions, process events, performance metrics, and lifecycle events
- **Data Storage**: Store and retrieve data using Firestore
- **Privacy Compliant**: GDPR-compliant with user consent management

## Installation

1. Clone this repository into your VS Code extensions folder
2. Run `npm install` to install dependencies
3. Run `npm run compile` to build the extension
4. Configure Firebase credentials (see Configuration section)

## Configuration

Before using the extension, you need to configure your Firebase project credentials. You can do this in two ways:

### Method 1: VS Code Settings

Add the following to your VS Code settings:

```json
{
  "firebase-service.apiKey": "your-api-key",
  "firebase-service.authDomain": "your-project.firebaseapp.com",
  "firebase-service.projectId": "your-project-id",
  "firebase-service.storageBucket": "your-project.appspot.com",
  "firebase-service.messagingSenderId": "123456789",
  "firebase-service.appId": "1:123456789:web:abcdef123456"
}
```

### Method 2: Environment Variables

Set the following environment variables:

```bash
FIREBASE_API_KEY=your-api-key
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=123456789
FIREBASE_APP_ID=1:123456789:web:abcdef123456
```

## Usage

### Initialization

First, initialize the Firebase service:

```typescript
await vscode.commands.executeCommand('firebase-service.initialize');
```

### Authentication

#### Sign In

```typescript
// Sign in with Google
await vscode.commands.executeCommand('firebase-service.signIn');
```

#### Sign Out

```typescript
await vscode.commands.executeCommand('firebase-service.signOut');
```

#### Get Current User

```typescript
const user = await vscode.commands.executeCommand('firebase-service.getUser');
```

### Analytics

#### Log Process Events

```typescript
await vscode.commands.executeCommand('firebase-service.logProcessEvent', 'file_opened', {
  fileExtension: '.ts',
  projectType: 'typescript'
});
```

#### Log Interaction Events

```typescript
await vscode.commands.executeCommand('firebase-service.logInteractionEvent', 'command_executed', {
  command: 'workbench.action.files.newUntitledFile',
  source: 'command_palette'
});
```

#### Log Performance Events

```typescript
await vscode.commands.executeCommand('firebase-service.logPerformanceEvent', 'response_time', 150, {
  endpoint: '/api/search',
  method: 'GET'
});
```

#### Set User Properties

```typescript
await vscode.commands.executeCommand('firebase-service.setUserProperty', 'user_type', 'developer');
await vscode.commands.executeCommand('firebase-service.setUserProperty', 'experience_level', 'senior');
```

### Data Storage

#### Store Data

```typescript
await vscode.commands.executeCommand('firebase-service.storeData', 'userPreferences', 'user123', {
  theme: 'dark',
  fontSize: 14,
  autoSave: true
});
```

#### Retrieve Data

```typescript
const data = await vscode.commands.executeCommand('firebase-service.retrieveData', 'userPreferences', 'user123');
```

## Event Categories

The extension supports four main event categories:

### Process Events
Track IDE operations and workflows:
- `file_opened`, `file_saved`, `file_closed`
- `build_started`, `build_completed`
- `debug_started`, `debug_stopped`
- `test_run`, `extension_activated`

### Interaction Events
Track user interactions with the IDE:
- `command_executed`
- `menu_clicked`, `button_clicked`
- `search_performed`
- `settings_changed`

### Performance Events
Track performance metrics:
- `response_time`
- `memory_usage`
- `cpu_usage`
- `error_rate`

### Lifecycle Events
Track application lifecycle:
- `session_start`, `session_end`
- `workspace_opened`, `workspace_closed`

## Privacy & Compliance

- **User Consent**: The extension requires explicit user consent before collecting any data
  - **Step 1**: A custom webview popup asks for quick consent ("Yes" or "No" - cannot be cancelled)
    - Includes "Learn More" accordion with complete privacy information
  - **Step 2**: If user clicks "No", a webview panel shows:
    - Clear explanation of what features are unavailable without consent
    - Two options: "I Consent" or "Don't Ask Again"
    - Choosing "Don't Ask Again" prevents the consent popup from appearing on future IDE launches
  - This design ensures users make an informed decision about their data
  - Consent can be reviewed and changed at any time using the `FBS: Review Privacy Consent` command
  - Users who chose "Don't Ask Again" can reset their preference via the review command
- **Data Minimization**: Only collects necessary data for authentication and functionality
- **GDPR Compliance**: Provides options to opt-out of data collection
- **Secure Storage**: All data is stored securely in Firebase with user authentication
- **Transparency**: Clear information about what features are unavailable without consent

## Configuration Options

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `firebase-service.enableDataStorage` | boolean | `true` | Enable Firebase Firestore data storage |
| `firebase-service.enableDebugLogging` | boolean | `false` | Enable debug logging |
| `firebase-service.privacyConsent` | boolean | `false` | User consent for data collection |

## Development

### Building

```bash
npm run compile
```

### Testing

```bash
npm run test
```

### Debugging

Enable debug logging in VS Code settings:

```json
{
  "firebase-service.enableDebugLogging": true
}
```

## API Reference

### Commands

- `firebase-service.initialize`: Initialize the Firebase service
- `firebase-service.signIn`: Sign in to Firebase
- `firebase-service.signOut`: Sign out from Firebase
- `firebase-service.getUser`: Get current user information
- `firebase-service.logEvent`: Log a custom analytics event
- `firebase-service.setUserProperty`: Set a user property for analytics
- `firebase-service.logProcessEvent`: Log a process-related event
- `firebase-service.logInteractionEvent`: Log a user interaction event
- `firebase-service.logPerformanceEvent`: Log a performance metric
- `firebase-service.storeData`: Store data in Firestore
- `firebase-service.retrieveData`: Retrieve data from Firestore
- `firebase-service.getAnalyticsStatus`: Get analytics service status
- `firebase-service.reviewPrivacyConsent`: Review and manage privacy consent settings

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This extension is licensed under the MIT License.
