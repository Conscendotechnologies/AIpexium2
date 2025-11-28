# Firebase Service API for Other Extensions

The Firebase Service extension provides an exported API that other extensions can use to access user authentication and data storage directly, without relying on VS Code commands.

## Accessing the API

Other extensions can access the Firebase Service API by getting the extension and its exports:

```typescript
import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
  // Get the Firebase Service extension
  const firebaseExt = vscode.extensions.getExtension('ConscendoTechInc.firebase-service');

  if (firebaseExt) {
    // Access the exported API
    const { firebaseAPI } = firebaseExt.exports;

    // Now you can use firebaseAPI methods
    console.log('Firebase API available:', firebaseAPI);
  } else {
    console.warn('Firebase Service extension not found');
  }
}
```

## Available API Methods

### 1. Login
```typescript
// Authenticate with email and password
const result = await firebaseAPI.login('user@example.com', 'password');

// Response format:
{
  success: boolean,
  user?: {
    uid: string,
    email: string | null,
    displayName: string | null,
    // ... other user properties
  },
  error?: string
}
```

### 2. Logout
```typescript
// Sign out the current user
await firebaseAPI.logout();
```

### 3. Get Current User
```typescript
// Get current authenticated user details
const user = await firebaseAPI.getCurrentUser();

// Returns: AuthSession object or null
{
  user: {
    uid: string,
    email: string | null,
    displayName: string | null,
    // ... other user properties
  },
  // ... other session data
}
```

### 4. Auth State Changes (Event)
```typescript
// Listen to authentication state changes
firebaseAPI.onAuthStateChanged((isAuthenticated: boolean) => {
  if (isAuthenticated) {
    console.log('User signed in');
  } else {
    console.log('User signed out');
  }
});
```

### 5. Store Data
```typescript
// Store data in Firestore
const result = await firebaseAPI.storeData('myCollection', 'documentId', {
  key: 'value',
  timestamp: new Date()
});

// Response format:
{
  success: boolean,
  error?: string
}
```

### 6. Get Data
```typescript
// Retrieve data from Firestore
const data = await firebaseAPI.getData('myCollection', 'documentId');

// Returns: FirestoreDocument object or { error: string }
{
  id: string,
  data: Record<string, any>,
  createdAt: Date,
  updatedAt: Date,
  userId?: string
}
```

## Usage Examples

### Example 1: Complete Extension Integration

```typescript
import * as vscode from 'vscode';

let firebaseAPI: any = null;

export async function activate(context: vscode.ExtensionContext) {
  // Get Firebase API
  const firebaseExt = vscode.extensions.getExtension('ConscendoTechInc.firebase-service');
  if (!firebaseExt) {
    vscode.window.showErrorMessage('Firebase Service extension is required');
    return;
  }

  firebaseAPI = firebaseExt.exports.firebaseAPI;

  // Listen to auth changes
  firebaseAPI.onAuthStateChanged(async (isAuthenticated: boolean) => {
    if (isAuthenticated) {
      const user = await firebaseAPI.getCurrentUser();
      vscode.window.showInformationMessage(`Welcome, ${user?.user?.displayName || user?.user?.email || 'User'}!`);
    }
  });

  // Register commands that use Firebase
  const myCommand = vscode.commands.registerCommand('myExtension.saveData', async () => {
    if (!firebaseAPI) return;

    const user = await firebaseAPI.getCurrentUser();
    if (!user) {
      vscode.window.showWarningMessage('Please sign in first');
      return;
    }

    // Save some data
    const result = await firebaseAPI.storeData('myExtension_data', user.user.uid, {
      action: 'command_executed',
      timestamp: new Date().toISOString()
    });

    if (result.success) {
      vscode.window.showInformationMessage('Data saved successfully!');
    } else {
      vscode.window.showErrorMessage(`Failed to save data: ${result.error}`);
    }
  });

  context.subscriptions.push(myCommand);
}
```

### Example 2: Authentication Flow

