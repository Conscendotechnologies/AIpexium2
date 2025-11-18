# Firebase Service - UI Integration Guide

## Overview

The Firebase Service extension now includes a comprehensive UI integration with:
- Activity Bar menu with tree view
- Status bar showing logged-in user
- Interactive database commands
- Context-aware menus

## UI Components

### 1. Activity Bar Integration

A new **Firebase Service** icon (flame) appears in the activity bar with three main sections:

#### 📝 Authentication Section
- Displays current user status
- Shows user name/email when signed in
- Quick access to Sign In/Sign Out

#### 💾 Firestore Database Section
- **Store Data** - Interactive command to store data
- **Retrieve Data** - Interactive command to fetch data

#### 📊 Analytics Section
- **Log Event** - Record analytics events
- **View Status** - Check analytics service status

### 2. Status Bar

Located in the bottom right corner:
- **When signed in**: `🔥 [User Name/Email]`
  - Click to view authentication options
  - Normal background color
- **When not signed in**: `🔥 Firebase: Not signed in`
  - Click to initiate sign-in
  - Warning background color (orange)
- **On error**: `🔥 Firebase: Error`
  - Click for error details
  - Error background color (red)

### 3. Interactive Commands

#### Store Data Flow
1. Command: `FBS: Store Data (Interactive)`
2. **Step 1**: Enter collection name
   - Example: `users`
   - Validation: Cannot be empty
3. **Step 2**: Enter document ID
   - Example: `user123`
   - Leave empty for auto-generation
4. **Step 3**: Enter data as JSON
   - Example: `{"name": "John Doe", "email": "john@example.com"}`
   - Validation: Must be valid JSON
5. **Automatic additions**:
   - `_storedBy`: Current user's email or UID
   - `_storedAt`: ISO timestamp
6. **Confirmation**: Shows success message with path
7. **Analytics**: Logs `data_stored` event

#### Retrieve Data Flow
1. Command: `FBS: Retrieve Data (Interactive)`
2. **Step 1**: Enter collection name
   - Validation: Cannot be empty
3. **Step 2**: Enter document ID
   - Validation: Cannot be empty
4. **Result**: Opens new JSON document with data
5. **Analytics**: Logs `data_retrieved` event

## Menu Structure

### Command Palette
All commands available with `FBS:` prefix:
- Initialize Firebase Service
- Sign In
- Sign Out
- Get Current User
- Store Data (Interactive)
- Retrieve Data (Interactive)
- Log Analytics Event
- Show Authentication Status
- Refresh Session

### View Title Menu
When viewing the Firebase Service explorer:
- **When not authenticated**:
  - Sign In button (navigation group)
- **When authenticated**:
  - Sign Out button (navigation group)
  - Refresh Session button (navigation group)

### Context Menus
Right-click on tree items:
- **Firestore items**: Store Data, Retrieve Data
- **Analytics items**: Log Event

## Context Keys

The extension sets VS Code context keys for menu visibility:
- `firebase-service.authenticated`: Boolean indicating sign-in status
  - Used to show/hide commands based on authentication state

## Event Flow

### Sign In Process
1. User clicks "Sign In" in tree view or status bar
2. Provider selection dialog appears
3. External browser opens for authentication
4. User completes OAuth flow
5. Redirects back to VS Code with auth token
6. Extension processes authentication
7. **Events fired**:
   - Auth state change event (true)
   - Tree view refresh
   - Status bar update
   - Context key update

### Sign Out Process
1. User clicks "Sign Out"
2. Session cleared from storage
3. **Events fired**:
   - Auth state change event (false)
   - Tree view refresh
   - Status bar update
   - Context key update

### Data Operations
1. User triggers store/retrieve command
2. Authentication check performed
3. If not authenticated, prompt to sign in
4. Interactive prompts collect information
5. Operation executed
6. Analytics event logged
7. Success/error notification shown

## Implementation Details

### New Files Created
1. `src/views/firebaseTreeDataProvider.ts`
   - Tree view provider for activity bar
   - Listens to auth state changes
   - Provides hierarchical menu structure

2. `src/views/statusBarManager.ts`
   - Manages status bar item
   - Updates based on authentication state
   - Color-coded status indicators

### Modified Files
1. `package.json`
   - Added `viewsContainers` for activity bar
   - Added `views` configuration
   - Added `menus` for command palette, view title, and context
   - Added icons to commands
   - Added new interactive commands

2. `src/extension.ts`
   - Integrated tree view provider
   - Integrated status bar manager
   - Added interactive database commands
   - Set up event listeners for auth state changes
   - Context key management

## Usage Examples

### Example 1: Store User Preferences
```
1. Click Firebase icon in activity bar
2. Expand "Firestore Database"
3. Click "Store Data"
4. Collection: preferences
5. Document ID: user_settings
6. Data: {"theme": "dark", "fontSize": 14}
7. ✓ Stored with metadata
```

### Example 2: Retrieve User Data
```
1. Navigate to Firestore Database → Retrieve Data
2. Collection: preferences
3. Document ID: user_settings
4. ✓ Opens JSON document with data including:
   - Your stored data
   - _storedBy field
   - _storedAt timestamp
```

### Example 3: Monitor Authentication
```
1. Check status bar for current user
2. Click status bar to see options
3. Use tree view for detailed auth info
4. Refresh session if needed
```

## Benefits

1. **Discoverability**: All features visible in activity bar
2. **Context-Aware**: Menus adapt to authentication state
3. **User Feedback**: Real-time status in status bar
4. **Guided Workflow**: Interactive prompts reduce errors
5. **Automatic Tracking**: Analytics logged automatically
6. **Metadata**: Audit trail for all data operations

## Future Enhancements

Potential improvements:
- Collection browser in tree view
- Recent documents list
- Batch operations
- Query builder
- Real-time data sync indicators
- Offline mode support
