# Firebase Service API for Other Extensions

The Firebase Service extension provides API commands that other extensions can use to access user authentication and data.

## Available API Commands

### 1. Get User Details
```typescript
// Get complete user details including Firestore data
const userDetails = await vscode.commands.executeCommand('firebase-service.api.getUserDetails');

// Response format:
{
  authenticated: boolean,
  user: {
    uid: string,
    email: string | null,
    displayName: string | null,
    photoURL: string | null,
    emailVerified: boolean,
    provider: string,
    // Additional fields from Firestore (if stored)
    createdAt?: Date,
    firstLoginAt?: Date,
    lastLoginAt?: Date,
    updatedAt?: Date
  } | null,
  error?: string
}
```

### 2. Check Authentication Status
```typescript
// Check if user is authenticated
const isAuthenticated = await vscode.commands.executeCommand('firebase-service.api.isAuthenticated');
// Returns: boolean
```

### 3. Get User ID
```typescript
// Get current user's UID
const userId = await vscode.commands.executeCommand('firebase-service.api.getUserId');
// Returns: string | null
```

## Usage Examples

### Example 1: Check if user is logged in before performing an action

```typescript
import * as vscode from 'vscode';

async function performProtectedAction() {
  const isAuthenticated = await vscode.commands.executeCommand('firebase-service.api.isAuthenticated');

  if (!isAuthenticated) {
    const result = await vscode.window.showWarningMessage(
      'You need to sign in to use this feature',
      'Sign In'
    );

    if (result === 'Sign In') {
      await vscode.commands.executeCommand('firebase-service.signIn');
    }
    return;
  }

  // Proceed with protected action
  console.log('User is authenticated, proceeding...');
}
```

### Example 2: Get user details for personalization

```typescript
import * as vscode from 'vscode';

async function personalizeGreeting() {
  const userDetails = await vscode.commands.executeCommand('firebase-service.api.getUserDetails');

  if (userDetails.authenticated && userDetails.user) {
    const name = userDetails.user.displayName || userDetails.user.email || 'User';
    vscode.window.showInformationMessage(`Welcome back, ${name}!`);
  } else {
    vscode.window.showInformationMessage('Welcome! Please sign in to get started.');
  }
}
```

### Example 3: Store extension-specific user data

```typescript
import * as vscode from 'vscode';

async function saveUserSettings(settings: any) {
  const userId = await vscode.commands.executeCommand('firebase-service.api.getUserId');

  if (!userId) {
    vscode.window.showErrorMessage('Please sign in first');
    return;
  }

  // Use the userId to store extension-specific data
  const collection = 'myExtension_settings';
  const documentId = userId;

  await vscode.commands.executeCommand(
    'firebase-service.storeData',
    collection,
    documentId,
    settings
  );

  vscode.window.showInformationMessage('Settings saved successfully');
}
```

### Example 4: Retrieve user-specific data

```typescript
import * as vscode from 'vscode';

async function loadUserSettings() {
  const userId = await vscode.commands.executeCommand('firebase-service.api.getUserId');

  if (!userId) {
    return null;
  }

  const collection = 'myExtension_settings';
  const documentId = userId;

  try {
    const data = await vscode.commands.executeCommand(
      'firebase-service.retrieveData',
      collection,
      documentId
    );

    return data?.data || null;
  } catch (error) {
    console.error('Failed to load user settings:', error);
    return null;
  }
}
```

### Example 5: Complete extension integration

```typescript
import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
  // Register a command that requires authentication
  const myCommand = vscode.commands.registerCommand('myExtension.doSomething', async () => {
    // Check authentication
    const userDetails = await vscode.commands.executeCommand('firebase-service.api.getUserDetails');

    if (!userDetails.authenticated) {
      const signIn = await vscode.window.showWarningMessage(
        'This feature requires Firebase authentication',
        'Sign In',
        'Cancel'
      );

      if (signIn === 'Sign In') {
        await vscode.commands.executeCommand('firebase-service.signIn');
      }
      return;
    }

    // Use user details
    const user = userDetails.user;
    console.log(`Executing command for user: ${user.email}`);

    // Store some data specific to this extension
    await vscode.commands.executeCommand(
      'firebase-service.storeData',
      'myExtension_data',
      `${user.uid}_${Date.now()}`,
      {
        action: 'command_executed',
        timestamp: new Date().toISOString(),
        userId: user.uid
      }
    );

    vscode.window.showInformationMessage('Action completed successfully!');
  });

  context.subscriptions.push(myCommand);
}
```

## User Data Stored Automatically

When a user successfully authenticates, the Firebase Service extension automatically stores the following data in Firestore under the `users` collection:

```typescript
{
  uid: string,              // Firebase User ID
  email: string | null,     // User's email
  displayName: string | null, // User's display name
  photoURL: string | null,  // User's profile photo URL
  emailVerified: boolean,   // Email verification status
  provider: string,         // Authentication provider (google, github, email)
  createdAt: Date,         // First time user authenticated (only on first login)
  firstLoginAt: Date,      // First login timestamp
  lastLoginAt: Date,       // Last login timestamp (updated on each login)
  updatedAt: Date          // Last update timestamp
}
```

## Best Practices

1. **Always check authentication status** before accessing user-specific features
2. **Handle errors gracefully** - API commands may fail if Firebase Service is not initialized
3. **Cache user details** if needed, but refresh periodically
4. **Use user ID for namespacing** - prefix your Firestore collections with your extension name
5. **Respect user privacy** - only store necessary data
6. **Test with unauthenticated state** - ensure your extension works even when user is not signed in

## Error Handling

```typescript
try {
  const userDetails = await vscode.commands.executeCommand('firebase-service.api.getUserDetails');

  if (userDetails.error) {
    console.error('Error getting user details:', userDetails.error);
    // Handle error
  }

  if (!userDetails.authenticated) {
    // Handle unauthenticated state
  }

  // Use userDetails.user
} catch (error) {
  console.error('Firebase Service may not be available:', error);
  // Fallback behavior
}
```

## Dependencies

To use the Firebase Service API, ensure that:
1. Firebase Service extension is installed and activated
2. User has configured Firebase credentials
3. User has granted necessary permissions