```typescript
import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
  const firebaseExt = vscode.extensions.getExtension('ConscendoTechInc.firebase-service');
  if (!firebaseExt) return;

  const { firebaseAPI } = firebaseExt.exports;

  // Create authentication UI
  const authCommand = vscode.commands.registerCommand('myExtension.authenticate', async () => {
    const email = await vscode.window.showInputBox({
      prompt: 'Enter your email',
      placeHolder: 'user@example.com'
    });

    if (!email) return;

    const password = await vscode.window.showInputBox({
      prompt: 'Enter your password',
      password: true
    });

    if (!password) return;

    const result = await firebaseAPI.login(email, password);

    if (result.success) {
      vscode.window.showInformationMessage('Successfully signed in!');
    } else {
      vscode.window.showErrorMessage(`Sign in failed: ${result.error}`);
    }
  });

  const logoutCommand = vscode.commands.registerCommand('myExtension.logout', async () => {
    await firebaseAPI.logout();
    vscode.window.showInformationMessage('Signed out successfully');
  });

  context.subscriptions.push(authCommand, logoutCommand);
}
```

### Example 3: Data Management

```typescript
import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext) {
  const firebaseExt = vscode.extensions.getExtension('ConscendoTechInc.firebase-service');
  if (!firebaseExt) return;

  const { firebaseAPI } = firebaseExt.exports;

  // Save user preferences
  const savePrefsCommand = vscode.commands.registerCommand('myExtension.savePreferences', async () => {
    const user = await firebaseAPI.getCurrentUser();
    if (!user) {
      vscode.window.showWarningMessage('Please sign in first');
      return;
    }

    const preferences = {
      theme: 'dark',
      language: 'typescript',
      autoSave: true
    };

    const result = await firebaseAPI.storeData('user_preferences', user.user.uid, preferences);

    if (result.success) {
      vscode.window.showInformationMessage('Preferences saved!');
    }
  });

  // Load user preferences
  const loadPrefsCommand = vscode.commands.registerCommand('myExtension.loadPreferences', async () => {
    const user = await firebaseAPI.getCurrentUser();
    if (!user) return;

    const data = await firebaseAPI.getData('user_preferences', user.user.uid);

    if (data && !data.error) {
      console.log('Loaded preferences:', data.data);
      // Apply preferences to extension
    }
  });

  context.subscriptions.push(savePrefsCommand, loadPrefsCommand);
}
```

## Error Handling

```typescript
// Always check if Firebase Service is available
const firebaseExt = vscode.extensions.getExtension('ConscendoTechInc.firebase-service');
if (!firebaseExt) {
  console.error('Firebase Service extension not installed');
  return;
}

try {
  const { firebaseAPI } = firebaseExt.exports;

  // All API methods can throw or return error objects
  const result = await firebaseAPI.login(email, password);
  if (!result.success) {
    // Handle login error
    vscode.window.showErrorMessage(`Login failed: ${result.error}`);
  }

  const data = await firebaseAPI.getData(collection, docId);
  if (data.error) {
    // Handle data retrieval error
    console.error('Failed to get data:', data.error);
  }

} catch (error) {
  console.error('Unexpected error:', error);
}
```

## Best Practices

1. **Check extension availability** at activation time
2. **Handle authentication state** - provide fallbacks for unauthenticated users
3. **Validate data** before storing in Firestore
4. **Use user IDs for namespacing** - avoid data conflicts between users
5. **Implement proper error handling** for all API calls
6. **Cache data locally** when possible to reduce Firestore calls
7. **Respect user privacy** - only store necessary data
8. **Test with both authenticated and unauthenticated states**

## Dependencies

To use the Firebase Service API, ensure that:
1. Firebase Service extension (`ConscendoTechInc.firebase-service`) is installed and activated
2. Firebase has been properly configured in the extension
3. User has necessary permissions for data operations

## Migration from Command-based API

If you were previously using VS Code commands, here's how to migrate:

```typescript
// Old way (commands)
const userDetails = await vscode.commands.executeCommand('firebase-service.api.getUserDetails');

// New way (direct API)
const { firebaseAPI } = firebaseExt.exports;
const user = await firebaseAPI.getCurrentUser();
```

The exported API provides more direct access and better TypeScript support compared to command execution.
